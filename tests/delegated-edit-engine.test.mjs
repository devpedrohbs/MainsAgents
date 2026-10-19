import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile} from 'node:fs/promises';
import {existsSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge,isVideoEditorAgent} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';

/**
 * The user's real path: a content chat hands the recorded video to the video editor with mainsagents_delegate. That handoff
 * must run the app edit engine (cuts + Remotion overlays/motion + audio) directed by the editor agent, and come back with a
 * host-verified file (receipt with absolute path) in both chats — not a prose-only CLI turn. Model turns are simulated
 * (no real CLI/inference); FFmpeg runs for real; the animation engine is a copy stub (real Remotion is covered elsewhere).
 */
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
async function until(check,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error('timed out');}
async function fixture({animate=true,editorProvider='codex',claude=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'delegated-edit-')),dbPath=join(directory,'state.sqlite'),input=join(directory,'gravacao.mov');
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-c:a','aac','-f','mov',input]);
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Own role',providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',tools:['files','subagents']},{...base,id:'editor-de-video-1',name:'Editor de Vídeo',role:'Vídeo',tools:['files'],providerId:editorProvider,modelId:'model-x'}];
 const sessions=[{id:'chat-1',agentId:'conteudo',providerId:'codex',title:'Conversa',messages:[],createdAt:at,updatedAt:at}];
 let serial=0;const prompts=[],threads=new Map(),outputs=new Map();
 const reply=prompt=>prompt.includes('"removeSilences"')?JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.5,padding:0.15},normalizeAudio:true,animations:{title:'Skills no GitHub'},summary:'Cortar pausas e abrir com título'}):'Resposta normal do editor.';
 const runtime={providerId:editorProvider,capabilities:{reconcile:editorProvider==='codex'},createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},connect:async()=>`thread-${++serial}`,resumeSession:async()=>{},readThread:async id=>threads.get(id)??{turns:[]},cancel:async()=>{},
  send:async(_thread,prompt)=>{prompts.push(prompt);const id=`execution-${++serial}`;outputs.set(id,reply(prompt));return {executionId:id}},
  events:async function*(id){const text=outputs.get(id);yield {type:'message.delta',delta:text};yield {type:'message.completed',content:text};yield {type:'execution.completed'}}};
 const flow=createProductionFlow('space','Fluxo',agents);
 const mediaOptions={inspect,...(animate?{animate:async({inputPath,outputPath})=>copyFile(inputPath,outputPath),animationCapabilities:async()=>({available:true})}:{})};
 const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>runtime,getChatRuntime:provider=>provider==='claude'&&!claude?null:runtime,inspect,mediaOptions,timeoutMs:60000});
 const db=new DatabaseSync(dbPath);
 const delegate=(callId,args)=>bridge.delegations.dispatch({profileId:'owner',agentId:'conteudo',sessionId:'chat-1'},{threadId:'source-thread',turnId:'turn-1',callId,arguments:args},{targets:[{id:'editor-de-video-1'}]});
 return {directory,input,bridge,db,flow,agents,delegate,prompts,close:async()=>{await bridge.close();db.close();}};
}

test('the video editor is recognized by its flow box or its identity, never by a guess about other agents',()=>{
 const at=new Date().toISOString(),agents=[{id:'a',name:'Conteúdo',workspaceId:'w'},{id:'b',name:'Corte',workspaceId:'w'}],flow=createProductionFlow('w','F',[...agents]);
 const editor=flow.nodes.find(n=>n.kind==='video-agent')?.agentId;
 if(editor)assert.equal(isVideoEditorAgent([flow],agents.find(a=>a.id===editor)),true);
 assert.equal(isVideoEditorAgent([],{id:'editor-de-video-083621ee',name:'X',workspaceId:'w'}),true);
 assert.equal(isVideoEditorAgent([],{id:'research',name:'Pesquisa',role:'Pesquisa',workspaceId:'w'}),false);void at;
});

