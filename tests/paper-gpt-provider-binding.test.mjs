import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContentWorkflowBridge,effectiveSessionAgent} from '../content-workflow-bridge.mjs';

// The user's real setup: a Claude-configured carousel creator with Paper automation, plus a Codex chat opened with the
// provider chooser for native images. Both chats keep the same saved Paper target and grants.
const FILE='01M4V841P4WXN0HWA5BH326JKM';
const creator={id:'criador',name:'Criador de Carrosséis',role:'Carrosséis',workspaceId:'space',providerId:'claude',modelId:'claude-opus-5-5',tools:['files'],mcpPermissions:['read','write'],
 paperDesign:{enabled:true,automatic:true,fileId:FILE,fileName:'Joyful olive',signature:'@eupacass',visualStyle:''}};
const other={id:'outro',name:'Outro',role:'Texto',workspaceId:'space',providerId:'codex',tools:[],paperDesign:{enabled:true,automatic:true,fileId:'OTHER',fileName:'Outro',signature:'',visualStyle:''}};
const at='2026-10-13T12:00:00.000Z';
const sessions=[
 {id:'s-claude',agentId:'criador',providerId:'claude',remoteSessionId:'claude-remote',title:'Claude',messages:[],createdAt:at,updatedAt:at},
 {id:'s-codex',agentId:'criador',providerId:'codex',modelId:'gpt-5.5',remoteSessionId:'codex-thread',codexThreadId:'codex-thread',title:'GPT',messages:[],createdAt:at,updatedAt:at},
 {id:'s-codex-default',agentId:'criador',providerId:'codex',remoteSessionId:'codex-thread-2',codexThreadId:'codex-thread-2',title:'GPT default',messages:[],createdAt:at,updatedAt:at},
 // Saved before sessions recorded a provider: the agent default applies.
 {id:'s-legacy',agentId:'criador',remoteSessionId:'legacy-remote',title:'Antiga',messages:[],createdAt:at,updatedAt:at},
 {id:'s-other',agentId:'outro',providerId:'codex',codexThreadId:'other-thread',remoteSessionId:'other-thread',title:'Outro',messages:[],createdAt:at,updatedAt:at},
];
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'paper-gpt-binding-'));
 const bridge=createContentWorkflowBridge({dbPath:join(directory,'state.sqlite'),getCurrentProfile:()=> 'owner',getAgents:()=>[creator,other],getSessions:()=>sessions,getFlows:()=>({flows:[]})});
 return {bridge,close:async()=>{await bridge.close();rmSync(directory,{recursive:true,force:true});}};
}

test('a Codex chat of a Claude-configured agent binds with the saved session provider and keeps Paper settings',async()=>{
 const f=fixture();try{
  const codex=f.bridge.binding('codex-thread');
  assert.ok(codex,'the Codex session must bind (previously rejected because the agent default is Claude)');
  assert.equal(codex.agentId,'criador');assert.equal(codex.sessionId,'s-codex');assert.equal(codex.providerId,'codex');
  assert.equal(codex.agent.providerId,'codex');assert.equal(codex.agent.modelId,'gpt-5.5');
  assert.deepEqual(codex.agent.paperDesign,creator.paperDesign);assert.deepEqual(codex.agent.mcpPermissions,creator.mcpPermissions);
  // The Claude chat of the same agent is unchanged, and neither binds as the other provider.
  const claude=f.bridge.claudeBinding('claude-remote');
  assert.equal(claude.sessionId,'s-claude');assert.equal(claude.agent.providerId,'claude');assert.equal(claude.agent.modelId,'claude-opus-5-5');
  assert.equal(f.bridge.binding('claude-remote'),null);assert.equal(f.bridge.claudeBinding('codex-thread'),null);
  // The saved agent itself is never rewritten.
  assert.equal(creator.providerId,'claude');
 }finally{await f.close();}
});

test('the Claude model id never leaks into a Codex session without its own model',async()=>{
 const f=fixture();try{
  const binding=f.bridge.binding('codex-thread-2');
  assert.equal(binding.agent.providerId,'codex');assert.equal('modelId' in binding.agent,false);
 }finally{await f.close();}
});

test('legacy sessions without a saved provider keep the agent default',async()=>{
 const f=fixture();try{
  assert.equal(f.bridge.binding('legacy-remote'),null);
  assert.equal(f.bridge.claudeBinding('legacy-remote').agent.providerId,'claude');
 }finally{await f.close();}
});

