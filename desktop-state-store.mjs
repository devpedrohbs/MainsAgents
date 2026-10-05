import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {executionSnapshot,executionRevision,restoreExecution} from './editorial-execution-backup.mjs';
import {validateEditorialAssets} from './editorial-assets-validation.mjs';
import {validatePublications} from './editorial-publications.mjs';

// This file lives in userData, never in the application installation directory.
export function createDesktopStateStore(directory, version) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'workspace-state.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (profile TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile,key)); CREATE TABLE IF NOT EXISTS profiles (profile TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);');
  db.exec('CREATE TABLE IF NOT EXISTS agent_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT,profile TEXT NOT NULL,value TEXT NOT NULL,saved_at TEXT NOT NULL);');
  const previous = db.prepare("SELECT value FROM metadata WHERE key='app-version'").get()?.value;
  if (previous !== version) {
    const rows = db.prepare('SELECT profile,key,value FROM state ORDER BY profile,key').all();
    if (rows.length) {
      const backupDirectory = join(directory, 'backups');
      mkdirSync(backupDirectory, { recursive: true });
      const editorialRows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='editorial_state'").get()?db.prepare('SELECT * FROM editorial_state ORDER BY profile_id').all():[];
      const executions=Object.fromEntries(db.prepare('SELECT profile FROM profiles').all().map(row=>[row.profile,executionSnapshot(db,row.profile)]));
      writeFileSync(join(backupDirectory, `workspace-before-${version}-${Date.now()}.json`), JSON.stringify({ format: 'mainsagents-desktop-state', version: 1, appVersion: previous, createdAt: new Date().toISOString(), rows,editorialRows,executions }), { flag: 'wx',mode:0o600 });
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
  const hash = value => value === undefined ? null : createHash('sha256').update(value).digest('hex');
  const preserveAgents = profile => {
    const previous = db.prepare("SELECT value FROM state WHERE profile=? AND key='agents'").get(profile)?.value;
    if (previous === undefined) return;
    db.prepare('INSERT INTO agent_revisions(profile,value,saved_at) VALUES (?,?,?)').run(profile,previous,new Date().toISOString());
    db.prepare('DELETE FROM agent_revisions WHERE profile=? AND id NOT IN (SELECT id FROM agent_revisions WHERE profile=? ORDER BY id DESC LIMIT 50)').run(profile,profile);
  };
  const editorial = profile => {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='editorial_state'").get()) return {revision:0,state:{schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]}};
    const row=db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile);
    return row?{revision:row.revision,state:JSON.parse(row.state_json)}:{revision:0,state:{schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]}};
  };
  return {
    workspaceSnapshot(profile) {
      validateProfile(profile);
      let result;
      transaction(()=>{const execution=executionSnapshot(db,profile);result={...this.readAllVersioned(profile),editorial:editorial(profile),execution,executionRevision:executionRevision(execution)};});
      return result;
    },
    restoreWorkspace(profile,values,nextEditorial,expected,nextExecution) {
      validateProfile(profile);
      if(!this.hasProfile(profile))throw new Error('Storage profile has not been restored');
      if(nextEditorial?.schemaVersion!==1||!['topics','contents','runs','artifacts','approvals'].every(key=>Array.isArray(nextEditorial[key]))||!validateEditorialAssets(nextEditorial)||!validatePublications(nextEditorial))throw new Error('Invalid editorial backup');
      if(nextEditorial.assets)nextEditorial={...nextEditorial,assets:nextEditorial.assets.map(asset=>({...asset,status:'unchecked',checkedAt:undefined,lastError:undefined}))};
      transaction(()=>{
        const current=this.readAllVersioned(profile);
        const execution=executionSnapshot(db,profile);
        if(execution.jobs.some(job=>['queued','running'].includes(job.status)))throw new Error('Wait for active editorial work to finish before restoring a backup.');
        if(execution.work?.some(job=>['queued','running'].includes(job.status)))throw new Error('Cancel or finish persistent work before restoring a backup.');
        if(execution.actions?.some(action=>['pending','approved','running'].includes(action.status)))throw new Error('Finish or deny active tool actions before restoring a backup.');
        if(execution.delegations?.some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel agent collaboration before restoring a backup.');
        if(execution.mediaJobs?.some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel video exports before restoring a backup.');
        for(const delivery of editorial(profile).state?.publications??[]){
          if(delivery.operation?.phase==='requesting')throw new Error('Wait for the provider operation to finish before restoring a backup.');
          if(delivery.operation?.phase==='uncertain'&&JSON.stringify(delivery.operation)!==JSON.stringify(nextEditorial.publications?.find(item=>item.id===delivery.id)?.operation))throw new Error('Reconcile unresolved provider operations before replacing their history with a backup.');
        }
        if(expected.executionRevision&&executionRevision(execution)!==expected.executionRevision)throw new Error('Executions changed while preparing the restore. Review the backup again.');
        if(JSON.stringify(current.revisions)!==JSON.stringify(expected.revisions)||editorial(profile).revision!==expected.editorialRevision)throw new Error('Saved data changed while preparing the restore. Review the backup again.');
        preserveAgents(profile);
        db.prepare('DELETE FROM state WHERE profile=?').run(profile);
        for(const [key,value] of Object.entries(values)){validateKey(key);put.run(profile,key,JSON.stringify(value));}
        db.prepare('INSERT OR REPLACE INTO editorial_state VALUES (?,?,?,?)').run(profile,expected.editorialRevision+1,JSON.stringify(nextEditorial),new Date().toISOString());
        if(nextExecution)restoreExecution(db,profile,nextExecution.state,nextExecution.mode);
      });
    },
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
    readAllVersioned(profile) {
      validateProfile(profile);
      const rows=db.prepare('SELECT key,value FROM state WHERE profile=?').all(profile);
      return { values:Object.fromEntries(rows.map(row=>[row.key,JSON.parse(row.value)])), revisions:Object.fromEntries(rows.map(row=>[row.key,hash(row.value)])) };
    },
    write(profile, key, value, expectedRevision) {
      validateProfile(profile); validateKey(key);
      if (!this.hasProfile(profile)) throw new Error('Storage profile has not been restored');
      const serialized=JSON.stringify(value);
      transaction(()=>{
        const previous=db.prepare('SELECT value FROM state WHERE profile=? AND key=?').get(profile,key)?.value;
        if(expectedRevision!==undefined && expectedRevision!==hash(previous)) throw new Error('Newer saved data exists. Your changes are still in memory; export a backup and reload before continuing.');
        if(previous===serialized) return;
        if(key==='agents') preserveAgents(profile);
        put.run(profile,key,serialized);
        db.prepare("INSERT OR REPLACE INTO metadata VALUES ('last-saved-at',?)").run(new Date().toISOString());
      });
      return {revision:hash(serialized),savedAt:new Date().toISOString()};
    },
    readAll(profile) { validateProfile(profile); return all(profile); },
    replaceAll(profile, values) {
      validateProfile(profile);
      if (!this.hasProfile(profile)) throw new Error('Storage profile has not been restored');
      transaction(() => {
        preserveAgents(profile);
        db.prepare('DELETE FROM state WHERE profile=?').run(profile);
        for (const [key,value] of Object.entries(values)) { validateKey(key); put.run(profile,key,JSON.stringify(value)); }
      });
    },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(FULL)'); },
    recoverySnapshot() {
      const backupDirectory=join(directory,'backups'); mkdirSync(backupDirectory,{recursive:true});
      const path=join(backupDirectory,'workspace-latest.json'), temporary=join(backupDirectory,'workspace-latest.tmp');
      const editorialRows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='editorial_state'").get()?db.prepare('SELECT * FROM editorial_state ORDER BY profile_id').all():[];
      const executions=Object.fromEntries(db.prepare('SELECT profile FROM profiles').all().map(row=>[row.profile,executionSnapshot(db,row.profile)]));
      writeFileSync(temporary,JSON.stringify({format:'mainsagents-desktop-state',version:1,appVersion:version,createdAt:new Date().toISOString(),rows:db.prepare('SELECT profile,key,value FROM state ORDER BY profile,key').all(),editorialRows,executions}),{mode:0o600});
      renameSync(temporary,path); this.checkpoint(); return path;
    },
    close() { db.close(); },
  };
}
