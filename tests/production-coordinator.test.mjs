import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createChatImageArtifacts} from '../chat-image-artifacts.mjs';
import {createZernioPublicationConnector} from '../zernio-publication-connector.mjs';
import {runMediaProcess,probeVideo} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';
import {parseProductionSchedule,productionChatIntent,validateEditPlan} from '../production-protocol.mjs';
import {executionSnapshot,restoreExecution} from '../editorial-execution-backup.mjs';
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const scriptOptions={hooks:['A useful demo','Start here','This saves time'],ctas:['Save it','Try it'],paths:[{title:'Demo',outline:'Show the problem and demonstrate the practical solution.'},{title:'Story',outline:'Explain the example and how to apply it in daily work.'}],improvisationTopics:['Demo','Context'],thumbnailDirection:'Show a clear demo',draftScript:'A practical automation can save time in a repetitive task. Start with the problem, show the working example and explain how someone can apply this idea to their own daily routine.'};
async function until(check){const end=Date.now()+20000;while(Date.now()<end){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Production timed out');}
async function fixture(mediaExtra={},{providers={}}={}){
 const directory=mkdtempSync(join(tmpdir(),'production-coordinator-')),dbPath=join(directory,'state.sqlite'),input=join(directory,'recording.mp4'),png=join(directory,'tool.png');
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.5','-c:v','libx264','-c:a','aac',input]);
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','color=c=white:size=64x96','-frames:v','1',png]);
 const base={workspaceId:'space',instructions:'Keep my role and own skills',tools:['files'],skills:['own-skill'],providerId:'codex',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},agents=[{...base,id:'source',name:'Editor de Conteúdo',role:'Conteúdo',providerId:providers.source??'codex'},{...base,id:'editor',name:'Editor de Vídeo',role:'Vídeo',providerId:providers.editor??'codex'}],flow=createProductionFlow('space','Content creation',agents),images=createChatImageArtifacts(join(directory,'images'));
 let serial=0,sends=0,creates=0,uploads=0,notionWrites=0,notes='Original note',held=false;const executions=new Map(),threads=new Map(),posts=new Map(),prompts=[],notionPayloads=[];
 // Simulated Claude Code CLI runtime (text only, no real CLI or quota): same interface as claude-code-bridge `runtime`.
 const reply=prompt=>prompt.includes('"removeSilences"')?JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.5,padding:0.15},normalizeAudio:false,animations:{},summary:'Cortar pausas (Claude)'}):prompt.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.5,format:'original',normalizeAudio:true,fadeSeconds:.15,summary:'Claude'}):prompt.includes('Prepare legendas')?JSON.stringify({deliveries:['Instagram','TikTok'].map(platform=>({platform,caption:`Claude caption ${platform}`,coverPrompt:'A clear vertical cover'}))}):JSON.stringify(scriptOptions);
 const claude={sends:[],cancels:[],held:false,available:true,status:{state:'connected'},statusCalls:0},claudeOutputs=new Map();
 const chat={providerId:'claude',send:async(session,content,agent)=>{if(claude.sends.some(item=>item.session===session))throw Error('A Claude session was reused');claude.sends.push({session,content,agent});const id=`claude-execution-${++serial}`;claudeOutputs.set(id,reply(content));return {executionId:id}},events:async function*(id,signal){if(claude.held)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true}));const output=claudeOutputs.get(id);yield {type:'message.delta',delta:output.slice(0,4)};yield {type:'message.completed',content:output};yield {type:'execution.completed'}},cancel:async(_session,id)=>{claude.cancels.push(id)}};
 const runtime={createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},imageFile:image=>images.pathForImage(image),imageFromItem:(item,id)=>images.fromItem(item,id),send:async(thread,prompt,agent)=>{sends++;prompts.push({prompt,agent});const id=`execution-${++serial}`;let output,imageItem;if(prompt.includes('"removeSilences"'))output=JSON.stringify({removeSilences:true,silence:{thresholdDb:-35,minDuration:0.5,padding:0.15},normalizeAudio:false,animations:{title:'Sem renderer neste teste'},summary:'Cortar pausas longas'});else if(prompt.includes('Retorne SOMENTE JSON: {"start"'))output=JSON.stringify({start:0,duration:1.5,format:'original',normalizeAudio:true,fadeSeconds:.15,summary:'Áudio normalizado e acabamento discreto'});else if(prompt.includes('Prepare legendas'))output=JSON.stringify({deliveries:['Instagram','TikTok'].map(platform=>({platform,caption:`Approved caption ${platform}`,coverPrompt:'A clear professional vertical cover'}))});else if(prompt.includes('vídeo de REFERÊNCIA'))output=analysisReply;else if(prompt.includes('Gere uma imagem de capa')){output='Imagem gerada';imageItem={id:`image-${id}`,type:'imageGeneration',status:'completed',result:readFileSync(png).toString('base64')}}else output=JSON.stringify(scriptOptions);executions.set(id,{thread,prompt,output,imageItem});return {executionId:id}},events:async function*(id,signal){if(held)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Interrupted')),{once:true}));const item=executions.get(id);yield {type:'message.completed',content:item.output};if(item.imageItem)yield images.fromItem(item.imageItem,id);threads.get(item.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:item.prompt}]},{type:'agentMessage',text:item.output},...(item.imageItem?[item.imageItem]:[])]});yield {type:'execution.completed'}}};
 const fetchImpl=async(url,init={})=>{const u=new URL(url),path=u.pathname.split('/api/v1/')[1];if(init.method==='PUT'&&!path){for await(const chunk of init.body){}uploads++;return new Response('');}if(path==='accounts')return Response.json({accounts:[{_id:'ig',platform:'instagram',isActive:true,username:'IG'},{_id:'tt',platform:'tiktok',isActive:true,username:'TT'}]});if(path?.includes('creator-info'))return Response.json({privacyLevels:[{value:'PUBLIC_TO_EVERYONE',label:'Public'}],commercialContentTypes:[{value:'none',label:'None'}],postingLimits:{interactionSettings:{}}});if(path==='media/presign'){const n=++serial;return Response.json({uploadUrl:`https://media.zernio.com/upload/${n}`,publicUrl:`https://media.zernio.com/temp/${n}.jpg`});}if(path==='posts'&&init.method==='POST'){creates++;const body=JSON.parse(init.body),id=`post-${creates}`;posts.set(id,{...body,_id:id,status:body.isDraft?'draft':'scheduled',platforms:body.platforms.map(target=>({...target,status:body.isDraft?'draft':'scheduled'}))});return Response.json({post:posts.get(id)});}if(path?.startsWith('posts/'))return Response.json({post:posts.get(path.slice(6))});throw Error(`Unexpected endpoint ${url}`)};
 const options={dbPath,getCurrentProfile:()=> 'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>[],getRuntime:()=>runtime,getChatRuntime:provider=>provider==='claude'&&claude.available?chat:null,getProviderStatus:async provider=>{claude.statusCalls++;return provider==='claude'?claude.status:undefined},inspect,mediaOptions:{inspect,...mediaExtra},getPublicationConnector:()=>createZernioPublicationConnector(()=> 'fixture-key',{fetchImpl}),getConnector:()=>({upsert:async(payload,ctx)=>{ctx.authorize();notionWrites++;notionPayloads.push(payload.artifact);ctx.saveCheckpoint({phase:'verified',pageId:'12345678-1234-1234-1234-123456789abc'});return {pageId:'12345678-1234-1234-1234-123456789abc',url:'https://www.notion.so/12345678123412341234123456789abc',artifactVersion:payload.artifact.version,verifiedAt:new Date().toISOString()}},readCard:async()=>({text:notes,fetchedAt:new Date().toISOString()})})};
 let bridge=createContentWorkflowBridge(options);const db=new DatabaseSync(dbPath),at=new Date().toISOString(),file=await inspect(input),topic={id:'topic',workspaceId:'space',requestId:'idea',inputKind:'text',input:'A useful automation idea',priority:'normal',status:'review',title:'An automation project',category:'Tech',summary:'A practical project for saving time.',whyItMatters:'It solves a repetitive daily problem.',angles:['Demo','Explain'],sources:[{title:'Reference',url:'https://example.com'}],factualQuestions:[],createdAt:at,updatedAt:at};
 db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);bridge.jobs.configure('owner','space',{dataSourceId:'12345678-1234-1234-1234-123456789abc',autoSync:true});
 const start=()=>bridge.production.start('owner',{requestId:'start',flowId:flow.id,topicId:topic.id,expectedTopic:topic,notionDestination:bridge.jobs.connection('owner','space').dataSourceId,authorize:true});
 const current=()=>JSON.parse(db.prepare('SELECT state_json FROM editorial_state').get().state_json),run=id=>bridge.production.list('owner').find(p=>p.id===id);
 const command=(id,action,data={})=>bridge.production.command('owner',{id,revision:run(id).revision,requestId:`command-${++serial}`,action,...data});
 const attach=id=>{const p=run(id),state=current(),version={id:'original-v1',path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at};state.assets.push({id:'original',workspaceId:'space',contentId:p.contentId,kind:'video',role:'source',status:'available',name:file.name,currentVersionId:version.id,versions:[version],createdAt:at,updatedAt:at});db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(state));};
 const toRecording=async id=>{await until(()=>['script-review','blocked'].includes(run(id).stage));assert.equal(run(id).stage,'script-review',run(id).error);const v=run(id).scriptVersions.at(-1);await command(id,'approve-script',{authorize:true,version:v.version,expectedHash:v.hash});await until(()=>['recording','blocked'].includes(run(id).stage));};
 // Local covers: export each needed format explicitly (real FFmpeg engine), then approve one concept per format.
 const toPackage=async(id,choose={})=>{await until(()=>['covers-review','blocked'].includes(run(id).stage));assert.equal(run(id).stage,'covers-review',run(id).error);let r=run(id);const formats=[...new Set(r.covers.destinations.map(d=>d.format))];
  for(const format of formats){await command(id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>run(id).covers.render?.status!=='running');assert.equal(run(id).covers.render.status,'done',run(id).covers.render.error);r=run(id);}
  await command(id,'approve-covers',{authorize:true,destinations:r.covers.destinations,concepts:r.covers.concepts,brand:r.covers.brand,selections:formats.map(format=>({format,concept:choose[format]??'person',batchId:r.covers.batches[format].batchId}))});assert.equal(run(id).stage,'package-review');};
 return {toPackage,claude,notionPayloads,toRecording,directory,dbPath,input,file,db,flow,topic,start,run,command,attach,current,prompts,counts:()=>({sends,creates,uploads,notionWrites}),notes:value=>notes=value,hold:value=>held=value,completeSavedTurn:id=>{const step=run(id).step,item=executions.get(step.executionId);threads.get(step.threadId).turns.push({id:step.executionId,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:item.prompt}]},{type:'agentMessage',text:item.output}]})},get bridge(){return bridge},reopen:async()=>{await bridge.close();bridge=createContentWorkflowBridge(options)},close:async()=>{await bridge.close();db.close()}};
}
test('semi-automatic production produces real edited video and covers, waits for approvals, rereads Notion and schedules each exact package once',async()=>{
 const f=await fixture();try{const p=f.start();assert.equal(f.start().id,p.id);await f.toRecording(p.id);assert.equal(f.run(p.id).stage,'recording',f.run(p.id).error);assert.equal(f.counts().notionWrites,1);assert.equal(f.counts().creates,0);f.notes('NOTION_USER_EDIT');f.attach(p.id);await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));assert.equal(f.run(p.id).stage,'video-review',f.run(p.id).error);assert(f.prompts.some(x=>x.agent.id==='editor'&&x.prompt.includes('NOTION_USER_EDIT')));assert.equal(readFileSync(f.input).length,f.file.size);assert.equal(f.counts().creates,0);const video=f.run(p.id).outputVideo;assert.notEqual(video.sha256,f.file.sha256);await f.command(p.id,'approve-video',{authorize:true,expectedVideo:video});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await f.toPackage(p.id);assert.equal(f.run(p.id).stage,'package-review',f.run(p.id).error);assert.equal(f.counts().creates,0);assert(f.run(p.id).reviewDeliveries.every(d=>d.cover&&d.media.length===1));await f.command(p.id,'approve-package',{authorize:true,expectedHash:f.run(p.id).reviewHash});await f.command(p.id,'prepare-schedule',{text:'agende amanhã às 18h',timeZone:'America/Sao_Paulo',targets:[{platform:'Instagram',provider:'zernio',accountId:'ig'},{platform:'TikTok',provider:'zernio',accountId:'tt',networkSettings:{tiktokSettings:{privacy_level:'PUBLIC_TO_EVERYONE',commercialContentType:'none',allow_comment:false,allow_duet:false,allow_stitch:false,content_preview_confirmed:true,express_consent_given:true,video_made_with_ai:false}}}]});assert.equal(f.counts().creates,0);await f.command(p.id,'schedule',{authorize:true,expectedHash:f.run(p.id).scheduleHash});await until(()=>['complete','blocked'].includes(f.run(p.id).stage));assert.equal(f.run(p.id).stage,'complete',f.run(p.id).error);assert.equal(f.counts().creates,2);assert.equal(f.counts().uploads,4);const before=f.counts();await f.reopen();await new Promise(resolve=>setTimeout(resolve,850));assert.deepEqual(f.counts(),before);assert(f.current().publications.every(d=>d.receipt&&d.status==='scheduled'));}finally{await f.close()}
});
test('restart pauses uncertain inference, profile/config changes block work and imported productions never inherit authorization',async()=>{
 const f=await fixture();try{f.hold(true);const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');await f.reopen();assert.equal(f.run(p.id).stage,'paused');await f.command(p.id,'resume',{authorize:true});await until(()=>f.run(p.id).stage==='blocked');assert.equal(f.counts().sends,1);const backup=executionSnapshot(f.db,'owner');restoreExecution(f.db,'owner',backup,'replace');assert.equal(f.run(p.id).imported,true);await assert.rejects(()=>f.command(p.id,'resume',{authorize:true}),/Backup restaura histórico/);}finally{await f.close()}
});
test('a completed saved turn recovers without another inference or duplicate Notion card',async()=>{const f=await fixture();try{f.hold(true);const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');f.completeSavedTurn(p.id);await f.reopen();f.hold(false);await f.command(p.id,'resume',{authorize:true});await f.toRecording(p.id);assert.equal(f.run(p.id).stage,'recording',f.run(p.id).error);assert.equal(f.counts().sends,1);assert.equal(f.counts().notionWrites,1);}finally{await f.close()}});
test('chat schedule compiler uses São Paulo dates, rejects missing dates/past times and the video planner cannot invent shell operations',()=>{
 const now=new Date('2026-10-05T23:00:00Z');assert.equal(parseProductionSchedule('agende amanhã às 18h','America/Sao_Paulo',now).plannedAt,'2026-10-06T21:00:00.000Z');assert.equal(parseProductionSchedule('agende às 18h','America/Sao_Paulo',now),null);assert.throws(()=>parseProductionSchedule('hoje às 18h','America/Sao_Paulo',now),/futuro/);assert.equal(productionChatIntent('aprovo este vídeo').type,'video');assert.equal(productionChatIntent('agende amanhã às 18h').type,'schedule');assert.throws(()=>validateEditPlan({start:0,duration:5,format:'portrait',normalizeAudio:true,fadeSeconds:.1},{duration:5},{format:'original'}),/recortar/);
});
test('AI call cap pauses before any extra dispatch and continues only after a reviewed, valid limit increase',async()=>{
 const f=await fixture();try{const p=f.bridge.production.start('owner',{requestId:'start-capped',flowId:f.flow.id,topicId:f.topic.id,expectedTopic:f.topic,notionDestination:f.bridge.jobs.connection('owner','space').dataSourceId,authorize:true,budget:{maxCalls:1,maxAttemptsPerStep:2}});
  assert.deepEqual([p.budget.maxCalls,p.budget.maxAttemptsPerStep,p.budget.legacy],[1,2,false]);
  await f.toRecording(p.id);assert.equal(f.run(p.id).stage,'recording',f.run(p.id).error);assert.deepEqual(f.run(p.id).budget.calls.map(c=>c.status),['completed']);
  f.attach(p.id);await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await until(()=>f.run(p.id).stage==='paused');
  let run=f.run(p.id);assert.equal(f.counts().sends,1,'no dispatch beyond the cap');assert.equal(run.budgetStop.kind,'calls');assert.equal(run.resumeStage,'planning-edit');assert.match(run.error,/Limite de chamadas de IA.*\(1\/1\).*Nada foi enviado/);
  await assert.rejects(()=>f.command(p.id,'resume',{authorize:true}),/limite revisado/);
  for(const limits of [{maxCalls:0,maxAttemptsPerStep:2},{maxCalls:41,maxAttemptsPerStep:2},{maxCalls:2.5,maxAttemptsPerStep:2},{maxCalls:3,maxAttemptsPerStep:6},{maxCalls:'3',maxAttemptsPerStep:2}])await assert.rejects(()=>f.command(p.id,'adjust-budget',{authorize:true,reviewedCalls:1,limits}),/Escolha de/);
  await assert.rejects(()=>f.command(p.id,'adjust-budget',{authorize:true,reviewedCalls:0,limits:{maxCalls:3,maxAttemptsPerStep:2}}),/uso mudou/);
  await assert.rejects(()=>f.command(p.id,'adjust-budget',{reviewedCalls:1,limits:{maxCalls:3,maxAttemptsPerStep:2}}),/após revisar/);
  await f.command(p.id,'adjust-budget',{authorize:true,reviewedCalls:1,limits:{maxCalls:3,maxAttemptsPerStep:2}});assert.equal(f.run(p.id).stage,'paused','raising a limit never resumes automatically');assert.equal(f.counts().sends,1);
  assert.match(f.run(p.id).events.find(e=>e.action==='budget-limits').detail,/Chamadas 1→3/);
  await f.command(p.id,'resume',{authorize:true});await until(()=>['video-review','blocked','paused'].includes(f.run(p.id).stage));run=f.run(p.id);assert.equal(run.stage,'video-review',run.error);assert.equal(f.counts().sends,2);assert.equal(run.budget.calls.length,2);assert.equal(run.budgetStop,undefined);
 }finally{await f.close()}
});
test('uncertain sends survive restart, count conservatively and stop at the per-step attempt limit',async()=>{
 const f=await fixture();try{f.hold(true);const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');assert.equal(f.run(p.id).budget.calls[0].status,'sent');
  await f.reopen();assert.equal(f.run(p.id).stage,'paused');
  await f.command(p.id,'resume',{authorize:true});await until(()=>f.run(p.id).stage==='blocked');let run=f.run(p.id);assert.equal(run.budget.calls[0].status,'uncertain');assert.equal(f.counts().sends,1);
  await f.command(p.id,'resume',{authorize:true,resend:true});await until(()=>f.run(p.id).step?.attempt===2&&f.run(p.id).step?.phase==='streaming');assert.equal(f.counts().sends,2);
  await f.reopen();await f.command(p.id,'resume',{authorize:true,resend:true});await until(()=>f.run(p.id).budgetStop);run=f.run(p.id);
  assert.equal(run.stage,'paused');assert.equal(run.budgetStop.kind,'attempts');assert.equal(f.counts().sends,2,'resend authorization cannot exceed the attempt limit');assert.deepEqual(run.budget.calls.map(c=>c.status),['uncertain','uncertain']);
  await f.reopen();assert.equal(f.run(p.id).budget.calls.length,2,'restart neither resets nor refunds reservations');
 }finally{await f.close()}
});

test('automatic edit mode lets the editor choose bounded parameters while FFmpeg analyzes and the advanced export runs locally',async()=>{
 const f=await fixture();try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',editMode:'smart',authorize:true});
  await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));const run=f.run(p.id);assert.equal(run.stage,'video-review',run.error);
  assert.equal(run.editPreferences.mode,'smart');assert.equal(run.editPlan.mode,'smart');assert.match(run.editPlan.planHash,/^[a-f0-9]{64}$/);assert.deepEqual(run.editPlan.plan.animations,[],'no animation engine was injected');
  assert(f.prompts.some(x=>x.agent.id==='editor'&&x.prompt.includes('"removeSilences"')&&x.prompt.includes('não tem animações disponíveis')));
  const job=f.bridge.media.list('owner').find(item=>item.id===run.videoJobId);assert.equal(job.mode,'advanced');assert.equal(job.planHash,run.editPlan.planHash);assert.equal(job.status,'succeeded');
  assert(Math.abs((await probeVideo(job.result.file.path)).duration-run.editPlan.outputDuration)<0.2);assert.equal(readFileSync(f.input).length,f.file.size);
 }finally{await f.close()}
});

test('automatic edit carries the chosen motion intensity, asks for spoken highlights and reports motion honestly',async()=>{
 const animate=async input=>{const {copyFile}=await import('node:fs/promises');await copyFile(input.inputPath,input.outputPath);};
 const f=await fixture({animate,animationCapabilities:async()=>({available:true})});try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',editMode:'smart',motion:'intense',authorize:true});
  await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));const run=f.run(p.id);assert.equal(run.stage,'video-review',run.error);
  assert.equal(run.editPreferences.motion,'intense');
  assert(f.prompts.some(x=>x.agent.id==='editor'&&x.prompt.includes('"highlights"')&&x.prompt.includes('MEDE na voz')));
  // 1,5 s de tom sem fala: nada é inventado e o motivo aparece no resumo.
  assert.match(run.editPlan.motionSummary,/intenso: 0 momento/);assert.match(run.editPlan.motionSummary,/sem transcrição/);assert.equal(run.editPlan.plan.motion,undefined);
 }finally{await f.close()}
 const g=await fixture({animate,animationCapabilities:async()=>({available:true})});try{const p=g.start();await g.toRecording(p.id);g.attach(p.id);
  await g.command(p.id,'video',{assetId:'original',format:'original',editMode:'smart',motion:'off',authorize:true});
  await until(()=>['video-review','blocked'].includes(g.run(p.id).stage));const run=g.run(p.id);assert.equal(run.stage,'video-review',run.error);
  assert.equal(run.editPreferences.motion,'off');assert.equal(run.editPlan.motionSummary,undefined);
  assert(!g.prompts.some(x=>x.agent.id==='editor'&&x.prompt.includes('"highlights"')),'motion off: the editor is not asked for highlights');
 }finally{await g.close()}
});

