// Delivered-file QA (real Electron/React UI): a real fixture video (FFmpeg) gets its receipt from the REAL host registry
// (content bridge + SQLite) and REAL receipts IPC; the LLM turns of the finished edit are declared chat fixtures (no model, no
// render: the edit pipeline itself is covered by the engine suites). Checks that the source chat and the editor chat show the
// receipt of the SAME file (name, full absolute path, size, sha256, version, Claude director), that copy/open/show use the
// host-verified receipt (mock clipboard/shell, nothing visible), that a changed or moved file is reported and never opened,
// that a chat claim without a receipt is never shown as a delivery, and whether a media-export receipt surface exists.
// Isolated profile + SQLite in a throwaway folder, window show:false/offscreen, every dialog intercepted. No AI, no network, no cost.
// Usage: npx electron scripts/test-editing-delivery-ui.mjs [--asar <app.asar>] [--dist <ui dir>] [--out <dir>] [--require-media-export]
//   env: MAINSAGENTS_DELIVERY_ASAR, MAINSAGENTS_UI_DIST, MAINSAGENTS_DELIVERY_OUT, MAINSAGENTS_DELIVERY_REQUIRE_MEDIA_EXPORT=1
//   source mode loads the app modules from this checkout and serves ./dist; asar mode loads them (and <asar>/dist) from the release.
import electron from 'electron';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,renameSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep,join,basename,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,nativeImage}=electron;
const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;},flag=name=>process.argv.includes(name);
const root=resolve(import.meta.dirname,'..'),asar=arg('--asar')??process.env.MAINSAGENTS_DELIVERY_ASAR,mode=asar?'asar':'source';
const modules=asar?resolve(asar):root,dist=resolve(root,arg('--dist')??process.env.MAINSAGENTS_UI_DIST??(asar?join(modules,'dist'):'dist'));
const strictMediaExport=flag('--require-media-export')||process.env.MAINSAGENTS_DELIVERY_REQUIRE_MEDIA_EXPORT==='1';
const out=resolve(root,arg('--out')??process.env.MAINSAGENTS_DELIVERY_OUT??join('.mainsagents-workspaces/editing-delivery-ui',`${mode}-${Date.now()}`));
const temp=resolve(process.env.TEMP??process.env.TMPDIR??'/tmp');
// Every write/move of this run stays inside its own output folder (under the workdir or the system temp).
const inside=path=>{const full=resolve(path);assert(full.startsWith(out+sep),`Refusing to touch a file outside the QA folder: ${full}`);assert(out.startsWith(root+sep)||out.startsWith(temp+sep),`QA folder must be inside the workdir or temp: ${out}`);return full;};
// Setup failures (missing build, missing ffmpeg, refused receipt) end the run with the same FAIL marker instead of a hung app.
const fatal=error=>{console.error(`EDITING_DELIVERY_UI_FAIL (${mode}): ${error?.message??error}`);app.exit(1);process.exit(1);},need=(ok,message)=>{if(!ok)fatal(message);};
mkdirSync(out,{recursive:true});inside(join(out,'x'));app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
if(asar)need(existsSync(modules),`app.asar not found: ${modules}`);need(existsSync(join(dist,'app.html')),`UI not built: ${join(dist,'app.html')}`);
const uiBundle=readdirSync(join(dist,'assets')).filter(f=>f.endsWith('.js')).map(f=>readFileSync(join(dist,'assets',f),'utf8')).join('\n');
need(uiBundle.includes('delivery-receipt-path'),`The UI in ${dist} has no delivery receipt card (DeliveryReceiptCard). Build the current UI first.`);
const load=name=>import(pathToFileURL(join(modules,name)).href);
const [{createDesktopStateStore},{createContentWorkflowBridge},{registerEditorialFilesIpc},{runMediaProcess},{inspectLocalAsset},receiptsIpc]=await Promise.all(['desktop-state-store.mjs','content-workflow-bridge.mjs','editorial-files-ipc.mjs','editorial-media.mjs','editorial-local-files.mjs','delivery-receipts-ipc.mjs'].map(load)).catch(fatal);

