// Agent mascots and chat attachments in the real renderer (hidden Electron, isolated SQLite fixture, simulated Codex chat; no AI
// accounts, no network). Picks a mascot look in the agent editor and saves it, attaches a real photo and a file through the "+"
// menu (host previews from chat-attachments-ipc.mjs), pastes an image, sends, and checks what the provider receives, the
// attachments in the sent message and the thinking mascot while the reply runs.
import {app,BrowserWindow,dialog,ipcMain,nativeImage} from 'electron';
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {registerChatAttachmentsIpc} from '../chat-attachments-ipc.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/mascot-attachments-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date(Date.now()-3600_000).toISOString();
const agent=(id,name,role,providerId)=>({id,name,role,instructions:'Fixture',description:role,skills:[],workspaceId,providerId,tools:['files'],status:'idle',createdAt:at,updatedAt:at});
const agents=[agent('writer','Roteirista','Roteiro','codex'),agent('editor','Editor de vídeo','Vídeo','claude'),agent('cover','Designer de capa','Capas','claude')];
const store=createDesktopStateStore(out,'test');
store.initialize(profile,{agents,workspaces:[{id:workspaceId,name:'Conteúdos',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
// A real picture on disk (gradient), and a document.
const width=320,height=200,bitmap=Buffer.alloc(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;bitmap[i]=200-y/2;bitmap[i+1]=90+x/4;bitmap[i+2]=60+y/3;bitmap[i+3]=255;}
const photo=join(out,'capa-referencia.png'),doc=join(out,'roteiro-v2.txt');
writeFileSync(photo,nativeImage.createFromBitmap(bitmap,{width,height}).toPNG());writeFileSync(doc,'Cena 1: abertura.\n');
const inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const runtime={createSession:async()=>'cli',resumeSession:async()=>{},readThread:async()=>({turns:[]}),cancel:async()=>{},send:async()=>{throw Error('No CLI run in this scenario')},events:async function*(){}};
const bridge=createContentWorkflowBridge({dbPath:join(out,'workspace-state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{throw Error('No Notion')},readCard:async()=>{throw Error('No Notion')}})});
let win;
const picks={images:[photo],files:[doc],folder:[]};
ipcMain.handle('files:select-videos',()=>[]);
registerChatAttachmentsIpc({ipcMain,dialog:{showOpenDialog:async(_window,options)=>({canceled:false,filePaths:options.properties.includes('openDirectory')?picks.folder:options.filters?picks.images:picks.files})},nativeImage,getWindow:()=>win,directory:()=>join(out,'pasted')});
const chatRuns=new Map(),sent=[];let serial=0;
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
let finish;
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path==='/api/providers/claude/usage')return json(response,{fiveHours:null,weekly:null,plan:null,observedAt:null,fetchedAt:new Date().toISOString()});
 if(path.startsWith('/api/codex/')){let input={};if(request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;input=JSON.parse(text||'{}');}
  if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path.endsWith('/usage'))return json(response,{rateLimits:null,fetchedAt:new Date().toISOString()});
  if(path==='/api/codex/sessions')return json(response,{threadId:input.threadId??`chat-thread-${++serial}`});
  if(path==='/api/codex/executions'){sent.push(input);const executionId=`chat-turn-${++serial}`,run={events:[],streams:new Set(),done:false};chatRuns.set(executionId,run);run.events.push({type:'execution.started',executionId,threadId:input.remoteSessionId});
   // The reply waits for the test, so the thinking state can be checked and captured.
   finish=()=>{emit(run,{type:'message.completed',executionId,content:'Li a capa e o roteiro. RESPOSTA_COM_ANEXOS'});emit(run,{type:'execution.completed',executionId});};return json(response,{executionId});}
  const stream=path.match(/\/executions\/([^/]+)\/events$/);if(stream){const run=chatRuns.get(stream[1]);response.setHeader('content-type','application/x-ndjson');for(const event of run.events)response.write(JSON.stringify(event)+'\n');if(run.done)response.end();else{run.streams.add(response);request.on('close',()=>run.streams.delete(response));}return;}
  return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code),log=[];
async function until(check,label='condition'){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Mascot/attachments UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function shot(name,{dark=true}={}){await js(`document.documentElement.dataset.appearance=${JSON.stringify(dark?'dark':'light')}`);writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));log.push(`${name}.png`);}
const byText=(selector,label)=>`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.trim()===${JSON.stringify(label)})`;

app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/attachments-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>js('Boolean(document.querySelector(\'[data-od-id="agent-row-writer"]\'))'),'agents page');
 // 1. Every agent without a photo already shows its mascot (default look from name and role).
 assert.equal(await js('document.querySelectorAll(".agent-avatar.agent-mascot svg.mascot-figure").length>=3'),true,'mascots by default');
 assert.equal(await js('document.querySelectorAll(".agent-avatar img").length'),0,'no photo avatars');
 // 2. Mascot editor: shape, colour, object; the preview animates; saving stores the look on the agent.
 await click('[data-od-id="agent-row-writer"] .specialist-open');
 await until(()=>js(`Boolean(${byText('button','Configurar agente')})`),'agent details');await js(`${byText('button','Configurar agente')}.click()`);
 await until(()=>js('Boolean(document.querySelector(".avatar-picker"))'),'avatar picker');
 assert.equal(await js('Boolean(document.querySelector(".avatar-picker-tile .mascot-figure.thinking"))'),true,'animated preview');
 await js(`${byText('.avatar-shapes button','Robô')}.click()`);await js(`document.querySelector('.avatar-colors button[aria-label="Rosa"]').click()`);await js(`${byText('.avatar-chips button','Megafone')}.click()`);await js(`${byText('.avatar-chips button','Feliz')}.click()`);
 await until(()=>js(`document.querySelector('.avatar-colors button[aria-label="Rosa"]').getAttribute('aria-pressed')==='true'`),'colour picked');
 await shot('01-avatar-mascot');await shot('02-avatar-mascot-light',{dark:false});
 await js(`${byText('.avatar-picker-tabs button','Foto')}.click()`);await until(()=>js('Boolean(document.querySelector(".avatar-photo-drop"))'),'photo tab');await shot('03-avatar-photo');
 await js(`${byText('.avatar-picker-tabs button','Boneco')}.click()`);await until(()=>js('Boolean(document.querySelector(".avatar-shapes"))'),'back to mascot');
 await click('.drawer-form button[type=submit]');
 await until(()=>store.read(profile,'agents')?.find(item=>item.id==='writer')?.avatarMascot,'mascot saved');
 assert.deepEqual(store.read(profile,'agents').find(item=>item.id==='writer').avatarMascot,{shape:'robot',color:'#f472b6',prop:'megaphone',mood:'happy'});
 // 3. Chat: the "+" menu attaches a photo (host preview) and a file; a pasted image is saved by the host and attached too.
 await until(()=>js(`Boolean(${byText('button','Conversar com agente')})`),'chat button');await js(`${byText('button','Conversar com agente')}.click()`);
 await until(()=>js('Boolean(document.querySelector(".composer-plus"))'),'composer plus');
 await click('.composer-plus');await until(()=>js('!document.querySelector(".composer-attach-menu").hidden'),'menu open');await shot('04-attach-menu');
 await js(`${byText('.composer-attach-menu b','Fotos e imagens')}.closest('button').click()`);
 await until(()=>js('Boolean(document.querySelector(".composer-file.kind-image img"))'),'photo with preview');
 await click('.composer-plus');await js(`${byText('.composer-attach-menu b','Arquivos do computador')}.closest('button').click()`);
 await until(()=>js('Boolean(document.querySelector(".composer-file.kind-file"))'),'file chip');
 await js(`(async()=>{const canvas=document.createElement('canvas');canvas.width=60;canvas.height=40;const c=canvas.getContext('2d');c.fillStyle='#5b8cff';c.fillRect(0,0,60,40);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'image.png',{type:'image/png'}));document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`);
 await until(()=>js('document.querySelectorAll(".composer-file").length===3'),'pasted image attached');
 assert.equal(existsSync(join(out,'pasted')),true,'pasted image saved by the host');
 await shot('05-composer-attachments');
 // 4. Sending: the provider gets each attachment as a path (kind image/file); the message shows them; the mascot thinks.
 await inputText('.composer textarea','Use a capa como referência e siga o roteiro');await click('.send-button');
 await until(()=>sent.length===1,'message sent');
 const nodes=sent[0].context.filter(item=>['image','file'].includes(item.kind));
 assert.deepEqual(nodes.map(item=>[item.kind,item.content===photo||item.content===doc||item.content.startsWith(join(out,'pasted'))]),[['image',true],['file',true],['image',true]]);
 await until(()=>js('Boolean(document.querySelector(".chat-run-status.is-live .mascot-figure.thinking"))'),'thinking mascot');
 await until(()=>js('document.querySelectorAll(".message-files .message-file").length===3'),'attachments in the sent message');
 assert.equal(await js('Boolean(document.querySelector(".conversation-avatar .mascot-figure.thinking"))'),true,'header mascot thinking');
 await js('document.querySelector(".chat-run-status").scrollIntoView({block:"center"})');await shot('06-chat-thinking');
 finish();await until(()=>js(`document.querySelector('.chat-body')?.innerText.includes('RESPOSTA_COM_ANEXOS')`),'reply');
 assert.equal(await js('Boolean(document.querySelector(".chat-message.agent-turn .message-avatar svg"))'),true,'reply shows the agent mascot');
 await shot('07-chat-reply');await shot('08-chat-reply-light',{dark:false});
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'report.json'),JSON.stringify({ok:true,screenshots:log},null,1));
 console.log(`MASCOT_ATTACHMENTS_UI_OK ${out}`);win.destroy();server.close();app.exit(0);
}catch(error){console.error(error);try{writeFileSync(join(out,'failure.png'),await captureReadyPng(win.webContents));}catch{}win?.destroy();server.close();app.exit(1);}});
