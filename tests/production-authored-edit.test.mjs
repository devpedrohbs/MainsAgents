import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,readFile} from 'node:fs/promises';
import {existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createEditorAuthoring} from '../editor-authoring.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';
import {mergeProductionSessions} from '../src/features/production/model.ts';

/**
 * The user's real path with the Claude editor: a Codex content chat hands the recording to the (Codex) video editor with
 * mainsagents_delegate; the edit is DIRECTED by Claude Code (workspace default) through the real editor-authoring tools
 * (B) and the real host (editor-host + coordinator + media): frames, plan validation with the fact proof, preview, stills,
 * single final export, host receipt with absolute path in BOTH chats. Declared simulations: the model's tool calls are a
 * script (no CLI/inference), the transcript is absent (facts come from the brief), and the animation engine is a copy stub
 * with FFmpeg stills (real Remotion renders are proven by scripts/editing-upgrade-evidence.mjs). FFmpeg runs for real.
 */
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
async function until(check,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw Error('timed out');}
const ffmpeg=args=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-y',...args]);

/** Stills of the edited composition: real JPEG frames of the cut at entry/middle/exit of each requested scene. */
async function stillsStub({inputPath,outDir,animations,frames,sceneIds,metadata}){
 const {mkdir}=await import('node:fs/promises');await mkdir(outDir,{recursive:true});
 const fps=metadata.fps,scenes=(animations.storyboard?.scenes??[]).filter(scene=>!sceneIds||sceneIds.includes(scene.id));
 const picks=frames?frames.map(frame=>({frame,sceneId:null,moment:'manual'})):scenes.flatMap(scene=>[['entrada',scene.start+0.05],['meio',(scene.start+scene.end)/2],['saida',Math.max(scene.start,scene.end-0.1)]].map(([moment,t])=>({frame:Math.round(t*fps),sceneId:scene.id,moment})));
 const stills=[];for(const [index,pick] of picks.entries()){const path=join(outDir,`still-${index}.jpg`);await ffmpeg(['-ss',String(pick.frame/fps),'-i',inputPath,'-frames:v','1',path]);stills.push({...pick,seconds:pick.frame/fps,path});}
 const sheet=join(outDir,'sheet.jpg');await copyFile(stills[0].path,sheet);
 return {stills,contactSheets:[{path:sheet}],storyboard:{qa:{ok:true}}};
}

/** Claude chat runtime whose "model" is a script calling the REAL editor-authoring tools (the bridge's attach/subscribe). */
function scriptedClaude(authoring,scripts){
 const runs=new Map();let n=0;const sends=[];
 return {sends,
  openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),
  async send(_thread,content,agent){const id=`claude-exec-${++n}`;sends.push({content,editorSessionId:agent.editorSessionId,providerId:agent.providerId});runs.set(id,{agent});return {executionId:id};},
  async *events(id){
   const {agent}=runs.get(id);
   if(!agent.editorSessionId){yield {type:'message.completed',content:'{}'};yield {type:'execution.completed'};return;}
   const queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);
   let report;try{report=await scripts.shift()((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}
   for(const event of queue)yield event;
   yield {type:'message.completed',content:JSON.stringify(report)};yield {type:'execution.completed'};
  },
  cancel:async()=>{},
 };
}

/** One authored edit as a model would do it: look, plan (a first plan with an unsupported number is refused), preview, inspect, finalize. */
const editorScript=(log,{trim=0,title='3 dicas de edição'}={})=>async call=>{
 const context=(await call('get_context')).structuredContent;log.push({tool:'get_context',contextKeys:Object.keys(context)});
 const frames=await call('get_frames',{target:'source',times:[0.5,3]});log.push({tool:'get_frames',images:frames.content.filter(block=>block.type==='image').length});
 const segments=[{start:trim,end:context.metadata.duration}],out=context.metadata.duration-trim;
 const storyboard=layers=>({version:1,title:'Edição explicativa',timeline:{basis:'output'},style:{treatment:'creator'},scenes:[
  {id:'abertura',name:'Abertura',start:0,end:2.5,camera:{layout:'full'},layers},
  {id:'metodo',name:'Método',start:2.5,end:out,camera:{layout:'split-top'},layers:[{id:'passo',type:'text',text:'Corte as pausas',role:'title',slot:'panel',start:0.2,end:Math.min(2,out-2.6),source:'design'}]}]});
 const wrong=await call('write_plan',{baseRevision:0,plan:{segments,storyboard:storyboard([{id:'titulo',type:'text',text:'7 dicas de edição',role:'title',slot:'top',start:0.2,end:2.2,source:'brief',quote:'7 dicas de edição'}])}});
 log.push({tool:'write_plan',isError:wrong.isError===true,message:wrong.content[0].text});
 const saved=await call('write_plan',{baseRevision:0,plan:{segments,storyboard:storyboard([{id:'titulo',type:'text',text:title,role:'title',slot:'top',start:0.2,end:2.2,source:'brief',quote:title}])}});
 assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;log.push({tool:'write_plan',revision,scenes:saved.structuredContent.scenes.length});
 const preview=await call('render_preview',{revision,start:1,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5,2]});
 const stills=await call('storyboard_stills',{revision});assert.notEqual(stills.isError,true,stills.content[0].text);log.push({tool:'storyboard_stills',images:stills.content.filter(block=>block.type==='image').length});
 let result=await call('finalize',{revision,summary:'Cortes mantendo a fala e motion explicativo em 2 cenas.'});log.push({tool:'finalize',status:result.structuredContent?.status,error:result.isError?result.content[0].text:undefined});
 for(let i=0;i<300&&result.structuredContent?.status==='pending';i++){await new Promise(r=>setTimeout(r,100));result=await call('export_status');}
 log.push({tool:'export_status',status:result.structuredContent?.status});
 return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};
};