// --- Guards: nothing reaches the user's desktop, clipboard or default apps. ---
const intercepted=[],shellCalls=[],clipboardCalls=[];
for(const name of ['showOpenDialog','showOpenDialogSync','showSaveDialog','showSaveDialogSync','showMessageBox','showMessageBoxSync','showErrorBox','showCertificateTrustDialog'])try{dialog[name]=(...args)=>{intercepted.push({dialog:name,args:JSON.stringify(args.filter(a=>!(a instanceof BrowserWindow))).slice(0,300)});if(name.endsWith('Sync'))return name.startsWith('showOpen')?undefined:0;return Promise.resolve(name==='showMessageBox'?{response:0,checkboxChecked:false}:{canceled:true,filePaths:[]});};}catch{/* read-only export */}
for(const name of ['openPath','openExternal','showItemInFolder','trashItem','beep','writeShortcutLink'])try{shell[name]=(...args)=>{intercepted.push({shell:name,args});return name==='openPath'?Promise.resolve(''):name==='openExternal'||name==='trashItem'?Promise.resolve():false;};}catch{}
for(const name of ['writeText','writeHTML','writeImage','writeBuffer','write','clear'])try{clipboard[name]=(...args)=>{clipboardCalls.push({name,args:args.map(String)})};}catch{}
const shellMock={openPath:async path=>{shellCalls.push({action:'openPath',path});return '';},showItemInFolder:path=>{shellCalls.push({action:'showItemInFolder',path});}};

