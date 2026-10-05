const exists=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
export function workflowExecutionSnapshot(db,profile){
  return {
    work:exists(db,'workflow_work')?db.prepare('SELECT * FROM workflow_work WHERE profile_id=? ORDER BY id').all(profile):[],
    workSessions:exists(db,'workflow_sessions')?db.prepare('SELECT * FROM workflow_sessions WHERE profile_id=? ORDER BY id').all(profile):[],
    workEvents:exists(db,'workflow_events')?db.prepare('SELECT job_id,event_json,at FROM workflow_events WHERE job_id IN (SELECT id FROM workflow_work WHERE profile_id=?) ORDER BY id').all(profile):[],
  };
}
/** A backup contains saved work, not authorization to send its prompts again. */
export function restoreWorkflowExecution(db,profile,incoming,mode){
  for(const key of ['work','workSessions','workEvents'])if(incoming[key]!==undefined&&!Array.isArray(incoming[key]))throw new Error('Invalid persistent work backup.');
  if(!exists(db,'workflow_work')){if(incoming.work?.length||incoming.workSessions?.length||incoming.workEvents?.length)throw new Error('Persistent work storage is unavailable.');return;}
  if(mode==='replace'){
    db.prepare('DELETE FROM workflow_events WHERE job_id IN (SELECT id FROM workflow_work WHERE profile_id=?)').run(profile);
    db.prepare('DELETE FROM workflow_work WHERE profile_id=?').run(profile);db.prepare('DELETE FROM workflow_sessions WHERE profile_id=?').run(profile);
  }
  const interrupted=[];
  for(const row of incoming.work??[]){
    if(['id','workspace_id','target_id','request_key','data_json','created_at','updated_at'].some(key=>typeof row[key]!=='string')||!['research','script','handoff'].includes(row.kind)||!['queued','running','succeeded','failed','interrupted','blocked','canceled'].includes(row.status))throw new Error('Invalid work record.');
    const job=JSON.parse(row.data_json);
    if(job.id!==row.id||job.workspaceId!==row.workspace_id||job.targetId!==row.target_id||job.kind!==row.kind||job.status!==row.status||!job.agent?.id||!Number.isSafeInteger(job.attempt)||job.attempt<1||job.attempt>3||!Array.isArray(job.files)||typeof job.prompt!=='string'||typeof job.inputHash!=='string')throw new Error('Inconsistent work record.');
    const old=db.prepare('SELECT profile_id FROM workflow_work WHERE id=?').get(row.id);if(old&&old.profile_id!==profile)throw new Error('Work ID belongs to another profile.');
    job.profileId=profile;
    if(['queued','running'].includes(row.status)){job.status='interrupted';job.error='Restored from backup. Verify the saved session and explicitly resume.';interrupted.push(job.id);}
    db.prepare('INSERT OR IGNORE INTO workflow_work VALUES (?,?,?,?,?,?,?,?,?,?)').run(job.id,profile,job.workspaceId,job.targetId,job.kind,job.status,row.request_key,JSON.stringify(job),row.created_at,row.updated_at);
  }
  for(const row of incoming.workSessions??[]){
    if(['id','scope','agent_id','thread_id','config_hash','created_at'].some(key=>typeof row[key]!=='string'))throw new Error('Invalid work session.');
    const old=db.prepare('SELECT profile_id FROM workflow_sessions WHERE id=?').get(row.id);if(old&&old.profile_id!==profile)throw new Error('Work session belongs to another profile.');
    db.prepare('INSERT OR IGNORE INTO workflow_sessions VALUES (?,?,?,?,?,?,?)').run(row.id,profile,row.scope,row.agent_id,row.thread_id,row.config_hash,row.created_at);
  }
  for(const row of incoming.workEvents??[]){
    if(typeof row.job_id!=='string'||typeof row.event_json!=='string'||typeof row.at!=='string')throw new Error('Invalid work event.');JSON.parse(row.event_json);
    if(db.prepare('SELECT id FROM workflow_work WHERE id=? AND profile_id=?').get(row.job_id,profile)&&!db.prepare('SELECT id FROM workflow_events WHERE job_id=? AND event_json=? AND at=?').get(row.job_id,row.event_json,row.at))db.prepare('INSERT INTO workflow_events(job_id,event_json,at) VALUES (?,?,?)').run(row.job_id,row.event_json,row.at);
  }
  const saved=db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile);
  if(saved&&interrupted.length){const state=JSON.parse(saved.state_json);for(const run of state.runs)if(interrupted.includes(run.jobId)){run.state='interrupted';run.error='Restored from backup. Explicitly resume the saved work.';}db.prepare('UPDATE editorial_state SET state_json=? WHERE profile_id=?').run(JSON.stringify(state),profile);}
}