async function fixture({transcriber,videoAgent={}}={}){
 const directory=mkdtempSync(join(tmpdir(),'authored-edit-')),dbPath=join(directory,'state.sqlite'),input=join(directory,'gravacao.mp4');
 await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Own role',providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',tools:['files','subagents']},{...base,id:'editor-de-video-1',name:'Editor de Vídeo',role:'Vídeo',tools:['files'],...videoAgent}];
 const sessions=[{id:'chat-1',agentId:'conteudo',providerId:'codex',title:'Conversa',messages:[],createdAt:at,updatedAt:at}];
 let serial=0;const threads=new Map(),outputs=new Map();
 // Codex: the workflow runtime of the content/editor agents (never asked to edit here: Claude directs).
 const codex={providerId:'codex',capabilities:{reconcile:true},createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},connect:async()=>`thread-${++serial}`,resumeSession:async()=>{},readThread:async id=>threads.get(id)??{turns:[]},cancel:async()=>{},
  send:async()=>{const id=`execution-${++serial}`;outputs.set(id,'Resposta normal.');return {executionId:id}},
  events:async function*(id){const text=outputs.get(id);yield {type:'message.completed',content:text};yield {type:'execution.completed'}}};
 const authoring=createEditorAuthoring(),log=[],scripts=[],claude=scriptedClaude(authoring,scripts);
 const flow=createProductionFlow('space','Fluxo',agents);
 const mediaOptions={...(transcriber?{transcriber}:{}),inspect,animate:async({inputPath,outputPath})=>copyFile(inputPath,outputPath),animationCapabilities:async()=>({available:true}),stills:stillsStub};
 const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>codex,getChatRuntime:provider=>provider==='claude'?claude:codex,inspect,mediaOptions,timeoutMs:120000});
 const db=new DatabaseSync(dbPath);
 const delegate=(callId,instructions)=>bridge.delegations.dispatch({profileId:'owner',agentId:'conteudo',sessionId:'chat-1'},{threadId:'source-thread',turnId:`turn-${callId}`,callId,arguments:{targetAgentId:'editor-de-video-1',title:'Dicas de edição',instructions,files:[input]}},{targets:[{id:'editor-de-video-1'}]});
 const run=()=>bridge.production.list('owner')[0];
 const receiptsOf=session=>(session?.messages??[]).flatMap(message=>message.receipts??[]);
 return {directory,input,bridge,db,claude,scripts,log,delegate,run,receiptsOf,agents,sessions,close:async()=>{await bridge.close();db.close();}};
}

const brief='Edite com motion explicativo: 3 dicas de edição para quem grava no celular.';