test('automatic edit gives the editor the local transcript and lists possible retakes without cutting them',async()=>{
 // Stub transcriber: this fixture video is a pure tone. Real whisper.cpp output is covered in transcribe.test.mjs.
 let calls=0;const transcriber={capabilities:async()=>({available:true}),transcribe:async()=>{calls++;return {engine:'whisper.cpp',model:'ggml-base',language:'pt',segments:[{start:0,end:0.6,text:'Hoje vamos falar de automação'},{start:0.7,end:1.4,text:'Hoje vamos falar de automação local'}]}}};
 const f=await fixture({transcriber});try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',editMode:'smart',authorize:true});
  await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));const run=f.run(p.id);assert.equal(run.stage,'video-review',run.error);
  assert.equal(calls,1,'transcribed once; analysis reused the cached transcript');
  assert(f.prompts.some(x=>x.agent.id==='editor'&&x.prompt.includes('[0.7s] Hoje vamos falar de automação local')));
  assert.equal(run.editPlan.transcribed,true);assert.equal(run.editPlan.possibleRetakes.length,1);assert.equal(run.editPlan.possibleRetakes[0].start,0);
  assert.equal(run.editPlan.plan.segments[0].start,0,'possible retakes stay in the video');
 }finally{await f.close()}
});

test('the user can adjust the automatic cut and use that verified export as the version to approve',async()=>{
 const f=await fixture();try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',editMode:'smart',authorize:true});
  await until(()=>['video-review','blocked'].includes(f.run(p.id).stage));const automatic=f.run(p.id);assert.equal(automatic.stage,'video-review',automatic.error);
  const ref={contentId:automatic.contentId,assetId:'original',versionId:'original-v1',sha256:f.file.sha256};
  const preview=await f.bridge.media.plan('owner',{...ref,plan:{segments:[{start:0.2,end:1.3}]}});
  const revision=f.db.prepare('SELECT revision FROM editorial_state').get().revision;
  const adjusted=f.bridge.media.enqueue('owner',{mode:'advanced',authorize:true,revision,requestKey:'user-adjusted',...ref,plan:preview.plan,planHash:preview.planHash}).job;
  await until(()=>f.bridge.media.list('owner').find(job=>job.id===adjusted.id).status==='succeeded');
  await assert.rejects(()=>f.command(p.id,'use-edited-video',{jobId:adjusted.id}),/Confira o vídeo ajustado/);
  await assert.rejects(()=>f.command(p.id,'use-edited-video',{jobId:'media-other',authorize:true}),/gravação desta produção/);
  await f.command(p.id,'use-edited-video',{jobId:adjusted.id,authorize:true});const run=f.run(p.id);
  assert.equal(run.stage,'video-review');assert.equal(run.videoJobId,adjusted.id);assert.notEqual(run.outputVideo.assetId,automatic.outputVideo.assetId);
  await f.command(p.id,'approve-video',{authorize:true,expectedVideo:run.outputVideo});assert.equal(f.run(p.id).approvedVideo.assetId,run.outputVideo.assetId);
 }finally{await f.close()}
});

