// Chat edit journey in isolated Electron, WITHOUT the Flow tab: attach a video in the Editor Claude chat, ask for the edit,
// follow progress and delivery in the same chat, ask a localized adjustment, see the window preview, undo with the keyboard,
// an ambiguous question only offers the explicit action; light/dark and 420 px. Real: renderer (isolated build), desktop
// state store, host routes, ledger, coordinator, editor tools, media executor and FFmpeg. Simulated: the model (a script on
// the real tools), chat providers (local HTTP stubs) and the motion renderer (FFmpeg boxes per scene; Remotion is proven by
// scripts/local-adjust-evidence.mjs).  Run: npx electron scripts/test-chat-edit-ui.mjs  (MAINSAGENTS_TEST_DIST = isolated build)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createEditorAuthoring} from '../editor-authoring.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
import {registerDeliveryReceiptsIpc} from '../delivery-receipts-ipc.mjs';

const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_TEST_DIST??join(root,'.mainsagents-workspaces/chat-edit-ui/dist'));
const out=resolve(root,'.mainsagents-workspaces/chat-edit-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date().toISOString(),input=join(out,'gravacao.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const ffmpeg=args=>runMediaProcess('ffmpeg',['-nostdin','-v','error','-y',...args]);
const editor={id:'editor-de-video',name:'Editor de Vídeo',role:'Vídeo',instructions:'Own role',description:'Fixture',skills:[],workspaceId,providerId:'claude',tools:['files','web-search'],status:'idle',createdAt:at,updatedAt:at};
const source={...editor,id:'conteudo',name:'Editor de Conteúdo',role:'Conteúdo',providerId:'codex',tools:['files']};
const flow={id:'flow',workspaceId,name:'Fluxo',nodes:[{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:editor.id,position:{x:80,y:140}}],edges:[],createdAt:at,updatedAt:at};
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[editor,source],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}}});
ipcMain.handle('state:getProfile',()=>profile);
for(const method of ['hasProfile','initialize','read','write','readAllVersioned','replaceAll'])ipcMain.handle(`state:${method}`,(_e,...args)=>{assert.equal(args[0],profile);return store[method](...args)});
ipcMain.on('state:writeSync',(event,p,key,value,revision)=>{try{assert.equal(p,profile);event.returnValue={saved:true,...store.write(p,key,value,revision)}}catch(error){event.returnValue={saved:false,error:error.message}}});
ipcMain.handle('inbox:notify',()=>false);
ipcMain.handle('state:checkpoint',()=>store.recoverySnapshot());
ipcMain.handle('files:select-videos',()=>[input]);

