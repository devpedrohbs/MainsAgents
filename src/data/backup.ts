import { indexedDbStateStore } from './IndexedDbStateStore';
import { composeImport, safeData } from './backupFormat';
import type { BackupFile, ImportMode } from './backupFormat';
import { emptyEditorialState } from '../features/content/model';

export { describeBackup, parseBackup } from './backupFormat';
export type { BackupFile, ImportMode } from './backupFormat';

function editorialUrl():string {
  let profile='default';
  try{profile=localStorage.getItem('mainsagents-profile')||'default'}catch{/* Local profile unavailable. */}
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
  for(const key of ['topics','contents','runs','artifacts','approvals']){
    const rows=new Map<string,unknown>();
    for(const item of (incoming[key] as Array<{id:string}>))rows.set(item.id,item);
    for(const item of (current[key] as Array<{id:string}>))rows.set(item.id,item);
    result[key]=[...rows.values()];
  }
  return result;
}

export async function exportBackup():Promise<BackupFile> {
  const [all,editorial]=await Promise.all([indexedDbStateStore.readAll(),readEditorial()]);
  return {format:'mainsagents-backup',version:1,exportedAt:new Date().toISOString(),data:safeData(all),editorial:editorial.state};
}

export async function importBackup(file:BackupFile,mode:ImportMode):Promise<void> {
  const [current,editorial]=await Promise.all([indexedDbStateStore.readAll(),readEditorial()]);
  const nextEditorial=mode==='replace'?(file.editorial??emptyEditorialState()):file.editorial?mergeEditorial(editorial.state,file.editorial):editorial.state;
  const response=await fetch(editorialUrl(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:editorial.revision,state:nextEditorial})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error??'Could not restore editorial data.');
  await indexedDbStateStore.replaceAll(composeImport(current,file,mode));
}
