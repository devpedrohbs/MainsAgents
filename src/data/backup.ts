import { indexedDbStateStore,storageProfile } from './IndexedDbStateStore';
import { persistentSnapshot, saveNow } from './localPersistence';
import { saveCoordinator } from './SaveCoordinator';
import { composeImport, safeData } from './backupFormat';
import type { BackupFile, ImportMode } from './backupFormat';
import { emptyEditorialState } from '../features/content/model';
import {embedChatImages,readChatImageDataUrl} from './chatImageBackup';
import { recoverWorkspaceRestore, restoreWorkspaceRecoverably } from './WorkspaceRestore';

export { describeBackup, parseBackup } from './backupFormat';
export type { BackupFile, ImportMode } from './backupFormat';

function editorialUrl():string {
  let profile='default';
  if(window.mainsAgentsDesktop?.state)profile=storageProfile();
  else try{profile=localStorage.getItem('mainsagents-profile')||'default'}catch{/* Local profile unavailable. */}
  return `/api/content/state?profile=${encodeURIComponent(profile)}`;
}

async function readEditorial():Promise<{revision:number;state:Record<string,unknown>}> {
  const response=await fetch(editorialUrl(),{cache:'no-store'});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error??'Could not read editorial data for backup.');
  return payload;
}

function mergeEditorial(current:Record<string,unknown>,incoming:Record<string,unknown>):Record<string,unknown> {
  const result:Record<string,unknown>={schemaVersion:1};
  for(const key of ['topics','contents','runs','artifacts','approvals','assets','publications']){
    const rows=new Map<string,unknown>();
    for(const item of ((incoming[key]??[]) as Array<{id:string}>))rows.set(item.id,item);
    for(const item of ((current[key]??[]) as Array<{id:string}>))rows.set(item.id,item);
    result[key]=[...rows.values()];
  }
  // Reference library: union by id, the current copy wins (same rule as the other collections).
  const library=(value:unknown)=>((value as {references?:Array<{id:string}>}|undefined)?.references??[]);
  if(current.inspiration||incoming.inspiration){const rows=new Map<string,unknown>();for(const item of library(incoming.inspiration))rows.set(item.id,item);for(const item of library(current.inspiration))rows.set(item.id,item);result.inspiration={schemaVersion:1,references:[...rows.values()]};}
  if(Array.isArray(result.contents))result.contents=(result.contents as Array<{id:string}>).map(content=>({...content,assetIds:(result.assets as Array<{id:string;contentId:string}>).filter(asset=>asset.contentId===content.id).map(asset=>asset.id)}));
  return result;
}
function unverifiedFiles(state:Record<string,unknown>):Record<string,unknown>{return Array.isArray(state.assets)?{...state,assets:(state.assets as Array<Record<string,unknown>>).map(asset=>({...asset,status:'unchecked',checkedAt:undefined,lastError:undefined}))}:state;}
const editorialTransport={read:readEditorial,write:async(revision:number,state:Record<string,unknown>)=>{
  const response=await fetch(editorialUrl(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision,state})});
  const payload=await response.json();if(!response.ok)throw new Error(payload.error??'Could not restore editorial data.');return payload.revision as number;
}};
export async function recoverPendingBackup():Promise<void>{
  if(!window.mainsAgentsDesktop?.state)await recoverWorkspaceRestore(indexedDbStateStore,editorialTransport);
}

export async function exportBackup():Promise<BackupFile> {
  let recovery=false;
  try{await saveNow()}catch{recovery=true}
  const native=!recovery?await window.mainsAgentsDesktop?.backup?.snapshot():undefined;
  const all=native?.values??persistentSnapshot();
  const editorial=native?.editorial.state??(saveCoordinator.snapshot('editorial') as Record<string,unknown>|undefined)??(await readEditorial()).state;
  const agents=Array.isArray(all.agents)?all.agents as Array<{id:string;skillsDirectory?:string;skillFiles?:unknown}>:[];
  return {format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:await embedChatImages(safeData(all),readChatImageDataUrl),editorial,execution:native?.execution,recovery,fileManifest:agents.map(agent=>({agentId:agent.id,directory:agent.skillsDirectory,skills:agent.skillFiles??[]}))};
}

export async function importBackup(file:BackupFile,mode:ImportMode):Promise<void> {
  await saveNow();
  const native=await window.mainsAgentsDesktop?.backup?.snapshot();
  if(native){
    const nextEditorial:Record<string,unknown>=mode==='replace'?(file.editorial??{...emptyEditorialState()}):file.editorial?mergeEditorial(native.editorial.state,file.editorial):native.editorial.state;
    await window.mainsAgentsDesktop!.backup!.restore(composeImport(native.values,file,mode),nextEditorial,{revisions:native.revisions,editorialRevision:native.editorial.revision,executionRevision:native.executionRevision},{state:file.execution??(mode==='merge'?native.execution:{jobs:[],events:[],connections:[]}),mode});
    return;
  }
  const [current,editorial]=await Promise.all([indexedDbStateStore.readAll(),readEditorial()]);
  const nextEditorial:Record<string,unknown>=mode==='replace'?(file.editorial??{...emptyEditorialState()}):file.editorial?mergeEditorial(editorial.state,file.editorial):editorial.state;
  await restoreWorkspaceRecoverably(indexedDbStateStore,editorialTransport,composeImport(current,file,mode),unverifiedFiles(nextEditorial));
}
