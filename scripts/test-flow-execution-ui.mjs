// D04: the Flow page explains what production really executes. Real renderer + state store; no AI, no provider.
// Usage: electron scripts/test-flow-execution-ui.mjs   (MAINSAGENTS_DIST=<built app dir>, default ./dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_DIST??resolve(root,'dist')),out=resolve(root,'.mainsagents-workspaces/flow-execution-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
// The shared fixture preload pins this profile name.
const profile='handoff-test',workspaceId='space',at=new Date().toISOString();
const base={workspaceId,description:'Fixture',instructions:'Keep my role',skills:[],tools:['files'],status:'idle',createdAt:at,updatedAt:at};
const agents=[{...base,id:'content',name:'Editor de Conteúdo',role:'Conteúdo',providerId:'codex'},{...base,id:'video',name:'Editor de Vídeo',role:'Vídeo',providerId:'codex'},{...base,id:'claude',name:'Revisor Claude',role:'Revisão',providerId:'claude'}];
const box=(id,kind,title,x,agentId)=>({id,kind,title,position:{x,y:140},...(agentId?{agentId}:{})});
const flow={id:'flow-d04',workspaceId,name:'Fluxo D04',nodes:[box('b-content','content-agent','Agente de conteúdo',80,'content'),box('b-input','video-input','Vídeos da gravação',430),box('b-video','video-agent','Editor de vídeo',780,'video'),box('b-publish','publishing-agent','Preparar publicação',1130,'content'),{...box('b-extra','video-agent','Editor alternativo',430,'claude'),position:{x:430,y:520}}],edges:[{id:'l1',source:'b-content',target:'b-input',kind:'sequence'},{id:'l2',source:'b-input',target:'b-video',kind:'sequence'},{id:'l3',source:'b-video',target:'b-publish',kind:'sequence'},{id:'l4',source:'b-content',target:'b-extra',kind:'context'}],createdAt:at,updatedAt:at};
const flows={schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}};
const initial={agents,workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[],'active-sessions':{},'current-workspace':workspaceId,'production-flows':flows,language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
let store=createDesktopStateStore(out,'fixture');store.initialize(profile,initial);
ipcMain.handle('test:read',(_event,key)=>store.read(profile,key));ipcMain.handle('test:write',(_event,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
let sends=0;const runtime={connect:async()=>{sends++;return 'never'},send:async()=>{sends++;throw Error('No AI in this test')},events:async function*(){},cancel:async()=>{}};
const bridge=createContentWorkflowBridge({dbPath:resolve(out,'workspace-state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getSessions:()=>store.read(profile,'sessions'),getFlows:()=>store.read(profile,'production-flows'),getChatRuntime:()=>runtime,getRuntime:()=>null});
// An active (non-terminal) production of this flow, as the coordinator stores it: agent snapshots taken at start.
const runDb=new DatabaseSync(resolve(out,'workspace-state.sqlite')),session=(id,agentId)=>({id,agentId,providerId:'codex',contentId:'content-run',title:'Fixture',messages:[],createdAt:at,updatedAt:at});
const activeRun={id:'production-fixture',profileId:profile,workspaceId,contentId:'content-run',topicId:'topic',flowId:flow.id,name:flow.name,topic:{id:'topic',title:'Ideia em produção',workspaceId,status:'approved'},sourceAgent:{id:'content',name:'Editor de Conteúdo'},editorAgent:{id:'video',name:'Editor de Vídeo'},sourceSession:session('run-source','content'),editorSession:session('run-editor','video'),notionDestination:'fixture',timeZone:'America/Sao_Paulo',epoch:1,stage:'recording',events:[],createdAt:at,updatedAt:at};
runDb.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run(activeRun.id,profile,workspaceId,activeRun.contentId,1,JSON.stringify(activeRun),at);
const runRow=()=>runDb.prepare('SELECT revision,data_json FROM production_runs WHERE id=?').get(activeRun.id);const runBefore=JSON.stringify(runRow());
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');if(await bridge.handle(request,response,url))return;if(url.pathname.endsWith('/health'))return json(response,{ready:true,accountType:'chatgpt'});if(url.pathname.endsWith('/models'))return json(response,{models:[]});if(url.pathname.endsWith('/images'))return json(response,{events:[]});if(url.pathname.startsWith('/api/'))return json(response,{});try{const file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[];let win;const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error(`Flow execution UI timed out: ${label}`)}
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
const panelText=()=>js('document.querySelector(".flow-execution")?.innerText??""');
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#flow`);await until(()=>js('document.querySelectorAll(".production-box").length===5'),'five boxes');
 const before=JSON.stringify(store.read(profile,'production-flows'));
 await until(()=>js('document.querySelector(".flow-execution")?.open===true'),'panel opens for an ambiguous role');
 const text=await panelText();
 for(const expected of ['Papel duplicado','Como a produção executa este fluxo','Roteiro (e card no Notion, se ativado)','Agendamento autorizado','usa somente “Editor de vídeo” (a primeira na lista salva deste fluxo)','Conexões de contexto não enviam dados','Edição: Editor de Vídeo'])assert(text.includes(expected),`missing: ${expected}\n${text}`);
 assert(!text.includes('somente agentes Codex'),'the unused Claude box never blocks a valid configuration');
 await until(async()=>(await panelText()).includes('Edições neste fluxo ficam salvas para a próxima produção'),'active run snapshot notice');
 await screenshot('flow-execution-light');
 await js('Array.from(document.querySelectorAll(".flow-execution .text-link")).find(b=>b.textContent.trim()==="Ver caixa").click()');
 await until(()=>js('Boolean(document.querySelector(".production-flow-detail"))'),'box detail');
 await js('document.documentElement.dataset.appearance="dark"');await screenshot('flow-execution-dark');
 win.setSize(360,800);await new Promise(resolve=>setTimeout(resolve,150));
 assert(await js('document.documentElement.scrollWidth<=360'),'no horizontal page scroll at 360px');await screenshot('flow-execution-360');
 await js('window.mainsAgentsSaveNow?.()');
 assert.equal(JSON.stringify(store.read(profile,'production-flows')),before,'viewing and inspecting never rewrites the saved diagram');
 assert.equal(JSON.stringify(runRow()),runBefore,'the active run is never rewritten from the Flow page');
 assert.equal(sends,0,'no AI or production runtime was touched');assert.deepEqual(errors,[]);
 console.log(`FLOW_EXECUTION_UI_OK: active-run snapshot notice, ambiguous role explained, fixed order shown, diagram preserved, no AI, light/dark/360px. Screenshots: ${out}`);
 win.destroy();runDb.close();await bridge.close();store.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){await screenshot('failure').catch(()=>{});win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}});