test('handoff → Claude directs with editor tools → fact-checked storyboard → one export → host receipt (absolute path) in both chats',{timeout:180000},async()=>{
 const f=await fixture();try{
  const originalSha=await sha(f.input);f.scripts.push(editorScript(f.log));
  const result=await f.delegate('call-1',brief);
  assert.equal(result.success,true,result.content);
  assert.match(result.content,/verificada pelo app/);assert.doesNotMatch(result.content,/[A-Z]:\\|\/tmp\//,'the LLM context stays path-free');
  // Claude (the effective director) got the editor session; the editor agent itself stays Codex.
  assert.equal(f.claude.sends.length,1);assert.ok(f.claude.sends[0].editorSessionId);assert.equal(f.claude.sends[0].providerId,'claude');
  // Fact proof: the plan with a number absent from the brief was refused, the corrected one was saved.
  const writes=f.log.filter(item=>item.tool==='write_plan');assert.equal(writes[0].isError,true);assert.match(writes[0].message,/7/);assert.equal(writes[1].revision,1);assert.equal(writes[1].scenes,2);
  assert.ok(f.log.find(item=>item.tool==='get_frames').images>=1);assert.equal(f.log.find(item=>item.tool==='storyboard_stills').images,6);
  assert.equal(f.log.find(item=>item.tool==='export_status').status,'succeeded');
  const p=f.bridge.production.get('owner',f.run().id);
  assert.equal(p.stage,'video-review');assert.equal(p.editPlan.authoring,'editor-tools');assert.equal(p.editPlan.plan.storyboard.scenes.length,2);assert.equal(p.authoring.epoch,p.epoch);
  const source=f.receiptsOf(p.sourceSession),editor=f.receiptsOf(p.editorSession);
  assert.equal(editor.length,1);const receipt=editor[0];
  assert.ok(isAbsolute(receipt.path)&&existsSync(receipt.path));assert.equal(receipt.sha256,await sha(receipt.path));assert.equal(receipt.sha256,p.outputVideo.sha256);
  assert.equal(receipt.producedBy.providerId,'claude','receipt names the effective director, not the editor agent provider');
  // Both chats as the UI shows them: the generic source chat is linked to the run's content and carries the same receipt.
  const job=f.db.prepare("SELECT data_json FROM agent_delegation_jobs").all().map(row=>JSON.parse(row.data_json)).find(item=>item.route==='engine');
  assert.equal(job.receipts[0].sha256,receipt.sha256);assert.equal(job.receipts[0].path,receipt.path);
  const merged=mergeProductionSessions(f.sessions.map(item=>({...item})),[p],f.agents),chat=merged.find(item=>item.id==='chat-1'),editorChat=merged.find(item=>item.id===p.editorSession.id);
  assert.equal(chat.contentId,p.contentId);
  for(const shown of [chat,editorChat]){const list=f.receiptsOf(shown);assert.equal(list.length,1,shown.id);assert.equal(list[0].sha256,receipt.sha256);assert.equal(list[0].path,receipt.path);}
  assert.ok(source.length===0||source[0].sha256===receipt.sha256);
  assert.equal(await sha(f.input),originalSha,'original untouched');
  const message=p.editorSession.messages.find(item=>item.receipts?.length);assert.match(message.content,/Aplicado: .*2 cena\(s\) de motion \(storyboard\).*Direção: Editor de Vídeo \(Claude Code/s);
 }finally{await f.close();}
});

test('the request in progress repeated attaches; every new request after delivery is a new adjustment, even a repeated text',{timeout:240000},async()=>{
 const f=await fixture();let release=()=>{};try{
  const gate=new Promise(resolve=>{release=resolve;});
  f.scripts.push(async call=>{await gate;return editorScript(f.log)(call);});
  const first=f.delegate('call-1',brief);
  await until(()=>f.run()?.stage==='planning-edit'&&f.claude.sends.length===1);
  // Duplicate handoff of the request in progress: same run, no new Claude turn, both complete with the same receipt.
  const duplicate=f.delegate('call-2',brief);
  await until(()=>f.db.prepare('SELECT count(*) n FROM production_delegation_links').get().n===2);
  release();
  const [a,b]=await Promise.all([first,duplicate]);assert.equal(a.success,true,a.content);assert.equal(b.success,true,b.content);
  assert.equal(f.claude.sends.length,1);assert.equal(f.bridge.production.list('owner').length,1);
  assert.equal(f.bridge.media.list('owner').filter(job=>job.status==='succeeded').length,1);
  const start=f.bridge.production.get('owner',f.run().id);
  // Adjustments A, B, then A again: each is a new decision (new epoch, fresh editor session/budget, new verified file).
  const adjust=[['call-3','Ajuste A: corte o começo. 3 dicas de edição.',0.5],['call-4','Ajuste B: corte mais o começo. 3 dicas de edição.',1],['call-5','Ajuste A: corte o começo. 3 dicas de edição.',1.5]];
  for(const [callId,text,trim] of adjust){f.scripts.push(editorScript(f.log,{trim}));const result=await f.delegate(callId,text);assert.equal(result.success,true,result.content);}
  const p=f.bridge.production.get('owner',start.id);
  assert.equal(p.epoch,start.epoch+3);assert.equal(p.stage,'video-review');assert.equal(f.claude.sends.length,4);
  assert.equal(p.authoring.epoch,p.epoch);assert.equal(p.authoring.checkpoint.epoch,p.epoch);assert.equal(p.authoring.checkpoint.authorityHash,p.authoring.authorityHash);assert.ok(p.authoring.previousPlan,'previous plan kept as reference');
  const receipts=f.receiptsOf(p.editorSession);assert.equal(receipts.length,4);assert.equal(new Set(receipts.map(r=>r.sha256)).size,4);assert.deepEqual(receipts.map(r=>r.version),[1,2,3,4]);
  assert.equal(receipts.at(-1).sha256,p.outputVideo.sha256);assert.match(p.feedback,/Ajuste A/);
 }finally{release();await f.close();}
});

test('a different request while the same video is still rendering is refused with the reason, never silently merged',{timeout:180000},async()=>{
 const f=await fixture();let release=()=>{};try{
  const gate=new Promise(resolve=>{release=resolve;});
  f.scripts.push(async call=>{await gate;return editorScript(f.log)(call);});
  const first=f.delegate('call-1',brief);
  await until(()=>f.run()?.stage==='planning-edit'&&f.claude.sends.length===1);
  const other=await f.delegate('call-2','Outro pedido diferente para o mesmo vídeo.');
  assert.equal(other.success,false);assert.match(other.content,/já está sendo editado com outro pedido/);
  release();assert.equal((await first).success,true);
 }finally{release();await f.close();}
});

test('motion requested: a cuts-only plan and a storyboard of empty scenes are refused; nothing is exported and the reason is shown',{timeout:180000},async()=>{
 const f=await fixture();try{
  const originalSha=await sha(f.input),seen=[];
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent,segments=[{start:0,end:context.metadata.duration}];
   seen.push(await call('write_plan',{baseRevision:0,plan:{segments}}));
   seen.push(await call('write_plan',{baseRevision:0,plan:{segments,storyboard:{version:1,timeline:{basis:'output'},style:{treatment:'creator'},scenes:[{id:'vazia',start:0,end:context.metadata.duration,camera:{layout:'full'},layers:[]}]}}}));
   return {status:'not-finalized',finalRevision:0,summary:'sem motion',limitations:[]};
  });
  const result=await f.delegate('call-1',brief);
  assert.equal(result.success,false);assert.match(result.content,/sem finalizar/);
  for(const item of seen){assert.equal(item.isError,true);assert.match(item.content[0].text,/Motion was requested|storyboard/i);}
  assert.match(seen[1].content[0].text,/Motion was requested/);
  const p=f.bridge.production.get('owner',f.run().id);
  assert.equal(p.stage,'blocked');assert.match(p.error,/original está preservado/);assert.equal(p.videoJobId,undefined);assert.equal(f.bridge.media.list('owner').length,0);
  assert.equal(await sha(f.input),originalSha);
 }finally{await f.close();}
});

