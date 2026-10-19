import type {AgentSession} from './model/Chat';
// Pure (type-only imports): also loaded by node tests.

/**
 * What choosing a provider does for the chat on screen. Only a chat that never talked to any provider may change its own
 * binding ('in-place'); anything with history, a provider thread, a pair, a handoff or a production stays bound and the
 * choice opens a new chat in the same content ('new-chat'). Busy chats (own response or queued/running specialist work) are
 * never touched ('blocked'). Choosing never sends.
 */
export type ProviderSwitchPlan={kind:'in-place'|'new-chat'|'blocked';reason?:'busy'|'history'|'thread'|'comparison'|'handoff'|'production'};
export interface ProviderSwitchContext {busy:boolean;productionSessionIds?:ReadonlySet<string>}

export function bindingLock(session:AgentSession,context:Pick<ProviderSwitchContext,'productionSessionIds'>={}):ProviderSwitchPlan['reason']|undefined{
 if(session.messages.length)return 'history';
 if(session.remoteSessionId||session.codexThreadId||session.previousCodexThreadId||session.threadRecoveries?.length)return 'thread';
 if(session.comparison)return 'comparison';
 if(session.handoffs?.length||session.originHandoffId||session.pendingManualHandoff)return 'handoff';
 if(session.productionContext||context.productionSessionIds?.has(session.id))return 'production';
 return undefined;
}
export function providerSwitchPlan(session:AgentSession|undefined,context:ProviderSwitchContext):ProviderSwitchPlan{
 if(!session)return {kind:'in-place'};
 if(context.busy)return {kind:'blocked',reason:'busy'};
 const lock=bindingLock(session,context);
 return lock?{kind:'new-chat',reason:lock}:{kind:'in-place'};
}
/** Sessions bound to a production (source, editor, publisher): never rebound in place. */
export const productionSessionIds=(runs:readonly {sourceSession:{id:string};editorSession:{id:string};publisherSession?:{id:string}}[])=>new Set(runs.flatMap(run=>[run.sourceSession.id,run.editorSession.id,...(run.publisherSession?[run.publisherSession.id]:[])]));
export const providerShortName=(id?:string)=>id==='claude'?'Claude':id==='codex'?'Codex':id==='gemini'?'Gemini':id==='agent'?'Agente':id??'—';
/**
 * Who really runs the edit of a production, read from the run (never inferred from the chat provider). Before the video is
 * sent there is no run choice yet: the workspace default applies (labelled as such); a basic edit uses no AI director.
 */
export interface EditingLabel {provider:string;model?:string;source:'run'|'workspace'|'basic';agent?:boolean}
export function editingLabel(run:{editDirector?:{provider:string;model?:string;choice:string};editPreferences?:{mode?:string}}|undefined,workspaceDefault?:{providerId:string;modelId?:string}):EditingLabel|undefined{
 if(!run)return undefined;
 if(run.editPreferences?.mode==='basic')return {provider:'ffmpeg',source:'basic'};
 if(run.editDirector)return {provider:run.editDirector.provider,model:run.editDirector.model,source:'run',agent:run.editDirector.choice==='agent'};
 if(workspaceDefault)return {provider:workspaceDefault.providerId,model:workspaceDefault.modelId,source:'workspace',agent:workspaceDefault.providerId==='agent'};
 return undefined;
}
