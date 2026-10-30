// Real production renderer and SQLite; simulated provider only. The Flow area was retired: old #flow links open Canvas,
// and the saved production flows (same `production-flows` shape) are configured per role in the production dialog.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/production-flows-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='my-workspace',at=new Date().toISOString();
const base={workspaceId,description:'Fixture',instructions:'Keep my configured role',skills:['fixture-skill'],providerId:'codex',tools:['files','subagents'],status:'idle',createdAt:at,updatedAt:at};
const agents=[{...base,id:'content-agent',name:'Editor de Conteúdo',role:'Conteúdo'},{...base,id:'video-agent',name:'Editor de Vídeo',role:'Vídeo'},{...base,id:'alt-video',name:'Editor Alternativo',role:'Vídeo curto'},{...base,id:'elsewhere',workspaceId:'other',name:'Agente de outro workspace',role:'Vídeo'}];
const initial={agents,workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at},{id:'other',name:'Other',createdAt:at,updatedAt:at}],sessions:[],'active-sessions':{},'current-workspace':workspaceId,language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
let store=createDesktopStateStore(out,'fixture');store.initialize(profile,initial);
ipcMain.handle('test:read',(_event,key)=>store.read(profile,key));ipcMain.handle('test:write',(_event,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
let sends=0;
const runtime={connect:async()=>{sends++;return 'never'},send:async()=>{sends++;throw Error('No AI in this test')},events:async function*(){},cancel:async()=>{}};
const options={dbPath:resolve(out,'workspace-state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getSessions:()=>store.read(profile,'sessions'),getFlows:()=>store.read(profile,'production-flows'),getChatRuntime:()=>runtime,getRuntime:()=>null};let bridge=createContentWorkflowBridge(options);
const runs=()=>{const db=new DatabaseSync(options.dbPath);try{return db.prepare('SELECT COUNT(*) AS n FROM production_runs').get().n}catch{return 0}finally{db.close()}};
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');if(await bridge.handle(request,response,url))return;if(url.pathname.endsWith('/health'))return json(response,{ready:true,accountType:'chatgpt'});if(url.pathname.endsWith('/models'))return json(response,{models:[]});if(url.pathname.endsWith('/images'))return json(response,{events:[]});if(url.pathname.startsWith('/api/'))return json(response,{});try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[];let win;const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error(`Production flows UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function option(label){await until(()=>js(`Array.from(document.querySelectorAll('[role=option]')).some(item=>item.querySelector('b')?.textContent.trim()===${JSON.stringify(label)})`),`option ${label}`);await js(`Array.from(document.querySelectorAll('[role=option]')).find(item=>item.querySelector('b')?.textContent.trim()===${JSON.stringify(label)}).click()`)}
const roleValue=label=>js(`document.querySelector('[aria-label=${JSON.stringify(label)}]')?.textContent.trim()??''`);
const flows=()=>store.read(profile,'production-flows');
const box=(kind,flow=flows().flows[0])=>flow.nodes.find(node=>node.kind===kind);
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
async function open(hash,width=1440){win=new BrowserWindow({show:false,width,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#${hash}`);await until(()=>js('Boolean(document.querySelector(".global-create"))'),'app shell')}
async function openNewProduction(){await click('.global-create');await until(()=>js('Array.from(document.querySelectorAll(".flow-option")).some(b=>b.textContent.includes("Nova produção"))'),'new production option');await js('Array.from(document.querySelectorAll(".flow-option")).find(b=>b.textContent.includes("Nova produção")).click()');await until(()=>js('Boolean(document.querySelector(\'[aria-label="Produção atual"]\'))'),'production dialog')}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 // 1) An old #flow link opens Canvas, and the sidebar no longer offers Flow.
 await open('flow');await until(()=>js('location.hash==="#canvas"&&Boolean(document.querySelector(".canvas-layout"))'),'#flow redirects to Canvas');
 assert.equal(await js('document.querySelector("[data-od-id=nav-flow]")'),null);assert.equal(await js('Boolean(document.querySelector("[data-od-id=nav-canvas][aria-current=page]"))'),true);
 assert.equal(await js('document.querySelector(".production-flow-page")'),null);
 // 2) Create → New production shows who does each stage, from the default saved flow.
 await openNewProduction();await until(()=>flows()?.flows.length===1,'default flow saved');
 await until(async()=>(await roleValue('Editor de vídeo')).includes('Editor de Vídeo'),'default video agent');
 assert.match(await roleValue('Agente de conteúdo'),/Editor de Conteúdo/);assert.match(await roleValue('Agente de publicação'),/Editor de Conteúdo|Usar o agente de conteúdo/);
 await screenshot('roles-light');
 // 3) Changing a role only saves the flow: same shape, other boxes intact, nothing started or sent.
 const before=flows().flows[0];
 await click('[aria-label="Editor de vídeo"]');
 assert.equal(await js('Array.from(document.querySelectorAll("[role=option] b")).some(el=>el.textContent.includes("outro workspace"))'),false,'agents of another workspace are not offered');
 await option('Editor Alternativo');
 await until(()=>box('video-agent')?.agentId==='alt-video','video role saved');
 const after=flows().flows[0];
 assert.equal(after.id,before.id);assert.equal(after.nodes.length,before.nodes.length);assert.deepEqual(after.edges,before.edges);
 assert.deepEqual(after.nodes.filter(node=>node.kind!=='video-agent'),before.nodes.filter(node=>node.kind!=='video-agent'));
 assert.equal(flows().schemaVersion,1);assert.equal(sends,0,'no AI touched');assert.equal(runs(),0,'no production started');
 await click('[aria-label="Agente de publicação"]');await option('Usar o agente de conteúdo');await until(()=>!box('publishing-agent').agentId,'publishing falls back to content agent');
 await js('document.documentElement.dataset.appearance="dark"');await screenshot('roles-dark');
 win.setSize(360,800);await new Promise(resolve=>setTimeout(resolve,150));assert(await js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal scroll at 360px');await screenshot('roles-360');
 // 4) Reopen: the choice persisted and is shown again.
 await js('window.mainsAgentsSaveNow()');win.destroy();await bridge.close();store.close();store=createDesktopStateStore(out,'fixture');bridge=createContentWorkflowBridge(options);
 await open('board');await openNewProduction();await until(async()=>(await roleValue('Editor de vídeo')).includes('Editor Alternativo'),'persisted video agent');
 // 5) Without any saved flow the dialog offers to create one instead of sending the user to a removed page.
 await js('window.mainsAgentsSaveNow()');win.destroy();await bridge.close();store.close();store=createDesktopStateStore(out,'fixture');store.write(profile,'production-flows',{schemaVersion:1,flows:[],activeByWorkspace:{}});bridge=createContentWorkflowBridge(options);
 await open('board');await openNewProduction();
 await until(()=>js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Criar configuração de produção")'),'create flow offer');
 await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Criar configuração de produção").click()');
 await until(()=>flows().flows.length===1&&flows().activeByWorkspace[workspaceId]===flows().flows[0].id,'flow created from the dialog');
 await until(()=>js('Boolean(document.querySelector(\'[aria-label="Editor de vídeo"]\'))'),'roles of the new flow');
 assert.equal(sends,0);assert.equal(runs(),0);assert.deepEqual(errors,[]);
 console.log(`PRODUCTION_FLOWS_UI_OK: #flow opens Canvas, no Flow nav, roles from the saved flow, workspace-scoped agents, same production-flows shape, no production or AI, light/dark/360px, reopen, create flow when none. Screenshots: ${out}`);
 win.destroy();await bridge.close();store.close();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(await js('document.body.innerText'));await screenshot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
