import assert from 'node:assert/strict';
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createEditorAuthoring} from '../editor-authoring.mjs';
import {createProductionFlow} from '../src/features/flows/flowModel.ts';

/**
 * Real host path of an edit requested IN A CHAT: saved sessions/messages (the host reads them), the real bridge routes,
 * chat-edit-requests ledger, production coordinator, editor-authoring tools, editor host and media executor, with FFmpeg for
 * real. Declared simulations: the model is a SCRIPT calling the real tools (no CLI, no inference); the motion renderer is an
 * FFmpeg stub that paints one box per storyboard scene (colour = hash of that scene's data), so a changed scene changes those
 * frames and an identical scene paints identical boxes; Remotion itself is proven elsewhere.
 */
export const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
export const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
export async function until(check,ms=90000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw Error('timed out');}
export const ffmpeg=args=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-y',...args]);

/** Stand-in for Remotion: one coloured box per scene, visible only inside that scene's window. Audio is copied. */
async function paintScenes({inputPath,outputPath,animations,frameRange,metadata,screenPath}){
 const scenes=animations.storyboard?.scenes??[];
 // Camera + screen: the stub composites the REAL cut screen track in the left half wherever the composition has screen
 // (windows), so frames prove both sources; Remotion's own composition is proven by the real-render evidence script.
 if(screenPath&&animations.screen){
  const windows=animations.screen.windows.map(item=>`between(t,${item.start},${item.end-0.001})`).join('+')||'0';
  const range=frameRange?['-ss',String(frameRange[0]/metadata.fps),'-t',String((frameRange[1]-frameRange[0]+1)/metadata.fps)]:[];
  await ffmpeg(['-i',inputPath,'-i',screenPath,'-filter_complex',`[1:v]scale=${Math.floor(metadata.width/4)*2}:-2[s];[0:v][s]overlay=x=0:y=0:enable='${windows}'[v]`,'-map','[v]','-map','0:a?',...range,'-c:v','libx264','-pix_fmt','yuv420p',...(frameRange?['-c:a','aac']:['-c:a','copy']),outputPath]);
  return;
 }
 const boxes=scenes.map(scene=>{const h=createHash('sha256').update(JSON.stringify(scene)).digest('hex');return `drawbox=x=${20+parseInt(h.slice(0,2),16)%120}:y=${20+parseInt(h.slice(2,4),16)%60}:w=120:h=80:color=0x${h.slice(4,10)}@1:t=fill:enable='between(t,${scene.start},${scene.end-0.001})'`;});
 // A preview renders only its frame range (as the real engine does); timestamps of the boxes stay on the edited timeline.
 const range=frameRange?['-ss',String(frameRange[0]/metadata.fps),'-t',String((frameRange[1]-frameRange[0]+1)/metadata.fps)]:[];
 await ffmpeg(['-i',inputPath,...(boxes.length?['-vf',boxes.join(',')]:[]),...range,'-c:v','libx264','-pix_fmt','yuv420p',...(frameRange?['-c:a','aac']:['-c:a','copy']),outputPath]);
}
async function stillsStub({inputPath,outDir,animations,frames,sceneIds,metadata}){
 await mkdir(outDir,{recursive:true});
 const fps=metadata.fps,scenes=(animations.storyboard?.scenes??[]).filter(scene=>!sceneIds||sceneIds.includes(scene.id));
 const picks=frames?frames.map(frame=>({frame,sceneId:null,moment:'manual'})):scenes.flatMap(scene=>[['entrada',scene.start+0.05],['meio',(scene.start+scene.end)/2],['saida',Math.max(scene.start,scene.end-0.1)]].map(([moment,t])=>({frame:Math.round(t*fps),sceneId:scene.id,moment})));
 const stills=[];for(const [index,pick] of picks.entries()){const path=join(outDir,`still-${index}.jpg`);await ffmpeg(['-ss',String(pick.frame/fps),'-i',inputPath,'-frames:v','1',path]);stills.push({...pick,seconds:pick.frame/fps,path});}
 const sheet=join(outDir,'sheet.jpg');await copyFile(stills[0].path,sheet);
 return {stills,contactSheets:[{path:sheet}],storyboard:{qa:{ok:true}}};
}
/** Claude runtime whose "model" is a queue of scripts calling the REAL editor-authoring tools. */
function scriptedClaude(authoring,scripts){
 const runs=new Map();let n=0;const sends=[];
 return {sends,
  openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),
  async send(_thread,content,agent){const id=`claude-exec-${++n}`;sends.push({content,editorSessionId:agent.editorSessionId,providerId:agent.providerId});runs.set(id,{agent});return {executionId:id};},
  async *events(id){
   const {agent}=runs.get(id);
   if(!agent.editorSessionId){yield {type:'message.completed',content:'{}'};yield {type:'execution.completed'};return;}
   const queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);
   const script=scripts.shift();assert.ok(script,'no editor script queued for this Claude turn');
   let report;try{report=await script((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}
   for(const event of queue)yield event;
   // A script may end its turn the way the provider would on a usage limit (structured execution.failed), after real tool calls.
   if(report?.__fail){yield {type:'execution.failed',executionId:id,...report.__fail};return;}
   yield {type:'message.completed',content:JSON.stringify(report)};yield {type:'execution.completed'};
  },
  cancel:async()=>{},
 };
}
export const sceneDefs=out=>[
 {id:'abertura',name:'Abertura',start:0,end:2,camera:{layout:'full'},layers:[{id:'titulo',type:'text',text:'Como editar rápido',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},
 {id:'metodo',name:'Método',start:2,end:4,camera:{layout:'full'},layers:[{id:'passo',type:'text',text:'Corte as pausas',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},
 {id:'final',name:'Final',start:4,end:out,camera:{layout:'full'},layers:[{id:'cta',type:'text',text:'Siga para mais',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]}];
const storyboardOf=scenes=>({version:1,title:'Edição explicativa',timeline:{basis:'output'},style:{treatment:'creator'},scenes});
/** Finalize then follow the export (as a model would). */
export async function finalizeAndWait(call,revision,log){
 let result=await call('finalize',{revision,summary:'ok'});log?.push({tool:'finalize',status:result.structuredContent?.status,error:result.isError?result.content[0].text:undefined});
 for(let i=0;i<600&&result.structuredContent?.status==='pending';i++){await new Promise(r=>setTimeout(r,100));result=await call('export_status');}
 log?.push({tool:'export_status',status:result.structuredContent?.status});
 return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};
}
/** A whole-video authored edit: look at the source, write 3 scenes, preview, inspect every scene, finalize once. */
export const fullEditScript=(log,{segments,cutDecisions,storyboard,before}={})=>async call=>{
 const context=(await call('get_context')).structuredContent;log.push({tool:'get_context',context});
 if(before)await before(call,context);
 await call('get_frames',{target:'source',times:[0.5,3]});
 const segs=segments??[{start:0,end:context.metadata.duration}],out=segs.reduce((sum,item)=>sum+item.end-item.start,0);
 const saved=await call('write_plan',{baseRevision:0,plan:{segments:segs,storyboard:storyboard?.(out)??storyboardOf(sceneDefs(out))},...(cutDecisions?{cutDecisions}:{})});
 assert.notEqual(saved.isError,true,saved.content[0].text);log.push({tool:'write_plan',result:saved.structuredContent});
 const {revision}=saved.structuredContent;
 const preview=await call('render_preview',{revision,start:0,duration:3});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[0.5]});
 const stills=await call('storyboard_stills',{revision});assert.notEqual(stills.isError,true,stills.content[0].text);
 return finalizeAndWait(call,revision,log);
};

/** media: real engine options (e.g. createRemotionAnimator()) instead of the FFmpeg stub, for evidence scripts. */
export async function chatEditFixture({transcriber,editorProvider='claude',secondEditor=false,withFlow=true,media}={}){
 const directory=mkdtempSync(join(tmpdir(),'chat-edit-')),dbPath=join(directory,'state.sqlite'),input=join(directory,'gravacao.mp4'),other=join(directory,'outra-gravacao.mp4');
 await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
 await ffmpeg(['-f','lavfi','-i','smptebars=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',other]);
 const at=new Date().toISOString(),base={workspaceId:'space',instructions:'Own role',createdAt:at,updatedAt:at};
 const agents=[{...base,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',providerId:'codex',tools:['files','subagents']},{...base,id:'editor-de-video-1',name:'Editor de Vídeo',role:'Vídeo',providerId:editorProvider,tools:['files','web-search']},...(secondEditor?[{...base,id:'editor-de-video-2',name:'Editor de Vídeo B',role:'Vídeo',providerId:'claude',tools:['files']}]:[])];
 const sessions=[];
 let serial=0;
 const codex={providerId:'codex',capabilities:{reconcile:true},createSession:async()=>`thread-${++serial}`,connect:async()=>`thread-${++serial}`,resumeSession:async()=>{},readThread:async()=>({turns:[]}),cancel:async()=>{},sends:[],
  async send(){const id=`execution-${++serial}`;this.sends.push(id);return {executionId:id}},events:async function*(){yield {type:'message.completed',content:'{}'};yield {type:'execution.completed'}}};
 const log=[],scripts=[];let authoring=createEditorAuthoring(),claude=scriptedClaude(authoring,scripts);
 const flows=withFlow?[createProductionFlow('space','Fluxo',agents.filter(agent=>agent.id!=='editor-de-video-2'))]:[];
 const mediaOptions={...(transcriber?{transcriber}:{}),inspect,...(media??{animate:paintScenes,animationCapabilities:async()=>({available:true}),stills:stillsStub})};
 const makeBridge=()=>createContentWorkflowBridge({dbPath,getCurrentProfile:()=>'owner',getAgents:()=>agents,getFlows:()=>({flows}),getSessions:()=>sessions,getRuntime:()=>codex,getChatRuntime:provider=>provider==='claude'?claude:codex,inspect,mediaOptions,timeoutMs:120000});
 let bridge=makeBridge();
 const db=new DatabaseSync(dbPath);
 /** A saved chat and a saved user message, as the renderer persists them before asking the host. */
 const chat=(id,agentId,{providerId,contentId}={})=>{let session=sessions.find(item=>item.id===id);if(!session){session={id,agentId,providerId:providerId??agents.find(agent=>agent.id===agentId).providerId,...(contentId?{contentId}:{}),title:'Conversa',messages:[],createdAt:at,updatedAt:at};sessions.push(session);}return session;};
 const say=(sessionId,content,attachments=[])=>{const session=sessions.find(item=>item.id===sessionId),id=`message-${randomUUID()}`;session.messages.push({id,type:'message',role:'user',content,createdAt:new Date().toISOString(),...(attachments.length?{attachments:attachments.map(path=>({kind:'video',path,name:path.split(/[\\/]/).pop()}))}:{}),chatEdit:{kind:'edit'}});return id;};
 /** A saved message with a camera+screen pair: roles chosen per attachment, voice/layout options as the composer saves them. */
 const sayPair=(sessionId,content,{camera,screen,voice,layout='camera-corner',roles=['camera','screen']}={})=>{const session=sessions.find(item=>item.id===sessionId),id=`message-${randomUUID()}`;session.messages.push({id,type:'message',role:'user',content,createdAt:new Date().toISOString(),attachments:[{kind:'video',path:camera,name:camera.split(/[\/]/).pop(),...(roles[0]?{role:roles[0]}:{})},{kind:'video',path:screen,name:screen.split(/[\/]/).pop(),...(roles[1]?{role:roles[1]}:{})}],sourcePair:{...(voice?{voice}:{}),layout},chatEdit:{kind:'edit'}});return id;};
 const admit=(sessionId,messageId,extra={})=>bridge.chatEdits.admit('owner',{requestId:randomUUID(),sessionId,messageId,...extra});
 const runs=()=>bridge.production.list('owner');
 const delivered=runId=>until(()=>{const p=bridge.production.get('owner',runId);return p?.stage==='video-review'&&p.outputVideo&&!['planning','rendering'].includes(p.localAdjust?.status)?p:null;});
 const fixture={directory,input,other,bridge,db,claude,codex,scripts,log,agents,sessions,chat,say,sayPair,admit,runs,delivered,close:async()=>{await bridge.close();db.close();},
  /** App restart: the host closes (automatic stages pause), a NEW bridge, editor-authoring and Claude runtime open the same files. */
  async reopen(){await bridge.close();authoring=createEditorAuthoring();const sends=claude.sends;claude=scriptedClaude(authoring,scripts);claude.sends.push(...sends);bridge=makeBridge();fixture.bridge=bridge;fixture.claude=claude;return fixture;}};
 return fixture;
}
