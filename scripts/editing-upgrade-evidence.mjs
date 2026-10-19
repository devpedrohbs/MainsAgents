// Evidência REAL do pipeline integrado de edição (C, 2026-10-12), com fixtures SINTÉTICAS (nunca vídeo pessoal):
//   node scripts/editing-upgrade-evidence.mjs [demoId ...]
// Caminho completo do app: content-workflow-bridge -> production-coordinator (entrada gravada OU handoff do chat) ->
// diretor Claude Code com as ferramentas mainsagents_editor (editor-authoring REAL, B) -> editor-host (C) -> mídia local:
// Whisper local REAL, FFmpeg REAL, stills/prévia/MP4 final com Remotion REAL (A) -> recibo do host com caminho absoluto.
// Simulado e declarado: as chamadas de ferramenta do "modelo" são um roteiro que reproduz os storyboards que o Claude
// autorou na rodada A (docs/analysis/editing-ai-motion-engine-2026-10-12/storyboards); nenhuma inferência nova é feita.
// Fontes: %TEMP%/mainsagents-storyboard-demo (gerado por scripts/storyboard-demo.mjs prepare). Saída: docs/analysis/editing-ai-upgrade-2026-10-12.
import {copyFile,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {probeVideo,runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createEditorAuthoring} from '../editor-authoring.mjs';
import {createRemotionAnimator} from '../editorial-animate.mjs';
import {createWhisperTranscriber} from '../editorial-transcribe.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.join(os.tmpdir(),'mainsagents-storyboard-demo'),stories=path.join(root,'docs','analysis','editing-ai-motion-engine-2026-10-12','storyboards');
const out=path.join(root,'docs','analysis','editing-ai-upgrade-2026-10-12'),work=path.join(os.tmpdir(),'mainsagents-editing-upgrade');
const inspect=file=>inspectLocalAsset(file,{stabilityMs:0});
const sha=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Three motion approaches x two themes; two entry routes of the real app (recorded entry in the production UI, chat handoff). */
export const DEMOS=[
 {id:'edicao-creator-9x16',subject:'edicao',story:'edicao-creator-9x16',format:'portrait',route:'recorded'},
 {id:'juros-editorial-16x9',subject:'juros',story:'juros-editorial-16x9',format:'original',route:'recorded',userImage:true},
 {id:'juros-technical-9x16',subject:'juros',story:'juros-technical-9x16',format:'portrait',route:'recorded',userImage:true},
 {id:'edicao-handoff-16x9',subject:'edicao',story:'edicao-creator-9x16',format:'original',route:'handoff'},
];

/** Claude chat runtime whose turn is a replay script calling the REAL editor-authoring tools (same attach/subscribe as the bridge). */
function replayClaude(authoring,script){
 const runs=new Map();let n=0;
 return {sends:[],
  openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),
  async send(_thread,content,agent){const id=`claude-replay-${++n}`;this.sends.push({editorSessionId:agent.editorSessionId,providerId:agent.providerId,promptChars:content.length});runs.set(id,agent);return {executionId:id};},
  async *events(id){
   const agent=runs.get(id);if(!agent.editorSessionId){yield {type:'message.completed',content:'{}'};yield {type:'execution.completed'};return;}
   const queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);
   let report;try{report=await script((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}
   for(const event of queue)yield event;
   yield {type:'message.completed',content:JSON.stringify(report)};yield {type:'execution.completed'};
  },
  cancel:async()=>{},
 };
}

/** What the editor did and saw: tool, short result text and the images it received (saved for the reviewer). */
function recorder(dir){
 const log=[];let images=0;
 return {log,async call(call,name,args){
  const started=Date.now(),result=await call(name,args),blocks=(result.content??[]).filter(block=>block.type==='image');
  const saved=[];for(const block of blocks.slice(0,16)){const file=path.join(dir,'seen',`${String(++images).padStart(2,'0')}-${name}.${block.mimeType==='image/png'?'png':'jpg'}`);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.from(block.data,'base64'));saved.push(path.relative(dir,file).replaceAll('\\','/'));}
  log.push({tool:name,ms:Date.now()-started,isError:result.isError===true,text:String(result.content?.find(block=>block.type==='text')?.text??'').slice(0,600),images:saved});
  return result;
 }};
}

