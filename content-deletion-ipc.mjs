/**
 * IPC of the local content deletion. Only the main window may call it, only for the active profile, and the profile is
 * checked again after every await. Results are plain objects ({ok:false,...} instead of thrown errors) so the renderer gets
 * the reason, the busy work and the blockers intact.
 */
const outcome=error=>({ok:false,error:error?.message??String(error),...(error?.status?{status:error.status}:{}),...(error?.code?{code:error.code}:{}),...(error?.busy?{busy:error.busy}:{}),...(error?.blockers?{blockers:error.blockers}:{}),...(error?.contentId?{contentId:error.contentId,workspaceId:error.workspaceId}:{})});
export function registerContentDeletionIpc({ipcMain,isTrustedSender,getStore,getDeletion}){
 const bound=(event,profile)=>{
  if(!isTrustedSender(event))throw Object.assign(new Error('Untrusted application window'),{status:403});
  const store=getStore(),deletion=getDeletion();
  if(!store||!deletion)throw Object.assign(new Error('Local storage is not ready'),{status:503});
  if(typeof profile!=='string'||profile!==store.currentProfile())throw Object.assign(new Error('The active profile changed. Reopen the workspace.'),{status:409});
  return {store,deletion};
 };
 ipcMain.handle('content:deletePreview',(event,profile,input)=>{try{const {deletion}=bound(event,profile);return {ok:true,...deletion.preview(profile,input)};}catch(error){return outcome(error);}});
 ipcMain.handle('content:delete',async(event,profile,input)=>{
  try{
   const {deletion}=bound(event,profile);
   const result=await deletion.delete(profile,input);
   // The commit already happened atomically; the alias only keeps an in-flight renderer write from a false conflict.
   const store=getStore();if(store?.currentProfile()===profile)store.notePurge?.(profile,result.state);
   return {ok:true,...result};
  }catch(error){return outcome(error);}
 });
 ipcMain.handle('content:deleteSession',(event,profile,input)=>{try{const {store,deletion}=bound(event,profile);const result=deletion.removeSession(profile,input);store.notePurge?.(profile,result.state);return {ok:true,...result};}catch(error){return outcome(error);}});
}
