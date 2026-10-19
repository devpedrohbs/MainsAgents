import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';

// A recorded video handed to the video editor whose Codex session disappeared (rebuilt/expired CLI history).
// Simulated CLI with the real 0.162 error texts; FFmpeg-made media; no inference.
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
async function until(check){const end=Date.now()+30000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');}
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'production-session-recovery-')),dbPath=join(directory,'state.sqlite'),video=join(directory,'recorded.mp4');
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.2','-c:v','libx264','-c:a','aac',video]);
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Keep my role and own skills',tools:['files'],skills:['own-skill'],providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'source',name:'Editor de Conteúdo',role:'Conteúdo'},{...base,id:'editor',name:'Editor de Vídeo',role:'Vídeo'}],flow=createProductionFlow('space','Content creation',agents);
 const prompts=[],threads=new Map(),executions=new Map(),created=[],lost=new Set(),unloaded=new Set(),invalid=new Set();let serial=0,held=false,readFailOnce=false;
 const output=prompt=>prompt.includes('"removeSilences"')?JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.5,padding:0.15},normalizeAudio:false,animations:{},summary:'Cortar pausas'}):prompt.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.2,format:'original',normalizeAudio:true,fadeSeconds:.1,summary:'Acabamento'}):'{}';
 const missing=id=>{throw Error(`no rollout found for thread id ${id}`);};
 const runtime={capabilities:{reconcile:true},
  createSession:async agent=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});created.push({id,agent:agent.id});return id},
  resumeSession:async id=>{if(lost.has(id))missing(id);if(invalid.has(id))throw Error(`invalid session id: ${id}`);unloaded.delete(id);},
  readThread:async id=>{if(lost.has(id)||unloaded.has(id))throw Error(`thread not loaded: ${id}`);if(invalid.has(id))throw Error(`invalid session id: ${id}`);if(readFailOnce){readFailOnce=false;throw Error('CLI transport closed');}return threads.get(id);},
  cancel:async()=>{},
  send:async(thread,prompt,agent)=>{if(lost.has(thread))missing(thread);prompts.push({thread,prompt,agent:agent.id});const id=`execution-${++serial}`;executions.set(id,{thread,prompt,output:output(prompt)});return {executionId:id}},
  events:async function*(id,signal){if(held)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true}));const e=executions.get(id);yield {type:'message.completed',content:e.output};threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.prompt}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
 const sessions=[{id:'session-a',agentId:'source',contentId:'content-a',topicId:'topic-a',title:'Vídeo A',messages:[],createdAt:at,updatedAt:at}];
 const options={dbPath,getCurrentProfile:()=> 'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{throw Error('No card may be written')}})};
 let bridge=createContentWorkflowBridge(options);// Legacy behaviour under test: the editor agent's own provider directs edits (new default is Claude Code).
 bridge.production.setEditDirector('owner',{workspaceId:'space',director:{providerId:'agent'}});const db=new DatabaseSync(dbPath),file=await inspect(video);
 const topic={id:'topic-a',workspaceId:'space',requestId:'topic-a',inputKind:'text',input:'Vídeo A',priority:'normal',status:'draft',title:'Vídeo A',category:'Gravação',summary:'Gravação adicionada',whyItMatters:'Local',angles:[],sources:[],factualQuestions:[],contentId:'content-a',createdAt:at,updatedAt:at};
 const content={id:'content-a',workspaceId:'space',topicId:'topic-a',title:'Vídeo A',format:'short-video',platforms:[],status:'planning',productionStage:'recording',taskId:'task-content-a',createdAt:at,updatedAt:at};
 const asset={id:'video-a',workspaceId:'space',contentId:'content-a',kind:'video',role:'source',status:'available',name:file.name,currentVersionId:'v-a',versions:[{id:'v-a',path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at}],createdAt:at,updatedAt:at};
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[content],artifacts:[],approvals:[],runs:[],assets:[asset],publications:[]}),at);
 bridge.jobs.configure('owner','space',{dataSourceId:'abcdefabcdefabcdefabcdefabcdefab',autoSync:false});
 const run=id=>bridge.production.list('owner').find(p=>p.id===id);
 const command=(id,action,data={})=>bridge.production.command('owner',{id,revision:run(id).revision,requestId:`command-${++serial}`,action,...data});
 const start=()=>bridge.production.start('owner',{requestId:'recorded-a',entry:'recorded',flowId:flow.id,contentId:'content-a',sourceSessionId:'session-a',assetId:'video-a',context:{kind:'text',text:'Contexto do vídeo A com detalhes suficientes.'},format:'original',editMode:'basic',authorize:true});
 return {run,command,start,prompts,created,lost,unloaded,invalid,hold:value=>held=value,failNextRead:()=>readFailOnce=true,mediaJobs:()=>bridge.media.list('owner'),reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options)},close:async()=>{await bridge.close();db.close()}};
}
const sessionEvents=p=>(p.events??[]).filter(event=>event.action==='session-recreated');

