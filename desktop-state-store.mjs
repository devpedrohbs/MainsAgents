import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// This file lives in userData, never in the application installation directory.
export function createDesktopStateStore(directory, version) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'workspace-state.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (profile TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key)); CREATE TABLE IF NOT EXISTS profiles (profile TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);');
  const previous = db.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;
  if (previous !== version) {
    const rows = db.prepare('SELECT profile,key,value FROM state ORDER BY profile,key').all();
    if (rows.length) {
      const backupDirectory = join(directory, 'backups');
      mkdirSync(backupDirectory, { recursive: true });
      writeFileSync(join(backupDirectory, `workspace-before-${version}-${Date.now()}.json`), JSON.stringify({ format: 'mainsagents-desktop-state', version: 1, appVersion: previous, createdAt: new Date().toISOString(), rows }), { flag: 'wx' });
    }
    db.prepare("INSERT OR REPLACE INTO metadata VALUES ('app-version',?)").run(version);
  }
  const validateProfile = profile => {
    if (typeof profile !== 'string' || profile.length > 256 || !profile) throw new Error('Invalid storage profile');
  };
  const validateKey = key => {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Invalid storage key');
  };
  const transaction = operation => {
    db.exec('BEGIN IMMEDIATE');
    try { operation(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const all = profile => Object.fromEntries(db.prepare('SELECT key,value FROM state WHERE profile=?').all(profile).map(row => [row.key, JSON.parse(row.value)]));
  const put = db.prepare('INSERT OR REPLACE INTO state VALUES (?,?,?)');
  return {
    currentProfile() { return db.prepare("SELECT value FROM metadata WHERE key='active-profile'").get()?.value; },
    selectProfile(profile) { validateProfile(profile); db.prepare("INSERT OR REPLACE INTO metadata VALUES ('active-profile',?)").run(profile); },
    hasProfile(profile) { validateProfile(profile); return Boolean(db.prepare('SELECT profile FROM profiles WHERE profile=?').get(profile)); },
    initialize(profile, values) {
      validateProfile(profile);
      if (this.hasProfile(profile)) return;
      transaction(() => {
        for (const [key, value] of Object.entries(values)) { validateKey(key); put.run(profile, key, JSON.stringify(value)); }
        db.prepare('INSERT INTO profiles VALUES (?)').run(profile);
        if (!this.currentProfile()) this.selectProfile(profile);
      });
    },
    read(profile, key) { validateProfile(profile); validateKey(key); const row = db.prepare('SELECT value FROM state WHERE profile=? AND key=?').get(profile,key); return row ? JSON.parse(row.value) : undefined; },
    write(profile, key, value) {
      validateProfile(profile); validateKey(key);
      if (!this.hasProfile(profile)) throw new Error('Storage profile has not been restored');
      put.run(profile, key, JSON.stringify(value));
    },
    readAll(profile) { validateProfile(profile); return all(profile); },
    replaceAll(profile, values) {
      validateProfile(profile);
      if (!this.hasProfile(profile)) throw new Error('Storage profile has not been restored');
      transaction(() => {
        db.prepare('DELETE FROM state WHERE profile=?').run(profile);
        for (const [key,value] of Object.entries(values)) { validateKey(key); put.run(profile,key,JSON.stringify(value)); }
      });
    },
    close() { db.close(); },
  };
}
