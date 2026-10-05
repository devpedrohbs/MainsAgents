import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { desktopStorageDirectory } from './desktop-storage-location.mjs';
import { createContentWorkflowBridge } from './content-workflow-bridge.mjs';

/** Editorial and core data share one permanent SQLite file and atomic restores. */
export function openDesktopEditorialBridge(home, legacyDirectory, options = {}) {
  const destination = join(desktopStorageDirectory(home), 'workspace-state.sqlite');
  const legacy = join(legacyDirectory, 'editorial.sqlite');
  const db = new DatabaseSync(destination);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    if (!db.prepare("SELECT value FROM metadata WHERE key='editorial-migration-v1'").get()) {
      let rows = [];
      if (existsSync(legacy)) {
        const source = new DatabaseSync(legacy, {readOnly: true});
        try {
          if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Editorial migration failed integrity verification. Existing data was preserved.');
          rows = source.prepare('SELECT profile_id,revision,state_json,updated_at FROM editorial_state').all();
          for (const row of rows) {
            const state = JSON.parse(row.state_json);
            if (state.schemaVersion !== 1 || !['topics','contents','runs','artifacts','approvals'].every(key => Array.isArray(state[key]))) throw new Error('Existing editorial state cannot be migrated safely.');
          }
        } finally { source.close(); }
      }
      if(rows.length){
        const backups=join(desktopStorageDirectory(home),'backups');mkdirSync(backups,{recursive:true});
        writeFileSync(join(backups,`editorial-before-migration-${Date.now()}.json`),JSON.stringify({format:'mainsagents-editorial-recovery',createdAt:new Date().toISOString(),rows}),{flag:'wx',mode:0o600});
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('CREATE TABLE IF NOT EXISTS editorial_state (profile_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state_json TEXT NOT NULL,updated_at TEXT NOT NULL)');
        const insert = db.prepare('INSERT OR IGNORE INTO editorial_state VALUES (?,?,?,?)');
        rows.forEach(row => insert.run(row.profile_id,row.revision,row.state_json,row.updated_at));
        db.prepare("INSERT INTO metadata VALUES ('editorial-migration-v1',?)").run(new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  } finally { db.close(); }
  return createContentWorkflowBridge({dbPath: destination, ...options});
}
