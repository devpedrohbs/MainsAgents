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
import {runMediaProcess} from '../editorial-media.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/editorial-media-ui-test');mkdirSync(out,{recursive:true});
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
app.whenReady().then(async()=>{try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
  const originalPath=resolve(out,`original-${Date.now()}.mp4`),opened=[];
  await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-c:v','libx264','-c:a','aac',originalPath]);
  registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[originalPath]})},shell:{showItemInFolder:()=>{},openPath:async path=>{opened.push(path);return ''}},getWindow:()=>window,getStore:()=>({currentProfile:()=>profile,workspaceSnapshot:()=>{const db=new DatabaseSync(dbPath);try{return {editorial:{state:JSON.parse(db.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json)}};}finally{db.close();}}}),inspect:path=>inspectLocalAsset(path,{stabilityMs:1})});
  await clickText('Adicionar arquivos');await until(()=>evaluate('document.querySelectorAll(".content-asset").length===1'));await clickText('Cortar e exportar');await clickText('Verificar duração e áudio');
  await until(()=>evaluate('document.querySelectorAll(".media-export-fields input[type=number]").length===2'));
  await evaluate('(()=>{const [start,duration]=document.querySelectorAll(".media-export-fields input[type=number]");for(const [input,value] of [[start,"0.5"],[duration,"1.2"]]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}))}})()');
  await clickText('Autorizar e exportar este trecho');await until(()=>evaluate('document.querySelector(".content-media")?.textContent.includes("Vídeo exportado e verificado")'));await until(()=>evaluate('document.querySelectorAll(".content-asset").length===2'));assert.equal(calls,0);
  await clickText('Ver original');await clickText('Revisar resultado');await until(()=>opened.length===2);assert.equal(opened.length,2);assert.equal(opened[0],originalPath);assert.notEqual(opened[1],originalPath);
  await evaluate('document.documentElement.dataset.appearance="dark";document.querySelector(".content-media").scrollIntoView({block:"center"})');await new Promise(resolve=>setTimeout(resolve,250));writeFileSync(resolve(out,'video-export-dark.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(880,720);await evaluate('document.documentElement.dataset.appearance="light"');await new Promise(resolve=>setTimeout(resolve,250));assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  await evaluate('window.mainsAgentsSaveNow()');window.destroy();await bridge.close();bridge=createContentWorkflowBridge({dbPath});await open();await until(()=>evaluate('document.querySelector(".content-media")?.textContent.includes("Vídeo exportado e verificado")'));
  assert.equal(bridge.media.list(profile).length,1);assert.equal(bridge.media.list(profile)[0].result.metadata.hasAudio,true);assert.deepEqual(errors,[]);console.log('PASS real FFmpeg desktop UI: source inspection, authorized cut, verified new output, original/result review through trusted IPC, compact layout and restart. No user data or AI generation.');
  window.destroy();await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);if(window&&!window.isDestroyed()){console.log(await evaluate('document.body.innerText'));writeFileSync(resolve(out,'failure.png'),(await window.webContents.capturePage()).toPNG());window.destroy()}await bridge.close();server.close();app.exit(1)}});