/** Motion renderer stand-in (one box per scene) and stills; frameRange honoured like the real engine. */
async function paintScenes({inputPath,outputPath,animations,frameRange,metadata}){const scenes=animations.storyboard?.scenes??[];const boxes=scenes.map(scene=>{const h=createHash('sha256').update(JSON.stringify(scene)).digest('hex');return `drawbox=x=${20+parseInt(h.slice(0,2),16)%120}:y=${20+parseInt(h.slice(2,4),16)%60}:w=120:h=80:color=0x${h.slice(4,10)}@1:t=fill:enable='between(t,${scene.start},${scene.end-0.001})'`;});const range=frameRange?['-ss',String(frameRange[0]/metadata.fps),'-t',String((frameRange[1]-frameRange[0]+1)/metadata.fps)]:[];await ffmpeg(['-i',inputPath,...(boxes.length?['-vf',boxes.join(',')]:[]),...range,'-c:v','libx264','-pix_fmt','yuv420p',...(frameRange?['-c:a','aac']:['-c:a','copy']),outputPath]);}
async function stills({inputPath,outDir,animations,sceneIds,metadata}){await mkdir(outDir,{recursive:true});const fps=metadata.fps,scenes=(animations.storyboard?.scenes??[]).filter(scene=>!sceneIds||sceneIds.includes(scene.id));const list=[];for(const [i,scene] of scenes.entries()){const path=join(outDir,`s-${i}.jpg`);await ffmpeg(['-ss',String((scene.start+scene.end)/2),'-i',inputPath,'-frames:v','1',path]);for(const moment of ['entrada','meio','saida'])list.push({sceneId:scene.id,moment,seconds:(scene.start+scene.end)/2,frame:Math.round((scene.start+scene.end)/2*fps),path});}const sheet=join(outDir,'sheet.jpg');await copyFile(list[0].path,sheet);return {stills:list,contactSheets:[{path:sheet}],storyboard:{qa:{ok:true}}};}
const scenes=out=>[{id:'abertura',name:'Abertura',start:0,end:2,camera:{layout:'full'},layers:[{id:'t',type:'text',text:'Como editar rápido',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},{id:'metodo',name:'Método',start:2,end:4,camera:{layout:'full'},layers:[{id:'p',type:'text',text:'Corte as pausas',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},{id:'final',name:'Final',start:4,end:out,camera:{layout:'full'},layers:[{id:'c',type:'text',text:'Siga para mais',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]}];
async function finalize(call,revision){let result=await call('finalize',{revision,summary:'ok'});for(let i=0;i<600&&result.structuredContent?.status==='pending';i++){await new Promise(r=>setTimeout(r,100));result=await call('export_status');}return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};}
const scripts=[
 async call=>{const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[1]});const saved=await call('write_plan',{baseRevision:0,plan:{segments:[{start:0,end:context.metadata.duration}],storyboard:{version:1,timeline:{basis:'output'},style:{treatment:'creator'},scenes:scenes(context.metadata.duration)}}});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;const preview=await call('render_preview',{revision,start:0,duration:3});await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1]});await call('storyboard_stills',{revision});return finalize(call,revision);},
 async call=>{const context=(await call('get_context')).structuredContent;await call('get_frames',{target:'source',times:[3]});const plan=structuredClone(context.currentPlan);plan.storyboard.scenes.find(item=>item.id==='metodo').layers=[{id:'cmp',type:'compare',slot:'center',start:0.1,end:1.8,before:{label:'Antes',text:'manual'},after:{label:'Depois',text:'com app'},source:'design'}];const saved=await call('write_plan',{baseRevision:0,plan});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;const preview=await call('render_preview',{revision,start:1.5,duration:3});await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1]});await call('storyboard_stills',{revision});return finalize(call,revision);},
];
const fullEditorScript=scripts[0];
const authoring=createEditorAuthoring(),editorRuns=new Map();let execution=0;
const claudeEditor={openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),cancel:async()=>{},
 async send(_t,_c,agent){const id=`editor-exec-${++execution}`;editorRuns.set(id,agent);return {executionId:id};},
 async *events(id){const agent=editorRuns.get(id),queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);let report;try{report=await scripts.shift()((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}for(const event of queue)yield event;yield {type:'message.completed',content:JSON.stringify(report)};yield {type:'execution.completed'};}};
const newBridge=()=>createContentWorkflowBridge({dbPath:join(out,'workspace-state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getChatRuntime:provider=>provider==='claude'?claudeEditor:null,inspect,mediaOptions:{inspect,animate:paintScenes,animationCapabilities:async()=>({available:true}),stills}});
let bridge=newBridge();
registerDeliveryReceiptsIpc({ipcMain,shell:{openPath:async()=>{throw Error('No external apps in QA')},showItemInFolder:()=>{throw Error('No Explorer in QA')}},getWindow:()=>win,getReceipts:()=>bridge.receipts,getCurrentProfile:()=>profile});

const chatSends=[],streams=new Map();let serial=0,win;
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
async function body(req){let data='';for await(const chunk of req)data+=chunk;return data?JSON.parse(data):{}}
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=url.pathname,provider=path.startsWith('/api/codex')?'codex':path.startsWith('/api/providers/claude')?'claude':null;
 if(provider){const local=path.replace(provider==='codex'?'/api/codex':'/api/providers/claude','');
  if(local==='/health'||local==='/status')return json(res,{providerId:provider,ready:true,status:'connected',state:'connected',authMode:'cli',accountType:'chatgpt'});
  if(local==='/models')return json(res,{models:[{id:'cl-model',name:'Claude fixture model'}]});
  if(local.endsWith('/images'))return json(res,{events:[]});
  if(local==='/sessions'||local.endsWith('/resume')){const input=await body(req);const remote=input.threadId??`${provider}-remote-${++serial}`;return json(res,provider==='codex'?{threadId:remote}:{remoteSessionId:remote})}
  if(local==='/executions'){const input=await body(req),id=`${provider}-execution-${++serial}`;chatSends.push({provider,input,id});return json(res,{executionId:id,remoteSessionId:input.remoteSessionId,threadId:input.threadId})}
  if(local.endsWith('/events')){const id=local.split('/')[2];res.setHeader('content-type','application/x-ndjson');res.write(JSON.stringify({type:'execution.started',executionId:id})+'\n');res.end(JSON.stringify({type:'message.completed',executionId:id,content:'Posso analisar o vídeo; para editar de verdade use o botão abaixo.'})+'\n'+JSON.stringify({type:'execution.completed',executionId:id})+'\n');return}
  return json(res,{});
 }
 if(await bridge.handle(req,res,url))return;
 if(path.startsWith('/api/'))return json(res,{ready:false,state:'not-installed',sessions:[],jobs:[],actions:[],models:[]});
 const file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch(error){res.statusCode=500;json(res,{error:error.message})}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,ms=60000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50))}throw Error('Chat edit UI timed out')}
