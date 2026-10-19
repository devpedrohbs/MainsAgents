import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {copyFile,readFile} from 'node:fs/promises';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createEditorAuthoring,editorContinuation,editorTurnBudget,EDITOR_CONTRACT,EDITOR_TURNS} from '../editor-authoring.mjs';
import {createEditorHost} from '../editor-host.mjs';
import {createClaudeCodeBridge} from '../claude-code-bridge.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';
import {agentSnapshot,productionBindingHash} from '../production-coordinator.mjs';

/**
 * Editor turn limit (production-8314f2f5, 2026-10-14): the Claude CLI stopped the editor at --max-turns 20 with 22 host calls
 * done and revision 3 saved. These tests prove the turn cap follows the host budget, a confirmed turn-limit stop continues
 * from the SAME host checkpoint (nothing redone, budgets kept) with a bounded number of continuations and only on measured
 * progress, legacy stops are recovered only with durable evidence, previews are re-bound only with matching bytes, and the
 * effective executor (Claude) is recorded while the editor agent stays Codex. Declared simulations: the model's tool calls
 * are scripts (no CLI/inference); the animation engine is a copy stub with FFmpeg stills. FFmpeg runs for real.
 */
const turnLimitText='The editor reached its turn limit. The checkpoint keeps what was done; nothing beyond it was applied.';
const sha=value=>createHash('sha256').update(value).digest('hex');
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const ffmpeg=args=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-y',...args]);
async function until(check,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw Error('timed out');}

// ---------------------------------------------------------------- pure limits and continuation decision
const checkpoint=(over={})=>({contract:EDITOR_CONTRACT,state:'open',calls:0,revision:0,planHash:null,revisionsUsed:0,previewsUsed:0,finalized:false,qa:{sourceObserved:false,inspectedRevision:0,coveredScenes:[]},scenes:[],previews:[],...over});

test('turn cap follows the host call budget left (callsLeft + slack, clamped), never the old fixed 20',()=>{
 assert.equal(editorTurnBudget(checkpoint()),40,'fresh session: capped at 40');
 assert.equal(editorTurnBudget(checkpoint({calls:22})),40,'the real run (22 calls) gets 40 turns for what remains');
 assert.equal(editorTurnBudget(checkpoint({calls:50})),16);
 assert.equal(editorTurnBudget(checkpoint({calls:60})),EDITOR_TURNS.min,'budget used: minimum turns to report');
 assert.equal(editorTurnBudget(checkpoint({calls:2}),{maxCalls:10}),14);
});

test('continuation needs a checkpoint, measured progress (automatic), budget left and stays under the per-epoch cap',()=>{
 const before={calls:10,revision:1,planHash:'a',sourceObserved:true,inspectedRevision:0,coveredScenes:0,previewsUsed:0,finalized:false};
 const scenes=[{id:'hook',start:0,end:4},{id:'fim',start:4,end:8}];
 const progressed=checkpoint({calls:14,revision:2,planHash:'b',revisionsUsed:1,qa:{sourceObserved:true,inspectedRevision:1,coveredScenes:['hook']},scenes,previewsUsed:1,previews:[{previewId:'preview-0123456789abcdef',revision:2}]});
 const ok=editorContinuation({checkpoint:progressed,previous:before,used:0});
 assert.equal(ok.continue,true);assert.equal(ok.reason,'progress');assert.deepEqual(ok.remaining.uncoveredScenes,['fim']);assert.deepEqual(ok.remaining.previews,['preview-0123456789abcdef']);assert.equal(ok.remaining.callsLeft,46);
 // Calls without any new revision/inspection/preview are not progress (e.g. looping on get_context or refused writes).
 const idle=editorContinuation({checkpoint:checkpoint({calls:12,revision:1,planHash:'a',qa:{sourceObserved:true,inspectedRevision:0,coveredScenes:[]}}),previous:before,used:0});
 assert.deepEqual([idle.continue,idle.reason],[false,'no_progress']);
 // A user resume may retry once without new progress; the cap and the host budget still apply.
 assert.deepEqual([editorContinuation({checkpoint:checkpoint({calls:12,revision:1}),previous:before,used:1,requireProgress:false}).continue],[true]);
 assert.equal(editorContinuation({checkpoint:progressed,previous:before,used:EDITOR_TURNS.maxContinuations}).reason,'continuation_cap');
 assert.equal(editorContinuation({checkpoint:checkpoint({calls:58,revision:3}),previous:before,used:0}).reason,'host_budget');
 assert.equal(editorContinuation({checkpoint:{...progressed,state:'cancelled'},previous:before}).reason,'cancelled');
 assert.equal(editorContinuation({checkpoint:{...progressed,finalized:true},previous:before}).reason,'finalized');
 assert.equal(editorContinuation({checkpoint:null}).reason,'no_checkpoint');
 assert.equal(editorContinuation({checkpoint:{...progressed,contract:'other/1'}}).reason,'no_checkpoint');
});

