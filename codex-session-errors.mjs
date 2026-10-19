// Backend "provider session is gone" contract (production coordinator, native delegations).
// The CLI wording lives in ONE place, classifyThreadError (codex-executor-readiness.mjs), which the bridge also uses
// for its HTTP codes: 410 thread-missing, 409 thread-not-loaded, 400 invalid-thread-id. Only 'thread-missing' proves
// absence; 'thread-not-loaded' is resumed first; invalid ids, auth, network and sandbox setup are never an expiry.
import {classifyThreadError} from './codex-executor-readiness.mjs';

const classOf=error=>{
 if(!error)return null;
 if(['thread-missing','thread-not-loaded','invalid-thread-id'].includes(error.code))return error.code;
 return classifyThreadError(error);
};

/** True only when the provider proved the session no longer exists. */
export const isMissingThreadError=error=>classOf(error)==='thread-missing';

/** The thread exists on disk but is not loaded in this app-server: resume before reading it. */
export const isThreadNotLoadedError=error=>classOf(error)==='thread-not-loaded';

/**
 * Reads a thread, resuming it once when the app-server reports it as not loaded.
 * Resolves `{thread}` or `{missing:true}` (proved absent); every other failure is rethrown unchanged.
 */
export async function readThreadOrMissing(readThread,resume,threadId){
 try{return {thread:await readThread(threadId)};}
 catch(error){
  if(isMissingThreadError(error))return {missing:true};
  if(!isThreadNotLoadedError(error)||!resume)throw error;
 }
 try{await resume(threadId);}catch(error){if(isMissingThreadError(error))return {missing:true};throw error;}
 try{return {thread:await readThread(threadId)};}catch(error){if(isMissingThreadError(error))return {missing:true};throw error;}
}
