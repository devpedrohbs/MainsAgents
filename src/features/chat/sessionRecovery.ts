import type {AgentSession,ChatActivityItem,ChatItem} from './model/Chat';

/**
 * Thread recovery for a saved chat whose provider thread can no longer be resumed (rollout missing, runtime database
 * rebuilt, thread never materialized). The decision is made from the provider's answer only, never from the chat's age.
 * The local history, content link and production snapshot stay untouched; a NEW provider thread is opened, the user is told,
 * and the saved conversation goes along as reference text. Nothing already done (tools, handoffs, publications) is re-run.
 */
/**
 * Fallback for bridges older than the HTTP 410 "thread-missing" contract: only the texts the CLIs are proven to return for an
 * absent thread (Codex app-server rollout lookup, Claude Code --resume), optionally prefixed by the failing RPC.
 */
const missingThreadPattern=/(?:^|: )(?:no rollout found for thread id|no persisted rollout|thread not found\b|no conversation found with (?:session|thread) id)/i;
/**
 * Never treated as a missing thread: a thread only unloaded from memory ("not loaded" is resumed by the bridge first), a malformed
 * id, busy writers, sign-in/auth, policy, executor setup and network failures. Those keep the thread and show the real error.
 */
const notMissingPattern=/not loaded|invalid (session|thread)( id)?|active writer|still finishing|log ?in|sign in|unauthori[sz]ed|forbidden|\b40[13]\b|policy|setup refresh|sandbox|kernel reset|fetch failed|network|econn|etimedout|timed out|socket|rate limit|quota/i;

/** True only for a missing/expired provider thread. Busy writers, auth, policy or network errors are not recovered here. */
export function isMissingThreadError(error:unknown):boolean{
 if(!error||typeof error!=='object'&&typeof error!=='string')return false;
 const code=typeof error==='object'?(error as {code?:unknown}).code:undefined;
 // Bridge contract: HTTP 410 + code "thread-missing" once the runtime confirmed the thread cannot be resumed.
 if(code==='thread-missing')return true;
 const message=typeof error==='string'?error:error instanceof Error?error.message:String((error as {message?:unknown}).message??'');
 if(code||notMissingPattern.test(message))return false;
 return missingThreadPattern.test(message);
}

/**
 * Bridge contract: HTTP 409 "thread-not-loaded" is answered BEFORE any turn starts, so the SAME thread is resumed and the
 * message sent once more. It never creates a new thread.
 */
export function isThreadNotLoadedError(error:unknown):boolean{
 return !!error&&typeof error==='object'&&(error as {code?:unknown}).code==='thread-not-loaded';
}

const historyLimit=24000,messageLimit=4000;

/**
 * Saved conversation sent once to the new thread. Bounded (latest messages first win the budget), with an explicit marker
 * when older messages were left out, and an instruction that past actions are history, not pending work.
 */
export function recoveryBriefing(messages:readonly ChatItem[],excludeId?:string):string{
 const saved=messages.filter((item):item is Extract<ChatItem,{type:'message'}>=>item.type==='message'&&item.id!==excludeId&&item.deliveryState!=='streaming'&&!!item.content.trim());
 const lines:string[]=[];let used=0,omitted=0;
 for(let index=saved.length-1;index>=0;index--){
  const item=saved[index],text=item.content.length>messageLimit?`${item.content.slice(0,messageLimit)} […]`:item.content;
  const line=`${item.role==='user'?'user':item.sourceAgentName?`agent (${item.sourceAgentName})`:'agent'}: ${text}`;
  if(used+line.length>historyLimit){omitted=index+1;break;}
  lines.unshift(line);used+=line.length;
 }
 const header='MainsAgents thread recovery: the previous provider thread of this chat is no longer available, so this is a new thread. Below is the conversation saved in the app (reference only). Actions it mentions (tool calls, specialist handoffs, files, Notion edits, approvals, schedules or publications) already happened or were already refused: do NOT repeat them unless the current request explicitly asks again. Do not claim to have seen files or results that are not in this text or in the current request.';
 return `${header}${omitted?`\n[${omitted} older message(s) were not included.]`:''}\n\n${lines.join('\n\n')||'(no saved messages)'}\n\nCurrent request:\n`;
}

/** Visible, honest notice saved in the chat feed (not an error: the conversation continues). */
export function recoveryNotice(id:string,pt:boolean):ChatActivityItem{
 return {id,type:'activity',status:'done',label:pt?'A conversa anterior não está mais disponível no runtime do agente. Abri uma nova conversa no provedor e enviei o histórico salvo deste chat; nada foi repetido automaticamente.':'The previous conversation is no longer available in the agent runtime. A new provider conversation was opened with this chat’s saved history; nothing was repeated automatically.'};
}

/** Session fields after a recovery: new remote thread, previous one kept for audit, same content/production/messages. */
export function recoveredSession(session:AgentSession,providerId:NonNullable<AgentSession['providerId']>,remoteSessionId:string,previousRemoteSessionId:string,at:string):AgentSession{
 return {...session,providerId,remoteSessionId,codexThreadId:providerId==='codex'?remoteSessionId:session.codexThreadId,delegationRuntimeVersion:providerId==='codex'?2:session.delegationRuntimeVersion,previousCodexThreadId:previousRemoteSessionId,threadRecoveries:[...(session.threadRecoveries??[]),{previousRemoteSessionId,remoteSessionId,at}].slice(-5),updatedAt:at};
}
