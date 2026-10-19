// Camera + screen and provider-wait journey in isolated Electron, from the chat (no Flow tab):
//  1) Editor (Claude) chat: attach two videos, mark Câmera/Tela (keyboard), choose the layout, send; the app MEASURES the
//     offset, edits and delivers in the same chat with the pair line.
//  2) Codex content chat: a pair without common audio asks for a manual offset (convention + 6 s check preview), then the
//     Claude director hits a usage limit after real work: the card shows what is kept/left and "Retomar", the composer shows
//     the provider notice; host + renderer restart keeps the wait without any new turn; Retomar (keyboard) continues and delivers.
//  3) Dark and 420 px.
// Real: renderer (isolated build), desktop preload/state store, host routes, ledger, local sync measurement, coordinator,
// editor tools, media executor and FFmpeg. Simulated: the model (scripts on the real tools; the limit is the structured event
// the Claude bridge publishes), chat providers (local HTTP stubs) and the motion renderer (FFmpeg composite of the REAL cut
// screen track; Remotion is proven by scripts/camera-screen-evidence.mjs).
//   npx electron scripts/test-camera-screen-ui.mjs   (MAINSAGENTS_TEST_DIST = isolated renderer build)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {createEditorAuthoring} from '../editor-authoring.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
import {registerDeliveryReceiptsIpc} from '../delivery-receipts-ipc.mjs';
import {pairFixture} from '../tests/pair-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_TEST_DIST??join(root,'.mainsagents-workspaces/camera-screen-ui/dist'));
const out=resolve(root,'.mainsagents-workspaces/camera-screen-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const profile='pair-test',workspaceId='space',at=new Date().toISOString(),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
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
let picked=[];ipcMain.handle('files:select-videos',()=>picked);

/** Motion renderer stand-in: composites the REAL cut screen track (left) where the composition has screen; audio copied. */
async function paint({inputPath,outputPath,animations,frameRange,metadata,screenPath}){
 const range=frameRange?['-ss',String(frameRange[0]/metadata.fps),'-t',String((frameRange[1]-frameRange[0]+1)/metadata.fps)]:[];
 if(screenPath&&animations.screen){const windows=animations.screen.windows.map(item=>`between(t,${item.start},${item.end-0.001})`).join('+')||'0';
  await ffmpeg(['-i',inputPath,'-i',screenPath,'-filter_complex',`[1:v]scale=${Math.floor(metadata.width/4)*2}:-2[s];[0:v][s]overlay=x=0:y=0:enable='${windows}'[v]`,'-map','[v]','-map','0:a?',...range,'-c:v','libx264','-pix_fmt','yuv420p',...(frameRange?['-c:a','aac']:['-c:a','copy']),outputPath]);return;}
 await ffmpeg(['-i',inputPath,...range,'-c:v','libx264','-pix_fmt','yuv420p',...(frameRange?['-c:a','aac']:['-c:a','copy']),outputPath]);
}
async function stills({inputPath,outDir,animations,sceneIds,metadata}){await mkdir(outDir,{recursive:true});const scenes=(animations.storyboard?.scenes??[]).filter(scene=>!sceneIds||sceneIds.includes(scene.id));const list=[];for(const [i,scene] of scenes.entries()){const path=join(outDir,`s-${i}.jpg`);await ffmpeg(['-ss',String((scene.start+scene.end)/2),'-i',inputPath,'-frames:v','1',path]);for(const moment of ['entrada','meio','saida'])list.push({frame:Math.round((scene.start+scene.end)/2*metadata.fps),sceneId:scene.id,moment,seconds:(scene.start+scene.end)/2,path});}return {stills:list,contactSheets:list.length?[{path:list[0].path}]:[],storyboard:{qa:{ok:true}}};}
const scenes=[{id:'tela-camera',name:'Tela e câmera',start:0,end:2,screen:'with-camera',layers:[{id:'t1',type:'text',text:'Abertura',role:'title',slot:'top',start:0.1,end:1.8,source:'design'}]},
 {id:'so-tela',name:'Só a tela',start:2,end:4,screen:'full',layers:[]},{id:'final',name:'Final',start:4,end:11,screen:'with-camera',layers:[]}];
const segments=[{start:3,end:8},{start:12,end:18}];
async function finalize(call,revision){let result=await call('finalize',{revision,summary:'ok'});for(let i=0;i<600&&result.structuredContent?.status==='pending';i++){await new Promise(r=>setTimeout(r,100));result=await call('export_status');}return {status:result.structuredContent?.status==='succeeded'?'finalized':'not-finalized',finalRevision:revision,summary:'ok',limitations:[]};}
const seen=[];
/** Full pair edit; with limit=true it stops with the provider's structured usage-limit failure after real work. */
const pairEdit=({limit=false}={})=>async call=>{
 const context=(await call('get_context')).structuredContent;seen.push(context.screenRecording);
 await call('get_frames',{target:'source',times:[4,13]});await call('get_frames',{target:'screen',times:[4,13]});
 const saved=await call('write_plan',{baseRevision:0,plan:{segments,storyboard:{version:1,timeline:{basis:'output'},style:{treatment:'technical'},scenes}}});assert.notEqual(saved.isError,true,saved.content[0].text);const {revision}=saved.structuredContent;
 const preview=await call('render_preview',{revision,start:0,duration:4});assert.notEqual(preview.isError,true,preview.content[0].text);
 await call('get_frames',{target:{previewId:preview.structuredContent.previewId},times:[1]});
 if(limit){state.previewId=preview.structuredContent.previewId;state.revision=revision;return {__fail:{code:'provider_limit',message:'Claude Code recusou por limite de uso temporário.',retryable:false,limit:{kind:'rate-limit',resetsAt:null,evidence:{source:'rate_limit_event',value:'rejected',at:new Date().toISOString()}}}};}
 await call('storyboard_stills',{revision});return finalize(call,revision);
};
const state={};
const resumeScript=async call=>{await call('get_context');const frames=await call('get_frames',{target:{previewId:state.previewId},times:[2]});assert.notEqual(frames.isError,true,frames.content[0].text);await call('storyboard_stills',{revision:state.revision});return finalize(call,state.revision);};
const scripts=[];let authoring=createEditorAuthoring(),execution=0;const editorRuns=new Map();
const claudeEditor={openEditorSession:options=>authoring.open(options),editorCheckpoint:id=>authoring.checkpoint(id),closeEditorSession:(id,reason)=>authoring.close(id,reason),forgetEditorSession:id=>authoring.forget(id),cancel:async()=>{},
 async send(_t,_c,agent){const id=`editor-exec-${++execution}`;editorRuns.set(id,agent);return {executionId:id};},
 async *events(id){const agent=editorRuns.get(id),queue=[],unsubscribe=authoring.subscribe(agent.editorSessionId,event=>queue.push({...event,executionId:id})),token=authoring.attach(agent.editorSessionId,id);let report;try{const script=scripts.shift();assert.ok(script,'no editor script queued');report=await script((name,args={})=>authoring.call(token,name,args));}finally{authoring.detach(agent.editorSessionId);unsubscribe();}
  for(const event of queue)yield event;if(report?.__fail){yield {type:'execution.failed',executionId:id,...report.__fail};return;}yield {type:'message.completed',executionId:id,content:JSON.stringify(report)};yield {type:'execution.completed',executionId:id};}};
const newBridge=()=>createContentWorkflowBridge({dbPath:join(out,'workspace-state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getChatRuntime:provider=>provider==='claude'?claudeEditor:null,inspect,mediaOptions:{inspect,animate:paint,animationCapabilities:async()=>({available:true}),stills},timeoutMs:120000});
let bridge=newBridge(),win;
registerDeliveryReceiptsIpc({ipcMain,shell:{openPath:async()=>{throw Error('No external apps in QA')},showItemInFolder:()=>{throw Error('No Explorer in QA')}},getWindow:()=>win,getReceipts:()=>bridge.receipts,getCurrentProfile:()=>profile});

const chatSends=[];let serial=0;
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
async function body(req){let data='';for await(const chunk of req)data+=chunk;return data?JSON.parse(data):{}}
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=url.pathname,provider=path.startsWith('/api/codex')?'codex':path.startsWith('/api/providers/claude')?'claude':null;
 if(provider){const local=path.replace(provider==='codex'?'/api/codex':'/api/providers/claude','');
  if(local==='/health'||local==='/status')return json(res,{providerId:provider,ready:true,status:'connected',state:'connected',authMode:'cli',accountType:'chatgpt'});
  if(local==='/models')return json(res,{models:[{id:'model',name:'Fixture model'}]});
  if(local.endsWith('/images'))return json(res,{events:[]});
  if(local==='/sessions'||local.endsWith('/resume')){const input=await body(req);const remote=input.threadId??`${provider}-remote-${++serial}`;return json(res,provider==='codex'?{threadId:remote}:{remoteSessionId:remote})}
  if(local==='/executions'){const input=await body(req),id=`${provider}-execution-${++serial}`;chatSends.push({provider,input,id});return json(res,{executionId:id})}
  if(local.endsWith('/events')){const id=local.split('/')[2];res.setHeader('content-type','application/x-ndjson');res.end(JSON.stringify({type:'message.completed',executionId:id,content:'ok'})+'\n'+JSON.stringify({type:'execution.completed',executionId:id})+'\n');return;}
  return json(res,{});
 }
 if(await bridge.handle(req,res,url))return;
 if(path.startsWith('/api/'))return json(res,{ready:false,state:'not-installed',sessions:[],jobs:[],actions:[],models:[]});
 const file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch(error){res.statusCode=500;json(res,{error:error.message})}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,ms=90000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,60))}throw Error('Camera/screen UI timed out')}