async function shot(name,selector){if(selector)await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).at(-1)?.scrollIntoView({block:'center'})`);writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
const cardText=()=>js('Array.from(document.querySelectorAll(".chat-edit-card")).map(el=>el.innerText).join("\\n---\\n")');
async function type(value){await js(`(()=>{const el=document.querySelector('.composer textarea');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);}
async function enter(){await js('document.querySelector(".composer textarea").focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});}
async function noOverflow(){return js('document.documentElement.scrollWidth<=innerWidth+1&&Array.from(document.querySelectorAll(".chat-edit-card,.composer-attachments,.chat-adjust-preview")).every(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=-1})');}
async function openChat(name='Editor de Vídeo'){const selector=`.agent-nav[title="${name}"]`;await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))'));}
async function open(name){win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:resolve(root,'desktop-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await openChat(name);}

app.whenReady().then(async()=>{const report={};try{
 await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await open();
 // 1) Attach with the button (native picker) and send with Enter: the engine starts, no chat turn is sent.
 await js('document.querySelector(".composer-attach").click()');await until(()=>js('document.querySelector(".composer-attachments")?.innerText.includes("gravacao.mp4")'));
 await type('Pode editar este vídeo com motion explicativo?');await shot('01-anexo-e-pedido-claro');await enter();
 await until(async()=>/Planejando cortes e motion|Exportando o vídeo editado|Vídeo editado entregue/.test(await cardText()));report.progress=await cardText();
 await until(async()=>(await cardText()).includes('Vídeo editado entregue'));await until(()=>js('Boolean(document.querySelector(".delivery-receipt"))'));
 assert.equal(chatSends.length,0,'an explicit edit request is not sent to the chat model');assert.match(await cardText(),/Editor de Vídeo \(Claude Code\)/);
 await shot('02-edicao-entregue-claro');
 console.log('UI: edit delivered with a real receipt');
 // 2) Localized adjustment typed in the same chat: preview of the window, then the new version with the same audio.
 await type('Entre 2 e 4 segundos troque a animação por uma comparação');await enter();
 await until(()=>js('Boolean(document.querySelector(".chat-adjust-preview video"))'),120000);await until(async()=>(await cardText()).includes('Ajuste aplicado em 2,0–4,0 s'),120000);
 report.adjust=await cardText();assert.match(report.adjust,/Áudio idêntico ao da versão anterior/);await until(()=>js('document.querySelector(".chat-adjust-preview video")?.readyState>=1'));await shot('03-ajuste-com-previa-claro','.chat-adjust-preview');
 // 3) Keyboard: Tab-focusable undo, activated with Enter.
 await js(`(()=>{const target=Array.from(document.querySelectorAll('.chat-edit-card button')).find(b=>b.textContent.includes('Voltar à versão anterior'));const controls=Array.from(document.querySelectorAll('button,a[href],input,textarea,select,summary,[tabindex]')).filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);controls[controls.indexOf(target)-1].focus()})()`);
 win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
 assert.equal(await js('document.activeElement?.textContent'),'Voltar à versão anterior');
 win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
 await until(async()=>(await cardText()).includes('Versão anterior restaurada'));
 console.log('UI: window preview, adjusted receipt and keyboard undo verified');
 // 4) An ambiguous question goes to the chat model and only OFFERS the explicit action.
 await js('document.querySelector(".composer-attach").click()');await until(()=>js('Boolean(document.querySelector(".composer-attachments"))'));
 await type('Esse vídeo precisa de edição');await enter();await until(()=>js('Boolean(document.querySelector(".chat-edit-cta button"))'));
 await until(()=>chatSends.length===1);assert.equal(chatSends[0].provider,'claude');assert.equal(bridge.production.list(profile).length,1,'no new run from a mention');
 await shot('04-pergunta-ambigua-cta-claro');
 const beforeCta=execution;scripts.push(fullEditorScript);
 await js('document.querySelector(".chat-edit-cta button").click()');
 await until(()=>execution===beforeCta+1);
 await until(()=>bridge.production.list(profile)[0].stage==='video-review');
 await until(()=>js('document.querySelectorAll(".delivery-receipt").length===3'));
 assert.equal(bridge.production.list(profile).length,1,'CTA records a real request on this content without duplicating the run');
 report.cta={editorTurns:execution-beforeCta,realRequest:store.read(profile,'sessions').some(s=>s.messages.some(m=>m.chatEdit&&m.content==='Editar este vídeo'))};assert.equal(report.cta.realRequest,true);
 // 5) A Codex source chat uses the same real Claude director; delivery stays in its own chat/content.
 await openChat('Editor de Conteúdo');await js('document.querySelector(".composer-attach").click()');await until(()=>js('Boolean(document.querySelector(".composer-attachments"))'));
 scripts.push(fullEditorScript);await type('Edite este vídeo no chat Codex');await enter();
 await until(async()=>/Planejando cortes e motion|Exportando o vídeo editado|Vídeo editado entregue/.test(await cardText()));report.codexProgress=await cardText();
 await until(async()=>(await cardText()).includes('Vídeo editado entregue'));await until(()=>js('document.querySelectorAll(".delivery-receipt").length===1'));
 assert.equal(bridge.production.list(profile).length,2);assert.equal(await js('document.querySelector(".chat-body").innerText.includes("Pode editar este vídeo com motion explicativo?")'),false,'another content never leaks into this chat');
 const codexRun=bridge.production.list(profile).find(r=>r.sourceAgent.id===source.id);assert.equal(codexRun.editDirector.provider,'claude');
 await shot('05-codex-entrega-mesmo-chat');
 // 6) Cancel an adjustment in this chat and reject the model callback that arrives afterwards.
 let release;const gate=new Promise(r=>release=r);let late;
 scripts.push(async call=>{await gate;late=await call('get_context');return {status:'not-finalized',finalRevision:0,summary:'canceled',limitations:[]}});
 await type('Entre 4 e 6 segundos troque o título final');await enter();await until(()=>js('Array.from(document.querySelectorAll(".chat-edit-card button")).some(b=>b.textContent==="Cancelar ajuste")'));
 await js('Array.from(document.querySelectorAll(".chat-edit-card button")).find(b=>b.textContent==="Cancelar ajuste").click()');await until(async()=>(await cardText()).includes('Ajuste cancelado'));release();await until(()=>late);assert.equal(late.isError,true);
 assert.equal(bridge.production.list(profile).find(r=>r.id===codexRun.id).outputVideo.sha256,codexRun.outputVideo.sha256);await shot('06-codex-ajuste-cancelado');
 // Host + renderer restart on the same isolated SQLite files; no personal run is resumed or resubmitted.
 const beforeRestart=execution;await js('window.mainsAgentsDesktop.state.saveCheckpoint()');win.destroy();await bridge.close();bridge=newBridge();await open('Editor de Conteúdo');
 await until(async()=>(await cardText()).includes('Ajuste cancelado'));assert.equal(execution,beforeRestart);report.restart={newEditorTurns:execution-beforeRestart};
 await openChat();
 // 5) Dark appearance and a 420 px window.
 await js('localStorage.setItem("mainsagents-appearance","dark")');await win.webContents.reload();await openChat();
 await until(async()=>(await cardText()).includes('Versão anterior restaurada'));assert.equal(await js('document.documentElement.dataset.appearance'),'dark');await shot('05-escuro','.chat-edit-card');
 win.setContentSize(420,860);await until(()=>js('innerWidth<=430'));await until(noOverflow);assert.equal(await js('document.querySelector(".chat-layer").getBoundingClientRect().width>=innerWidth-2'),true,'mobile chat fills the available width');await shot('06-escuro-420px','.chat-edit-card');
 await js('localStorage.setItem("mainsagents-appearance","light")');await win.webContents.reload();await openChat();await until(noOverflow);assert.equal(await js('document.documentElement.dataset.appearance'),'light');await shot('07-claro-420px','.chat-edit-card');
 assert.deepEqual(errors,[]);
 report.runs=bridge.production.list(profile).map(run=>({stage:run.stage,adjustments:run.localAdjustments?.map(item=>item.status),director:run.editDirector}));report.chatSends=chatSends.length;report.out=out;
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,1));console.log('CHAT_EDIT_UI_OK',out);
 win.destroy();await bridge.close();store.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(String(await js('document.body.innerText')).slice(0,3000));await shot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}});