import {migrateScriptGate,recordingReady} from '../production-script.mjs';
import {migrateCoverGate,initialCovers,validateDestinations} from '../production-covers.mjs';
import {validateInspirationState} from '../editorial-inspiration.mjs';
import * as thumbnailEngine from '../editorial-thumbnails.mjs';
import {createHash} from 'node:crypto';
const waitStage=(f,id,stages)=>until(()=>[...stages,'blocked'].includes(f.run(id).stage));
const edit=(f,id,baseVersion,text,hook='Meu hook editado')=>f.command(id,'save-script',{baseVersion,hook,cta:scriptOptions.ctas[1],pathIndex:1,text});

test('script gate: no Notion card before approval, edits create versions, recording only for the approved and confirmed version',async()=>{
 const f=await fixture();try{const p=f.start();await waitStage(f,p.id,['script-review']);let r=f.run(p.id);
  assert.equal(r.stage,'script-review',r.error);assert.equal(f.counts().notionWrites,0,'nothing reaches Notion before approval');assert.equal(r.recordingReady,false);
  assert.deepEqual([r.scriptVersions.length,r.scriptVersions[0].source,r.scriptOptions.hooks.length,r.scriptOptions.paths.length],[1,'agent',3,2]);
  f.attach(p.id);await assert.rejects(()=>f.command(p.id,'video',{assetId:'original',format:'original',authorize:true}),/Confirme a gravação/);
  const v1=r.scriptVersions[0];await assert.rejects(()=>edit(f,p.id,0,'Texto revisado pelo usuário com detalhes suficientes.'),/mudou desde/);
  await edit(f,p.id,1,'Texto revisado pelo usuário com detalhes suficientes para gravar.');r=f.run(p.id);const v2=r.scriptVersions.at(-1);
  assert.deepEqual([v2.version,v2.source,v2.path.title,v2.cta],[2,'user','Story','Try it']);assert.notEqual(v2.hash,v1.hash);
  await edit(f,p.id,2,'Texto revisado pelo usuário com detalhes suficientes para gravar.');assert.equal(f.run(p.id).scriptVersions.length,2,'an identical save is a no-op');
  await assert.rejects(()=>f.command(p.id,'approve-script',{authorize:true,version:1,expectedHash:v1.hash}),/versão atual/,'an older version cannot be approved');
  await assert.rejects(()=>f.command(p.id,'approve-script',{version:2,expectedHash:v2.hash}),/versão atual/,'approval needs explicit authorization');
  await f.command(p.id,'approve-script',{authorize:true,version:2,expectedHash:v2.hash});await waitStage(f,p.id,['recording']);r=f.run(p.id);
  assert.equal(r.stage,'recording',r.error);assert.equal(f.counts().notionWrites,1);assert.deepEqual([f.notionPayloads.at(-1).version,f.notionPayloads.at(-1).data.hook],[2,'Meu hook editado']);
  assert.deepEqual([r.recordingReady,r.notion.scriptHash,r.script.text],[true,v2.hash,v2.text]);
  await f.command(p.id,'approve-script',{authorize:true,version:2,expectedHash:v2.hash});assert.equal(f.run(p.id).stage,'recording','repeating the approval is idempotent');assert.equal(f.counts().notionWrites,1);
  await edit(f,p.id,2,'Outra versão do texto revisado pelo usuário, com uma mudança real.');r=f.run(p.id);
  assert.deepEqual([r.stage,r.recordingReady,r.scriptApproval],['script-review',false,undefined],'a later change invalidates the approval');assert.equal(r.notion.scriptHash,v2.hash,'the confirmed card stays bound to v2');
  await assert.rejects(()=>f.command(p.id,'video',{assetId:'original',format:'original',authorize:true}),/Confirme a gravação/);
  const v3=r.scriptVersions.at(-1);await f.command(p.id,'approve-script',{authorize:true,version:3,expectedHash:v3.hash});await waitStage(f,p.id,['recording']);
  assert.equal(f.run(p.id).stage,'recording');assert.equal(f.counts().notionWrites,2);assert.equal(f.run(p.id).notion.pageId,r.notion.pageId,'the same card is updated');
  f.notes('NOTION_OLD_SCRIPT');await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);
  const prompt=f.prompts.filter(x=>x.agent.id==='editor').at(-1).prompt;assert.match(prompt,/Roteiro aprovado pelo usuário \(v3, prevalece/);assert.match(prompt,/só referência; pode estar desatualizado/);assert(prompt.includes('NOTION_OLD_SCRIPT')&&prompt.includes('Outra versão do texto'));
  assert.equal(f.run(p.id).script.text,v3.text,'Notion content never replaces the approved script');
  await assert.rejects(()=>edit(f,p.id,3,'Uma edição tardia depois da gravação já enviada.'),/antes da gravação/);
 }finally{await f.close()}
});

