import {randomUUID} from 'node:crypto';

/**
 * Per-stage production runtime. Each stage runs on the provider of the agent configured for it;
 * an unavailable provider stops the stage instead of switching to another one.
 * Claude never runs shell commands or writes files here. As video editor it may direct the edit through
 * the bound local editor tools (editor-authoring.mjs: frames, plan, preview, final export receipt) when the
 * runtime offers them; the host still renders and owns the final file. Image generation requires a
 * provider that declares it.
 */
export const productionProviders=['codex','claude'];
export const providerOf=agent=>agent?.providerId??'codex';
export const providerLabel=id=>id==='claude'?'Claude Code':id==='codex'?'Codex':String(id);
export const providerCapabilities=id=>id==='claude'?{text:true,reconcile:false,imageGeneration:false,editorTools:true}:id==='codex'?{text:true,reconcile:true,imageGeneration:true,editorTools:false}:{text:false,reconcile:false,imageGeneration:false,editorTools:false};

/** Claude Code CLI adapter: one fresh CLI session per attempt, so a resend never reuses an uncertain session. */
export function claudeProductionRuntime(chat){
 const editorTools=typeof chat.openEditorSession==='function';
 return {
  providerId:'claude',capabilities:{...providerCapabilities('claude'),editorTools},
  async createSession(){return randomUUID();},
  async resumeSession(){},
  // The CLI keeps no readable history for MainsAgents; an interrupted turn is never assumed complete.
  async readThread(){return null;},
  send:(threadId,content,agent)=>chat.send(threadId,content,{...agent,reasoningEffort:'medium',runtimeFirstMessage:true}),
  events:(id,signal)=>chat.events(id,signal),
  cancel:(threadId,id)=>chat.cancel(threadId,id),
  // Editor authoring: open with the run binding + host callbacks, then send with {editorSessionId}. The stream adds
  // editor.checkpoint and file.completed (receipt verified against the real file). Absent when the runtime lacks it.
  ...(editorTools?{
   openEditorSession:options=>chat.openEditorSession(options),
   editorCheckpoint:id=>chat.editorCheckpoint(id),
   // Re-binds what a restored checkpoint lists (previews of the current revision) before a continuation is planned.
   prepareEditorSession:(id,options)=>typeof chat.prepareEditorSession==='function'?chat.prepareEditorSession(id,options):{restored:[],missing:[],checkpoint:chat.editorCheckpoint(id)},
   closeEditorSession:(id,reason)=>chat.closeEditorSession(id,reason),
   forgetEditorSession:id=>chat.forgetEditorSession?.(id),
  }:{}),
 };
}
export function codexProductionRuntime(workflow){
 return {...workflow,providerId:'codex',capabilities:{...providerCapabilities('codex'),imageFile:typeof workflow.imageFile==='function'}};
}
/** Resolves the runtime for one provider; returns null when that provider is unavailable. */
export function productionRuntimeFor(providerId,{getRuntime,getChatRuntime}={}){
 if(providerId==='codex'){const workflow=getRuntime?.();return workflow?codexProductionRuntime(workflow):null;}
 if(providerId==='claude'){const chat=getChatRuntime?.('claude');return chat?claudeProductionRuntime(chat):null;}
 return null;
}
/** Maps a provider status (e.g. Claude `auth status`, a local check without inference) to the preflight shape. */
export function providerStatus(providerId,{runtime,status}={}){
 const caps=providerCapabilities(providerId),available=!!runtime&&status?.state!=='not-installed';
 const auth=status===undefined?'unverified':status?.state==='connected'?'connected':status?.state==='login-required'?'login-required':status?.state==='not-installed'?'not-installed':status?.state==='error'?'error':'unverified';
 return {available,auth,imageGeneration:caps.imageGeneration,reconcile:caps.reconcile,editorTools:available&&caps.editorTools&&(providerId!=='claude'||typeof runtime?.openEditorSession==='function'),...(providerId==='codex'&&runtime?{imageFile:typeof runtime.imageFile==='function'}:{})};
}

/**
 * Suggests the configured Claude agent as editor when Claude is connected. It never changes agents or
 * sessions and never replaces an unavailable provider with another one.
 * Status: ok | provider-unavailable (explicit, no fallback) | suggest | none.
 */
export function editorRoleSuggestion({agents = [], workspaceId, currentEditorId, claudeStatus} = {}) {
 const current = agents.find((agent) => agent.id === currentEditorId && agent.workspaceId === workspaceId);
 const connected = claudeStatus?.state === 'connected';
 if (current?.providerId === 'claude') return connected ? {status: 'ok', agentId: current.id} : {status: 'provider-unavailable', agentId: current.id, providerId: 'claude', state: claudeStatus?.state ?? 'unverified'};
 if (!connected) return {status: 'none'};
 const candidate = agents.find((agent) => agent.workspaceId === workspaceId && agent.providerId === 'claude');
 return candidate ? {status: 'suggest', agentId: candidate.id, replaces: current?.id ?? null} : {status: 'none'};
}
