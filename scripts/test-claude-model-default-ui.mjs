// Isolated renderer: local model metadata only, never a real Claude request.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_TEST_DIST??join(root,'dist'));
const out=join(root,'.mainsagents-workspaces/claude-model-default-ui',String(Date.now()));mkdirSync(out,{recursive:true});
app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const now=new Date().toISOString(),workspaceId='claude-default-fixture';
const agent={id:'fixture-claude',workspaceId,name:'Claude Fixture',providerId:'claude',role:'Researcher',description:'Synthetic fixture',tools:[],instructions:'Local test only',status:'idle',createdAt:now,updatedAt:now};
const state={agents:[agent],workspaces:[{id:workspaceId,name:'Model fixture',createdAt:now,updatedAt:now}],sessions:[],tasks:[],'current-workspace':workspaceId,'active-sessions':{},language:'pt-BR',appearance:'dark'};
ipcMain.handle('test:all',()=>state);ipcMain.handle('test:read',(_e,key)=>state[key]);ipcMain.handle('test:write',(_e,key,value)=>{state[key]=value});
let defaultModel={id:'opus',name:'Claude Opus',source:'user-settings'},requests=0,win;
const errors=[];
const bridge=createContentWorkflowBridge({dbPath:join(out,'state.sqlite'),getCurrentProfile:()=> 'handoff-test',getAgents:()=>state.agents,getSessions:()=>state.sessions});
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=url.pathname;
 if(path==='/api/providers/claude/status')return json(res,{providerId:'claude',state:'connected',authMode:'cli',connectionName:'Claude Code',defaultModel});
 if(path==='/api/providers/claude/models')return json(res,{models:[{id:'opus',name:'Claude Opus'},{id:'sonnet',name:'Claude Sonnet'}]});
 if(path==='/api/providers/claude/executions'||path==='/api/providers/claude/sessions'){requests++;res.statusCode=500;return json(res,{error:'No inference or remote session allowed'});}
 if(await bridge.handle(req,res,url))return;
 if(path.startsWith('/api/'))return json(res,{ready:false,state:'not-installed',sessions:[],jobs:[],actions:[],models:[]});
 const file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch(error){res.statusCode=500;json(res,{error:error.message})}});
const js=expression=>win.webContents.executeJavaScript(expression);
async function until(predicate,label){const end=Date.now()+10_000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,40))}throw Error(`Timed out: ${label}`)}
const click=selector=>js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing control');b.click()})()`);
const pill=()=>js('document.querySelector(".model-picker-name")?.textContent');
async function open(){win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:join(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);callback({cancel:['http:','https:'].includes(url.protocol)&&url.hostname!=='127.0.0.1'})});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>js('!!document.querySelector(\'.agent-nav[title="Claude Fixture"]\')'),'agent');await click('.agent-nav[title="Claude Fixture"]');await until(()=>js('!!document.querySelector(".model-picker-trigger")'),'model picker')}
app.whenReady().then(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 await open();await until(async()=>await pill()==='Claude Opus','configured default');
 assert.match(await js('document.querySelector(".model-picker-trigger").getAttribute("aria-label")'),/Claude Code.*Claude Opus.*Médio/);
 await click('.model-picker-trigger');assert.match(await js('document.querySelector(".model-select").textContent'),/Padrão do Claude Code.*Configurado: Claude Opus/s);
 await js(`(()=>{const b=[...document.querySelectorAll('.model-select button')].find(b=>b.textContent.trim()==='Claude Sonnet');if(!b)throw Error('Missing Sonnet');b.click()})()`);
 await until(async()=>await pill()==='Claude Sonnet','explicit model');await js('window.mainsAgentsSaveNow()');assert.equal(state.sessions.at(-1).modelId,'sonnet');
 defaultModel={id:'haiku',name:'Claude Haiku',source:'environment'};await js('window.dispatchEvent(new Event("focus"))');await new Promise(r=>setTimeout(r,150));assert.equal(await pill(),'Claude Sonnet');
 await click('.model-select button');await until(async()=>await pill()==='Claude Haiku','updated CLI default');await js('window.mainsAgentsSaveNow()');assert.equal(state.sessions.at(-1).modelId,undefined);
 await js('window.mainsAgentsSaveNow()');win.destroy();await open();await until(async()=>await pill()==='Claude Haiku','default after reopen');
 await click('.model-picker-trigger');writeFileSync(join(out,'default-dark.png'),await captureReadyPng(win.webContents));
 win.setSize(360,800);await new Promise(r=>setTimeout(r,150));assert(await js('document.documentElement.scrollWidth<=innerWidth+1'));
 assert(await js('(()=>{const menu=document.querySelector(".model-picker-pop"),r=menu.getBoundingClientRect();return menu.matches(":popover-open")&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'),'model menu remains entirely visible above clipped chat panels');
 writeFileSync(join(out,'default-360.png'),await captureReadyPng(win.webContents));
 defaultModel=undefined;await js('window.dispatchEvent(new Event("focus"))');await until(async()=>await pill()==='Claude Code','unknown default is honest');
 win.destroy();state.agents=[{...agent,modelId:'sonnet'}];state.sessions=[];state['active-sessions']={};state.language='en-US';state.appearance='light';delete state['content-scopes'];await open();await until(async()=>await pill()==='Claude Sonnet','agent default before first chat');
 await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Light');if(!b)throw Error('Light appearance switch missing');b.click()})()`);
 await click('.model-picker-trigger');assert.match(await js('document.querySelector(".model-picker-trigger").getAttribute("aria-label")'),/Medium effort/);writeFileSync(join(out,'explicit-light-en.png'),await captureReadyPng(win.webContents));
 await js('(()=>{const b=document.querySelector(".model-select button");b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))})()');
 assert(await js('document.querySelector(".model-picker-pop").hidden&&!document.querySelector(".model-picker-pop").matches(":popover-open")&&document.activeElement===document.querySelector(".model-picker-trigger")'),'Escape closes and restores focus');
 assert.equal(state.sessions.length,0);assert.equal(requests,0);assert.deepEqual(errors,[]);
 console.log(`CLAUDE_MODEL_DEFAULT_UI_OK: configured model, CLI identity, effort, explicit override, refresh, reopen, unknown default, agent model, 360px; no inference. ${out}`);
 await bridge.close();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed())writeFileSync(join(out,'failure.png'),await captureReadyPng(win.webContents).catch(()=>Buffer.alloc(0)));await bridge.close();server.close();app.exit(1)}}).catch(error=>{console.error(error);app.exit(1)});