test('regenerating the script is an explicit, budgeted AI call that keeps prior versions',async()=>{
 const f=await fixture();try{const p=f.start();await waitStage(f,p.id,['script-review']);
  await assert.rejects(()=>f.command(p.id,'regenerate-script',{notes:' '}),/Informe o que mudar/);
  await f.command(p.id,'regenerate-script',{notes:'Mais curto e com exemplo real'});await waitStage(f,p.id,['script-review']);const r=f.run(p.id);
  assert.equal(r.stage,'script-review',r.error);assert.deepEqual(r.scriptVersions.map(v=>[v.version,v.source]),[[1,'agent'],[2,'agent']]);assert.equal(f.counts().sends,2);assert.equal(r.budget.calls.length,2);
  assert(f.prompts.at(-1).prompt.includes('Mais curto e com exemplo real'));assert.equal(f.counts().notionWrites,0);
 }finally{await f.close()}
});

test('Claude availability and sign-in are checked separately; a signed-out CLI is refused before any budget reservation',async()=>{
 const f=await fixture({},{providers:{source:'claude'}});try{const input={flowId:f.flow.id,topicId:f.topic.id,expectedTopic:f.topic,notionDestination:f.bridge.jobs.connection('owner','space').dataSourceId};
  f.claude.status={state:'login-required'};let report=await f.bridge.production.preflight('owner',input);assert.deepEqual(report.blockers.map(c=>c.id),['auth-claude']);
  assert.throws(()=>f.start(),/claude auth login/);
  f.claude.status={state:'connected'};f.claude.available=false;report=await f.bridge.production.preflight('owner',input);assert.deepEqual(report.blockers.map(c=>c.id),['runtime-claude']);assert.throws(()=>f.start(),/outro provedor/);
  f.claude.available=true;report=await f.bridge.production.preflight('owner',input);assert.equal(report.ready,true);
  f.claude.status={state:'login-required'};const p=f.start();await until(()=>f.run(p.id).stage==='blocked');let r=f.run(p.id);
  assert.match(r.error,/claude auth login.*nada foi enviado/);assert.deepEqual([r.budget.calls.length,f.claude.sends.length,f.counts().sends],[0,0,0]);
  f.claude.status={state:'connected'};await f.command(p.id,'resume',{authorize:true});await waitStage(f,p.id,['script-review']);r=f.run(p.id);assert.equal(r.stage,'script-review',r.error);assert.equal(f.claude.sends.length,1);
 }finally{await f.close()}
});

test('an interrupted Claude turn is never assumed complete: resume asks for resend, uses a fresh session, cancel stops the CLI',async()=>{
 const f=await fixture({},{providers:{source:'claude'}});try{f.claude.held=true;const p=f.start();await until(()=>f.run(p.id).step?.phase==='streaming');
  await f.reopen();assert.equal(f.run(p.id).stage,'paused');assert(f.claude.cancels.length>=1,'closing the app cancels the CLI process');
  await f.command(p.id,'resume',{authorize:true});await until(()=>f.run(p.id).stage==='blocked');assert.match(f.run(p.id).error,/não permite conferir/);assert.equal(f.claude.sends.length,1);
  f.claude.held=false;await f.command(p.id,'resume',{authorize:true,resend:true});await waitStage(f,p.id,['script-review']);const r=f.run(p.id);
  assert.equal(r.stage,'script-review',r.error);assert.equal(f.claude.sends.length,2);assert.notEqual(f.claude.sends[0].session,f.claude.sends[1].session);assert.deepEqual(r.budget.calls.map(c=>c.status),['uncertain','completed']);
  f.claude.held=true;await f.command(p.id,'regenerate-script',{notes:'Outra abordagem'});await until(()=>f.run(p.id).step?.phase==='streaming');const before=f.claude.cancels.length;
  await f.command(p.id,'cancel');assert.equal(f.run(p.id).stage,'canceled');assert(f.claude.cancels.length>before,'cancel stops the running CLI turn');
 }finally{await f.close()}
});

test('legacy productions migrate safely: no synthetic approval before recording, no duplicate card, later stages keep progress',async()=>{
 const f=await fixture();try{const p=f.start();await f.toRecording(p.id);
  const legacy=JSON.parse(f.db.prepare('SELECT data_json FROM production_runs WHERE id=?').get(p.id).data_json);for(const key of ['scriptGate','scriptVersions','scriptApproval','scriptOptions'])delete legacy[key];delete legacy.notion.scriptHash;delete legacy.notion.scriptVersion;
  f.db.prepare('UPDATE production_runs SET data_json=? WHERE id=?').run(JSON.stringify(legacy),p.id);
  let r=f.run(p.id);assert.deepEqual([r.stage,r.recordingReady,r.scriptApproval,r.scriptVersions[0].source],['script-review',false,undefined,'legacy']);
  f.attach(p.id);await assert.rejects(()=>f.command(p.id,'video',{assetId:'original',format:'original',authorize:true}),/Confirme a gravação/);
  const v=r.scriptVersions[0];await f.command(p.id,'approve-script',{authorize:true,version:1,expectedHash:v.hash});r=f.run(p.id);
  assert.deepEqual([r.stage,r.recordingReady,f.counts().notionWrites],['recording',true,1],'approving the unchanged legacy script reuses the confirmed card');
 }finally{await f.close()}
 const script={hook:'h',cta:'c',path:{title:'t',outline:'o'},text:'texto',improvisationTopics:[],thumbnailDirection:'d'},at='2026-10-01T00:00:00.000Z';
 const past=migrateScriptGate({stage:'video-review',script,notion:{pageId:'x',url:'u'},updatedAt:at,events:[]});assert.deepEqual([past.stage,past.scriptApproval.legacy,recordingReady(past),past.events.length],['video-review',true,true,0],'later stages keep progress without re-running');
 const writingCard=migrateScriptGate({stage:'paused',resumeStage:'notion',script,updatedAt:at});assert.deepEqual([writingCard.scriptApproval.reviewRequired,recordingReady(writingCard)],[true,false],'an in-flight legacy card finishes, then waits for review');
 const writing=migrateScriptGate({stage:'writing',updatedAt:at});assert.deepEqual(writing.scriptVersions,[]);
 assert.deepEqual(migrateScriptGate(structuredClone(past)),past,'migration is idempotent');
});

test('Claude runs the stages of Claude agents only: Codex keeps its own stages and covers are local, never another provider',async()=>{
 const f=await fixture({},{providers:{source:'claude'}});try{
  const report=await f.bridge.production.preflight('owner',{flowId:f.flow.id,topicId:f.topic.id,expectedTopic:f.topic,notionDestination:f.bridge.jobs.connection('owner','space').dataSourceId});
  assert.equal(report.ready,true,JSON.stringify(report.blockers));assert.deepEqual(['runtime-claude','auth-claude','cover-generation'].map(id=>report.checks.find(c=>c.id===id)?.level),['ok','ok','unverified']);
  const p=f.start();await f.toRecording(p.id);let r=f.run(p.id);assert.equal(r.stage,'recording',r.error);
  assert.deepEqual([f.claude.sends.length,f.counts().sends],[1,0],'the script ran on Claude, not Codex');assert.deepEqual([f.claude.sends[0].agent.id,f.claude.sends[0].agent.runtimeFirstMessage],['source',true]);
  assert.deepEqual(r.providers,{source:'claude',editor:'codex',publisher:'claude'});assert.equal(r.budget.calls.length,1);
  f.attach(p.id);await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);
  assert.deepEqual([f.claude.sends.length,f.counts().sends],[1,1],'the Codex editor keeps the edit stage');
  await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await f.toPackage(p.id);r=f.run(p.id);
  assert.equal(r.stage,'package-review',r.error);assert.deepEqual([f.claude.sends.length,f.counts().sends],[2,1],'captions by Claude; covers rendered locally with no AI call');
  assert(r.reviewDeliveries.every(d=>d.cover&&d.text.startsWith('Claude caption')));
 }finally{await f.close()}
});