// --- Isolated workspace (throwaway profile + SQLite). Declared fixtures: the chat messages below stand in for the LLM turns
// of a finished edit; the FILE is real (FFmpeg, inside the QA folder) and its receipt is issued by the REAL host registry. ---
const profile='delivery-qa',workspaceId='space',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),fixture=join(out,'Entrega QA - video final v1.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const source={id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Fixture',description:'Fixture',skills:[],workspaceId,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at},editor={...source,id:'editor',name:'Editor de Vídeo',role:'Vídeo',providerId:'claude'};
let win;
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>null /* no LLM runtime in this QA scenario */,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{throw Error('No card may be written in this scenario')},readCard:async()=>{throw Error('No card is read in this scenario')}})});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();
await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-c:a','aac',inside(fixture)]).catch(fatal);
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex'),fixtureSha=sha(fixture);
const receipt=await bridge.receipts.issue(profile,{source:{kind:'production-video',id:'qa-run',step:'epoch-1'},contentId:'qa-content',workspaceId,sessionId:'source-chat',path:fixture,expectedSha256:fixtureSha,label:'Vídeo final',producedBy:{agentName:editor.name,providerId:'claude'}}).catch(fatal);
// Content with a real source video (for the REAL media-export engine) and a real file an agent "delivers" manually.
const recording=join(out,'Gravacao QA.mp4'),manualFile=join(out,'Entrega manual QA.mp4');
for(const [file,freq] of [[recording,330],[manualFile,550]])await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=48000`,'-t','2','-c:v','libx264','-c:a','aac',inside(file)]).catch(fatal);
const rec=await inspect(recording),contentId='qa-content';
const topic={id:'qa-topic',workspaceId,requestId:'qa',inputKind:'text',input:'Entrega QA',title:'Entrega QA',category:'Vídeo',summary:'QA fixture',whyItMatters:'QA fixture',angles:[],sources:[],factualQuestions:[],priority:'medium',status:'approved',contentId,createdAt:at,updatedAt:at};
const content={id:contentId,workspaceId,topicId:topic.id,title:'Entrega QA',format:'short-video',platforms:[],status:'planning',productionStage:'editing',taskId:'qa-task',assetIds:['qa-asset'],createdAt:at,updatedAt:at};
const asset={id:'qa-asset',workspaceId,contentId,kind:'video',role:'source',name:rec.name,currentVersionId:'qa-v1',versions:[{id:'qa-v1',path:rec.path,name:rec.name,size:rec.size,sha256:rec.sha256,modifiedAt:rec.modifiedAt,createdAt:at}],status:'available',checkedAt:rec.checkedAt,createdAt:at,updatedAt:at};
{const db=new DatabaseSync(dbPath);db.prepare('UPDATE editorial_state SET state_json=? WHERE profile_id=?').run(JSON.stringify({schemaVersion:1,topics:[topic],contents:[content],artifacts:[],approvals:[],runs:[],assets:[asset],publications:[]}),profile);db.close();}
const editorialRevision=()=>{const db=new DatabaseSync(dbPath);try{return db.prepare('SELECT revision FROM editorial_state WHERE profile_id=?').get(profile).revision;}finally{db.close();}};
const deliveryText=`Vídeo exportado e verificado: ${receipt.name}\nAbra o arquivo e aprove esta versão, ou peça ajustes.`;
const chat=(id,agentId,title,messages)=>({id,agentId,providerId:agentId==='editor'?'claude':'codex',title,messages,createdAt:at,updatedAt:at});
const msg=(id,role,content,extra={})=>({id,type:'message',role,content,createdAt:at,...(role==='agent'?{deliveryState:'completed'}:{}),...extra});
const sourceChat=chat('source-chat','source','Entrega QA',[msg('s-u','user','Edite o vídeo gravado e me entregue o arquivo final.'),msg('s-a','agent',deliveryText,{receipts:[receipt]})]);
const editorChat=chat('editor-chat','editor','Entrega QA · edição',[msg('e-u','user','Edite o vídeo conforme o plano aprovado.'),msg('e-a','agent',deliveryText,{receipts:[receipt]})]);
// A chat that CLAIMS a delivery with no host receipt: must never look delivered.
const fakePath='C:\\Users\\qa\\Videos\\entrega-inventada-final.mp4';
const manualChat={...chat('manual-chat','source','Entrega manual',[msg('m-u','user','Exporte e me entregue o arquivo.'),msg('m-a','agent',JSON.stringify({kind:'files',summary:'Vídeo final exportado.',files:[{path:manualFile,caption:'Corte final'}]}))]),contentId};
const claim=chat('claim','source','Conversa sem recibo',[msg('c-u','user','Me entregue o vídeo final'),msg('c-a','agent',`Pronto! O vídeo final foi exportado em ${fakePath}`)]);
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[claim,sourceChat,editorChat,manualChat],'current-workspace':workspaceId,'active-sessions':{source:'claim',editor:'editor-chat'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>{intercepted.push({dialog:'files:select'});return {canceled:true,filePaths:[]};}},shell:shellMock,getWindow:()=>win,getStore:()=>store});
need(typeof receiptsIpc.registerDeliveryReceiptsIpc==='function',`${mode} build has no delivery-receipts-ipc`);
receiptsIpc.registerDeliveryReceiptsIpc({ipcMain,shell:shellMock,getWindow:()=>win,getReceipts:()=>bridge.receipts,getCurrentProfile:()=>profile});
// Preload of this run (own file in the QA folder): state/files/receipts bridges + main-world clipboard and dialog mocks.
const preload=inside(join(out,'qa-preload.cjs'));
writeFileSync(preload,`const {contextBridge,ipcRenderer,webUtils,webFrame}=require('electron');
webFrame.executeJavaScript(${JSON.stringify(`(()=>{window.__qa={clipboard:[],dialogs:[],errors:[]};window.addEventListener('error',e=>window.__qa.errors.push(String(e.error?.stack??e.message).slice(0,1500)));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__qa.clipboard.push(String(text))},readText:async()=>window.__qa.clipboard.at(-1)??'',write:async()=>{window.__qa.clipboard.push('[blob]')}}});window.alert=m=>{window.__qa.dialogs.push(['alert',String(m)])};window.confirm=m=>{window.__qa.dialogs.push(['confirm',String(m)]);return true};window.prompt=m=>{window.__qa.dialogs.push(['prompt',String(m)]);return null};window.open=u=>{window.__qa.dialogs.push(['open',String(u)]);return null};})()`)});
contextBridge.exposeInMainWorld('mainsAgentsDesktop',{files:{pathForFile:file=>webUtils.getPathForFile(file),select:(p,c,m)=>ipcRenderer.invoke('files:select',p,c,m),inspect:(p,c,paths)=>ipcRenderer.invoke('files:inspect',p,c,paths),verify:(p,c)=>ipcRenderer.invoke('files:verify',p,c),open:(p,c,a)=>ipcRenderer.invoke('files:open',p,c,a),preview:(p,c,a)=>ipcRenderer.invoke('files:preview',p,c,a),reveal:(p,c,a)=>ipcRenderer.invoke('files:reveal',p,c,a)},receipts:{check:(p,id)=>ipcRenderer.invoke('receipts:check',p,id),open:(p,id)=>ipcRenderer.invoke('receipts:open',p,id),reveal:(p,id)=>ipcRenderer.invoke('receipts:reveal',p,id)},state:{profile:${JSON.stringify(profile)},hasProfile:()=>Promise.resolve(true),read:(_p,key)=>ipcRenderer.invoke('test:read',key),write:(_p,key,value)=>ipcRenderer.invoke('test:write',key,value),readAll:()=>ipcRenderer.invoke('test:all')}});
`);
// Minimal Codex/Claude provider health and model lists (no model turn is expected from the chat in this scenario) + app routes + the built UI.
const chatTurns=[];
const json=(response,value,status=200)=>{response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path==='/api/codex/executions'||path==='/api/codex/sessions')chatTurns.push(path);return json(response,{error:'No chat turn is part of this QA scenario.'},503);}
 if(path.startsWith('/api/providers/')){if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/status'))return json(response,{providerId:'claude',state:'ready',authMode:'cli',billingDescription:'QA mock (no CLI call)'});
  if(/\/(executions|sessions)/.test(path)){chatTurns.push(path);return json(response,{error:'No chat turn is part of this QA scenario.'},503);}return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],consoleErrors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition',ms=60000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40))}throw Error(`Editing delivery UI timed out: ${label}`)}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
const findButton=(text,scope='document')=>`Array.from(${scope}.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`;
async function button(text){await until(()=>js(`Boolean(${findButton(text)})`),text);await js(`${findButton(text)}.click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
const shots=[];
async function shot(name){const png=await captureReadyPng(win.webContents),size=nativeImage.createFromBuffer(png).getSize(),file=inside(join(out,`${name}.png`));writeFileSync(file,png);shots.push({name,file,...size});assert.deepEqual([size.width,size.height],[1600,1000],`${name}.png must be 1600x1000`);}
const sessions=()=>store.read(profile,'sessions')??[],byTitle=title=>sessions().find(s=>s.title===title),runsFor=contentId=>bridge.production.list(profile).filter(p=>p.contentId===contentId);
async function openSessions(){await js(`document.querySelector('button[title="Sessões deste agente"]').click()`);await until(()=>js('Boolean(document.querySelector(".panel-sessions"))'),'sessions tab');}
async function openSessionNamed(title){await openSessions();await until(()=>js(`Array.from(document.querySelectorAll('.panel-session-main')).some(el=>el.querySelector('b')?.textContent===${JSON.stringify(title)})`),`session ${title} listed`);await js(`Array.from(document.querySelectorAll('.panel-session-main')).find(el=>el.querySelector('b')?.textContent===${JSON.stringify(title)}).click()`);await until(()=>js(`document.querySelector('.active-session-bar')?.textContent.includes(${JSON.stringify(title)})`),`open ${title}`).catch(async error=>{throw Error(`${error.message} (bar: ${await js(`document.querySelector('.active-session-bar')?.textContent??'none'`)}; url: ${await js('location.href')}; text: ${(await js(`document.body.innerText`)).replace(/\s+/g,' ').slice(-700)})`)});}
async function openAgent(name){await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="${name}"]'))`),`agent ${name}`);await js(`document.querySelector('.agent-nav[title="${name}"]').click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))'),'chat open');}
// Scroll the receipt into view (so the screenshot shows it) and read everything the user sees on it.
const cardState=(receiptId,scope='.chat-body')=>js(`(()=>{const cards=Array.from(document.querySelectorAll(${JSON.stringify(scope)}+' .delivery-receipt'));const card=cards.find(c=>c.dataset.qa===${JSON.stringify(receiptId)})??cards.at(-1);if(!card)return null;card.scrollIntoView({block:'center'});const code=card.querySelector('.delivery-receipt-path'),r=code.getBoundingClientRect(),cs=getComputedStyle(code);
 const buttons=Object.fromEntries(Array.from(card.querySelectorAll('button')).map(b=>[b.textContent.trim(),!b.disabled]));
 return {count:cards.length,label:card.getAttribute('aria-label'),name:card.querySelector('header b')?.textContent,meta:card.querySelector('header span')?.textContent,path:code.textContent,pathTitle:code.title,pathClipped:code.scrollWidth>code.clientWidth+1&&cs.overflowX!=='visible'&&!/wrap|anywhere|break/.test(cs.overflowWrap+cs.wordBreak+cs.whiteSpace),pathVisible:r.width>0&&r.height>0,small:card.querySelector('small')?.textContent,error:card.querySelector('.delivery-error')?.textContent??null,notes:Array.from(card.querySelectorAll('small[role=status]')).map(n=>n.textContent),buttons};})()`);
