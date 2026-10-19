import {sanitizeLinkedValue} from '../../../content-deletion-model.mjs';
import {adoptPersistentValues,saveNow,setPersistentFilter} from '../../data/localPersistence';
import {storageProfile} from '../../data/IndexedDbStateStore';

/** What a local content deletion would remove (ids are real ids; titles never decide anything). */
export interface DeletionCounts {chats:number;chatsByAgent:Record<string,number>;productions:number;specialistWork:number;srtDocuments:number;artifacts:number;assets:number;publications:number;deliveryFactsKept:number;jobs:number;receipts:number;toolActions:number}
export interface DeletionWork {kind:string;id:string;label:string;stage?:string}
export interface DeletionPreview {contentId:string;workspaceId:string;title:string;counts:DeletionCounts;busy:DeletionWork[];blockers:{kind:string;message:string}[];fingerprint:string;sessionIds:string[]}
type Failure={ok:false;error:string;status?:number;code?:string;busy?:DeletionWork[];blockers?:{kind:string;message:string}[];contentId?:string;workspaceId?:string};
export type DeletionPreviewResult=({ok:true}&(DeletionPreview|{contentId:string;alreadyDeleted:true}))|Failure;
export type DeletionResult=({ok:true;deleted:true;contentId?:string;sessionId?:string;sessionIds?:string[];runIds?:string[];alreadyDeleted?:boolean;state:Record<string,{value:unknown;revision:string}>})|Failure;

/** Refusal with the host's reason; `code` tells the UI what to offer (stop local work, review again, delete the content). */
export class DeletionRefused extends Error {
 code?:string;busy?:DeletionWork[];blockers?:{kind:string;message:string}[];contentId?:string;workspaceId?:string;
 constructor(failure:Failure){super(failure.error);Object.assign(this,{code:failure.code,busy:failure.busy,blockers:failure.blockers,contentId:failure.contentId,workspaceId:failure.workspaceId});}
}

/** Ids deleted in this window: every local update drops them (a response that started before the deletion cannot revive them). */
export const deletedLocally={sessions:new Set<string>(),contents:new Set<string>(),runs:new Set<string>()};
let filterInstalled=false;
function installFilter(){if(filterInstalled)return;filterInstalled=true;setPersistentFilter((key,value)=>sanitizeLinkedValue(key,value,deletedLocally));}
export const contentDeletedEvent='mainsagents:content-deleted';
export interface ContentDeletedDetail {contentId?:string;sessionIds:string[];runIds:string[]}

const desktop=()=>window.mainsAgentsDesktop?.content;
export const localDeletionAvailable=()=>Boolean(desktop()&&window.mainsAgentsDesktop?.state);

function applied(result:Extract<DeletionResult,{ok:true}>,contentId?:string){
 installFilter();
 for(const id of result.sessionIds??(result.sessionId?[result.sessionId]:[]))deletedLocally.sessions.add(id);
 for(const id of result.runIds??[])deletedLocally.runs.add(id);
 if(contentId)deletedLocally.contents.add(contentId);
 adoptPersistentValues(Object.fromEntries(Object.entries(result.state??{}).map(([key,change])=>[key,change.value])));
 window.dispatchEvent(new CustomEvent<ContentDeletedDetail>(contentDeletedEvent,{detail:{contentId,sessionIds:[...(result.sessionIds??(result.sessionId?[result.sessionId]:[]))],runIds:[...(result.runIds??[])]}}));
}

export async function previewContentDeletion(contentId:string,workspaceId:string):Promise<DeletionPreview|{alreadyDeleted:true}>{
 const api=desktop();if(!api)throw new Error('A exclusão local de conteúdo está disponível no app desktop.');
 await saveNow();
 const result=await api.deletePreview(storageProfile(),{contentId,workspaceId});
 if(!result.ok)throw new DeletionRefused(result);
 return 'alreadyDeleted' in result?{alreadyDeleted:true}:result;
}

/** One request id per confirmed preview: a retry after a lost reply replays instead of deleting twice. */
const requestIds=new Map<string,string>();
export async function deleteContentLocally(preview:DeletionPreview,{stopLocalWork,rendererBusy}:{stopLocalWork:boolean;rendererBusy:string[]}){
 const api=desktop();if(!api)throw new Error('A exclusão local de conteúdo está disponível no app desktop.');
 await saveNow();
 const requestId=requestIds.get(preview.fingerprint)??crypto.randomUUID();requestIds.set(preview.fingerprint,requestId);
 const result=await api.deleteContent(storageProfile(),{contentId:preview.contentId,workspaceId:preview.workspaceId,fingerprint:preview.fingerprint,requestId,stopLocalWork,rendererBusy});
 if(!result.ok)throw new DeletionRefused(result);
 requestIds.delete(preview.fingerprint);
 applied(result,preview.contentId);
 return result;
}

/** One ordinary chat. A production role chat is refused with code 'production-role' and the content to delete instead. */
export async function deleteChatLocally(sessionId:string){
 const api=desktop();if(!api)return null;
 await saveNow();
 const result=await api.deleteSession(storageProfile(),{sessionId});
 if(!result.ok)throw new DeletionRefused(result);
 applied(result);
 return result;
}