test('local covers gate: three concepts per format, explicit export only, forged/stale/dirty approvals refused, package uses the exact chosen file',async()=>{
 const f=await fixture();try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);
  await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});
  await waitStage(f,p.id,['covers-review']);let r=f.run(p.id);const sends=f.counts().sends;
  assert.equal(r.stage,'covers-review',r.error);assert.deepEqual(r.covers.destinations,[{platform:'Instagram',format:'instagram-reels-cover',confirmed:true},{platform:'TikTok',format:'tiktok-cover',confirmed:true}]);
  assert.deepEqual(r.covers.concepts.map(c=>c.id),['product','person','benefit']);assert.deepEqual(r.covers.source,{assetId:r.approvedVideo.assetId,versionId:r.approvedVideo.versionId,sha256:r.approvedVideo.sha256});
  assert.deepEqual(r.covers.batches,{},'nothing is rendered before an explicit export');assert(r.coverFormats.some(x=>x.id==='youtube-thumbnail'));
  const approve=(extra={})=>{const c=f.run(p.id).covers;return f.command(p.id,'approve-covers',{authorize:true,destinations:c.destinations,concepts:c.concepts,brand:c.brand,selections:['instagram-reels-cover','tiktok-cover'].map(format=>({format,concept:format==='tiktok-cover'?'product':'benefit',batchId:c.batches[format]?.batchId})),...extra});};
  await assert.rejects(()=>approve(),/exportação atual/,'no approval before an export');
  await assert.rejects(()=>f.command(p.id,'cover-render',{format:'instagram-reels-cover',concepts:r.covers.concepts.map(c=>c.id==='person'?{...c,title:''}:c),brand:r.covers.brand}),/Revise os campos da capa/);
  await assert.rejects(()=>f.command(p.id,'cover-render',{format:'instagram-reels-cover',concepts:r.covers.concepts,brand:{...r.covers.brand,logoPath:'C:/Windows/logo.png'}}),/não permitido/,'no filesystem path from the client');
  await assert.rejects(()=>f.command(p.id,'cover-render',{format:'instagram-reels-cover',concepts:r.covers.concepts,brand:{...r.covers.brand,logoAssetId:'original'}}),/logo de imagem/,'a logo must be an image of this content');
  for(const format of ['instagram-reels-cover','tiktok-cover']){await f.command(p.id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>f.run(p.id).covers.render.status!=='running');assert.equal(f.run(p.id).covers.render.status,'done',f.run(p.id).covers.render.error);}
  r=f.run(p.id);const batch=r.covers.batches['instagram-reels-cover'];assert.deepEqual(batch.items.map(i=>i.concept),['product','person','benefit']);assert.deepEqual([batch.items[0].width,batch.items[0].height],[1080,1920]);
  assert.equal(f.counts().sends,sends,'exports never call AI');
  const assets=f.current().assets.length;await f.command(p.id,'cover-render',{format:'instagram-reels-cover',concepts:r.covers.concepts,brand:r.covers.brand});
  assert.deepEqual([f.run(p.id).covers.render.reused,f.run(p.id).covers.batches['instagram-reels-cover'].batchId,f.current().assets.length],[true,batch.batchId,assets],'identical inputs reuse the verified batch');
  await assert.rejects(()=>approve({selections:[{format:'instagram-reels-cover',concept:'benefit',batchId:'forged'},{format:'tiktok-cover',concept:'product',batchId:r.covers.batches['tiktok-cover'].batchId}]}),/exportação atual/,'forged batch');
  await assert.rejects(()=>approve({concepts:r.covers.concepts.map(c=>c.id==='benefit'?{...c,title:'Edited after export'}:c)}),/mudaram depois da exportação/,'dirty approval');
  await assert.rejects(()=>approve({brand:{...r.covers.brand,theme:'light'}}),/mudaram depois da exportação/,'brand changed after export');
  await assert.rejects(()=>approve({destinations:[{platform:'Instagram',format:'instagram-reels-cover'}]}),/cada rede/,'every chosen network needs a cover');
  const file=await f.bridge.production.coverFile('owner',p.id,batch.items[2].assetId,batch.items[2].versionId);assert.equal(createHash('sha256').update(file.bytes).digest('hex'),batch.items[2].sha256);
  await assert.rejects(()=>f.bridge.production.coverFile('owner',p.id,'original','original-v1'),/não encontrada/,'only this run’s covers are served');
  await approve();r=f.run(p.id);assert.equal(r.stage,'package-review');
  const ig=r.reviewDeliveries.find(d=>d.platform==='Instagram'),tt=r.reviewDeliveries.find(d=>d.platform==='TikTok');
  assert.deepEqual([ig.cover.assetId,ig.cover.sha256],[batch.items[2].assetId,batch.items[2].sha256],'Instagram uses the chosen benefit cover');
  assert.equal(tt.cover.assetId,r.covers.batches['tiktok-cover'].items[0].assetId,'TikTok uses the chosen product cover of its own format');
  await f.command(p.id,'approve-package',{authorize:true,expectedHash:f.run(p.id).reviewHash});assert.equal(f.run(p.id).stage,'schedule');
 }finally{await f.close()}
});

test('cover export cancel, app restart and late results never register partial or stale covers; changed inputs re-render',async()=>{
 let hold,release;const engine={...thumbnailEngine,renderThumbnailSet:async options=>{if(hold){await new Promise(resolve=>release=resolve);}return thumbnailEngine.renderThumbnailSet({...options,signal:undefined});}};
 const f=await fixture({thumbnails:engine});try{const p=f.start();await f.toRecording(p.id);f.attach(p.id);
  await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);
  await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await waitStage(f,p.id,['covers-review']);
  let r=f.run(p.id);const format='instagram-reels-cover';
  hold=true;await f.command(p.id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>release);
  await assert.rejects(()=>f.command(p.id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand}),/já está em andamento/);
  await assert.rejects(()=>f.command(p.id,'approve-covers',{authorize:true,destinations:r.covers.destinations,concepts:r.covers.concepts,brand:r.covers.brand,selections:[]}),/Aguarde/);
  await f.command(p.id,'cover-cancel');assert.equal(f.run(p.id).covers.render.status,'canceled');
  const late=release;release=undefined;late();await new Promise(resolve=>setTimeout(resolve,2500));
  assert.deepEqual(f.run(p.id).covers.batches,{},'a canceled render that still finishes is discarded');
  await f.command(p.id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>release);
  await f.reopen();assert.equal(f.run(p.id).covers.render.status,'interrupted','restart never resumes an export silently');
  const stuck=release;release=undefined;stuck();await new Promise(resolve=>setTimeout(resolve,2500));assert.deepEqual(f.run(p.id).covers.batches,{});
  hold=false;await f.command(p.id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>f.run(p.id).covers.render.status!=='running');
  r=f.run(p.id);assert.equal(r.covers.render.status,'done',r.covers.render.error);const first=r.covers.batches[format];
  await f.command(p.id,'cover-render',{format,concepts:r.covers.concepts.map(c=>c.id==='person'?{...c,title:'Outro título'}:c),brand:r.covers.brand});await until(()=>f.run(p.id).covers.render.status!=='running');
  r=f.run(p.id);assert.notEqual(r.covers.batches[format].batchId,first.batchId);
  await assert.rejects(()=>f.command(p.id,'approve-covers',{authorize:true,destinations:r.covers.destinations,concepts:r.covers.concepts,brand:r.covers.brand,selections:[{format,concept:'person',batchId:first.batchId}]}),/exportação atual/,'an older batch cannot be approved');
  await f.command(p.id,'revise-video',{notes:'Cortar o início'});r=f.run(p.id);assert.equal(r.stage,'planning-edit');
  await waitStage(f,p.id,['video-review']);await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});
  await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await waitStage(f,p.id,['covers-review']);r=f.run(p.id);
  assert.deepEqual(r.covers.batches,{},'a new approved video restarts the gallery');assert.equal(r.covers.source.sha256,r.approvedVideo.sha256);
 }finally{await f.close()}
});

test('recording package checklist and notes persist per run and script version; legacy cover runs need a selection, completed runs are untouched',async()=>{
 const f=await fixture();try{const p=f.start();await f.toRecording(p.id);let r=f.run(p.id);const {version,hash}=r.scriptApproval;
  await f.command(p.id,'recording-prep',{version,hash,checklist:{framing:true,audio:true}});
  await f.command(p.id,'recording-prep',{version,hash,suggestions:[{id:'broll-1',sceneIndex:1,kind:'broll',text:'Close da tela'}]});
  r=f.run(p.id);assert.deepEqual([r.recordingPrep.checklist,r.recordingPrep.suggestions[0].text],[{framing:true,audio:true},'Close da tela']);
  await assert.rejects(()=>f.command(p.id,'recording-prep',{version,hash:'0'.repeat(64),checklist:{}}),/roteiro mudou/);
  await assert.rejects(()=>f.command(p.id,'recording-prep',{version,hash,checklist:{framing:'yes'}}),/Checklist inválido/);
  await assert.rejects(()=>f.command(p.id,'recording-prep',{version,hash,suggestions:[{id:'x',sceneIndex:1,kind:'shell',text:'rm'}]}),/Sugestões inválidas/);
  assert.equal(r.events.filter(e=>e.action==='recording-prep').length,0,'ticks do not flood the audit trail');
  await f.command(p.id,'save-script',{baseVersion:version,hook:'Outro hook',cta:'Try it',pathIndex:0,text:'Uma nova versão do roteiro com conteúdo suficiente.'});
  await assert.rejects(()=>f.command(p.id,'recording-prep',{version,hash,checklist:{}}),/depois do roteiro aprovado/);
  assert.equal(f.run(p.id).recordingPrep,undefined,'a new script version invalidates the old recording checklist');
  const backup=executionSnapshot(f.db,'owner');restoreExecution(f.db,'owner',backup,'replace');r=f.run(p.id);assert.equal(r.imported,true);assert.equal(r.recordingPrep,undefined,'restoring a backup must not revive a checklist invalidated by a new script version');
  await assert.rejects(()=>f.command(p.id,'recording-prep',{version,hash,checklist:{}}),/nova autorização|antes|depois/,'restored history grants no execution');
  await assert.rejects(()=>f.bridge.production.coverFile('owner',p.id,'a','b'),/Histórico importado/);
 }finally{await f.close()}
 const base={id:'run',stage:'generating-cover',approvedVideo:{assetId:'v',versionId:'v1',sha256:'a'.repeat(64)},package:{deliveries:[]},platforms:['Instagram'],script:{hook:'Hook',cta:'CTA'},topic:{title:'T'},editPlan:{outputDuration:10},coverIndex:1,updatedAt:'2026-10-01T00:00:00.000Z',events:[]};
 const legacy=migrateCoverGate(structuredClone(base));assert.deepEqual([legacy.stage,legacy.covers.destinations,Object.keys(legacy.covers.batches).length,legacy.coverIndex],['covers-review',[{platform:'Instagram',format:'instagram-reels-cover',confirmed:true}],0,undefined]);
 assert.equal(migrateCoverGate({...structuredClone(base),stage:'paused',resumeStage:'generating-cover'}).stage,'covers-review');
 const complete=migrateCoverGate({...structuredClone(base),stage:'complete',deliveries:['d']});assert.deepEqual([complete.stage,complete.covers,complete.deliveries],['complete',undefined,['d']],'completed productions keep their delivered covers');
 assert.deepEqual(migrateCoverGate(structuredClone(legacy)),legacy,'idempotent');
});