test('a lost editor session before any send is replaced once, without a duplicate call',async()=>{
 const f=await fixture();try{
  f.failNextRead();const p=f.start();await until(()=>f.run(p.id).stage==='blocked');
  let r=f.run(p.id);assert.equal(r.step.phase,'thread-ready',r.error);assert.equal(f.prompts.length,0,'nothing was sent before the failure');
  const stale=r.step.threadId;f.lost.add(stale);
  await f.command(p.id,'resume',{authorize:true});await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));
  r=f.run(p.id);assert.equal(r.stage,'video-review',r.error);
  assert.equal(sessionEvents(r).length,1);assert(f.prompts.every(item=>item.thread!==stale&&item.agent==='editor'),'only the video editor executes, never in the lost thread');
  assert.equal(new Set(f.prompts.map(item=>item.prompt)).size,f.prompts.length,'each planning prompt was sent once');
  assert.deepEqual(r.budget.calls.map(call=>call.status),f.prompts.map(()=> 'completed'));
  assert.equal(f.mediaJobs().length,1,'a single edit job');
 }finally{await f.close();}
});

test('an interrupted turn whose session vanished needs explicit resend and then runs in a new session',async()=>{
 const f=await fixture();try{
  f.hold(true);const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');const stale=f.run(p.id).step.threadId;
  await f.reopen();assert.equal(f.run(p.id).stage,'paused');f.lost.add(stale);f.hold(false);
  await f.command(p.id,'resume',{authorize:true});await until(()=>f.run(p.id).stage==='blocked');
  let r=f.run(p.id);assert.match(r.error,/não existe mais no CLI.*reenvio/);assert.equal(f.prompts.length,1,'no silent resend');assert.deepEqual(r.budget.calls.map(call=>call.status),['uncertain']);
  await f.command(p.id,'resume',{authorize:true,resend:true});await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));
  r=f.run(p.id);assert.equal(r.stage,'video-review',r.error);assert.equal(sessionEvents(r).length,1);
  assert(f.prompts.slice(1).every(item=>item.thread!==stale&&item.agent==='editor'));assert.equal(r.budget.calls[0].status,'uncertain');assert.equal(f.mediaJobs().length,1);
 }finally{await f.close();}
});

test('other resume failures are not mistaken for a missing session',async()=>{
 const f=await fixture();try{
  f.failNextRead();const p=f.start();await until(()=>f.run(p.id).stage==='blocked');
  const created=f.created.length;await f.command(p.id,'resume',{authorize:true});await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));
  const r=f.run(p.id);assert.equal(r.stage,'video-review',r.error);assert.equal(sessionEvents(r).length,0);assert.equal(f.created.length,created,'existing session reused');
 }finally{await f.close();}
});

test('a session that is only not loaded is resumed and kept; an invalid session id is never treated as expired',async()=>{
 for(const kind of ['unloaded','invalid']){const f=await fixture();try{
  f.hold(true);const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');const thread=f.run(p.id).step.threadId;
  await f.reopen();f[kind].add(thread);f.hold(false);const created=f.created.length;
  await f.command(p.id,'resume',{authorize:true});await until(()=>f.run(p.id).stage==='blocked');
  const r=f.run(p.id);assert.equal(sessionEvents(r).length,0,kind);assert.equal(f.created.length,created,`${kind}: no replacement session`);assert.equal(f.prompts.length,1,`${kind}: nothing resent`);
  if(kind==='unloaded'){assert.match(r.error,/Autorize explicitamente o reenvio/);assert.equal(f.unloaded.size,0,'resumed before reading');}else assert.match(r.error,/invalid session id/);
 }finally{await f.close();}}
});