// ---------------------------------------------------------------- authoring: durable read progress and preview re-binding
const binding={runId:'run-x',epoch:1,profileId:'owner',workspaceId:'space',agentId:'editor',contentId:'content',authorityHash:'auth-1',source:{assetId:'a',versionId:'v',sha256:'f'.repeat(64)}};
function memoryHost(root,{previewBytes='preview-bytes'}={}){
 const files=new Map();let n=0;
 return {files,
  currentBinding:()=>binding,context:async()=>({metadata:{duration:8},planSchema:{}}),
  validatePlan:async({plan})=>({ok:true,plan,planHash:sha(JSON.stringify(plan)),scenes:[{id:'hook',start:0,end:4},{id:'fim',start:4,end:8}]}),
  savePlan:async()=>{},
  frames:async({times})=>times.map(time=>({time,bytes:Buffer.from('png'),mimeType:'image/png'})),
  storyboardStills:async({sceneIds})=>sceneIds.map(sceneId=>({sceneId,position:'mid',time:1,bytes:Buffer.from('png'),mimeType:'image/png'})),
  renderPreview:async()=>{const path=join(root,`preview-${++n}.mp4`),bytes=`${previewBytes}-${n}`;writeFileSync(path,bytes);const digest=sha(bytes);files.set(`preview-${digest.slice(0,16)}`,path);return {previewId:`preview-${digest.slice(0,16)}`,path,sha256:digest,duration:2};},
  restorePreview:async({previewId})=>files.has(previewId)?{previewId,path:files.get(previewId)}:null,
  finalExport:async()=>({status:'pending',jobId:'job'}),
 };
}
const grant={scope:'edit-local',authorityHash:'auth-1'};

test('every applied call checkpoints (read QA too); preview refs of the current revision are saved without paths',async()=>{
 const root=mkdtempSync(join(tmpdir(),'turn-limit-authoring-')),authoring=createEditorAuthoring(),host=memoryHost(root);
 const {sessionId}=authoring.open({binding,host,grant}),events=[];authoring.subscribe(sessionId,event=>events.push(event));const token=authoring.attach(sessionId,'exec-1');
 await authoring.call(token,'get_frames',{times:[1]});
 assert.equal(events.at(-1).checkpoint.qa.sourceObserved,true,'source observation survives a stop right after it');
 await authoring.call(token,'write_plan',{baseRevision:0,plan:{segments:[{start:0,end:8}]}});
 const preview=(await authoring.call(token,'render_preview',{revision:1,start:0,duration:2})).structuredContent.previewId;
 await authoring.call(token,'storyboard_stills',{revision:1,sceneIds:['hook']});
 const saved=events.at(-1).checkpoint;
 assert.deepEqual(saved.qa.coveredScenes,['hook']);assert.equal(saved.calls,4);
 assert.deepEqual(saved.previews.map(item=>[item.previewId,item.revision,item.duration]),[[preview,1,2]]);
 assert.equal(JSON.stringify(saved).includes(root),false,'no host path in the checkpoint');
});

test('a restored session re-binds previews only with matching bytes and never treats an unseen preview as inspected',async()=>{
 const root=mkdtempSync(join(tmpdir(),'turn-limit-restore-')),first=createEditorAuthoring(),host=memoryHost(root);
 const {sessionId}=first.open({binding,host,grant,limits:{maxPreviews:1}}),token=first.attach(sessionId,'exec-1');
 await first.call(token,'get_frames',{times:[1]});await first.call(token,'write_plan',{baseRevision:0,plan:{segments:[{start:0,end:8}]}});
 const previewId=(await first.call(token,'render_preview',{revision:1,start:0,duration:2})).structuredContent.previewId;
 await first.call(token,'storyboard_stills',{revision:1});
 const saved=first.checkpoint(sessionId);first.close(sessionId);
 // New process (restart/resume): budget continues, the preview of revision 1 is re-bound after hashing its file.
 const second=createEditorAuthoring(),reopened=second.open({binding,host,grant,limits:{maxPreviews:1},checkpoint:saved}).sessionId;
 const prepared=await second.prepare(reopened);
 assert.deepEqual(prepared.restored,[previewId]);assert.equal(prepared.checkpoint.calls,saved.calls,'host call budget is not reset');assert.equal(prepared.checkpoint.previewsUsed,1);
 const t2=second.attach(reopened,'exec-2');
 // Preview budget exhausted, but THIS revision has a rendered preview: finalize demands it is looked at.
 const refused=await second.call(t2,'finalize',{revision:1});
 assert.equal(refused.structuredContent.code,'qa_required');assert.match(refused.content[0].text,new RegExp(previewId));
 assert.notEqual((await second.call(t2,'get_frames',{target:{previewId},times:[0.5]})).isError,true,'the restored preview is inspectable');
 const final=await second.call(t2,'finalize',{revision:1});assert.equal(final.structuredContent.status,'pending');
 assert.equal(second.checkpoint(reopened).final.qa.previewInspected,true);
 // Bytes changed on disk: not restored, reported as missing, finalize then records the real limitation.
 writeFileSync(host.files.get(previewId),'tampered');
 const third=createEditorAuthoring(),again=third.open({binding,host,grant,limits:{maxPreviews:1},checkpoint:saved}).sessionId;
 assert.deepEqual((await third.prepare(again)).missing,[previewId]);
 const t3=third.attach(again,'exec-3'),limited=await third.call(t3,'finalize',{revision:1});
 assert.equal(limited.structuredContent.status,'pending');assert.deepEqual(third.checkpoint(again).final.qa.limitations,['previewBudgetExhausted']);assert.equal(third.checkpoint(again).final.qa.previewInspected,false);
});

