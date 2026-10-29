// Removing cards from the Board in the REAL renderer with the REAL desktop preload, IPC, SQLite state store and content bridge.
// Fixture data only (temporary folder). An ordinary task is deleted (with undo); an editorial card is only taken off the Board:
// its content stays in the Studio and the editorial sync must not bring the card back, not even after a restart.
// Run: npx electron scripts/test-board-remove-ui.mjs   (renderer from MAINSAGENTS_UI_DIST, default dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/board-remove-ui',String(Date.now()));mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='board-ui',ws='space',at='2026-10-15T10:00:00.000Z',dbPath=join(out,'workspace-state.sqlite');
const agents=[{id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Fixture',description:'Fixture',skills:[],workspaceId:ws,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at}];
const task=(id,title,status)=>({id,title,description:'Fixture',agentId:'source',workspaceId:ws,status,metadata:'Nova',createdAt:at});
let store=createDesktopStateStore(out,'ui-test');
store.initialize(profile,{agents,workspaces:[{id:ws,name:'Conteúdo',createdAt:at,updatedAt:at}],sessions:[],tasks:[task('task-manual','Tarefa manual','research'),task('task-keep','Tarefa que fica','running')],
 'current-workspace':ws,language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
store.selectProfile(profile);
const bridgeOptions={dbPath,getCurrentProfile:()=>store.currentProfile(),getAgents:p=>store.read(p,'agents'),getFlows:p=>store.read(p,'production-flows'),getSessions:p=>store.read(p,'sessions'),getRuntime:()=>null};
let bridge=createContentWorkflowBridge(bridgeOptions);
const seed=new DatabaseSync(dbPath);seed.exec('PRAGMA busy_timeout=5000');
seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[],
 contents:[{id:'content-ed',workspaceId:ws,topicId:'topic-ed',title:'Post editorial',format:'short-video',platforms:['LinkedIn'],status:'planning',taskId:'task-content-ed',createdAt:at,updatedAt:at}],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);
seed.close();
let win;const trusted=event=>event.sender===win?.webContents;
ipcMain.handle('state:getProfile',event=>{assert(trusted(event));return store.currentProfile();});
ipcMain.on('state:profile',event=>{event.returnValue=trusted(event)?store.currentProfile():undefined;});
ipcMain.on('state:writeSync',(event,p,key,value,revision)=>{try{assert(trusted(event));if(p!==store.currentProfile())throw Error('profile');event.returnValue={saved:true,...store.write(p,key,value,revision)};}catch(error){event.returnValue={saved:false,error:error.message};}});
ipcMain.handle('state:checkpoint',()=>store.recoverySnapshot());
for(const operation of ['hasProfile','initialize','read','write','readAll','readAllVersioned','replaceAll'])ipcMain.handle(`state:${operation}`,(event,...args)=>{assert(trusted(event));return store[operation](...args);});
ipcMain.handle('account:status',()=>({configured:false,signedIn:false}));ipcMain.handle('account:google-configured',()=>false);
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});return json(response,{events:[]});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));}catch{response.statusCode=404;response.end();}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error(`Board remove UI timed out: ${label}`);}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));}
const titles=()=>js('JSON.stringify(Array.from(document.querySelectorAll(".qb .task-card h3")).map(el=>el.textContent))').then(JSON.parse);
const tasks=()=>store.read(profile,'tasks');
const remove=title=>js(`(()=>{const card=Array.from(document.querySelectorAll('.qb .task-card-wrap')).find(el=>el.querySelector('h3').textContent===${JSON.stringify(title)});card.querySelector('.task-card-remove').click();return card.querySelector('.task-card-remove').getAttribute('aria-label');})()`);
const undo=()=>js(`Array.from(document.querySelectorAll('.toast button')).find(b=>/Desfazer|Undo/.test(b.textContent)).click()`);
async function open(){
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'desktop-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component|Failed to persist/.test(event.message))errors.push(event.message);});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#board`);
 await until(()=>js('Boolean(document.querySelector(".qb"))'),'board');
}

app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 await until(async()=>(await titles()).includes('Post editorial'),'editorial card synced');
 assert.deepEqual((await titles()).sort(),['Post editorial','Tarefa manual','Tarefa que fica']);
 assert.equal(await js('document.querySelectorAll(".qb .task-card-remove").length'),3,'every card has a remove button');
 assert.equal(await js('document.querySelector(".qb .task-card .task-card-remove")'),null,'the remove button is not nested inside the card button');
 await shot('01-board');
 // Ordinary task: deleted, undo restores it, deleting again sticks.
 assert.match(await remove('Tarefa manual'),/Excluir a tarefa/);
 await until(async()=>!(await titles()).includes('Tarefa manual'),'manual removed');
 assert.equal(tasks().some(item=>item.id==='task-manual'),false,'manual task deleted from the store');
 await undo();await until(async()=>(await titles()).includes('Tarefa manual'),'manual restored');
 await remove('Tarefa manual');await until(async()=>!(await titles()).includes('Tarefa manual'),'manual removed again');
 // Editorial card: hidden from the Board only; the content stays and the sync does not recreate the card.
 assert.match(await remove('Post editorial'),/Retirar .* do quadro/);
 await until(async()=>!(await titles()).includes('Post editorial'),'editorial hidden');
 assert.match(await js('document.querySelector(".toast")?.textContent??""'),/continua no Estúdio/);
 await undo();await until(async()=>(await titles()).includes('Post editorial'),'editorial restored');
 await remove('Post editorial');await until(async()=>!(await titles()).includes('Post editorial'),'editorial hidden again');
 await new Promise(r=>setTimeout(r,1500));
 assert.equal(tasks().find(item=>item.id==='task-content-ed')?.hiddenFromBoard,true,'editorial card kept and marked hidden');
 assert.equal(tasks().filter(item=>item.id==='task-content-ed').length,1,'sync did not duplicate the card');
 const editorial=JSON.parse(new DatabaseSync(dbPath).prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile)?.state_json??'{}');
 assert.equal(editorial.contents?.some(item=>item.id==='content-ed'),true,'content remains in the Studio');
 assert.deepEqual(await titles(),['Tarefa que fica']);
 await shot('02-board-after');
 // Restart: the hidden card stays off the Board, the deleted task stays gone.
 win.destroy();await open();await new Promise(r=>setTimeout(r,1500));
 assert.deepEqual(await titles(),['Tarefa que fica'],'still removed after restart');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,out}));
 await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);try{await shot('failure');}catch{}console.error(JSON.stringify({ok:false,out,errors}));app.exit(1);}
});