const cardButton=(label,scope='.chat-body')=>js(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(scope)}+' .delivery-receipt button')).reverse().find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`);
const kb=bytes=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1e3))} KB`;
const checks=[],check=(name,ok,detail)=>{checks.push({name,ok:Boolean(ok),...(detail!==undefined?{detail}:{})});assert(ok,`${name}${detail!==undefined?`: ${JSON.stringify(detail)}`:''}`);};
async function openWindow(){win=new BrowserWindow({show:false,width:1600,height:1000,useContentSize:true,webPreferences:{preload,contextIsolation:true,sandbox:false,offscreen:true,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(({url})=>{intercepted.push({windowOpen:url});return {action:'deny'};});win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(`http://127.0.0.1:${server.address().port}/`)){intercepted.push({navigate:url});event.preventDefault();}});
 win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)consoleErrors.push(String(event.message).slice(0,500));if(/Uncaught|Maximum update depth|Cannot update a component|error occurred in the/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await openAgent(source.name);}
const report={mode,modules,dist,out,startedAt:new Date().toISOString(),simulated:['LLM turns: declared chat/editor messages carrying the host receipt (no model, no render)','provider health endpoints','clipboard (main + renderer)','shell open/show','file dialogs'],real:['fixture video bytes (FFmpeg, QA folder)','delivery receipt registry + content bridge (SQLite)','receipts IPC (host re-verification)','React UI from dist'],checks,shots};
app.whenReady().then(async()=>{let failed;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await openWindow();
 const output=receipt.path,original=readFileSync(output);report.receipt=receipt;
 // 0) Host receipt = the real bytes of the fixture.
 check('receipt path is absolute and is the fixture file',/^(?:[a-z]:[\\/]|\/)/i.test(output)&&resolve(output)===resolve(fixture)&&basename(output)===receipt.name,output);
 check('receipt sha256/size match the bytes on disk (independent hash)',receipt.sha256===fixtureSha&&statSync(output).size===receipt.size,{sha:receipt.sha256,size:receipt.size});
 check('receipt directed by Claude Code, production video v1',receipt.producedBy?.providerId==='claude'&&receipt.producedBy?.agentName===editor.name&&receipt.source.kind==='production-video'&&receipt.version===1&&receipt.fileKind==='video',{producedBy:receipt.producedBy,version:receipt.version,kind:receipt.fileKind});
 check('host registry resolves the same receipt',JSON.stringify(bridge.receipts.get(profile,receipt.id))===JSON.stringify(receipt));
 const expectVisible=(where,card,receipt=report.receipt,director=true)=>{
  check(`${where}: card present`,card,card);
  check(`${where}: full name`,card.name===receipt.name&&card.label.endsWith(receipt.name),{ui:card.name});
  check(`${where}: full absolute path`,card.path===receipt.path&&card.pathTitle===receipt.path&&card.pathVisible,{ui:card.path,host:receipt.path});
  check(`${where}: path not clipped`,!card.pathClipped);
  check(`${where}: version and size`,card.meta===`v${receipt.version} · ${kb(receipt.size)}`,card.meta);
  check(`${where}: sha256 and Claude director`,card.small.includes(receipt.sha256.slice(0,12))&&(director?card.small.includes(`direção ${editor.name} (Claude Code)`):!card.small.includes('direção')),card.small);
 };
 // 1) Claim without receipt: plain text, never a receipt card, nothing verifiable.
 await until(()=>js(`document.querySelector('.chat-body')?.textContent.includes('entrega-inventada-final.mp4')`),'claim chat shown');
 check('no receipt -> no delivery card',await js(`document.querySelectorAll('.chat-body .delivery-receipt').length`)===0);
 check('no receipt -> never "verified by the app"',!await js(`document.querySelector('.chat-body').textContent.includes('Verificado pelo app')`));
 check('no receipt -> no host receipt exists for the claimed path',!bridge.receipts.list(profile).some(r=>r.path===fakePath));
 await shot('01-claim-without-receipt');
 // 2) Source chat.
 await openSessionNamed('Entrega QA');await until(()=>js(`document.querySelectorAll('.chat-body .delivery-receipt').length>0`),'receipt in source chat');
 await js(`document.querySelectorAll('.chat-body .delivery-receipt').forEach(c=>{if(c.querySelector('.delivery-receipt-path')?.textContent===${JSON.stringify(receipt.path)})c.dataset.qa=${JSON.stringify(receipt.id)}})`);
 let card=await cardState(receipt.id);expectVisible('source chat',card);
 check('source chat: no other receipt shown',card.count===1,card.count);
 await until(async()=>!(await cardState(receipt.id)).error&&(await cardState(receipt.id)).buttons['Abrir'],'host check available');
 await shot('02-source-chat-receipt');
 // Copy -> mock clipboard gets exactly the absolute path; nothing reaches the system clipboard.
 assert(await cardButton('Copiar caminho'));await until(()=>js(`window.__qa.clipboard.length===1`),'clipboard write');
 check('copy path writes the exact absolute path',await js('window.__qa.clipboard[0]')===receipt.path,await js('window.__qa.clipboard'));
 check('system clipboard untouched',clipboardCalls.length===0,clipboardCalls);
 // Open / show folder -> host re-verifies, mock shell receives the receipt path.
 assert(await cardButton('Abrir'));await until(()=>shellCalls.length===1,'open');assert(await cardButton('Mostrar na pasta'));await until(()=>shellCalls.length===2,'reveal');
 check('open/show use the host receipt path',JSON.stringify(shellCalls)===JSON.stringify([{action:'openPath',path:receipt.path},{action:'showItemInFolder',path:receipt.path}]),shellCalls);
 card=await cardState(receipt.id);check('status notes shown',card.notes.at(-1)==='Pasta aberta.',card.notes);await shot('03-source-chat-actions');
 // 3) Editor chat: the SAME receipt.
 await openAgent(editor.name);await openSessionNamed(editorChat.title);await until(()=>js(`document.querySelectorAll('.chat-body .delivery-receipt').length>0`),'receipt in editor chat');
 const editorIds=(sessions().find(s=>s.id==='editor-chat')?.messages??[]).flatMap(m=>m.receipts??[]).map(r=>r.id);check('editor chat carries the same receipt id',editorIds.includes(receipt.id),editorIds);
 card=await cardState(receipt.id);expectVisible('editor chat',card);await shot('04-editor-chat-receipt');
 // 4) Bytes changed after delivery -> "changed", actions disabled, host refuses to open.
 const before=shellCalls.length;writeFileSync(inside(output),Buffer.concat([original,Buffer.from('tampered-by-qa')]));
 await openAgent(editor.name);await openAgent(source.name);await openSessionNamed('Entrega QA');
 await until(async()=>(await cardState(receipt.id))?.error,'changed state');card=await cardState(receipt.id);
 check('changed file -> visible changed state',card.error==='O arquivo mudou depois da entrega.',card.error);
 check('changed file -> open/show disabled',card.buttons['Abrir']===false&&card.buttons['Mostrar na pasta']===false,card.buttons);
 const forced=await js(`window.mainsAgentsDesktop.receipts.open(${JSON.stringify(profile)},${JSON.stringify(receipt.id)}).then(()=>'opened',e=>e.message)`);
 check('changed file -> host refuses open even if forced',/changed after delivery/.test(forced)&&shellCalls.length===before,{forced,shellCalls:shellCalls.length-before});
 await shot('06-changed-file');
 // 5) File moved -> "moved or removed", never opened. Then the original bytes are put back in place.
 writeFileSync(inside(output),original);const moved=inside(join(out,'moved',basename(output)));mkdirSync(dirname(moved),{recursive:true});renameSync(inside(output),moved);
 await openAgent(editor.name);await openAgent(source.name);await openSessionNamed('Entrega QA');
 await until(async()=>(await cardState(receipt.id))?.error,'missing state');card=await cardState(receipt.id);
 check('moved file -> visible missing state',card.error==='O arquivo foi movido ou removido.',card.error);
 check('moved file -> open/show disabled',card.buttons['Abrir']===false&&card.buttons['Mostrar na pasta']===false,card.buttons);
 const forcedReveal=await js(`window.mainsAgentsDesktop.receipts.reveal(${JSON.stringify(profile)},${JSON.stringify(receipt.id)}).then(()=>'shown',e=>e.message)`);
 check('moved file -> host refuses reveal even if forced',/moved or removed/.test(forcedReveal)&&shellCalls.length===before,{forcedReveal});
 check('moved file -> path still shown as delivered (for the user to locate it)',card.path===receipt.path);
 await shot('07-moved-file');
 renameSync(moved,inside(output));check('original bytes restored',sha(output)===receipt.sha256);
 // The card re-checks on mount: an already open card keeps the last state until the chat is reopened (reported in report.notes).
 report.notes=['An open DeliveryReceiptCard keeps its last host status (e.g. "moved") until the chat is reopened; it does not re-check live.'];
 await openAgent(editor.name);await openAgent(source.name);await openSessionNamed('Entrega QA');
 await until(async()=>{const c=await cardState(receipt.id);return c&&!c.error&&c.buttons['Abrir']},'available again after restore');
 check('restored file -> available again after reopening the chat',true);
 // 6) Media export (ContentMediaEditor .media-job): REAL FFmpeg export by the media engine -> host receipt -> same card.
 const surface=/result\??\.receipt/.test(uiBundle);
 if(!surface){report.mediaExport={status:'not-implemented',error:'No renderer component reads mediaJobs[].result.receipt (media-export).'};checks.push({name:'media-export receipt surface',ok:false,optional:!strictMediaExport,detail:report.mediaExport});assert(!strictMediaExport,report.mediaExport.error);}
 else{
  bridge.media.enqueue(profile,{requestKey:'qa-export',contentId,assetId:asset.id,versionId:'qa-v1',sha256:rec.sha256,revision:editorialRevision(),start:0,duration:1.5});
  await until(()=>['succeeded','failed','interrupted'].includes(bridge.media.list(profile).find(j=>j.requestKey==='qa-export')?.status),'media export',120000);
  const job=bridge.media.list(profile).find(j=>j.requestKey==='qa-export'),exported=job.result?.receipt;
  check('media export succeeded with a host receipt',job.status==='succeeded'&&exported,{status:job.status,error:job.error,receiptError:job.receiptError});
  check('media-export receipt = exported bytes (independent hash), new file, not the source',exported.source.kind==='media-export'&&exported.path===job.result.file.path&&sha(exported.path)===exported.sha256&&exported.path!==rec.path&&exported.path.startsWith(out+sep),{path:exported.path});
  await js(`window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:${JSON.stringify(contentId)}}}))`);
  await until(()=>js(`Array.from(document.querySelectorAll('.media-job .delivery-receipt-path')).some(c=>c.textContent===${JSON.stringify(exported.path)})`),'media-export receipt card',60000);
  await js(`document.querySelectorAll('.media-job .delivery-receipt').forEach(c=>{if(c.querySelector('.delivery-receipt-path')?.textContent===${JSON.stringify(exported.path)})c.dataset.qa=${JSON.stringify(exported.id)}})`);
  card=await cardState(exported.id,'.media-job');expectVisible('media export',card,exported,false);
  await until(async()=>(await cardState(exported.id,'.media-job')).buttons['Abrir'],'media-export host check');
  const clip=await js('window.__qa.clipboard.length'),calls=shellCalls.length;
  assert(await cardButton('Copiar caminho','.media-job'));await until(()=>js(`window.__qa.clipboard.length===${clip+1}`),'media-export copy');
  assert(await cardButton('Abrir','.media-job'));await until(()=>shellCalls.length===calls+1,'media-export open');
  check('media export: copy/open use the exported receipt path',await js('window.__qa.clipboard.at(-1)')===exported.path&&shellCalls.at(-1).path===exported.path&&shellCalls.at(-1).action==='openPath',{clipboard:await js('window.__qa.clipboard.at(-1)'),shell:shellCalls.at(-1)});
  report.mediaExport={status:'verified',receipt:exported};await shot('08-media-export-receipt');
 }
 // 7) Manual agent delivery (FileDeliveryCard): before verification only the NAME; after "Salvar entrega" the verified path.
 await openSessionNamed('Entrega manual');await until(()=>js(`Boolean(document.querySelector('.chat-body .chat-delivery'))`),'manual delivery card');
 const manualBefore=await js(`(()=>{const c=document.querySelector('.chat-body .chat-delivery');return {text:c.textContent,paths:Array.from(c.querySelectorAll('.delivery-receipt-path')).map(e=>e.textContent),badge:c.querySelector('header span')?.textContent}})()`);
 check('manual delivery before verification: name only, agent path never shown as delivered',manualBefore.text.includes(basename(manualFile))&&!manualBefore.text.includes(manualFile)&&manualBefore.paths.length===0&&manualBefore.badge==='A verificar',manualBefore);
 await shot('09-manual-delivery-unverified');
 await button('Conferir e salvar entrega');await until(()=>js(`Boolean(document.querySelector('.flow-dialog'))`),'save delivery dialog');await button('Salvar entrega');
 await until(()=>js(`Boolean(document.querySelector('.chat-body .chat-delivery .delivery-receipt-path'))`),'manual delivery verified',60000);
 const manualAfter=await js(`(()=>{const c=document.querySelector('.chat-body .chat-delivery');c.scrollIntoView({block:'center'});return {paths:Array.from(c.querySelectorAll('.delivery-receipt-path')).map(e=>e.textContent),badge:c.querySelector('header span')?.textContent}})()`);
 check('manual delivery after verification: full absolute path of the verified version',manualAfter.paths.length===1&&resolve(manualAfter.paths[0])===resolve(manualFile)&&/^v\d+$/.test(manualAfter.badge??''),manualAfter);
 const clip2=await js('window.__qa.clipboard.length'),calls2=shellCalls.length;
 await js(`Array.from(document.querySelectorAll('.chat-body .chat-delivery button')).find(b=>b.textContent.trim()==='Copiar caminho').click()`);await until(()=>js(`window.__qa.clipboard.length===${clip2+1}`),'manual copy');
 await js(`Array.from(document.querySelectorAll('.chat-body .chat-delivery button')).find(b=>b.textContent.trim()==='Abrir mídia').click()`);await until(()=>shellCalls.length===calls2+1,'manual open');
 check('manual delivery: copy/open use the verified path',await js('window.__qa.clipboard.at(-1)')===manualAfter.paths[0]&&resolve(shellCalls.at(-1).path)===resolve(manualFile),{clipboard:await js('window.__qa.clipboard.at(-1)'),shell:shellCalls.at(-1)});
 await shot('10-manual-delivery-verified');
 // Global invariants.
 check('no chat turn was sent to any provider',chatTurns.length===0,chatTurns);
 check('no dialog/shell/navigation reached the desktop',intercepted.length===0,intercepted);
 check('renderer dialogs: none',(await js('window.__qa.dialogs')).length===0,await js('window.__qa.dialogs'));
 check('no React errors',errors.length===0,errors);
}catch(error){failed=error;console.error(error);try{if(win&&!win.isDestroyed()){report.bodyText=(await js('document.body.innerText').catch(()=>'')).slice(0,3000);report.pageErrors=await js('window.__qa?.errors??[]').catch(()=>[]);await shot('failure').catch(()=>{});}}catch{}}
 report.finishedAt=new Date().toISOString();report.ok=!failed;report.error=failed?String(failed.stack??failed).slice(0,2000):undefined;report.intercepted=intercepted;report.consoleErrors=consoleErrors;report.shellCalls=shellCalls;
 writeFileSync(inside(join(out,'report.json')),JSON.stringify(report,null,1));
 console.log(failed?`EDITING_DELIVERY_UI_FAIL (${mode}): ${failed.message}\nReport: ${join(out,'report.json')}`:`EDITING_DELIVERY_UI_OK (${mode}): ${checks.filter(c=>c.ok).length}/${checks.length} checks${checks.some(c=>!c.ok)?` (optional pending: ${checks.filter(c=>!c.ok).map(c=>c.name).join(', ')})`:''}\nReport: ${join(out,'report.json')}`);
 try{win?.destroy();}catch{}await bridge.close().catch(()=>{});store.close();server.close();app.exit(failed?1:0);
});
