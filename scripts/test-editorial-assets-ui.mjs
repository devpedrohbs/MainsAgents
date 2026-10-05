// Hidden, isolated Electron fixture. No user data, AI inference or remote writes.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/editorial-assets-ui-test');mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,`profile-${Date.now()}`));
app.on('window-all-closed',()=>{});
const dbPath=resolve(out,`test-${Date.now()}.sqlite`),workspaceId='my-workspace',profile='handoff-test',source='12345678-1234-1234-1234-123456789abc';
const now=new Date().toISOString(),original='This is the complete script originally proposed by the specialist. It explains the project and its practical value with a concrete example and a closing reminder.';
const changed=original+' EDITED_SCRIPT_PRESERVED';
const editorial={schemaVersion:1,topics:[{id:'topic',workspaceId,requestId:'topic',inputKind:'text',input:'Personal project',category:'Tech',priority:'normal',status:'approved',title:'Personal project',summary:'A practical explanation of my project',whyItMatters:'It demonstrates useful technology',angles:['Example','How it works'],sources:[{title:'Reference',url:'https://example.com'}],factualQuestions:[],contentId:'content',createdAt:now,updatedAt:now}],contents:[{id:'content',workspaceId,topicId:'topic',title:'Personal project',format:'short-video',platforms:['LinkedIn'],status:'script-review',taskId:'task',scriptOptionsArtifactId:'options',createdAt:now,updatedAt:now}],runs:[],artifacts:[{id:'options',workspaceId,topicId:'topic',contentId:'content',type:'script-options',version:1,createdAt:now,data:{hooks:['Here is my project','A useful example','What I learned'],ctas:['Save it','Try it'],paths:[{title:'Explain',outline:'Show a practical example'}, {title:'Story',outline:'Describe the project journey'}],improvisationTopics:['Context','Demo'],thumbnailDirection:'Project screenshot',draftScript:original}}],approvals:[]};
const base={workspaceId,role:'Editor',description:'Test specialist',instructions:'Follow the user request',tools:['web-search'],status:'idle',createdAt:now,updatedAt:now};
const state={agents:[{...base,id:'content-agent',name:'Content Editor'}],workspaces:[{id:workspaceId,name:'Test workspace',createdAt:now,updatedAt:now}],sessions:[],'active-sessions':{},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
let calls=0,fail=true,blockProfileCache=false;
const connector={upsert:async(payload,context)=>{calls++;context.authorize();if(fail)throw new Error('TEST_CONNECTION_UNAVAILABLE');return {pageId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',url:'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',verifiedAt:new Date().toISOString(),artifactVersion:payload.artifact.version}}};
let bridge=createContentWorkflowBridge({dbPath,getConnector:()=>connector,suggestConnection:()=>source});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES (?,?,?,?)').run(profile,1,JSON.stringify(editorial),now);seed.close();
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');if(await bridge.handle(req,res,url))return;
  if(url.pathname.startsWith('/api/'))return json(res,url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/usage')?{rateLimits:null}:{ready:false,status:'disconnected'});
  try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);let content=readFileSync(file);if(blockProfileCache&&extname(file)==='.html')content=Buffer.from(content.toString().replace('<head>',`<head><script>Object.defineProperty(window,'localStorage',{get(){throw new Error('Profile cache unavailable')}});</script>`));res.end(content);}catch{res.statusCode=404;res.end()}
});
const errors=[];let window;
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(check){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,70))}throw new Error('Editorial UI assertion timed out');}
async function clickText(text){await until(()=>evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});return Boolean(button&&!button.disabled)})()`));await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});button.scrollIntoView({block:'center'});button.click()})()`);}
async function open(){window=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});window.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#content`);await until(()=>evaluate("Boolean(document.querySelector('.editorial-script'))"));}
app.whenReady().then(async()=>{
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();

    let selected=[];const originalPath=resolve(out,'raw-video.mp4'),movedPath=resolve(out,'raw-video-moved.mp4'),editPath=resolve(out,'edited-video.mp4');
    writeFileSync(originalPath,'ORIGINAL_VIDEO');writeFileSync(editPath,'EDITED_VIDEO');
    registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:selected})},shell:{showItemInFolder:()=>{}},getWindow:()=>window,getStore:()=>({currentProfile:()=>profile,workspaceSnapshot:()=>{const db=new DatabaseSync(dbPath);try{return {editorial:{state:JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json)}};}finally{db.close();}}}),inspect:path=>inspectLocalAsset(path,{stabilityMs:1})});
    const saved=()=>{const db=new DatabaseSync(dbPath);try{return JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json);}finally{db.close();}};
    selected=[originalPath];await clickText('Adicionar arquivos');await until(()=>evaluate("document.querySelectorAll('.content-asset').length===1"));
    await evaluate("window.mainsAgentsSaveNow()");assert.equal(saved().assets.length,1);
    await clickText('Adicionar arquivos');await until(()=>evaluate("document.body.textContent.includes('já existente')"));assert.equal(saved().assets.length,1);
    renameSync(originalPath,movedPath);await clickText('Verificar arquivos');await until(()=>evaluate("Boolean(document.querySelector('[data-status=missing]'))"));
    selected=[editPath];await clickText('Localizar');await until(()=>evaluate("document.querySelector('.content-asset-error')?.textContent.includes('different file')"));assert.equal(saved().assets[0].versions.length,1);
    selected=[movedPath];await clickText('Localizar');await until(()=>evaluate("document.body.textContent.includes('Arquivo religado')"));assert.equal(saved().assets[0].versions[0].path,movedPath);
    selected=[editPath];await clickText('Nova versão');await until(()=>evaluate("document.body.textContent.includes('Versão salva')"));assert.equal(saved().assets[0].versions.length,2);
    await evaluate("window.mainsAgentsSaveNow()");window.destroy();await bridge.close();bridge=createContentWorkflowBridge({dbPath});await open();
    await until(()=>evaluate("Boolean(document.querySelector('[data-status=unchecked]'))"));assert.equal(saved().assets[0].versions.length,2);
    await clickText('Verificar arquivos');await until(()=>evaluate("Boolean(document.querySelector('[data-status=available]'))"));
    await evaluate("document.querySelector('.content-asset-versions').open=true;document.querySelector('.content-assets').scrollIntoView({block:'center'})");
    writeFileSync(resolve(out,'library-light.png'),(await window.webContents.capturePage()).toPNG());
    window.setSize(840,800);await evaluate("document.documentElement.dataset.appearance='dark';document.querySelector('.content-assets').scrollIntoView({block:'center'})");await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(await evaluate("(()=>{const el=document.querySelector('.content-assets');return el.scrollWidth<=el.clientWidth+1;})()"),true);
    writeFileSync(resolve(out,'library-dark-compact.png'),(await window.webContents.capturePage()).toPNG());

    const dropped=resolve(out,'reference.md');writeFileSync(dropped,'REAL_DROPPED_REFERENCE');
    await evaluate("(()=>{const input=document.createElement('input');input.type='file';input.id='native-drop-test';document.body.append(input)})()");
    window.webContents.debugger.attach('1.3');const {root:dom}=await window.webContents.debugger.sendCommand('DOM.getDocument');const {nodeId}=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'#native-drop-test'});await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[dropped]});window.webContents.debugger.detach();
    await evaluate("(()=>{const input=document.querySelector('#native-drop-test'),data=new DataTransfer();data.items.add(input.files[0]);document.querySelector('.content-assets').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));input.remove()})()");
    await until(()=>evaluate("document.querySelectorAll('.content-asset').length===2"));await evaluate("window.mainsAgentsSaveNow()");assert.equal(saved().assets[1].name,'reference.md');
    await clickText('Desassociar');await clickText('Confirmar');await until(()=>evaluate("document.querySelectorAll('.content-asset').length===1"));
    await clickText('Desassociar');await clickText('Confirmar');await until(()=>evaluate("document.querySelectorAll('.content-asset').length===0"));await evaluate("window.mainsAgentsSaveNow()");assert.equal(saved().assets.length,0);assert.equal(readFileSync(editPath,'utf8'),'EDITED_VIDEO');assert.deepEqual(errors,[]);assert.equal(calls,0);
    console.log('PASS: real IPC and file reads, attach, deduplication, missing file, relink validation, new version, restart, verification, compact dark layout and unlink without deleting files. No AI or external writes.');
    writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:true,restart:true,realIpc:true,compact:true,errors}));
    window.destroy();await bridge.close();server.close();app.exit(0);
  }catch(error){console.error(error);try{if(window&&!window.isDestroyed()){console.log('UI:',await evaluate('document.body.innerText'));writeFileSync(resolve(out,'failure.png'),(await window.webContents.capturePage()).toPNG());}}catch{}writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:false,error:error.stack,errors}));if(window&&!window.isDestroyed())window.destroy();await bridge.close();server.close();app.exit(1)}
});