test('reference library is validated on the server: workspace-scoped video assets, no private paths or extra fields',()=>{
 const at='2026-10-01T00:00:00.000Z',ref={id:'r1',workspaceId:'space',sourceUrl:'https://www.instagram.com/reel/abc',sourceHost:'www.instagram.com',platform:'instagram',notes:'Gancho bom',tags:['gancho'],metadataStatus:'not_collected',revision:1,createdAt:at,updatedAt:at};
 const state=(references,assets=[])=>({assets,inspiration:{schemaVersion:1,references}});
 assert.equal(validateInspirationState({}),true);assert.equal(validateInspirationState(state([ref])),true);
 assert.equal(validateInspirationState(state([{...ref,path:'C:/Users/me/video.mp4'}])),false,'no private path field');
 assert.equal(validateInspirationState(state([{...ref,asset:{assetId:'a',name:'x',path:'C:/x.mp4'}}])),false);
 assert.equal(validateInspirationState(state([{...ref,sourceUrl:'file:///C:/x.mp4'}])),false);
 assert.equal(validateInspirationState(state([{...ref,asset:{assetId:'a',name:'x'}}],[{id:'a',workspaceId:'other',kind:'video'}])),false,'asset of another workspace');
 assert.equal(validateInspirationState(state([{...ref,sourceUrl:undefined,sourceHost:undefined,platform:undefined,asset:{assetId:'gone',name:'x'}}])),true,'a removed asset stays as unavailable');
 assert.equal(validateInspirationState(state([ref,{...ref}])),false,'duplicate ids');
 assert.equal(validateInspirationState(state([{...ref,metadataStatus:'collected'}])),false,'no invented analysis');
});

test('networks without a verified cover preset (LinkedIn) start from an approximate format the user must explicitly confirm',()=>{
 const covers=initialCovers({approvedVideo:{assetId:'v',versionId:'v1',sha256:'a'.repeat(64)},platforms:['Instagram','LinkedIn'],script:{hook:'H',cta:'C'},topic:{title:'T'},editPlan:{outputDuration:10}});
 assert.deepEqual(covers.destinations,[{platform:'Instagram',format:'instagram-reels-cover',confirmed:true},{platform:'LinkedIn',format:'instagram-feed-4x5',confirmed:false}]);
 assert.throws(()=>validateDestinations(covers.destinations,['Instagram','LinkedIn']),/LinkedIn não tem um modelo de capa próprio verificado/);
 assert.throws(()=>validateDestinations([covers.destinations[0],{platform:'LinkedIn',format:'youtube-thumbnail'}],['Instagram','LinkedIn']),/Escolha e confirme/,'picking a format still needs the explicit confirmation flag');
 assert.deepEqual(validateDestinations([covers.destinations[0],{platform:'LinkedIn',format:'youtube-thumbnail',confirmed:true}],['Instagram','LinkedIn'])[1],{platform:'LinkedIn',format:'youtube-thumbnail',confirmed:true});
});

import * as captionEngine from '../editorial-captions.mjs';
const fakeTranscriber={capabilities:async()=>({available:true}),transcribe:async({duration})=>({origin:'local-whisper',engine:'whisper.cpp',model:'test',language:'pt',segments:[{start:0.1,end:Math.min(0.8,duration),text:'Olá, edição automática'}],speech:[]})};
const toVideoReview=async f=>{const p=f.start();await f.toRecording(p.id);f.attach(p.id);await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);assert.equal(f.run(p.id).stage,'video-review',f.run(p.id).error);return p;};
const toCoversApproved=async(f,id)=>{let r=f.run(id);const formats=[...new Set(r.covers.destinations.map(d=>d.format))];for(const format of formats){await f.command(id,'cover-render',{format,concepts:r.covers.concepts,brand:r.covers.brand});await until(()=>f.run(id).covers.render?.status!=='running');assert.equal(f.run(id).covers.render.status,'done',f.run(id).covers.render.error);r=f.run(id);}
 await f.command(id,'approve-covers',{authorize:true,destinations:r.covers.destinations,concepts:r.covers.concepts,brand:r.covers.brand,selections:formats.map(format=>({format,concept:'person',batchId:r.covers.batches[format].batchId}))});};

test('B05 burned speech captions: reviewed versions, approved style, new MP4 with audio, original kept, approvals bound and invalidated; B03 frames',async()=>{
 const f=await fixture({transcriber:fakeTranscriber});try{const p=await toVideoReview(f);let r=f.run(p.id);const edited=r.outputVideo,sends=f.counts().sends;
  assert.deepEqual(r.captionStyles.map(s=>s.id),['classic','boxed','highlight']);
  await f.command(p.id,'captions-transcribe',{language:'pt'});await until(()=>f.run(p.id).captions.transcription.status!=='running');r=f.run(p.id);
  assert.equal(r.captions.transcription.status,'done',r.captions.transcription.error);assert.deepEqual(r.captions.base,{assetId:edited.assetId,versionId:edited.versionId,sha256:edited.sha256});
  const v1=r.captions.versions[0];assert.equal(v1.origin,'transcript');assert(v1.warnings.includes('whisper-approximate'),'Whisper timing is labelled approximate');assert.equal(v1.segments[0].text,'Olá, edição automática','no automatic semantic correction');
  await assert.rejects(()=>f.command(p.id,'captions-render',{authorize:true,version:1,hash:v1.hash,style:'classic'}),/Aprove/,'no burn without approval');
  await assert.rejects(()=>f.command(p.id,'captions-save',{baseVersion:1,segments:[{start:0.5,end:0.2,text:'x'}]}),/Revise as legendas/);
  await assert.rejects(()=>f.command(p.id,'captions-save',{baseVersion:1,segments:[{start:0,end:1,text:'texto {com chaves}'}]}),/não são aceitos/);
  await assert.rejects(()=>f.command(p.id,'captions-save',{baseVersion:1,segments:[{start:0,end:9,text:'Fora do vídeo'}]}),/depois do fim/);
  await f.command(p.id,'captions-save',{baseVersion:1,segments:[{start:0.1,end:0.7,text:'Olá, edição'},{start:0.8,end:1.4,text:'Ação e coração'}]});r=f.run(p.id);const v2=r.captions.versions.at(-1);assert.equal(v2.version,2);
  await assert.rejects(()=>f.command(p.id,'captions-approve',{authorize:true,version:1,hash:v1.hash,style:'boxed'}),/versão atual/,'only the latest version can be approved');
  await assert.rejects(()=>f.command(p.id,'captions-approve',{authorize:true,version:2,hash:v2.hash,style:'brand-x'}),/estilos/);
  await f.command(p.id,'captions-approve',{authorize:true,version:2,hash:v2.hash,style:'boxed'});
  await assert.rejects(()=>f.command(p.id,'captions-render',{authorize:true,version:2,hash:v2.hash,style:'classic'}),/estilo mudou/,'style is bound to the approval');
  await f.command(p.id,'captions-render',{authorize:true,version:2,hash:v2.hash,style:'boxed'});
  await assert.rejects(()=>f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo}),/Aguarde as legendas/);
  await until(()=>f.run(p.id).captions.render.status!=='running');r=f.run(p.id);assert.equal(r.captions.render.status,'done',r.captions.render.error);
  assert.notEqual(r.outputVideo.sha256,edited.sha256,'a new captioned file is the version to approve');assert.deepEqual([r.captions.output.version,r.captions.output.style,r.captions.output.audio],[2,'boxed','copied']);
  const assets=f.current().assets,burned=assets.find(a=>a.id===r.outputVideo.assetId),base=assets.find(a=>a.id===edited.assetId),srt=assets.find(a=>a.id===r.captions.output.srtAssetId);
  assert.equal(base.versions.find(v=>v.id===edited.versionId).sha256,edited.sha256,'the uncaptioned video stays registered');assert.equal(createHash('sha256').update(readFileSync(base.versions[0].path)).digest('hex'),edited.sha256,'and unchanged on disk');
  const burnedMeta=await probeVideo(burned.versions[0].path);assert.equal(burnedMeta.hasAudio,true);assert(Math.abs(burnedMeta.duration-1.5)<0.2);
  assert.match(readFileSync(srt.versions[0].path,'utf8'),/Ação e coração/,'SRT of the same approved version for CapCut');
  assert.equal(f.counts().sends,sends,'captions never call AI');
  // Saving again withdraws the approval; the burned v2 file stays bound to v2.
  await f.command(p.id,'captions-save',{baseVersion:2,segments:[{start:0.1,end:0.7,text:'Olá'}]});assert.equal(f.run(p.id).captions.approved,undefined);assert.equal(f.run(p.id).outputVideo.sha256,r.outputVideo.sha256);
  await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await waitStage(f,p.id,['covers-review']);r=f.run(p.id);
  assert.equal(r.approvedVideo.sha256,burned.versions[0].sha256);assert.deepEqual(r.covers.source,{assetId:edited.assetId,versionId:edited.versionId,sha256:edited.sha256},'covers use frames without burned captions');
  // B03 frame picker over the same uncaptioned version.
  const candidates=await f.bridge.production.coverCandidates('owner',p.id);assert(candidates.candidates.length>=1&&candidates.candidates.length<=6);assert(!JSON.stringify(candidates).includes('production-media'),'no filesystem path to the client');
  const at=candidates.candidates[0].timestampSeconds,ask=(extra={},signal)=>f.bridge.production.coverFrame('owner',p.id,{timestampSeconds:at,versionId:edited.versionId,sha256:edited.sha256,...extra},signal);
  const frame=await ask();assert.equal(frame.bytes.subarray(0,2).toString('hex'),'ffd8');
  assert.equal((await ask()).cached,true,'repeat previews hit the bounded cache');
  await assert.rejects(()=>ask({sha256:'0'.repeat(64)}),e=>e.status===409,'an old source is refused');
  await assert.rejects(()=>ask({timestampSeconds:99}),e=>e.status===400);
  const abort=new AbortController();abort.abort();await assert.rejects(()=>ask({timestampSeconds:0.3},abort.signal),e=>[499,409].includes(e.status));
  const frames=join(f.directory,'production-media','owner',p.id,'frames');assert(!readdirSync(frames).some(name=>name.includes('partial')),'cancel leaves no partial preview');
  // Reopening the approved video withdraws covers/package approval and keeps the post texts (no new AI call).
  await toCoversApproved(f,p.id);assert.equal(f.run(p.id).stage,'package-review');
  await f.command(p.id,'reopen-video',{authorize:true});r=f.run(p.id);assert.deepEqual([r.stage,r.approvedVideo,r.covers.approved,r.approvedMaterials],['video-review',undefined,undefined,undefined]);
  await f.command(p.id,'captions-remove');assert.equal(f.run(p.id).outputVideo.sha256,edited.sha256);
  await assert.rejects(()=>ask({timestampSeconds:0.3}),e=>e.status===409,'no frames outside the cover stage');
  const sendsBefore=f.counts().sends;await f.command(p.id,'approve-video',{authorize:true,expectedVideo:f.run(p.id).outputVideo});await f.command(p.id,'platforms',{platforms:['Instagram','TikTok']});await waitStage(f,p.id,['covers-review']);
  r=f.run(p.id);assert.equal(r.stage,'covers-review',r.error);assert.equal(f.counts().sends,sendsBefore,'post texts reused');assert.equal(r.covers.approved,undefined,'covers need a new approval');
 }finally{await f.close()}
});

