import {validateEditorialAssets} from '../../editorial-assets-validation.mjs';
import {validatePublications} from '../../publication-model.mjs';
export const dataKeys = ['workspaces', 'current-workspace', 'agents', 'sessions', 'active-sessions', 'tasks', 'canvas-workspaces', 'language', 'focus-mode', 'text-scale', 'reduced-motion', 'welcome-dismissed', 'sidebar-width', 'inspector-width', 'default-codex-model', 'chat-presentation', 'chat-drafts', 'chat-inbox'] as const;
const collectionKeys = new Set(['workspaces', 'agents', 'sessions', 'tasks']);
export interface BackupFile { format:'mainsagents-backup'; version:1; exportedAt:string; data:Record<string, unknown>; editorial?:Record<string,unknown>; execution?:Record<string,unknown>; recovery?:boolean; fileManifest?:Array<{agentId:string;directory?:string;skills:unknown}> }
export type ImportMode = 'replace' | 'merge';

export function backupFileReferences(file:BackupFile):string[]{
  const paths=new Set<string>();
  for(const agent of Array.isArray(file.data.agents)?file.data.agents:[]){
    if(!isObject(agent))continue;
    if(typeof agent.skillsDirectory==='string'&&agent.skillsDirectory)paths.add(agent.skillsDirectory);
    if(isObject(agent.skillFiles))for(const path of Object.values(agent.skillFiles))if(typeof path==='string'&&path)paths.add(path);
  }
  if(Array.isArray(file.editorial?.assets))for(const asset of file.editorial.assets){if(isObject(asset)&&Array.isArray(asset.versions))for(const version of asset.versions)if(isObject(version)&&typeof version.path==='string')paths.add(version.path);}
  if(Array.isArray(file.execution?.work))for(const row of file.execution.work){if(!isObject(row)||typeof row.data_json!=='string')continue;try{const job=JSON.parse(row.data_json);for(const file of job.files??[])if(typeof file.path==='string')paths.add(file.path);}catch{}}
  return [...paths];
}

function isObject(value:unknown):value is Record<string,unknown> { return typeof value==='object' && value!==null && !Array.isArray(value) }
export function safeData(data:Record<string,unknown>):Record<string,unknown> { return Object.fromEntries(dataKeys.filter((key)=>key in data).map((key)=>[key,data[key]])) }

export function parseBackup(text:string):BackupFile {
  const parsed:unknown=JSON.parse(text);
  if(!isObject(parsed)||parsed.format!=='mainsagents-backup'||parsed.version!==1||!isObject(parsed.data))throw new Error('This file is not a supported MainsAgents backup.');
  for(const key of collectionKeys)if(key in parsed.data && !Array.isArray(parsed.data[key]))throw new Error(`Invalid ${key} collection in backup.`);
  for(const key of collectionKeys){const rows=parsed.data[key];if(Array.isArray(rows)&&rows.some((row)=>!isObject(row)||typeof row.id!=='string'||!row.id))throw new Error(`Invalid ${key} record in backup.`)}
  const sessions=parsed.data.sessions;if(Array.isArray(sessions)&&sessions.some((session)=>!isObject(session)||typeof session.agentId!=='string'||typeof session.title!=='string'||!Array.isArray(session.messages)))throw new Error('Invalid sessions in backup.');
  const tasks=parsed.data.tasks;if(Array.isArray(tasks)&&tasks.some((task)=>!isObject(task)||typeof task.agentId!=='string'||typeof task.workspaceId!=='string'||typeof task.title!=='string'))throw new Error('Invalid tasks in backup.');
  for(const key of ['active-sessions','canvas-workspaces'])if(key in parsed.data && !isObject(parsed.data[key]))throw new Error(`Invalid ${key} data in backup.`);
  if ('chat-drafts' in parsed.data) {
    const drafts = parsed.data['chat-drafts'];
    if (!isObject(drafts) || Object.entries(drafts).some(([key, value]) => {
      let identity: unknown;
      try { identity = JSON.parse(key); } catch { return true; }
      return !Array.isArray(identity) || identity.length !== 2 || typeof identity[0] !== 'string' || (identity[1] !== null && typeof identity[1] !== 'string') || !isObject(value) || typeof value.text !== 'string' || (value.skill !== null && typeof value.skill !== 'string') || ('context' in value && (!Array.isArray(value.context) || value.context.some(ref => !isObject(ref) || typeof ref.workspaceId !== 'string' || typeof ref.nodeId !== 'string' || typeof ref.label !== 'string')));
    })) throw new Error('Invalid chat drafts in backup.');
  }
  if('chat-inbox' in parsed.data){const inbox=parsed.data['chat-inbox'];if(!isObject(inbox)||typeof inbox.muted!=='boolean'||typeof inbox.initialized!=='boolean'||!isObject(inbox.seen)||Object.values(inbox.seen).some(ids=>!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))||('notified' in inbox&&(!Array.isArray(inbox.notified)||inbox.notified.some(id=>typeof id!=='string'))))throw new Error('Invalid chat inbox in backup.');}
  if('language' in parsed.data&&!['en-US','pt-BR'].includes(String(parsed.data.language)))throw new Error('Invalid language in backup.');
  if('editorial' in parsed){
    const editorial=parsed.editorial;
    if(!isObject(editorial)||editorial.schemaVersion!==1||['topics','contents','runs','artifacts','approvals'].some((key)=>!Array.isArray(editorial[key])||(editorial[key] as unknown[]).some((item)=>!isObject(item)||typeof item.id!=='string'||!item.id)))throw new Error('Invalid editorial data in backup.');
    if(!validateEditorialAssets(editorial))throw new Error('Invalid content file library in backup.');
    if(!validatePublications(editorial))throw new Error('Invalid publication data in backup.');
  }
  if('execution' in parsed){const execution=parsed.execution;if(!isObject(execution)||['jobs','events','connections'].some(key=>!Array.isArray(execution[key])))throw new Error('Invalid execution data in backup.');}
  if(isObject(parsed.execution)){
    const execution=parsed.execution;
    for(const key of ['work','workSessions','workEvents','actions','delegations','delegationSessions','mediaJobs'])if(key in execution&&!Array.isArray(execution[key]))throw new Error('Invalid persistent work backup.');
    for(const row of Array.isArray(execution.work)?execution.work:[]){
      if(!isObject(row)||['id','workspace_id','target_id','request_key','data_json','created_at','updated_at'].some(key=>typeof row[key]!=='string')||!['research','script','handoff'].includes(String(row.kind))||!['queued','running','succeeded','failed','interrupted','blocked','canceled'].includes(String(row.status)))throw new Error('Invalid work record in backup.');
      const job:unknown=JSON.parse(String(row.data_json));if(!isObject(job)||job.id!==row.id||job.workspaceId!==row.workspace_id||job.targetId!==row.target_id||job.kind!==row.kind||job.status!==row.status||!isObject(job.agent)||typeof job.agent.id!=='string'||!Number.isSafeInteger(job.attempt)||Number(job.attempt)<1||Number(job.attempt)>3||!Array.isArray(job.files)||typeof job.prompt!=='string'||typeof job.inputHash!=='string')throw new Error('Inconsistent work record in backup.');
    }
    for(const row of Array.isArray(execution.workSessions)?execution.workSessions:[])if(!isObject(row)||['id','scope','agent_id','thread_id','config_hash','created_at'].some(key=>typeof row[key]!=='string'))throw new Error('Invalid specialist session in backup.');
    for(const row of Array.isArray(execution.workEvents)?execution.workEvents:[]){if(!isObject(row)||typeof row.job_id!=='string'||typeof row.event_json!=='string'||typeof row.at!=='string')throw new Error('Invalid work event in backup.');JSON.parse(row.event_json);}
  }
  return parsed as unknown as BackupFile;
}