test('legacy checkpoints (no refs) re-bind a preview from their own render_preview action by hashing the run folder',async()=>{
 const root=mkdtempSync(join(tmpdir(),'turn-limit-legacy-')),runFolder=join(root,'run-x-e1');mkdirSync(runFolder,{recursive:true});
 const bytes='rendered-preview-of-revision-3',digest=sha(bytes),previewId=`preview-${digest.slice(0,16)}`;
 writeFileSync(join(runFolder,`preview-${randomUUID()}.mp4`),'another preview');writeFileSync(join(runFolder,`preview-${randomUUID()}.mp4`),bytes);
 let stored={authoring:{revision:3,planHash:'h3',revisions:[{revision:3,planHash:'h3',plan:{}}]}};const seen=[];
 const host=createEditorHost({profile:'owner',binding,read:()=>stored,update:change=>change(stored),guard:()=>{},media:{authoringFrames:async(_profile,input)=>{seen.push(input.path);return {frames:[]};}},ref:{},base:{segments:[]},authoringRoot:root,finalExport:async()=>({}),exportStatus:async()=>({})});
 assert.equal(await host.restorePreview({previewId,sha256Prefix:digest.slice(0,16),revision:2,planHash:'h2'}),null,'only the saved current revision');
 const found=await host.restorePreview({previewId,sha256Prefix:digest.slice(0,16),revision:3,planHash:'h3',start:54,duration:10});
 assert.equal(found.previewId,previewId);assert.equal(sha(await readFile(found.path)),digest);
 await host.frames({target:{previewId},times:[1]});assert.equal(seen[0],found.path);
 // The authoring module derives the legacy ref from the checkpoint's own action log and re-verifies the full hash.
 const legacy={contract:EDITOR_CONTRACT,runId:'run-x',epoch:1,authorityHash:'auth-1',sourceSha256:'f'.repeat(64),state:'open',revision:3,planHash:'h3',revisionsUsed:2,previewsUsed:3,visionBytes:10,calls:22,qa:{sourceObserved:true,inspectedRevision:2,coveredScenes:['hook']},scenes:[{id:'hook',start:0,end:4},{id:'fechamento',start:4,end:8}],finalized:false,actions:[{tool:'render_preview',revision:2,previewId:'preview-aaaaaaaaaaaaaaaa',start:0,duration:10},{tool:'render_preview',revision:3,previewId,start:54,duration:10}]};
 const authoring=createEditorAuthoring(),{sessionId}=authoring.open({binding,host:{...host,currentBinding:()=>binding,context:async()=>({}),validatePlan:async()=>({ok:true})},grant,checkpoint:legacy});
 const prepared=await authoring.prepare(sessionId);
 assert.deepEqual(prepared.restored,[previewId]);assert.equal(prepared.checkpoint.qa.inspectedRevision,2,'restoring is not inspecting');
 assert.equal(prepared.checkpoint.previews[0].sha256,digest);assert.equal(prepared.checkpoint.calls,22);
 const decision=editorContinuation({checkpoint:prepared.checkpoint,used:0,requireProgress:false});
 assert.deepEqual(decision.remaining.uncoveredScenes,['fechamento']);assert.deepEqual(decision.remaining.previews,[previewId]);assert.equal(decision.remaining.previewInspected,false);
});

// ---------------------------------------------------------------- bridge: derived --max-turns and a diagnosable stop
test('the Claude bridge derives --max-turns from the host budget and reports the turn limit with real diagnostics',async()=>{
 const root=mkdtempSync(join(tmpdir(),'turn-limit-bridge-')),spawned=[];
 const spawnImpl=(_resolved,args)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={on(){},end(){}};child.kill=()=>{};spawned.push(args);
  setImmediate(()=>{child.stdout.emit('data',Buffer.from(`${JSON.stringify({type:'result',subtype:'error_max_turns',is_error:true,num_turns:41})}\n`));child.emit('close',1);});return child;};
 const bridge=createClaudeCodeBridge({cwdRoot:root,resolveCli:()=>({command:join(root,'claude.exe'),prefixArgs:[]}),spawnImpl});
 const host={currentBinding:()=>binding,context:async()=>({}),validatePlan:async()=>({ok:true})};
 const run=async extra=>{const {sessionId}=bridge.runtime.openEditorSession({binding,host,grant});const {executionId}=await bridge.runtime.send(randomUUID(),'Edite.',{name:'Editor',workspaceId:'space',runtimeFirstMessage:true,editorSessionId:sessionId,...extra});const events=[];for await(const event of bridge.runtime.events(executionId))events.push(event);return {sessionId,events,args:spawned.at(-1)};};
 const first=await run({});
 assert.equal(first.args[first.args.indexOf('--max-turns')+1],'40');
 const failed=first.events.find(event=>event.type==='execution.failed');
 assert.equal(failed.code,'editor_turn_limit');assert.equal(failed.retryable,false);assert.equal(failed.checkpointed,true);
 assert.deepEqual(failed.diagnostics,{numTurns:41,maxTurns:40,callsAtStart:0,calls:0,callsLeft:60,revision:0,finalized:false});
 assert.ok(bridge.runtime.openEditorSession&&typeof bridge.runtime.prepareEditorSession==='function');
 // The finished process was detached before its terminal event: a continuation can attach to the same host session.
 assert.doesNotThrow(()=>bridge.runtime.closeEditorSession(first.sessionId,'closed'));
 const explicit=await run({editorMaxTurns:70});assert.equal(explicit.args[explicit.args.indexOf('--max-turns')+1],'70','explicit override up to 80');
 const over=await run({editorMaxTurns:500});assert.equal(over.args[over.args.indexOf('--max-turns')+1],'40','out-of-range override falls back to the derived cap');
});