test('B05 caption burn cancel, restart and late results never offer a partial or stale video; a new edit drops old captions',async()=>{
 let hold,release;const engine={...captionEngine,renderBurnedCaptions:async options=>{if(hold)await new Promise(resolve=>release=resolve);return captionEngine.renderBurnedCaptions({...options,signal:undefined});}};
 const f=await fixture({transcriber:fakeTranscriber,captionEngine:engine});try{const p=await toVideoReview(f);const edited=f.run(p.id).outputVideo;
  await f.command(p.id,'captions-save',{baseVersion:0,srt:'1\r\n00:00:00,100 --> 00:00:01,000\r\n<i>Fala</i> importada do CapCut\r\n'});let r=f.run(p.id);const v=r.captions.versions[0];assert.deepEqual([v.origin,v.segments[0].text],['srt','Fala importada do CapCut']);
  await f.command(p.id,'captions-approve',{authorize:true,version:1,hash:v.hash,style:'highlight'});
  hold=true;await f.command(p.id,'captions-render',{authorize:true,version:1,hash:v.hash,style:'highlight'});await until(()=>release);
  await f.command(p.id,'captions-cancel');assert.equal(f.run(p.id).captions.render.status,'canceled');
  const assets=f.current().assets.length,late=release;release=undefined;late();await new Promise(resolve=>setTimeout(resolve,2500));
  assert.deepEqual([f.current().assets.length,f.run(p.id).outputVideo.sha256],[assets,edited.sha256],'a canceled burn that still finishes is discarded');
  const folder=join(f.directory,'production-media','owner',p.id,'captions');assert.deepEqual(readdirSync(folder).filter(name=>name.endsWith('.mp4')),[],'and its file removed');
  await f.command(p.id,'captions-render',{authorize:true,version:1,hash:v.hash,style:'highlight'});await until(()=>release);
  await f.reopen();assert.equal(f.run(p.id).captions.render.status,'interrupted','restart never resumes a burn silently');const stuck=release;release=undefined;stuck();await new Promise(resolve=>setTimeout(resolve,2500));assert.equal(f.run(p.id).outputVideo.sha256,edited.sha256);
  hold=false;await f.command(p.id,'captions-render',{authorize:true,version:1,hash:v.hash,style:'highlight'});await until(()=>f.run(p.id).captions.render.status!=='running');assert.equal(f.run(p.id).captions.render.status,'done',f.run(p.id).captions.render.error);
  await f.command(p.id,'revise-video',{notes:'Outro corte'});assert.equal(f.run(p.id).captions,undefined,'a new edit drops captions timed for the previous cut');
 }finally{await f.close()}
});

import {productionSnapshot,restoreProductions} from '../production-backup.mjs';
test('imported backups keep caption history but never resume caption jobs or expose frames; cover-gate runs restore',async()=>{
 let hold,release;const engine={...captionEngine,renderBurnedCaptions:async options=>{if(hold)await new Promise(resolve=>release=resolve);return captionEngine.renderBurnedCaptions({...options,signal:undefined});}};
 const f=await fixture({transcriber:fakeTranscriber,captionEngine:engine});try{const p=await toVideoReview(f);const edited=f.run(p.id).outputVideo;
  await f.command(p.id,'captions-save',{baseVersion:0,segments:[{start:0.1,end:1,text:'Fala revisada'}]});const v=f.run(p.id).captions.versions[0];
  await f.command(p.id,'captions-approve',{authorize:true,version:1,hash:v.hash,style:'classic'});hold=true;await f.command(p.id,'captions-render',{authorize:true,version:1,hash:v.hash,style:'classic'});await until(()=>release);
  const rows=productionSnapshot(f.db,'owner');restoreProductions(f.db,'owner',rows,'replace');
  let r=f.run(p.id);assert.deepEqual([r.imported,r.stage,r.captions.render.status,r.captions.versions.length],[true,'paused','interrupted',1]);
  const late=release;release=undefined;late();await new Promise(resolve=>setTimeout(resolve,2500));
  r=f.run(p.id);assert.equal(r.outputVideo.sha256,edited.sha256,'a burn that finishes after the import is discarded');
  await assert.rejects(()=>f.command(p.id,'resume',{authorize:true}),/Backup restaura histórico/);
  const gate=rows.map(row=>({...row,data_json:JSON.stringify({...JSON.parse(row.data_json),stage:'covers-review',covers:{source:edited,durationSeconds:1.5,concepts:[],brand:{theme:'dark',accent:'#2f6bff'},destinations:[],batches:{}}})}));
  restoreProductions(f.db,'owner',gate,'replace');r=f.run(p.id);assert.deepEqual([r.imported,r.stage,r.resumeStage],[true,'paused','covers-review'],'a backup taken at the cover gate restores');
  await assert.rejects(()=>f.bridge.production.coverCandidates('owner',p.id),e=>e.status===409);
 }finally{await f.close()}
});

import {recordingReady as clientRecordingReady,recordingGate} from '../src/features/production/recordingPackage.ts';
test('B07 local mode: explicit choice, approved script releases recording without any Notion job/read/card; prompts say there is no card',async()=>{
 const f=await fixture();try{
  const base={flowId:f.flow.id,topicId:f.topic.id,expectedTopic:f.topic,language:'pt-BR'};
  await assert.rejects(async()=>f.bridge.production.start('owner',{...base,requestId:'bad-mode',scriptMode:'cloud',authorize:true}),/modo Notion ou local/);
  const notionCheck=await f.bridge.production.preflight('owner',{...base,notionDestination:'12345678-1234-1234-1234-123456789abc'}),localCheck=await f.bridge.production.preflight('owner',{...base,scriptMode:'local'});
  assert.notEqual(localCheck.fingerprint,notionCheck.fingerprint,'the mode is part of the reviewed fingerprint');assert.match(localCheck.checks.find(c=>c.id==='notion-destination').message,/Modo local/);
  const p=f.bridge.production.start('owner',{...base,requestId:'local-start',scriptMode:'local',authorize:true,preflightFingerprint:localCheck.fingerprint});
  assert.equal(p.scriptMode,'local');assert.equal(p.notionDestination,undefined);
  await until(()=>['script-review','blocked'].includes(f.run(p.id).stage));let r=f.run(p.id);assert.equal(r.stage,'script-review',r.error);assert.match(r.sourceSession.messages.at(-1).content,/Modo local/);
  const v1=r.scriptVersions.at(-1);await f.command(p.id,'approve-script',{authorize:true,version:v1.version,expectedHash:v1.hash});r=f.run(p.id);
  assert.deepEqual([r.stage,r.recordingReady,r.notion,r.notionJobId],['recording',true,undefined,undefined]);assert.equal(f.counts().notionWrites,0);assert.equal(f.bridge.jobs.list('owner').length,0,'no Notion job');
  assert.equal(clientRecordingReady(r),true,'client gate agrees with the backend in local mode');
  await f.command(p.id,'recording-prep',{version:v1.version,hash:v1.hash,checklist:{framing:true}});assert.equal(f.run(p.id).recordingPrep.checklist.framing,true);
  // A new version withdraws approval and checklist; recording is blocked again until re-approval.
  await f.command(p.id,'save-script',{baseVersion:v1.version,hook:v1.hook,cta:v1.cta,path:v1.path,text:`${v1.text} Versão local revisada.`});r=f.run(p.id);
  assert.deepEqual([r.stage,r.recordingReady,r.scriptApproval,r.recordingPrep],['script-review',false,undefined,undefined]);assert.equal(recordingGate(r).ok,false);
  const v2=r.scriptVersions.at(-1);await f.command(p.id,'approve-script',{authorize:true,version:v2.version,expectedHash:v2.hash});assert.equal(f.run(p.id).stage,'recording');
  f.attach(p.id);await f.command(p.id,'video',{assetId:'original',format:'original',authorize:true});await waitStage(f,p.id,['video-review']);r=f.run(p.id);assert.equal(r.stage,'video-review',r.error);
  const editPrompt=f.prompts.find(x=>x.prompt.includes('Retorne SOMENTE JSON: {"start"')).prompt;assert.match(editPrompt,/Modo local: esta produção não tem card/);assert.doesNotMatch(editPrompt,/Card do Notion \(só referência/);
  assert.equal(f.counts().notionWrites,0,'local mode never contacts Notion');
 }finally{await f.close()}
});

test('B07 enabling Notion later is explicit, re-binds authorization and reuses the same artifact/hash (no duplicate card)',async()=>{
 const f=await fixture();try{
  const p=f.bridge.production.start('owner',{flowId:f.flow.id,topicId:f.topic.id,expectedTopic:f.topic,requestId:'local-later',scriptMode:'local',authorize:true});
  await until(()=>f.run(p.id).stage==='script-review');let r=f.run(p.id),v=r.scriptVersions.at(-1);await f.command(p.id,'approve-script',{authorize:true,version:v.version,expectedHash:v.hash});
  const dest=f.bridge.jobs.connection('owner','space').dataSourceId;
  await assert.rejects(()=>f.command(p.id,'enable-notion',{notionDestination:dest}),/Confirme o destino/);
  await assert.rejects(()=>f.command(p.id,'enable-notion',{authorize:true,notionDestination:'aaaaaaaa-1234-1234-1234-123456789abc'}),/destino Notion autorizado/);
  await f.command(p.id,'enable-notion',{authorize:true,notionDestination:dest});r=f.run(p.id);assert.deepEqual([r.scriptMode,r.notionDestination,r.recordingReady],[undefined,dest,false],'recording waits for the card in Notion mode');
  await until(()=>['recording','blocked'].includes(f.run(p.id).stage));r=f.run(p.id);assert.equal(r.stage,'recording',r.error);assert.deepEqual([r.notion.scriptHash,r.recordingReady,f.counts().notionWrites],[v.hash,true,1]);
  assert.equal(f.notionPayloads[0].id,r.draftArtifactId,'the card holds the artifact approved in local mode');
  await assert.rejects(()=>f.command(p.id,'enable-notion',{authorize:true,notionDestination:dest}),/Confirme o destino/,'already in Notion mode');
  // Re-approving the same version does not create another card.
  await f.command(p.id,'save-script',{baseVersion:v.version,hook:v.hook,cta:v.cta,path:v.path,text:v.text});await f.reopen();assert.equal(f.counts().notionWrites,1);assert.equal(f.bridge.jobs.list('owner').length,1);
  // Default/legacy start keeps Notion: same command without scriptMode behaves exactly as before.
  const legacy=f.run(p.id);assert.equal(legacy.scriptMode,undefined);
 }finally{await f.close()}
});

const analysisReply=JSON.stringify({hook:{text:'Olá, edição automática',startSeconds:0.1,endSeconds:0.8,why:'Promessa direta logo na primeira frase.'},rhythm:{pace:'fast',summary:'Fala contínua com poucas pausas.'},structure:[{label:'Gancho',startSeconds:0,endSeconds:0.8,summary:'Promessa'},{label:'Fechamento',startSeconds:0.8,endSeconds:99,summary:'Chamada'}],takeaways:['Abrir com o benefício em uma frase.'],limitations:['Sem acesso à imagem.']});
const addReference=(f,{link=false}={})=>{const s=f.current(),at=new Date().toISOString(),content={id:'ref-content',workspaceId:'space',topicId:f.topic.id,title:'Referências',format:'short-video',platforms:[],status:'planning',createdAt:at,updatedAt:at};
 s.contents.push(content);s.assets.push({id:'ref-video',workspaceId:'space',contentId:'ref-content',kind:'video',role:'source',status:'available',name:f.file.name,currentVersionId:'ref-v1',versions:[{id:'ref-v1',path:f.file.path,name:f.file.name,size:f.file.size,sha256:f.file.sha256,modifiedAt:f.file.modifiedAt,createdAt:at}],createdAt:at,updatedAt:at});
 s.inspiration={schemaVersion:1,references:[{id:'ref-1',workspaceId:'space',title:'Reel de referência',notes:'Gosto do começo',tags:['gancho'],asset:{assetId:'ref-video',name:f.file.name},metadataStatus:'not_collected',revision:1,createdAt:at,updatedAt:at},{id:'ref-link',workspaceId:'space',sourceUrl:'https://www.instagram.com/reel/abc/',sourceHost:'www.instagram.com',platform:'instagram',notes:'',tags:[],metadataStatus:'not_collected',revision:1,createdAt:at,updatedAt:at}]};
 f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(s));};