async function runDemo(demo){
 const dir=path.join(work,demo.id),evidence=path.join(out,demo.id);await rm(dir,{recursive:true,force:true});await rm(evidence,{recursive:true,force:true});await mkdir(dir,{recursive:true});await mkdir(evidence,{recursive:true});
 const fixture=JSON.parse(await readFile(path.join(fixtures,demo.subject,'words.json'),'utf8')),story=JSON.parse(await readFile(path.join(stories,`${demo.story}.json`),'utf8'));
 const video=path.join(dir,`gravacao-${demo.subject}.mp4`);await copyFile(path.join(fixtures,demo.subject,'source.mp4'),video);
 const image=demo.userImage?path.join(dir,'planilha.png'):null;if(image)await copyFile(path.join(fixtures,demo.subject,'planilha.png'),image);
 const originalSha=await sha(video),dbPath=path.join(dir,'state.sqlite'),at=new Date().toISOString();
 const base={workspaceId:'space',instructions:'Papel e skills do próprio agente.',providerId:'codex',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',tools:['files','subagents']},{...base,id:'editor-de-video',name:'Editor de Vídeo',role:'Vídeo',tools:['files']}];
 const flow=createProductionFlow('space','Criação de conteúdo',agents);
 const sessions=[{id:'chat-1',agentId:'conteudo',providerId:'codex',title:fixture.title,...(demo.route==='recorded'?{contentId:'content-1',topicId:'topic-1'}:{}),messages:[],createdAt:at,updatedAt:at}];
 const codex={providerId:'codex',capabilities:{reconcile:true},createSession:async()=>'codex-thread',connect:async()=>'codex-thread',resumeSession:async()=>{},readThread:async()=>({turns:[]}),cancel:async()=>{},send:async()=>{throw Error('Codex is not asked to edit in this evidence (Claude directs).');},events:async function*(){}};
 const rec=recorder(evidence),authoring=createEditorAuthoring();
 const script=async call=>{
  const context=(await rec.call(call,'get_context')).structuredContent;
  await rec.call(call,'get_frames',{target:'source',times:[1,Math.round(context.metadata.duration/2)]});
  let storyboard=structuredClone(story.storyboard);
  let saved=await rec.call(call,'write_plan',{baseRevision:0,plan:{segments:fixture.segments,normalizeAudio:true,storyboard},note:`Storyboard ${demo.story} autorado pelo Claude (rodada A).`});
  // Like a model reading the host's refusal: a layer refused by QA (e.g. over the caption band in another frame shape)
  // moves to the top slot, once. Declared replay rule, not inference.
  const refused=[...String(saved.content?.[0]?.text??'').matchAll(/QA ([\w-]+)\/([\w-]+): (\w+)/g)];
  if(saved.isError&&refused.length){for(const [,sceneId,layerId] of refused){const layer=storyboard.scenes.find(scene=>scene.id===sceneId)?.layers.find(item=>item.id===layerId);if(layer?.box)layer.box={...layer.box,y:0.24,h:0.26};else if(layer)layer.slot='top';}
   rec.log.push({tool:'(replay correction)',text:`raised/shrank or moved to top: ${refused.map(match=>`${match[1]}/${match[2]}`).join(', ')}`});
   saved=await rec.call(call,'write_plan',{baseRevision:0,plan:{segments:fixture.segments,normalizeAudio:true,storyboard},note:'Correção após QA do host.'});}
  if(saved.isError)return {status:'not-finalized',finalRevision:0,summary:'plano recusado',limitations:[saved.content[0].text.slice(0,180)]};
  const {revision,scenes}=saved.structuredContent;
  const preview=await rec.call(call,'render_preview',{revision,start:Math.max(0,scenes[1]?.start-1||0),duration:8});
  if(!preview.isError)await rec.call(call,'get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1,4,7]});
  await rec.call(call,'storyboard_stills',{revision});
  let result=await rec.call(call,'finalize',{revision,summary:`Cortes da fala + storyboard ${story.storyboard.style?.treatment} (${scenes.length} cenas).`});
  for(let i=0;i<900&&result.structuredContent?.status==='pending';i++){await sleep(2000);result=await call('export_status');}
  rec.log.push({tool:'export_status',status:result.structuredContent?.status,text:String(result.content?.[0]?.text??'').slice(0,300)});
  return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};
 };
 const claude=replayClaude(authoring,script);
 const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows:[flow]}),getSessions:()=>sessions,getRuntime:()=>codex,getChatRuntime:provider=>provider==='claude'?claude:codex,inspect,mediaOptions:{inspect,transcriber:createWhisperTranscriber(),...createRemotionAnimator()},timeoutMs:60*60*1000});
 const db=new DatabaseSync(dbPath),started=Date.now();
 try{
  let runId;
  if(demo.route==='recorded'){
   const file=await inspect(video),assets=[{id:'video-1',workspaceId:'space',contentId:'content-1',kind:'video',role:'source',status:'available',name:file.name,currentVersionId:'v-1',versions:[{id:'v-1',path:file.path,name:file.name,size:file.size,sha256:file.sha256,modifiedAt:file.modifiedAt,createdAt:at}],createdAt:at,updatedAt:at}];
   if(image){const img=await inspect(image);assets.push({id:'image-1',workspaceId:'space',contentId:'content-1',kind:'image',role:'reference',status:'available',name:'Planilha do usuário.png',currentVersionId:'i-1',versions:[{id:'i-1',path:img.path,name:img.name,size:img.size,sha256:img.sha256,modifiedAt:img.modifiedAt,createdAt:at}],createdAt:at,updatedAt:at});}
   const topic={id:'topic-1',workspaceId:'space',requestId:'topic-1',inputKind:'text',input:fixture.title,priority:'normal',status:'draft',title:fixture.title,category:'Gravação',summary:'Gravação sintética',whyItMatters:'Evidência',angles:[],sources:[],factualQuestions:[],contentId:'content-1',createdAt:at,updatedAt:at};
   const content={id:'content-1',workspaceId:'space',topicId:'topic-1',title:fixture.title,format:'short-video',platforms:[],status:'planning',productionStage:'recording',taskId:'task-1',assetIds:assets.map(a=>a.id),createdAt:at,updatedAt:at};
   db.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run('owner',1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[content],artifacts:[],approvals:[],runs:[],assets,publications:[]}),at);
   const context=`${fixture.brief}${image?' Imagem: Planilha do usuário.':''}`;
   runId=(await bridge.production.start('owner',{requestId:`evidence-${demo.id}`,entry:'recorded',flowId:flow.id,contentId:'content-1',sourceSessionId:'chat-1',assetId:'video-1',context:{kind:'text',text:context},format:demo.format,editMode:'smart',motion:'balanced',authorize:true})).id;
  }else{
   const result=bridge.delegations.dispatch({profileId:'owner',agentId:'conteudo',sessionId:'chat-1'},{threadId:'source-thread',turnId:'turn-1',callId:'call-1',arguments:{targetAgentId:'editor-de-video',title:fixture.title,instructions:`Edite este vídeo com cortes e motion explicativo. Roteiro: ${fixture.brief}`,files:[video]}},{targets:[{id:'editor-de-video'}]});
   const settled=await result;rec.log.push({tool:'(handoff result to the source LLM)',text:String(settled.content).slice(0,600),success:settled.success});
   runId=bridge.production.list('owner')[0]?.id;
  }
  let p;for(;;){p=bridge.production.get('owner',runId);if(!p||['video-review','blocked','paused','canceled'].includes(p.stage))break;if(Date.now()-started>60*60*1000)throw Error('timeout');await sleep(1500);}
  const receipt=[...(p?.editorSession?.messages??[])].reverse().flatMap(m=>m.receipts??[])[0];
  const report={demo,route:demo.route,stage:p?.stage,error:p?.error,seconds:Math.round((Date.now()-started)/1000),director:{sends:claude.sends.length,providerId:claude.sends[0]?.providerId},original:{path:video,sha256:originalSha,untouched:await sha(video)===originalSha},tools:rec.log,
   editPlan:p?.editPlan&&{authoring:p.editPlan.authoring,planHash:p.editPlan.planHash,sourceDuration:p.editPlan.sourceDuration,outputDuration:p.editPlan.outputDuration,removedSeconds:p.editPlan.removedSeconds,cuts:p.editPlan.cuts,scenes:p.editPlan.plan?.storyboard?.scenes?.length,treatment:p.editPlan.plan?.storyboard?.style?.treatment},
   messages:(p?.editorSession?.messages??[]).filter(m=>m.role==='agent').map(m=>({id:m.id,content:m.content,receipts:m.receipts?.length??0}))};
  if(receipt){
   const probe=await probeVideo(receipt.path,{ffprobe:'ffprobe',run:runMediaProcess});
   report.receipt={...receipt,verifiedNow:(await sha(receipt.path))===receipt.sha256};report.output={width:probe.width,height:probe.height,fps:probe.fps,duration:probe.duration,hasAudio:probe.hasAudio};
   await copyFile(receipt.path,path.join(evidence,'final.mp4'));
   const scenes=p.editPlan.plan.storyboard?.scenes??[],times=scenes.map(scene=>(scene.start+scene.end)/2);
   for(const [index,time] of times.entries())await runMediaProcess('ffmpeg',['-nostdin','-v','error','-y','-ss',time.toFixed(3),'-i',receipt.path,'-frames:v','1','-vf','scale=540:-2',path.join(evidence,`final-scene${index+1}.jpg`)]);
   await runMediaProcess('ffmpeg',['-nostdin','-v','error','-y','-i',receipt.path,'-vf',`fps=${Math.min(2,12/probe.duration)},scale=240:-2,tile=6x2:padding=6:margin=6:color=0x202020`,'-frames:v','1',path.join(evidence,'final-contact.jpg')]);
  }
  await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,1));
  return report;
 }finally{await bridge.close();db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!existsSync(path.join(fixtures,'edicao','words.json')))throw Error(`Fixtures ausentes em ${fixtures}: rode node scripts/storyboard-demo.mjs prepare.`);
 const wanted=process.argv.slice(2),summary=[];
 for(const demo of DEMOS.filter(item=>!wanted.length||wanted.includes(item.id))){
  console.log(`[evidence] ${demo.id} (${demo.route}, ${demo.format})...`);
  try{const report=await runDemo(demo);summary.push({id:demo.id,route:demo.route,stage:report.stage,seconds:report.seconds,scenes:report.editPlan?.scenes,treatment:report.editPlan?.treatment,output:report.output,receipt:report.receipt&&{path:report.receipt.path,sha256:report.receipt.sha256,version:report.receipt.version,producedBy:report.receipt.producedBy},originalUntouched:report.original.untouched,error:report.error});console.log(`[evidence] ${demo.id}: ${report.stage} ${report.receipt?.path??report.error??''}`);}
  catch(error){summary.push({id:demo.id,error:error.message});console.log(`[evidence] ${demo.id} FAILED: ${error.message}`);}
 }
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,1));
 if(summary.some(item=>item.stage!=='video-review'))process.exitCode=1;
}