function mergeRows(current:unknown,incoming:unknown):unknown {
  if(!Array.isArray(current)||!Array.isArray(incoming))return incoming;
  const byId=new Map<string,unknown>();
  for(const item of current)if(isObject(item)&&typeof item.id==='string')byId.set(item.id,item);
  for(const item of incoming)if(isObject(item)&&typeof item.id==='string'&&!byId.has(item.id))byId.set(item.id,item);
  return [...byId.values()];
}

function mergeCanvas(current:unknown,incoming:unknown):unknown {
  if(!isObject(current)||!isObject(incoming))return incoming;
  const merged={...incoming,...current};
  for(const [workspaceId,remote] of Object.entries(incoming)) {
    const local=current[workspaceId];
    if(!isObject(local)||!isObject(remote)){if(!(workspaceId in current))merged[workspaceId]=remote;continue}
    merged[workspaceId]={...remote,...local,nodes:mergeRows(local.nodes,remote.nodes),edges:mergeRows(local.edges,remote.edges)};
  }
  return merged;
}

export function composeImport(current:Record<string,unknown>,file:BackupFile,mode:ImportMode):Record<string,unknown> {
  const incoming=safeData(file.data);
  if(mode==='replace'){
    const retained=Object.fromEntries(Object.entries(current).filter(([key])=>!dataKeys.includes(key as typeof dataKeys[number])));
    return {...retained,...incoming};
  }
  const merged={...current};
  for(const [key,value] of Object.entries(incoming)) {
    if(collectionKeys.has(key))merged[key]=mergeRows(current[key],value);
    else if(key==='canvas-workspaces')merged[key]=mergeCanvas(current[key],value);
    else if(key==='active-sessions'||key==='chat-drafts')merged[key]={...(isObject(value)?value:{}),...(isObject(current[key])?current[key]:{})};
    else if(!(key in current))merged[key]=value;
  }
  return merged;
}

export function describeBackup(file:BackupFile):string {
  const count=(key:string)=>Array.isArray(file.data[key])?file.data[key].length:0;
  const topics=Array.isArray(file.editorial?.topics)?file.editorial.topics.length:0;
  const contents=Array.isArray(file.editorial?.contents)?file.editorial.contents.length:0;
  return `${count('workspaces')} workspaces · ${count('agents')} agents · ${count('sessions')} sessions · ${count('tasks')} tasks · ${topics} editorial topics · ${contents} content cards`;
}