test('B09 reference analysis: only authorized local videos, one AI turn per authorization, provenance/limits kept, briefing reaches the script, cancel and backup import',async()=>{
 const f=await fixture({transcriber:fakeTranscriber});try{
  addReference(f);const a=f.bridge.analyses,base={workspaceId:'space',agentId:'source',referenceRevision:1,language:'pt-BR'};
  assert.throws(()=>a.analyze('owner',{...base,referenceId:'ref-link',requestKey:'k0',authorize:true}),/só um link/);
  assert.throws(()=>a.analyze('owner',{...base,referenceId:'ref-1',requestKey:'k1'}),/Autorize/);
  const sends=f.counts().sends;let entry=a.analyze('owner',{...base,referenceId:'ref-1',requestKey:'k1',authorize:true});
  await until(()=>a.list('owner').find(x=>x.id===entry.id).status!=='running');entry=a.list('owner').find(x=>x.id===entry.id);
  assert.equal(entry.status,'done',entry.error);assert.equal(f.counts().sends,sends+1,'exactly one AI turn');
  assert.deepEqual([entry.coverage.transcript,entry.coverage.frames,entry.source.sha256,entry.agent.id,entry.current],['local-whisper','not-sent',f.file.sha256,'source',true]);
  assert(entry.limitations.some(l=>/Nenhum quadro/.test(l)),'no visual claim');assert.equal(entry.result.structure.at(-1).endSeconds,entry.evidence.durationSeconds,'times clamped to the measured duration');
  const prompt=f.prompts.at(-1).prompt;assert.match(prompt,/Olá, edição automática/);assert.match(prompt,/NÃO vê o vídeo/);assert(!prompt.includes(f.directory),'no filesystem path in the prompt');
  assert.equal(a.analyze('owner',{...base,referenceId:'ref-1',requestKey:'k1',authorize:true}).id,entry.id,'same authorization is idempotent');assert.equal(f.counts().sends,sends+1);
  assert.throws(()=>a.analyze('owner',{...base,referenceRevision:0,referenceId:'ref-1',requestKey:'k2',authorize:true}),/referência mudou/);
  // Briefing: explicit link to an idea; the production script prompt receives it as reference data.
  a.link('owner',{analysisId:entry.id,topicId:f.topic.id});assert.match(a.briefingsFor('owner',f.topic.id)[0].text,/REFERÊNCIA ANALISADA/);
  const p=f.start();await until(()=>['script-review','blocked'].includes(f.run(p.id).stage));assert.equal(f.run(p.id).stage,'script-review',f.run(p.id).error);
  const scriptPrompt=f.prompts.find(x=>x.prompt.includes('REFERÊNCIA ANALISADA'));assert(scriptPrompt,'briefing in the script prompt');assert.deepEqual(f.run(p.id).briefingAnalysisIds,[entry.id]);
  a.unlink('owner',{analysisId:entry.id,topicId:f.topic.id});assert.deepEqual(a.briefingsFor('owner',f.topic.id),[]);assert.equal(a.list('owner')[0].briefings[0].unlinkedAt!==undefined,true,'soft unlink keeps history');
  // Editing the reference makes the analysis stale: it cannot be used until analyzed again.
  const s=f.current();s.inspiration.references[0].revision=2;s.inspiration.references[0].notes='nova nota';f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(s));
  assert.equal(a.list('owner').find(x=>x.id===entry.id).current,false);assert.throws(()=>a.link('owner',{analysisId:entry.id,topicId:f.topic.id}),/mudou/);
  // Cancel: the AI turn is stopped and the late output is never saved.
  f.hold(true);const held=a.analyze('owner',{...base,referenceRevision:2,referenceId:'ref-1',requestKey:'k3',authorize:true});
  await until(()=>a.list('owner').find(x=>x.id===held.id).call?.status==='sent');await a.cancel('owner',{analysisId:held.id});f.hold(false);
  await new Promise(resolve=>setTimeout(resolve,300));const canceled=a.list('owner').find(x=>x.id===held.id);assert.deepEqual([canceled.status,canceled.result],['canceled',undefined]);
  // Backup import: history only, never running, never usable as briefing without a new analysis.
  const snapshot=executionSnapshot(f.db,'owner');assert.equal(snapshot.referenceAnalyses.length,2);restoreExecution(f.db,'owner',snapshot,'replace');
  const imported=a.list('owner').find(x=>x.id===entry.id);assert.equal(imported.imported,true);s.inspiration.references[0].revision=1;f.db.prepare('UPDATE editorial_state SET state_json=?,revision=revision+1').run(JSON.stringify(s));
  assert.throws(()=>a.link('owner',{analysisId:entry.id,topicId:f.topic.id}),/importada/);
 }finally{await f.close()}
});

test('word-by-word captions: whisper word timings become a normal reviewable version, verbatim and libass-valid',async()=>{
 const words=[{start:0.1,end:0.3,text:'Olá,'},{start:0.32,end:0.6,text:'edição'},{start:0.62,end:0.95,text:'automática'},{start:1.0,end:1.3,text:'agora.'}];
 const transcriber={capabilities:async()=>({available:true}),transcribe:async({duration})=>({origin:'local-whisper',engine:'whisper.cpp',model:'test',language:'pt',segments:[{start:0.1,end:Math.min(1.3,duration),text:'Olá, edição automática agora.'}],speech:[{start:0.1,end:1.3}],words:words.filter(word=>word.end<=duration)})};
 const f=await fixture({transcriber});try{const p=await toVideoReview(f);
  await assert.rejects(()=>f.command(p.id,'captions-transcribe',{language:'pt',mode:'karaoke'}),/por frase ou por palavra/);
  await f.command(p.id,'captions-transcribe',{language:'pt',mode:'words'});await until(()=>f.run(p.id).captions.transcription.status!=='running');const r=f.run(p.id);
  assert.equal(r.captions.transcription.status,'done',r.captions.transcription.error);assert.equal(r.captions.transcription.mode,'words');
  const v1=r.captions.versions[0],kept=words.filter(word=>word.end<=r.captions.durationSeconds);
  assert.equal(v1.timing,'words');assert(v1.warnings.includes('word-timing')&&v1.warnings.includes('whisper-approximate'),JSON.stringify(v1.warnings));
  assert.equal(v1.segments.map(item=>item.text).join(' '),kept.map(word=>word.text).join(' '),'recognized words kept verbatim');
  assert(v1.segments.every(item=>item.text.split(' ').length<=3),JSON.stringify(v1.segments));
  captionEngine.validateCaptionSegments(v1.segments,r.captions.durationSeconds);
 }finally{await f.close();}
});