// ---------------------------------------------------------------- coordinator: real host, scripted Claude
async function stillsStub({inputPath,outDir,animations,frames,sceneIds,metadata}){
 const {mkdir}=await import('node:fs/promises');await mkdir(outDir,{recursive:true});
 const fps=metadata.fps,scenes=(animations.storyboard?.scenes??[]).filter(scene=>!sceneIds||sceneIds.includes(scene.id));
 const picks=frames?frames.map(frame=>({frame,sceneId:null,moment:'manual'})):scenes.flatMap(scene=>[['entrada',scene.start+0.05],['meio',(scene.start+scene.end)/2],['saida',Math.max(scene.start,scene.end-0.1)]].map(([moment,t])=>({frame:Math.round(t*fps),sceneId:scene.id,moment})));
 const stills=[];for(const [index,pick] of picks.entries()){const path=join(outDir,`still-${index}.jpg`);await ffmpeg(['-ss',String(pick.frame/fps),'-i',inputPath,'-frames:v','1',path]);stills.push({...pick,seconds:pick.frame/fps,path});}
 const sheet=join(outDir,'sheet.jpg');await copyFile(stills[0].path,sheet);
 return {stills,contactSheets:[{path:sheet}],storyboard:{qa:{ok:true}}};
}
/** Chat runtime of Claude whose "model" is a script on the REAL editor-authoring tools; a script may end on the turn limit. */
function scriptedClaude(authoring,scripts){
 const runs=new Map();let n=0;const sends=[];
 return {sends,
  openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),prepareEditorSession:(id,options)=>authoring.prepare(id,options),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),
  async send(_thread,content,agent){const id=`claude-exec-${++n}`;sends.push({content,editorSessionId:agent.editorSessionId,providerId:agent.providerId,modelId:agent.modelId});runs.set(id,{agent});return {executionId:id};},
  async *events(id){
   const {agent}=runs.get(id),script=scripts.shift();if(!script)throw Error('No scripted turn left.');
   const queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);
   let outcome;try{outcome=await script((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}
   for(const event of queue)yield event;
   yield {type:'usage.reported',executionId:id,usage:{version:1,status:outcome?.stop?'partial':'reported',provider:'claude',tokens:{input:10,output:20},model:'claude-opus-5-5',numTurns:outcome?.numTurns??21}};
   if(outcome?.stop){
    const cp=authoring.checkpoint(agent.editorSessionId);
    if(outcome.stop==='legacy'){yield {type:'execution.failed',executionId:id,message:turnLimitText,retryable:false};return;}
    if(outcome.stop==='cli')  {yield {type:'execution.failed',executionId:id,code:'claude_cli_error',message:'Claude Code CLI could not complete this response. Check its connection and authentication, then retry.',retryable:true};return;}
    yield {type:'execution.failed',executionId:id,code:'editor_turn_limit',message:turnLimitText,retryable:false,checkpointed:true,diagnostics:{numTurns:21,maxTurns:20,callsAtStart:0,calls:cp.calls,callsLeft:60-cp.calls,revision:cp.revision,finalized:cp.finalized}};return;
   }
   yield {type:'message.completed',content:JSON.stringify(outcome)};yield {type:'execution.completed'};
  },
  cancel:async()=>{},
 };
}
const title='3 dicas de edição';
const storyboard=(out,step='Corte as pausas')=>({version:1,title:'Edição explicativa',timeline:{basis:'output'},style:{treatment:'creator'},scenes:[
 {id:'abertura',name:'Abertura',start:0,end:2.5,camera:{layout:'full'},layers:[{id:'titulo',type:'text',text:title,role:'title',slot:'top',start:0.2,end:2.2,source:'brief',quote:title}]},
 {id:'metodo',name:'Método',start:2.5,end:out,camera:{layout:'split-top'},layers:[{id:'passo',type:'text',text:step,role:'title',slot:'panel',start:0.2,end:Math.min(2,out-2.6),source:'design'}]}]});
