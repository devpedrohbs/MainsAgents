import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDesktopStateStore } from './desktop-state-store.mjs';

// AppData can resolve to a different physical database when a Windows MSIX
// launcher supplies package identity. Keep workspace data outside that overlay.
export const desktopStorageDirectory = home => join(home, '.mainsagents', 'storage');

export async function openDesktopWorkspaceStore(home, legacyDirectory, version) {
  const directory = desktopStorageDirectory(home);
  const destination = join(directory, 'workspace-state.sqlite');
  const legacy = join(legacyDirectory, 'workspace-state.sqlite');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(destination) && existsSync(legacy)) {
    // SQLite backup includes committed WAL contents. A raw file copy could
    // restore an older base or combine journals from two virtualized locations.
    const temporary = join(directory, `migration-${randomUUID()}.sqlite`);
    const source = new DatabaseSync(legacy, { readOnly: true });
    try {
      const integrity = source.prepare('PRAGMA integrity_check').all();
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
        throw new Error('Existing workspace database failed integrity verification. Restore a backup before opening the app.');
      }
      await backup(source, temporary);
    } finally { source.close(); }
    // Failed migration leaves the original intact, and never seeds empty data.
    const migrated = new DatabaseSync(temporary, { readOnly: true });
    try {
      if (migrated.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
        throw new Error('Workspace migration could not be verified. Original data was preserved.');
      }
    } finally { migrated.close(); }
    renameSync(temporary, destination);
  }
  return createDesktopStateStore(directory, version);
}
