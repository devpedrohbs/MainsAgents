interface EditorialSnapshot {revision:number;state:Record<string,unknown>}
interface RestoreJournal {before:Record<string,unknown>;after:Record<string,unknown>;editorialBefore:Record<string,unknown>;editorialAfter:Record<string,unknown>;revision:number}
interface RestoreStore {readAll():Promise<Record<string,unknown>>;write(key:string,value:unknown):Promise<void>;replaceAll(value:Record<string,unknown>):Promise<void>}
interface EditorialTransport {read():Promise<EditorialSnapshot>;write(revision:number,state:Record<string,unknown>):Promise<number>}
const key='backup-restore-journal';
const clean=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** IndexedDB + HTTP cannot share a transaction: persist recovery intent first. */
export async function recoverWorkspaceRestore(store:RestoreStore,editorial:EditorialTransport):Promise<void>{
  const local=await store.readAll(),journal=local[key] as RestoreJournal|null|undefined;
  if(!journal)return;
  const remote=await editorial.read();
  if(equal(clean(local),clean(journal.after))&&equal(remote.state,journal.editorialAfter)){
    await store.write(key,null);return;
  }
  if(!equal(clean(local),clean(journal.before))&&!equal(clean(local),clean(journal.after)))throw new Error('Restore recovery found newer local edits. Your recovery journal was preserved.');
  // Do not undo somebody else's subsequent editorial edits.
  if(!equal(remote.state,journal.editorialBefore)&&!equal(remote.state,journal.editorialAfter))throw new Error('Restore recovery found newer editorial edits. Your recovery journal was preserved.');
  if(!equal(remote.state,journal.editorialBefore))await editorial.write(remote.revision,journal.editorialBefore);
  await store.replaceAll(journal.before);
}

export async function restoreWorkspaceRecoverably(store:RestoreStore,editorial:EditorialTransport,after:Record<string,unknown>,editorialAfter:Record<string,unknown>):Promise<void>{
  await recoverWorkspaceRestore(store,editorial);
  const before=clean(await store.readAll()),remote=await editorial.read();
  const journal:RestoreJournal={before,after:clean(after),editorialBefore:remote.state,editorialAfter,revision:remote.revision};
  await store.write(key,journal);
  try{
    await editorial.write(remote.revision,editorialAfter);
    await store.replaceAll({...journal.after,[key]:journal});
    await store.write(key,null);
  }catch(error){
    try{await recoverWorkspaceRestore(store,editorial)}catch{
      throw new Error('Restore interrupted. A recovery journal was saved; reopen the app to recover before editing.');
    }
    throw error;
  }
}