test('a receipt that fails once is retried by the host without re-rendering; the handoff completes only with it',{timeout:180000},async()=>{
 const f=await fixture();try{
  const original=f.bridge.receipts.issue.bind(f.bridge.receipts);let failures=1;
  // The coordinator holds the same receipts store as the bridge: fail the first video receipt only.
  f.bridge.receipts.issue=async(profile,input)=>{if(input.source.kind==='production-video'&&failures-->0)throw Error('transient read error');return original(profile,input);};
  f.scripts.push(editorScript(f.log));
  const result=await f.delegate('call-1',brief);
  assert.equal(result.success,true,result.content);
  const p=f.bridge.production.get('owner',f.run().id);
  assert.equal(p.pendingReceipts,undefined);assert.ok(p.events.some(event=>event.action==='receipt-failed'));assert.ok(p.events.some(event=>event.action==='receipt-issued'));
  const receipts=f.receiptsOf(p.editorSession);assert.equal(receipts.length,1);assert.equal(receipts[0].sha256,p.outputVideo.sha256);
  assert.equal(f.bridge.media.list('owner').filter(job=>job.status==='succeeded').length,1,'no second render');
 }finally{await f.close();}
});

test('a failed adjustment leaves no link: retrying the same handoff applies the adjustment instead of returning the old file',{timeout:240000},async()=>{
 const f=await fixture();try{
  f.scripts.push(editorScript(f.log));
  assert.equal((await f.delegate('call-1',brief)).success,true);
  const first=f.bridge.production.get('owner',f.run().id),firstReceipt=f.receiptsOf(first.editorSession)[0];
  const command=f.bridge.production.command;let failures=1;
  f.bridge.production.command=async function(profile,input){if(input.action==='revise-video'&&failures-->0)throw Error('A produção mudou. Revise a versão atual.');return command.call(this,profile,input);};
  const failed=await f.delegate('call-2','Ajuste: corte o começo. 3 dicas de edição.');
  assert.equal(failed.success,false);assert.match(failed.content,/mudou/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM production_delegation_links WHERE job_id=(SELECT id FROM agent_delegation_jobs WHERE request_key LIKE '%call-2')").get().n,0,'no link after a failed revise');
  assert.equal(f.bridge.production.get('owner',first.id).epoch,first.epoch);
  // Retry of the SAME job (as a recovery would): the adjustment is applied, never the previous receipt as its result.
  const job=f.db.prepare("SELECT data_json FROM agent_delegation_jobs WHERE request_key LIKE '%call-2'").get(),data=JSON.parse(job.data_json);
  f.scripts.push(editorScript(f.log,{trim:0.5}));
  const run=await f.bridge.production.startDelegatedEdit('owner',{jobId:data.id,sourceAgentId:data.sourceAgentId,sourceSessionId:data.sourceSessionId,targetAgentId:data.targetAgentId,targetSessionId:data.targetSessionId,title:data.title,instructions:data.instructions,videoPath:data.videoPath});
  assert.equal(run.epoch,first.epoch+1);assert.equal(run.stage,'planning-edit');
  const done=await until(()=>{const p=f.bridge.production.get('owner',first.id);return p.stage==='video-review'&&p.outputVideo?.sha256!==firstReceipt.sha256?p:null;});
  const receipts=f.receiptsOf(done.editorSession);assert.equal(receipts.length,2);assert.equal(receipts[1].sha256,done.outputVideo.sha256);
  assert.equal(f.db.prepare('SELECT run_id FROM production_delegation_links WHERE job_id=?').get(data.id).run_id,first.id);
 }finally{await f.close();}
});

test('the coordinator hands the REAL word timings and the enabled skills (host-read) to the editor MCP; disabled skills stay out',{timeout:180000},async()=>{
 const skills=mkdtempSync(join(tmpdir(),'video-skills-'));
 writeFileSync(join(skills,'edicao.md'),'# Edição\nAcento laranja, legenda pequena.');writeFileSync(join(skills,'corte.md'),'# Corte desligado\nNÃO entregar.');
 const words=[['Três',0.3,0.6],['dicas',0.65,1.0],['de',1.05,1.15],['edição',1.2,1.7],['para',2.0,2.2],['celular',2.25,2.9]].map(([text,start,end])=>({text,start,end}));
 const transcriber={capabilities:async()=>({available:true}),transcribe:async()=>({engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0.3,end:2.9,text:'Três dicas de edição para celular'}],speech:[{start:0.3,end:2.9}],words})};
 const f=await fixture({transcriber,videoAgent:{skillsDirectory:skills,skills:['edicao','corte'],disabledSkills:['corte'],skillFiles:{edicao:join(skills,'edicao.md'),corte:join(skills,'corte.md')}}});
 try{
  const seen={};
  f.scripts.push(async call=>{
   const context=(await call('get_context')).structuredContent;seen.context=context;
   seen.words=await call('get_transcript_words',{start:0,end:context.metadata.duration});
   return editorScript(f.log)(call);
  });
  const result=await f.delegate('call-words',brief);assert.equal(result.success,true,result.content);
  assert.equal(seen.context.transcriptInfo.timing,'words');assert.equal(seen.context.transcriptInfo.words,6);assert.equal(seen.context.transcriptInfo.engine,'whisper.cpp');
  assert.deepEqual(seen.context.guidance.items.map(item=>item.name),['mainsagents-guia-creator-tech','edicao']);
  assert.match(seen.context.guidance.items[1].text,/Acento laranja/);assert.doesNotMatch(JSON.stringify(seen.context),/Corte desligado|NÃO entregar/);
  assert.notEqual(seen.words.isError,true,seen.words.content[0].text);
  assert.equal(seen.words.structuredContent.count,6);assert.match(seen.words.structuredContent.lines,/^0\.30 0\.60 Três\n0\.65 1\.00 dicas/);assert.equal(seen.words.structuredContent.timeline,'source');
  const p=f.bridge.production.get('owner',f.run().id);
  assert.equal(p.stage,'video-review');assert.match(p.events.find(event=>event.action==='editor-guidance').detail,/mainsagents-guia-creator-tech, edicao · [0-9a-f]{12}/);
 }finally{await f.close();}
});