const look=async call=>{const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[0.5,3]});return context;};
const plan=async(call,baseRevision,step)=>{const context=(await call('get_context')).structuredContent,out=context.metadata.duration,saved=await call('write_plan',{baseRevision,plan:{segments:[{start:0,end:out}],storyboard:storyboard(out,step)}});assert.notEqual(saved.isError,true,saved.content[0].text);return saved.structuredContent.revision;};
const finish=async(call,revision,{render=true}={})=>{
 if(render){const preview=await call('render_preview',{revision,start:1,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5,2]});}
 const stills=await call('storyboard_stills',{revision});assert.notEqual(stills.isError,true,stills.content[0].text);
 let result=await call('finalize',{revision,summary:'Cortes e motion explicativo.'});assert.notEqual(result.isError,true,result.content[0].text);
 for(let i=0;i<300&&result.structuredContent?.status==='pending';i++){await new Promise(r=>setTimeout(r,100));result=await call('export_status');}
 return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};
};
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'turn-limit-edit-')),dbPath=join(directory,'state.sqlite'),input=join(directory,'gravacao.mp4');
 await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Own role',providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',tools:['files','subagents']},{...base,id:'editor-de-video-1',name:'Editor de Vídeo',role:'Vídeo',tools:['files']}];
 const sessions=[{id:'chat-1',agentId:'conteudo',providerId:'codex',title:'Conversa',messages:[],createdAt:at,updatedAt:at}];
 let serial=0;const threads=new Map();
 const codex={providerId:'codex',capabilities:{reconcile:true},createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},connect:async()=>`thread-${++serial}`,resumeSession:async()=>{},readThread:async id=>threads.get(id)??{turns:[]},cancel:async()=>{},send:async()=>({executionId:`execution-${++serial}`}),events:async function*(){yield {type:'message.completed',content:'Resposta normal.'};yield {type:'execution.completed'}}};
 const authoring=createEditorAuthoring(),scripts=[],claude=scriptedClaude(authoring,scripts),flow=createProductionFlow('space','Fluxo',agents);
 const mediaOptions={inspect,animate:async({inputPath,outputPath})=>copyFile(inputPath,outputPath),animationCapabilities:async()=>({available:true}),stills:stillsStub};
 const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>codex,getChatRuntime:provider=>provider==='claude'?claude:codex,inspect,mediaOptions,timeoutMs:120000});
 const db=new DatabaseSync(dbPath);
 const delegate=callId=>bridge.delegations.dispatch({profileId:'owner',agentId:'conteudo',sessionId:'chat-1'},{threadId:'source-thread',turnId:`turn-${callId}`,callId,arguments:{targetAgentId:'editor-de-video-1',title:'Dicas de edição',instructions:`Edite com motion explicativo: ${title} para quem grava no celular.`,files:[input]}},{targets:[{id:'editor-de-video-1'}]});
 const run=()=>bridge.production.list('owner')[0],get=()=>bridge.production.get('owner',run().id);
 let n=0;const command=(action,data={})=>bridge.production.command('owner',{id:run().id,revision:get().revision,requestId:`turn-limit-${++n}`,action,...data});
 const raw=()=>JSON.parse(db.prepare('SELECT data_json FROM production_runs').get().data_json);
 const patch=change=>{const value=raw();change(value);db.prepare('UPDATE production_runs SET data_json=?').run(JSON.stringify(value));};
 return {bridge,db,claude,scripts,delegate,get,command,raw,patch,agents,input,close:async()=>{await bridge.close();db.close();}};
}
const settled=f=>until(()=>{const p=f.get();return ['video-review','blocked','paused'].includes(p?.stage)?p:null;});

test('a confirmed turn-limit stop with progress continues automatically in the SAME host session: nothing redone, Claude recorded as executor',{timeout:180000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async call=>{await look(call);await plan(call,0);return {stop:'turn-limit'};});
  f.scripts.push(async call=>{const context=(await call('get_context')).structuredContent;assert.equal(context.currentPlan.revision,1,'the saved revision is the starting point');return finish(call,1);});
  const result=await f.delegate('call-1');assert.equal(result.success,true,result.content);
  const p=f.get();assert.equal(p.stage,'video-review',p.error);
  assert.equal(f.claude.sends.length,2);assert.equal(f.claude.sends[1].editorSessionId,f.claude.sends[0].editorSessionId,'same host session and budget');
  assert.match(f.claude.sends[1].content,/Continuação 1\/3 da MESMA edição/);assert.match(f.claude.sends[1].content,/revisão atual 1/);assert.match(f.claude.sends[1].content,/gravação já observada: sim/);
  assert.doesNotMatch(f.claude.sends[1].content,/1\) get_context: leia a orientação de edição/,'the first prompt is not replayed');
  assert.equal(p.authoring.checkpoint.revision,1,'no plan rewritten');assert.equal(p.authoring.continuations,1);
  const [initial,continuation]=p.authoring.executions;
  assert.deepEqual([initial.kind,initial.outcome,initial.code,initial.numTurns,initial.maxTurns],['initial','turn_limit','editor_turn_limit',21,20]);
  assert.deepEqual([continuation.kind,continuation.outcome,continuation.continuation],['continuation','completed',1]);
  assert.equal(continuation.callsBefore,initial.callsAfter,'host call counter continues, never resets');assert.ok(continuation.callsAfter>continuation.callsBefore);
  for(const item of p.authoring.executions){assert.equal(item.providerId,'claude');assert.equal(item.model,'claude-opus-5-5');assert.equal(item.requestedModel,null);}
  assert.equal(p.editorAgent.providerId,'codex','the editor agent stays Codex; Claude is the effective director');assert.ok(f.claude.sends.every(item=>item.providerId==='claude'));
  const calls=p.budget.calls;assert.equal(calls.length,2);assert.notEqual(calls[0].key,calls[1].key);assert.deepEqual(calls.map(item=>item.status),['failed','completed']);
  assert.equal(p.authoring.lastStop,undefined);assert.ok(p.events.some(event=>event.action==='editor-continuation'));
  assert.equal(f.bridge.media.list('owner').filter(job=>job.status==='succeeded').length,1,'one export');
 }finally{await f.close();}
});