test('a chat handoff of a video to the editor runs the edit engine and returns a verified file with a host receipt in both chats',async()=>{
 const f=await fixture();try{
  const original=await inspect(f.input);
  const result=await f.delegate('call-1',{targetAgentId:'editor-de-video-1',title:'LinkedIn Skills',instructions:'Corte as pausas, mantenha a fala e anime a abertura.',files:[f.input]});
  assert.equal(result.success,true,result.content);
  assert.match(result.content,/Edição concluída e verificada pelo app/);assert.match(result.content,/Aplicado: /);
  assert(!result.content.includes(f.directory)&&!/[A-Za-z]:\\/.test(result.content),'the model gets no absolute path');
  const [run]=f.bridge.production.list('owner');
  assert.equal(run.entry.origin,'delegation');assert.equal(run.stage,'video-review',run.error);assert.equal(run.editPlan.mode,'smart');
  assert.equal(run.editPlan.plan.animations.length,1,'Remotion overlay rendered by the engine (title)');
  assert.deepEqual([run.editPreferences.motion,run.editPreferences.style],['balanced','creator-explanatory']);
  assert.equal(run.editorAgent.id,'editor-de-video-1');assert.equal(run.editorAgent.modelId,'model-x','the configured editor agent snapshot is kept as is');
  const job=f.bridge.delegations.snapshot('owner').jobs.find(j=>j.productionId===run.id);
  assert.equal(job.route,'engine');assert.equal(run.sourceSession.id,'chat-1');assert.equal(run.editorSession.id,job.targetSessionId,'editor chat = the delegated editor session');
  // Receipt on the production video message, mirrored to the source chat and the editor chat by the production merge.
  const video=run.editorSession.messages.find(m=>m.receipts?.length);const [receipt]=video.receipts;
  assert.equal(receipt.sha256,run.outputVideo.sha256);assert(isAbsolute(receipt.path)&&existsSync(receipt.path));assert.equal(job.receipts[0].id,receipt.id);
  // New edits are directed by Claude Code by default (per-function choice), with the editor agent's role/skills; the agent itself is unchanged.
  assert.match(video.content,/Direção: Editor de Vídeo \(Claude Code · modelo padrão do CLI\)/);assert.equal(run.editorAgent.providerId,'codex');assert.deepEqual(run.editDirector,{name:'Editor de Vídeo',provider:'claude',choice:'claude'});
  const checked=await f.bridge.receipts.check('owner',receipt.id);assert.equal(checked.status,'available');
  // The original recording is untouched; the content was created only because of this edit request.
  assert.equal((await inspect(f.input)).sha256,original.sha256);
  const state=JSON.parse(f.db.prepare('SELECT state_json FROM editorial_state').get().state_json);
  assert.equal(state.contents.length,1);assert(state.assets.some(a=>a.role==='source'&&a.versions[0].sha256===original.sha256));
  // Same tool call again (retry/restart of the source turn): same result, never a second run or render.
  const again=await f.delegate('call-1',{targetAgentId:'editor-de-video-1',title:'LinkedIn Skills',instructions:'Corte as pausas, mantenha a fala e anime a abertura.',files:[f.input]});
  assert.equal(again.content,result.content);assert.equal(f.bridge.production.list('owner').length,1);assert.equal(f.bridge.media.list('owner').length,1);
  // The editor directed the edit through the engine prompt, not a free-form CLI briefing.
  assert(f.prompts.some(p=>p.includes('"removeSilences"')));assert(!f.prompts.some(p=>p.includes('Task from Editor de Conteúdo')));
 }finally{await f.close();}
});

test('the workspace can keep the editor agent\'s own provider; an unavailable Claude stops with the reason and an explicit alternative',async()=>{
 const f=await fixture({claude:false});try{
  const result=await f.delegate('call-4',{targetAgentId:'editor-de-video-1',title:'Sem Claude',instructions:'Edite com motion.',files:[f.input]});
  assert.equal(result.success,false);assert.match(result.content,/Claude Code indisponível/);
  let [run]=f.bridge.production.list('owner');assert.equal(run.stage,'blocked');assert.equal(f.bridge.media.list('owner').length,0,'no silent switch to another provider');
  run=await f.bridge.production.command('owner',{id:run.id,revision:run.revision,requestId:'director-1',action:'set-edit-director',authorize:true,director:{providerId:'agent'}});
  // R4: a halted run only saves the choice; the existing Resume runs it.
  assert.equal(run.stage,'blocked');assert.equal(run.resumeStage,'planning-edit');assert.equal(f.bridge.media.list('owner').length,0);
  await f.bridge.production.command('owner',{id:run.id,revision:run.revision,requestId:'resume-1',action:'resume',authorize:true});
  await until(()=>['video-review','blocked'].includes(f.bridge.production.list('owner')[0].stage));[run]=f.bridge.production.list('owner');assert.equal(run.stage,'video-review',run.error);
  assert.match(run.editorSession.messages.find(m=>m.receipts?.length).content,/Direção: Editor de Vídeo \(Codex · model-x\)/);
  assert.deepEqual(f.bridge.production.editDirector('owner','space'),{providerId:'claude',source:'default'},'a choice made in one production never changes the workspace default');
 }finally{await f.close();}
});

test('requested motion without an animation engine fails the handoff honestly instead of returning a plain cut',async()=>{
 const f=await fixture({animate:false});try{
  const result=await f.delegate('call-2',{targetAgentId:'editor-de-video-1',title:'Sem motor',instructions:'Edite com motion.',files:[f.input]});
  assert.equal(result.success,false);assert.match(result.content,/Motion pedido, mas o motor de animação/);assert.match(result.content,/Continuar sem motion/);
  const [run]=f.bridge.production.list('owner');assert.equal(run.stage,'blocked');assert.equal(run.blockReason,'motion');assert.equal(f.bridge.media.list('owner').length,0,'no export');
 }finally{await f.close();}
});

test('a handoff without a video keeps the normal specialist chat route',async()=>{
 const f=await fixture();try{
  const result=await f.delegate('call-3',{targetAgentId:'editor-de-video-1',title:'Pergunta',instructions:'Qual duração ideal para um reel?',files:[]});
  assert.equal(result.success,true);assert.equal(result.content,'Resposta normal do editor.');
  assert.equal(f.bridge.production.list('owner').length,0);assert(f.prompts.some(p=>p.includes('Task from Editor de Conteúdo')));
 }finally{await f.close();}
});
