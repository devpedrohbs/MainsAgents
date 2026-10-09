import {randomUUID} from 'node:crypto';

/**
 * Per-stage production runtime. Each stage runs on the provider of the agent configured for it;
 * an unavailable provider stops the stage instead of switching to another one.
 * Claude generates text only: local tools (FFmpeg/Remotion) edit and render, and image generation
 * requires a provider that declares it.
 */
export const productionProviders=['codex','claude'];
export const providerOf=agent=>agent?.providerId??'codex';
export const providerLabel=id=>id==='claude'?'Claude Code':id==='codex'?'Codex':String(id);
export const providerCapabilities=id=>id==='claude'?{text:true,reconcile:false,imageGeneration:false}:id==='codex'?{text:true,reconcile:true,imageGeneration:true}:{text:false,reconcile:false,imageGeneration:false};

/** Claude Code CLI adapter: one fresh CLI session per attempt, so a resend never reuses an uncertain session. */
export function claudeProductionRuntime(chat){
 return {
  providerId:'claude',capabilities:providerCapabilities('claude'),
  async createSession(){return randomUUID();},
  async resumeSession(){},
  // The CLI keeps no readable history for MainsAgents; an interrupted turn is never assumed complete.
  async readThread(){return null;},
  send:(threadId,content,agent)=>chat.send(threadId,content,{...agent,reasoningEffort:'medium',runtimeFirstMessage:true}),
  events:(id,signal)=>chat.events(id,signal),
  cancel:(threadId,id)=>chat.cancel(threadId,id),
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
 return {available,auth,imageGeneration:caps.imageGeneration,reconcile:caps.reconcile,...(providerId==='codex'&&runtime?{imageFile:typeof runtime.imageFile==='function'}:{})};
}