test('no progress stops with PT diagnostics; resume continues from the checkpoint and later re-binds the saved preview',{timeout:180000},async()=>{
 const f=await fixture();try{
  let previewId;
  f.scripts.push(async call=>{await look(call);const revision=await plan(call,0);previewId=(await call('render_preview',{revision,start:1,duration:3})).structuredContent.previewId;return {stop:'turn-limit'};});
  f.scripts.push(async()=>({stop:'turn-limit'}));// continuation 1 does nothing: no measured progress
  assert.equal((await f.delegate('call-1')).success,false);
  let p=await settled(f);assert.equal(p.stage,'blocked');
  assert.match(p.error,/O editor \(Claude Code\) parou em 21 turno\(s\) com limite 20/);assert.match(p.error,/Não continuei automaticamente: a última execução não avançou/);assert.match(p.error,/Retome para continuar do checkpoint/);assert.match(p.error,/original está preservado/);
  assert.deepEqual([p.authoring.lastStop.code,p.authoring.lastStop.reason,p.authoring.lastStop.continuable,p.authoring.lastStop.continuationsUsed],['editor_turn_limit','no_progress',true,1]);
  assert.equal(f.bridge.media.list('owner').length,0,'nothing exported');assert.equal(f.claude.sends.length,2);
  // Resume (explicit user decision): a NEW host session restored from the checkpoint; the preview comes back by its host record.
  f.scripts.push(async call=>{const frames=await call('get_frames',{target:{previewId},times:[0.5]});assert.notEqual(frames.isError,true,frames.content[0].text);return finish(call,1,{render:false});});
  await f.command('resume',{authorize:true});
  p=await settled(f);assert.equal(p.stage,'video-review',p.error);
  assert.equal(f.claude.sends.length,3);assert.notEqual(f.claude.sends[2].editorSessionId,f.claude.sends[0].editorSessionId);
  assert.match(f.claude.sends[2].content,/Continuação 2\/3/);assert.match(f.claude.sends[2].content,new RegExp(`${previewId}.*não renderize de novo`));
  assert.equal(p.authoring.checkpoint.previewsUsed,1,'restoring a preview spends nothing');assert.equal(p.editPlan.qa.previewInspected,true);
  assert.deepEqual(p.authoring.executions.map(item=>item.outcome),['turn_limit','turn_limit','completed']);
 }finally{await f.close();}
});

test('continuations are capped per epoch; after the cap a resume does not spend another turn',{timeout:240000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async call=>{await look(call);await plan(call,0);return {stop:'turn-limit'};});
  f.scripts.push(async call=>{await plan(call,1,'Corte as pausas longas');return {stop:'turn-limit'};});
  f.scripts.push(async call=>{await plan(call,2,'Corte só as pausas');return {stop:'turn-limit'};});
  f.scripts.push(async call=>{await call('storyboard_stills',{revision:3,sceneIds:['abertura']});return {stop:'turn-limit'};});
  assert.equal((await f.delegate('call-1')).success,false);
  let p=await settled(f);assert.equal(p.stage,'blocked');assert.equal(f.claude.sends.length,4);
  assert.equal(p.authoring.lastStop.reason,'continuation_cap');assert.equal(p.authoring.lastStop.continuable,false);assert.match(p.error,/Retomar não continua esta edição/);
  await f.command('resume',{authorize:true});
  p=await until(()=>{const value=f.get();return value.stage==='blocked'&&value.revision!==p.revision?value:null;});
  assert.equal(f.claude.sends.length,4,'no fifth turn');assert.equal(p.budget.calls.length,4);
 }finally{await f.close();}
});

test('another failure is not a turn limit: no continuation, and resuming still requires an explicit resend',{timeout:180000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async call=>{await look(call);return {stop:'cli'};});
  assert.equal((await f.delegate('call-1')).success,false);
  let p=await settled(f);assert.equal(p.stage,'blocked');assert.match(p.error,/Claude Code CLI could not complete/);assert.equal(p.authoring.continuations,undefined);
  assert.equal(p.step.failure.code,'claude_cli_error');
  await f.command('resume',{authorize:true});
  p=await until(()=>{const value=f.get();return value.stage==='blocked'&&/reenvio/.test(value.error)?value:null;});
  assert.equal(f.claude.sends.length,1,'nothing re-sent implicitly');
 }finally{await f.close();}
});

