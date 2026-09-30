export const dataKeys = ['workspaces', 'current-workspace', 'agents', 'sessions', 'active-sessions', 'tasks', 'canvas-workspaces', 'language', 'focus-mode', 'text-scale', 'reduced-motion', 'welcome-dismissed', 'sidebar-width', 'inspector-width', 'default-codex-model', 'chat-presentation'] as const;
const collectionKeys = new Set(['workspaces', 'agents', 'sessions', 'tasks']);
export interface BackupFile { format:'mainsagents-backup'; version:1; exportedAt:string; data:Record<string, unknown>; editorial?:Record<string,unknown> }
export type ImportMode = 'replace' | 'merge';

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
  if('language' in parsed.data&&!['en-US','pt-BR'].includes(String(parsed.data.language)))throw new Error('Invalid language in backup.');
  if('editorial' in parsed){
    const editorial=parsed.editorial;
    if(!isObject(editorial)||editorial.schemaVersion!==1||['topics','contents','runs','artifacts','approvals'].some((key)=>!Array.isArray(editorial[key])||(editorial[key] as unknown[]).some((item)=>!isObject(item)||typeof item.id!=='string'||!item.id)))throw new Error('Invalid editorial data in backup.');
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
    else if(key==='active-sessions')merged[key]={...(isObject(value)?value:{}),...(isObject(current[key])?current[key]:{})};
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
