import {createHash} from 'node:crypto';
import {workflowExecutionSnapshot,restoreWorkflowExecution} from './workflow-execution-backup.mjs';
import {actionHash} from './runtime-action-approvals.mjs';
import {productionSnapshot,restoreProductions} from './production-backup.mjs';

const tables=['editorial_jobs','editorial_job_events','editorial_connections'];
const exists=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
export function executionSnapshot(db,profile){
  const jobs=exists(db,tables[0])?db.prepare('SELECT * FROM editorial_jobs WHERE profile_id=? ORDER BY id').all(profile):[];
  const events=exists(db,tables[1])?db.prepare('SELECT job_id,event,at FROM editorial_job_events WHERE job_id IN (SELECT id FROM editorial_jobs WHERE profile_id=?) ORDER BY id').all(profile):[];
  const connections=exists(db,tables[2])?db.prepare('SELECT workspace_id,config_json FROM editorial_connections WHERE profile_id=? ORDER BY workspace_id').all(profile):[];
  const actions=exists(db,'runtime_actions')?db.prepare('SELECT * FROM runtime_actions WHERE profile_id=? ORDER BY id').all(profile):[];
  const delegations=exists(db,'agent_delegation_jobs')?db.prepare('SELECT * FROM agent_delegation_jobs WHERE profile_id=? ORDER BY id').all(profile):[];
  const delegationSessions=exists(db,'agent_delegation_sessions')?db.prepare('SELECT * FROM agent_delegation_sessions WHERE profile_id=? ORDER BY id').all(profile):[];
  const mediaJobs=exists(db,'editorial_media_jobs')?db.prepare('SELECT * FROM editorial_media_jobs WHERE profile_id=? ORDER BY id').all(profile):[];
  return {jobs,events,connections,actions,delegations,delegationSessions,mediaJobs,productions:productionSnapshot(db,profile),...workflowExecutionSnapshot(db,profile)};
}
export const executionRevision=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Import is a data restore, never permission to replay remote writes. */
export function restoreExecution(db,profile,incoming,mode='replace'){
  if(!incoming||!Array.isArray(incoming.jobs)||!Array.isArray(incoming.events)||!Array.isArray(incoming.connections))throw new Error('Invalid execution backup.');
  if(mode==='replace'){
    db.prepare('DELETE FROM editorial_job_events WHERE job_id IN (SELECT id FROM editorial_jobs WHERE profile_id=?)').run(profile);
    db.prepare('DELETE FROM editorial_jobs WHERE profile_id=?').run(profile);
    db.prepare('DELETE FROM editorial_connections WHERE profile_id=?').run(profile);
  }
  for(const row of incoming.jobs){
    const fields=['id','content_id','artifact_id','artifact_hash','destination','payload_json','checkpoint_json','created_at','updated_at'];
    if(fields.some(key=>typeof row[key]!=='string')||!['queued','running','succeeded','failed','canceled'].includes(row.status)||!Number.isSafeInteger(row.attempts)||row.attempts<0)throw new Error('Invalid execution record.');
    JSON.parse(row.payload_json);JSON.parse(row.checkpoint_json);
    const result=row.result_json?JSON.parse(row.result_json):null;
    if(result){const url=new URL(result.url);if(url.protocol!=='https:'||!['notion.so','www.notion.so','notion.com','www.notion.com','app.notion.com'].includes(url.hostname))throw new Error('Invalid Notion receipt URL.');}
    // IDs cannot replace another profile's jobs, even from an imported backup.
    const old=db.prepare('SELECT profile_id FROM editorial_jobs WHERE id=?').get(row.id);
    if(old&&old.profile_id!==profile)throw new Error('Execution ID belongs to another profile.');
    const status=['queued','running'].includes(row.status)?'failed':row.status;
    db.prepare('INSERT OR IGNORE INTO editorial_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,profile,row.content_id,row.artifact_id,row.artifact_hash,row.destination,status,row.payload_json,row.checkpoint_json,row.result_json??null,status==='failed'?'Restored from backup. Review the destination and retry explicitly.':row.error??null,row.attempts,row.created_at,row.updated_at);
  }
  for(const row of incoming.events){
    if(typeof row.job_id!=='string'||typeof row.event!=='string'||typeof row.at!=='string')throw new Error('Invalid execution event.');
    if(db.prepare('SELECT id FROM editorial_jobs WHERE id=? AND profile_id=?').get(row.job_id,profile)&&!db.prepare('SELECT id FROM editorial_job_events WHERE job_id=? AND event=? AND at=?').get(row.job_id,row.event,row.at))db.prepare('INSERT INTO editorial_job_events(job_id,event,at) VALUES (?,?,?)').run(row.job_id,row.event,row.at);
  }
  for(const row of incoming.connections){
    if(typeof row.workspace_id!=='string'||typeof row.config_json!=='string')throw new Error('Invalid connection record.');
    const config=JSON.parse(row.config_json);
    if(typeof config.dataSourceId!=='string'||!/^$|^[a-f0-9]{32}$|^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(config.dataSourceId))throw new Error('Invalid Notion destination.');
    db.prepare('INSERT OR IGNORE INTO editorial_connections VALUES (?,?,?)').run(profile,row.workspace_id,JSON.stringify({...config,autoSync:false}));
  }
  restoreWorkflowExecution(db,profile,incoming,mode);
  restoreProductions(db,profile,incoming.productions,mode);
  if(exists(db,'editorial_media_jobs')){
    if(mode==='replace')db.prepare('DELETE FROM editorial_media_jobs WHERE profile_id=?').run(profile);
    for(const row of incoming.mediaJobs??[]){
      if(typeof row.id!=='string'||typeof row.data_json!=='string'||typeof row.updated_at!=='string')throw new Error('Invalid media work backup.');
      const job=JSON.parse(row.data_json);
      if(job.id!==row.id||!/^media-[a-f0-9-]{36}$/.test(job.id)||!['queued','running','failed','interrupted','succeeded','canceled'].includes(job.status)||!Number.isFinite(job.start)||!Number.isFinite(job.duration)||job.duration<=0)throw new Error('Invalid media export record.');
      const existing=db.prepare('SELECT profile_id FROM editorial_media_jobs WHERE id=?').get(job.id);if(existing&&existing.profile_id!==profile)throw new Error('Media work belongs to another profile.');
      Object.assign(job,{profileId:profile,ownerPid:0,imported:true});
      if(['queued','running'].includes(job.status)){job.status='interrupted';job.error='Imported history only. Review a new local export before executing.';}
      db.prepare('INSERT OR IGNORE INTO editorial_media_jobs VALUES (?,?,?,?,?)').run(job.id,profile,job.status,JSON.stringify(job),row.updated_at);
    }
  }
  if(exists(db,'runtime_actions')){
    if(mode==='replace')db.prepare('DELETE FROM runtime_actions WHERE profile_id=?').run(profile);
    for(const row of incoming.actions??[]){
      if(['id','hash','status','payload_json','created_at','updated_at'].some(key=>typeof row[key]!=='string')||!['pending','approved','running','succeeded','failed','denied','interrupted'].includes(row.status)||actionHash(JSON.parse(row.payload_json))!==row.hash)throw new Error('Invalid tool action audit.');
      const old=db.prepare('SELECT profile_id FROM runtime_actions WHERE id=?').get(row.id);if(old&&old.profile_id!==profile)throw new Error('Action ID belongs to another profile.');
      const interrupted=['pending','approved','running'].includes(row.status);
      db.prepare('INSERT OR IGNORE INTO runtime_actions VALUES (?,?,?,?,?,?,?,?)').run(row.id,profile,row.hash,interrupted?'interrupted':row.status,row.payload_json,interrupted?'Imported audit only. No tool call was authorized or replayed.':row.error??null,row.created_at,row.updated_at);
    }
  }
  for(const [table,key] of [['agent_delegation_jobs','delegations'],['agent_delegation_sessions','delegationSessions']])if(exists(db,table)){
    if(mode==='replace')db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(profile);
    for(const row of incoming[key]??[]){
      if(typeof row.id!=='string'||typeof row.data_json!=='string')throw new Error('Invalid agent collaboration backup.');
      const value=JSON.parse(row.data_json);if(value.id!==row.id)throw new Error('Invalid collaboration ID.');
      const old=db.prepare(`SELECT profile_id FROM ${table} WHERE id=?`).get(row.id);if(old&&old.profile_id!==profile)throw new Error('Collaboration belongs to another profile.');
      if(key==='delegations'){
        if(typeof row.request_key!=='string'||!['queued','running','completed','error','cancelled','interrupted'].includes(row.status)||!Number.isSafeInteger(value.attempts)||typeof value.sourceSessionId!=='string'||typeof value.targetSessionId!=='string')throw new Error('Invalid delegation backup.');
        value.profileId=profile;value.status=['queued','running'].includes(row.status)?'interrupted':row.status;value.requestKey=`restored:${profile}:${value.id}`;value.error=value.status==='interrupted'?'Imported work was not resumed. Review the chat before recovering.':value.error;
        db.prepare('INSERT OR IGNORE INTO agent_delegation_jobs VALUES (?,?,?,?,?)').run(row.id,profile,value.requestKey,value.status,JSON.stringify(value));
      }else{if(!Array.isArray(value.messages)||typeof value.agentId!=='string')throw new Error('Invalid collaboration session backup.');db.prepare('INSERT OR IGNORE INTO agent_delegation_sessions VALUES (?,?,?)').run(row.id,profile,JSON.stringify(value));}
    }
  }
}