test('legacy stop (saved before step.failure existed) is continued only with durable evidence of the same step',{timeout:240000},async()=>{
 for(const evidence of [true,false]){
  const f=await fixture();try{
   f.scripts.push(async call=>{await look(call);await plan(call,0);return {stop:'legacy'};});
   assert.equal((await f.delegate('call-1')).success,false);
   let p=await settled(f);assert.equal(p.stage,'blocked');assert.equal(p.error,turnLimitText);assert.equal(p.step.phase,'streaming');
   // Exactly the shape of production-8314f2f5: no failure on the step; its call failed; the blocking audit carries the bridge text.
   f.patch(value=>{delete value.step.failure;delete value.authoring.executions;if(!evidence)value.events.findLast(event=>event.action==='blocked').detail='Texto qualquer escrito pelo usuário';});
   const stored=f.raw(),presented=f.bridge.production.list('owner')[0];
   if(evidence){assert.equal(presented.authoring.lastStop.code,'editor_turn_limit');assert.equal(presented.authoring.lastStop.continuable,true);assert.equal(presented.authoring.executions[0].model,'claude-opus-5-5');}
   else assert.equal(presented.authoring.lastStop,undefined,'unproven legacy failures keep the uncertain flow');
   assert.deepEqual(f.raw(),stored,'presenting the legacy stop never writes production state or uses a provider');assert.equal(f.claude.sends.length,1);
   if(evidence)f.scripts.push(async call=>finish(call,1));
   await f.command('resume',{authorize:true});
   if(evidence){
    p=await settled(f);assert.equal(p.stage,'video-review',p.error);
    assert.match(f.claude.sends[1].content,/Continuação 1\/3/);assert.equal(p.authoring.executions[0].legacy,true);assert.equal(p.authoring.executions[0].model,'claude-opus-5-5');
    assert.ok(p.events.some(event=>event.action==='editor-turn-limit-recovered'));
   }else{
    p=await until(()=>{const value=f.get();return value.stage==='blocked'&&/reenvio/.test(value.error)?value:null;});
    assert.equal(f.claude.sends.length,1,'without the evidence nothing is continued or re-sent');
   }
  }finally{await f.close();}
 }
});

test('changing the edit director is a new authority: fresh session and budget, no continuation, workspace default untouched',{timeout:180000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async()=>({stop:'turn-limit'}));
  assert.equal((await f.delegate('call-1')).success,false);
  let p=await settled(f);assert.equal(p.authoring.lastStop.reason,'no_progress');
  // R4 noop: the same normalized director changes nothing (no write, authority, step, checkpoint, budget) and sends nothing.
  const before=f.raw(),authority=()=>f.db.prepare('SELECT hash FROM production_authority').get().hash,hash=authority();
  const same=await f.command('set-edit-director',{authorize:true,director:{providerId:'claude'}});
  assert.equal(same.revision,before.revision);assert.deepEqual(f.raw(),before);assert.equal(authority(),hash);assert.equal(f.claude.sends.length,1);
  // R4 change while halted (blocked, then paused): only the choice is saved; it stays halted, nothing runs until Resume.
  f.patch(value=>{value.stage='paused';});
  p=await f.command('set-edit-director',{authorize:true,director:{providerId:'claude',modelId:'opus'}});
  assert.deepEqual([p.stage,p.resumeStage,p.step],['paused','planning-edit',undefined]);assert.notEqual(authority(),hash,'new authority bound to the new director');
  assert.equal(p.authoring.restartPending.reason,'director-changed');assert.match(p.error,/Ao retomar, o planejamento recomeça/);assert.deepEqual(p.authoring.checkpoint,before.authoring.checkpoint,'previous checkpoint remains available as history, not new-authority QA');
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert.equal(f.claude.sends.length,1,'no AI call before Resume');assert.equal(f.get().stage,'paused');assert.equal(f.get().budget.calls.length,1);
  f.scripts.push(async call=>{await look(call);const revision=await plan(call,0);return finish(call,revision);});
  await f.command('resume',{authorize:true});
  p=await settled(f);assert.equal(p.stage,'video-review',p.error);assert.equal(f.claude.sends.length,2,'exactly one run after Resume');assert.equal(f.claude.sends[1].providerId,'claude');
  assert.equal(p.authoring.restartPending,undefined,'restart marker clears only when resumed');
  assert.doesNotMatch(f.claude.sends[1].content,/Continuação/);assert.match(f.claude.sends[1].content,/1\) get_context: leia a orientação de edição/);assert.equal(f.claude.sends[1].modelId,'opus');
  assert.equal(p.authoring.continuations,undefined);assert.deepEqual(p.authoring.executions.map(item=>[item.kind,item.outcome,item.requestedModel]),[['initial','completed','opus']]);
  assert.deepEqual(f.bridge.production.editDirector('owner','space'),{providerId:'claude',source:'default'});
  assert.match(f.claude.sends[1].content,/<<<BRIEFING\n[^]*3 dicas de edição[^]*\nBRIEFING>>>/,'brief as plain text, not re-escaped JSON');assert.doesNotMatch(f.claude.sends[1].content,/Você não vê o vídeo/);
 }finally{await f.close();}
});