test('authority stays per agent, session and profile',async()=>{
 assert.equal(effectiveSessionAgent(creator,{...sessions[1],agentId:'outro'}),null,'a session of another agent never borrows this agent');
 assert.equal(effectiveSessionAgent(creator,{...sessions[1],providerId:'gemini'}),null,'unknown providers are rejected');
 const f=fixture();try{
  const binding=f.bridge.binding('other-thread');
  assert.equal(binding.agentId,'outro');assert.equal(binding.agent.paperDesign.fileId,'OTHER');
  assert.notEqual(binding.hash,f.bridge.binding('codex-thread').hash);
  // A session id names the saved session; the provider still has to match it.
  assert.equal(f.bridge.binding(undefined,'s-codex').sessionId,'s-codex');
  assert.equal(f.bridge.binding(undefined,'s-claude'),null);
  assert.equal(f.bridge.sessionBinding('s-claude').agent.providerId,'claude');
  assert.equal(f.bridge.sessionBinding('s-codex').agent.providerId,'codex');
 }finally{await f.close();}
});

test('the saved Paper grant applies to the Codex chat through the host approval service',async()=>{
 const f=fixture();try{
  const binding=f.bridge.binding('codex-thread'),replies=[];
  const id=f.bridge.actions.register({requestId:'r1',threadId:'codex-thread',executionId:'turn',server:'paper',tool:'write_html',arguments:{fileId:FILE,targetNodeId:'1-0',mode:'insert-children',html:'<div>Texto</div>'}},binding,reply=>replies.push(reply),()=>f.bridge.binding('codex-thread'));
  assert.ok(id);assert.deepEqual(replies,[{action:'accept',content:{}}]);
  const row=f.bridge.actions.list('owner','s-codex').find(item=>item.id===id);
  assert.equal(row.status,'approved');assert.equal(row.provider,'codex');assert.equal(row.approvalSource,'paper-preference');
  // Another file is never covered by the grant.
  const pending=[];f.bridge.actions.register({requestId:'r2',threadId:'codex-thread',executionId:'turn',server:'paper',tool:'write_html',arguments:{fileId:'OTHER',targetNodeId:'1-0',mode:'insert-children',html:'<div/>'}},binding,reply=>pending.push(reply));
  assert.deepEqual(pending,[]);
 }finally{await f.close();}
});

test('under the Paper grant only a host-verified generated image is inserted without review',async()=>{
 const {writeFileSync,mkdirSync}=await import('node:fs');
 const {createChatImageArtifacts}=await import('../chat-image-artifacts.mjs');
 const {paperAssetUrl}=await import('../paper-image-assets.mjs');
 const directory=mkdtempSync(join(tmpdir(),'paper-gpt-assets-')),images=join(directory,'images'),generated=join(directory,'generated');mkdirSync(join(generated,'t'),{recursive:true});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=','base64');
 const savedPath=join(generated,'t','exec-1.png');writeFileSync(savedPath,png);
 createChatImageArtifacts(images).fromItem({type:'imageGeneration',id:'exec-1',status:'completed',result:png.toString('base64'),savedPath},'turn');
 const private_=join(directory,'private.png');writeFileSync(private_,Buffer.concat([png,Buffer.from([1])]));
 const bridge=createContentWorkflowBridge({dbPath:join(directory,'state.sqlite'),getCurrentProfile:()=> 'owner',getAgents:()=>[creator,other],getSessions:()=>sessions,getFlows:()=>({flows:[]}),paperAssetOptions:{imagesDirectory:images,generatedRoots:[generated]}});
 try{
  const binding=bridge.binding('codex-thread'),call=(id,src)=>{const replies=[];bridge.actions.register({requestId:id,threadId:'codex-thread',executionId:'turn',server:'paper',tool:'write_html',arguments:{fileId:FILE,targetNodeId:'3Z-0',mode:'insert-children',html:`<img layer-name="Fundo gerado (GPT)" src="${src}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover">`}},binding,reply=>replies.push(reply),()=>bridge.binding('codex-thread'));return replies;};
  assert.deepEqual(call('a',paperAssetUrl(savedPath)),[{action:'accept',content:{}}],'the native tool output verified against the host copy');
  assert.deepEqual(call('b',paperAssetUrl(private_)),[],'any other local file waits for the person');
 }finally{await bridge.close();rmSync(directory,{recursive:true,force:true});}
});