async function shot(name,selector){if(selector)await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).at(-1)?.scrollIntoView({block:'center'})`);writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
const cardText=()=>js('Array.from(document.querySelectorAll(".chat-edit-card")).map(el=>el.innerText).join("\\n---\\n")');
async function type(value){await js(`(()=>{const el=document.querySelector('.composer textarea');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);}
const key=code=>{win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode:code});if(code==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'\r'});if(code==='Space')win.webContents.sendInputEvent({type:'char',keyCode:' '});win.webContents.sendInputEvent({type:'keyUp',keyCode:code});};
async function enter(){await js('document.querySelector(".composer textarea").focus()');key('Enter');}
async function noOverflow(){return js('document.documentElement.scrollWidth<=innerWidth+1&&Array.from(document.querySelectorAll(".chat-edit-card,.composer-attachments,.composer-pair,.composer-provider-wait,.chat-edit-sync,.chat-edit-wait")).every(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=-1})');}
async function openChat(name='Editor de Vídeo'){const selector=`.agent-nav[title="${name}"]`;await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))'));}
async function open(name){win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:resolve(root,'desktop-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await openChat(name);}
/** Marks a role with the KEYBOARD: focus the radio of that video/role and press Space. */
async function role(name,which){await js(`(()=>{const row=Array.from(document.querySelectorAll('.composer-pair-row')).find(el=>el.querySelector('span').textContent===${JSON.stringify(name)});const input=Array.from(row.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(which)})).querySelector('input');input.focus()})()`);key('Space');
 await until(()=>js(`Array.from(document.querySelectorAll('.composer-pair-row')).find(el=>el.querySelector('span').textContent===${JSON.stringify(name)})?.querySelector('.composer-role.is-on')?.textContent===${JSON.stringify(which)}`));}
const select=(index,value)=>js(`(()=>{const el=document.querySelectorAll('.composer-pair-options select')[${index}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}))})()`);

app.whenReady().then(async()=>{const report={};try{
 const pos=await pairFixture(out,{offsetSeconds:2.4,cameraSeconds:26,screenSeconds:26,name:'aula'}),neg=await pairFixture(out,{offsetSeconds:-1.7,cameraSeconds:20,screenSeconds:26,noAudio:'camera',name:'demo'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await open();
 // 1) Claude editor chat: two videos, roles by keyboard, layout, send with Enter: measured offset, delivery with the pair line.
 picked=[pos.camera,pos.screen];await js('document.querySelector(".composer-attach").click()');await until(()=>js('document.querySelectorAll(".composer-pair-row").length===2'));
 await type('Edite este vídeo tech com a tela');await shot('01-par-sem-papeis-claro','.composer-pair');
 await role('aula-camera.mp4','Câmera');await until(()=>js('Boolean(document.querySelector(".composer-pair-hint"))'));
 await enter();await new Promise(r=>setTimeout(r,500));assert.equal(bridge.production.list(profile).length,0,'a half-marked pair never starts');
 assert.equal(await js('document.querySelector(".composer textarea").value'),'Edite este vídeo tech com a tela','the message stays in the composer');
 await role('aula-screen.mkv','Tela');await until(()=>js('document.querySelectorAll(".composer-pair-options select").length===2'));await select(1,'alternate');
 await shot('02-papeis-e-layout-claro','.composer-pair');
 scripts.push(pairEdit());await enter();
 await until(async()=>/Medindo o atraso|Planejando cortes|Exportando o vídeo|Vídeo editado entregue/.test(await cardText()));report.progress=await cardText();
 await until(async()=>(await cardText()).includes('Vídeo editado entregue'),180000);await until(()=>js('Boolean(document.querySelector(".delivery-receipt"))'));
 const card1=await cardText();report.pairCard=card1;assert.match(card1,/Câmera: aula-camera\.mp4 · Tela: aula-screen\.mkv · voz: câmera · alternar · A tela começa 2,[34]\d s depois da câmera\. \(medido no áudio comum\)/);
 assert.equal(chatSends.length,0,'the edit request is not a chat turn');assert.equal(await js('document.querySelector(".chat-message-attachments").innerText.includes("Câmera")'),true);
 const first=bridge.production.list(profile)[0];assert.equal(first.sourcePair.layout,'alternate');assert.equal(first.sourcePair.sync.origin,'measured');assert.ok(seen[0]?.screen,'the director saw the screen facts');
 await shot('03-par-entregue-claro','.chat-edit-card');
 console.log('UI: measured pair delivered');
 // 2) Codex chat: no common audio -> manual offset with the check preview; then a usage limit after real work.
 await openChat('Editor de Conteúdo');picked=[neg.camera,neg.screen];await js('document.querySelector(".composer-attach").click()');await until(()=>js('document.querySelectorAll(".composer-pair-row").length===2'));
 await role('demo-camera.mp4','Câmera');await role('demo-screen.mkv','Tela');await type('Edite este vídeo tech');await enter();
 await until(async()=>(await cardText()).includes('Sem áudio comum para medir o atraso'));
 await js(`(()=>{const el=document.querySelector('.chat-edit-sync input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'-1,7');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await until(()=>js('document.querySelector(".chat-edit-sync").innerText.includes("A tela começa 1,70 s antes da câmera.")'));
 await js('Array.from(document.querySelectorAll(".chat-edit-sync button")).find(b=>b.textContent.includes("Prévia")).click()');await until(()=>js('document.querySelector(".chat-edit-sync video")?.readyState>=1'),120000);
 await shot('04-atraso-manual-previa-claro','.chat-edit-sync');
 scripts.push(pairEdit({limit:true}));
 await js('Array.from(document.querySelectorAll(".chat-edit-sync button")).find(b=>b.textContent==="Usar este atraso").click()');
 await until(async()=>(await cardText()).includes('Aguardando limite de uso do Claude Code'),180000);
 const waitCard=await cardText();report.waitCard=waitCard;assert.match(waitCard,/Horário de liberação desconhecido/);assert.match(waitCard,/Concluído e guardado/);assert.match(waitCard,/Exportação final/);
 assert.equal(await js('Boolean(document.querySelector(".composer-provider-wait"))'),false,'this Codex chat is not affected by the Claude wait');
 await shot('05-aguardando-limite-claro','.chat-edit-card');
 // The Claude chat shows the provider notice (manual messages stay possible: an explicit choice of the person).
 await openChat('Editor de Vídeo');await until(()=>js('Boolean(document.querySelector(".composer-provider-wait"))'),30000);report.composerNotice=await js('document.querySelector(".composer-provider-wait").innerText');
 assert.match(report.composerNotice,/Claude Code está com limite de uso desde .*Horário de liberação desconhecido/);await shot('05b-aviso-chat-claude','.composer-provider-wait');
 await openChat('Editor de Conteúdo');await until(async()=>(await cardText()).includes('Aguardando limite de uso do Claude Code'));
 // Restart host + renderer on the same isolated files: the wait survives, no new editor turn, nothing resumes alone.
 const turns=execution;await js('window.mainsAgentsDesktop.state.saveCheckpoint()');win.destroy();await bridge.close();authoring=createEditorAuthoring();bridge=newBridge();await open('Editor de Conteúdo');
 await until(async()=>(await cardText()).includes('Aguardando limite de uso do Claude Code'));await new Promise(r=>setTimeout(r,1500));assert.equal(execution,turns,'no turn after restart');report.restart={newTurns:execution-turns};
 // Retomar with the keyboard (Tab from the previous control, Enter).
 scripts.push(resumeScript);
 await js(`(()=>{const target=Array.from(document.querySelectorAll('.chat-edit-card button')).find(b=>b.textContent==='Retomar');const controls=Array.from(document.querySelectorAll('button,a[href],input,textarea,select,summary,[tabindex]')).filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);controls[controls.indexOf(target)-1].focus()})()`);
 key('Tab');assert.equal(await js('document.activeElement?.textContent'),'Retomar');key('Enter');
 await until(async()=>(await cardText()).includes('Vídeo editado entregue'),180000);
 const card2=await cardText();report.resumedCard=card2;assert.match(card2,/A tela começa 1,70 s antes da câmera\. \(manual, não verificado pelo app\)/);assert.match(card2,/voz: tela/);
 const second=bridge.production.list(profile).find(run=>run.sourceAgent.id===source.id);assert.equal(second.authoring.waitResumes,1);assert.equal(second.editDirector.provider,'claude');
 await shot('06-retomado-entregue-claro','.chat-edit-card');
 await openChat('Editor de Vídeo');await until(()=>js('!document.querySelector(".composer-provider-wait")'),30000);await openChat('Editor de Conteúdo');
 // 3) Dark and 420 px.
 await js('localStorage.setItem("mainsagents-appearance","dark")');await win.webContents.reload();await openChat('Editor de Conteúdo');
 await until(async()=>(await cardText()).includes('Vídeo editado entregue'));assert.equal(await js('document.documentElement.dataset.appearance'),'dark');await shot('07-escuro','.chat-edit-card');
 win.setContentSize(420,860);await until(()=>js('innerWidth<=430'));picked=[pos.camera,pos.screen];await js('document.querySelector(".composer-attach").click()');await until(()=>js('document.querySelectorAll(".composer-pair-row").length===2'));
 await until(noOverflow);await shot('08-escuro-420px-par','.composer-pair');
 await js('localStorage.setItem("mainsagents-appearance","light")');await win.webContents.reload();await openChat('Editor de Conteúdo');await until(noOverflow);await shot('09-claro-420px','.chat-edit-card');
 assert.deepEqual(errors,[]);
 report.runs=bridge.production.list(profile).map(run=>({stage:run.stage,pair:run.sourcePair&&{voice:run.sourcePair.voice,layout:run.sourcePair.layout,sync:run.sourcePair.sync},waitResumes:run.authoring?.waitResumes??0,director:run.editDirector}));report.chatSends=chatSends.length;report.editorTurns=execution;report.out=out;
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,1));console.log('CAMERA_SCREEN_UI_OK',out);
 win.destroy();await bridge.close();store.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(String(await js('document.body.innerText')).slice(0,3000));await shot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}});