test('adopt-agent-config: a halted run adopts the NEW editor config explicitly (new epoch/authority, old authoring verbatim in history), nothing runs until Resume',{timeout:240000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async call=>{await look(call);await plan(call,0);return {stop:'turn-limit'};});
  f.scripts.push(async()=>({stop:'turn-limit'}));
  assert.equal((await f.delegate('call-1')).success,false);
  let p=await settled(f);assert.equal(p.stage,'blocked');assert.equal(p.authoring.checkpoint.revision,1);
  const before=f.raw(),authority=()=>f.db.prepare('SELECT hash FROM production_authority').get().hash,oldAuthority=authority(),sends=f.claude.sends.length,sourceSha=sha(await readFile(f.input));
  assert.equal(oldAuthority,productionBindingHash(before));
  // The user switches the editor agent (e.g. to Claude, new instructions): the saved run no longer passes guard().
  const editor=f.agents.find(agent=>agent.id==='editor-de-video-1');Object.assign(editor,{providerId:'claude',instructions:'Nova configuração do editor.'});
  await assert.rejects(f.command('resume',{authorize:true}),/A configuração do agente mudou/);
  await assert.rejects(f.command('adopt-agent-config',{}),/Confirme a adoção/);
  p=await f.command('adopt-agent-config',{authorize:true});
  assert.deepEqual([p.stage,p.resumeStage,p.epoch,p.step,p.editPlan],['blocked','planning-edit',before.epoch+1,undefined,undefined]);
  assert.deepEqual(p.editorAgent,agentSnapshot(editor),'only the editor is re-snapshotted');assert.deepEqual(p.sourceAgent,before.sourceAgent);assert.deepEqual(p.publisherAgent,before.publisherAgent);
  assert.notEqual(authority(),oldAuthority);assert.equal(authority(),productionBindingHash(f.raw()),'new authority bound to the new editor');
  const entry=p.authoring.history.at(-1);
  assert.equal(entry.epoch,before.epoch);assert.equal(entry.authorityHash,oldAuthority);assert.deepEqual(entry.editorAgent,before.editorAgent);
  assert.deepEqual(entry.authoring,before.authoring,'previous authoring (checkpoint, revisions, previews, executions) kept verbatim');
  assert.deepEqual(p.authoring.previousPlan,before.authoring.plan);assert.equal(p.authoring.checkpoint,undefined);assert.deepEqual(p.authoring.revisions,[]);
  assert.equal(p.authoring.epoch,p.epoch);assert.equal(p.authoring.restartPending.reason,'agent-config-changed');
  assert.deepEqual(p.editorSession.messages,before.editorSession.messages,'no assistant speech is fabricated');assert.deepEqual(p.sourceSession.messages,before.sourceSession.messages);
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(f.claude.sends.length,sends,'no AI call before Resume');assert.equal(f.bridge.media.list('owner').length,0,'nothing rendered');assert.equal(sha(await readFile(f.input)),sourceSha,'source bytes untouched');
  // Same config again: a no-op (no write, no new epoch).
  const again=await f.command('adopt-agent-config',{authorize:true});assert.equal(again.epoch,p.epoch);assert.equal(again.revision,p.revision);
  // Resume starts the new epoch: fresh session and budget (no continuation), previous plan only as a reference.
  f.scripts.push(async call=>{const context=await look(call);assert.equal(context.budget.callsLeft,59,'fresh host budget');const revision=await plan(call,0);return finish(call,revision);});
  await f.command('resume',{authorize:true});
  p=await settled(f);assert.equal(p.stage,'video-review',p.error);assert.equal(f.claude.sends.length,sends+1);assert.doesNotMatch(f.claude.sends.at(-1).content,/Continuação/);
  assert.equal(p.authoring.checkpoint.epoch,p.epoch);assert.equal(p.authoring.history.at(-1).epoch,before.epoch);
  // An exported (delivered) run never adopts a new config.
  Object.assign(editor,{instructions:'Outra mudança.'});
  await assert.rejects(f.command('adopt-agent-config',{authorize:true}),/parada antes da exportação|já tem vídeo exportado/);
 }finally{await f.close();}
});

test('adopt-agent-config re-snapshots only the editor: a changed source agent still blocks the run',{timeout:180000},async()=>{
 const f=await fixture();try{
  f.scripts.push(async()=>({stop:'turn-limit'}));
  assert.equal((await f.delegate('call-1')).success,false);await settled(f);
  Object.assign(f.agents.find(agent=>agent.id==='editor-de-video-1'),{providerId:'claude'});Object.assign(f.agents.find(agent=>agent.id==='conteudo'),{instructions:'Fonte mudou.'});
  const before=f.raw();
  await assert.rejects(f.command('adopt-agent-config',{authorize:true}),/A configuração do agente mudou/);
  assert.deepEqual(f.raw(),before,'nothing written');
 }finally{await f.close();}
});
