// Paper carousel settings in the agent editor: real renderer, real Paper inspector (scripted `paper mcp` stdio, no Desktop,
// no AI), real approval coordinator and binding. No personal profile, no Paper writes, no network.
// Usage: npx electron scripts/test-paper-agent-ui.mjs   (MAINSAGENTS_UI_DIST=<built ui dir>, default dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {inspectPaperDesktop} from '../paper-desktop.mjs';
import {paperVisualStyle} from '../paper-design.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/paper-agent-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',at=new Date().toISOString();
const agent={id:'carrosseis',name:'Criador de Carrosseis',role:'Carrosséis',description:'Fixture',instructions:'Fixture only',workspaceId:'my-workspace',tools:[],skills:[],status:'idle',providerId:'claude',mcpPermissions:['read','write','delete'],createdAt:at,updatedAt:at};
const legacy={...agent,id:'legacy',name:'Agente Antigo',providerId:'codex'};
const state={agents:[agent,legacy],workspaces:[{id:'my-workspace',name:'Fixture',createdAt:at,updatedAt:at}],sessions:[{id:'chat',agentId:'carrosseis',providerId:'claude',title:'Fixture',remoteSessionId:'8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d',messages:[],createdAt:at,updatedAt:at}],'active-sessions':{carrosseis:'chat'},'current-workspace':'my-workspace',language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
ipcMain.handle('test:read',(_e,key)=>state[key]);ipcMain.handle('test:write',(_e,key,value)=>state[key]=value);ipcMain.handle('test:all',()=>state);
const bridge=createContentWorkflowBridge({dbPath:resolve(out,'state.sqlite'),getCurrentProfile:()=>profile,getAgents:()=>state.agents,getSessions:()=>state.sessions});
// Scripted `paper mcp`: the open file changes between connections; every tool call is recorded.
let openFile={id:'01JFILEA',name:'Carrosséis 2026'},paperDelayMs=0;const paperCalls=[];
const paperCli=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.stdout.end();setImmediate(()=>child.emit('close',null));};let buffer='';
 child.stdin=new Writable({write(chunk,_e,done){buffer+=chunk;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.id===undefined)continue;
  let result;if(message.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}}};else{paperCalls.push(message.params.name);result=message.params.name==='get_guide'?{content:[{type:'text',text:'guide'}]}:message.params.name==='get_basic_info'?{content:[{type:'text',text:JSON.stringify({fileId:openFile.id,fileName:openFile.name})}]}:{content:[{type:'text',text:'unexpected'}],isError:true};}
  child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');}done();}});return child;};
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/providers/claude/paper')try{if(paperDelayMs)await new Promise(r=>setTimeout(r,paperDelayMs));return json(res,await inspectPaperDesktop({spawnImpl:paperCli,timeoutMs:3000}));}catch(error){return json(res,{error:error.message},500);}
 if(url.pathname==='/api/providers/claude/models')return json(res,{models:[{id:'sonnet',name:'Claude Sonnet'}]});
 if(url.pathname==='/api/codex/health')return json(res,{ready:true,status:'connected',accountType:'chatgpt'});if(url.pathname==='/api/codex/models')return json(res,{models:[]});if(url.pathname.endsWith('/images'))return json(res,{events:[]});
 if(await bridge.handle(req,res,url))return;if(url.pathname.startsWith('/api/'))return json(res,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),path=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(path.startsWith(dist+sep));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream');res.end(readFileSync(path));}catch{res.statusCode=404;res.end();}});
let win;const js=code=>win.webContents.executeJavaScript(code),errors=[];
async function until(check,label){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error(`Paper agent UI timed out: ${label}`);}
async function open(width=1440,height=1000){win=new BrowserWindow({show:false,width,height,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',e=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(e.message))errors.push(e.message);});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await js('window.confirm=()=>true;true');}
async function configure(name){await until(()=>js(`Boolean(document.querySelector('[aria-label="Configurar ${name}"]'))`),'agent card');await js(`document.querySelector('[aria-label="Configurar ${name}"]').click()`);await until(()=>js('Boolean(document.querySelector(".agent-drawer"))'),'drawer');}
const section=async label=>{await js(`Array.from(document.querySelectorAll(".agent-editor-nav button")).find(el=>el.textContent.trim().endsWith(${JSON.stringify(label)})).click()`);};
const paperSection='document.querySelector(\'[data-editor-section="paper"]\')';
const checkbox=text=>`Array.from(${paperSection}.querySelectorAll("label")).find(el=>el.textContent.includes(${JSON.stringify(text)})).querySelector("input")`;
const typeInto=(selector,value)=>js(`(()=>{const el=${selector};Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const connect=()=>js(`Array.from(${paperSection}.querySelectorAll("button")).find(el=>el.textContent.includes("Conectar arquivo aberto")).click()`);
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));}
const call=(tool,args,replies)=>{const binding=bridge.claudeBinding(state.sessions[0].remoteSessionId);return bridge.actions.register({requestId:String(Math.random()),threadId:state.sessions[0].remoteSessionId,executionId:'turn',server:'paper',tool,arguments:args},binding,r=>replies.push(r),()=>bridge.claudeBinding(state.sessions[0].remoteSessionId));};
app.whenReady().then(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));
 // 1) Configure: enable, connect the open file (real inspector), signature, blue editorial default, no-repeat option.
 await open();await configure('Criador de Carrosseis');await section('Paper');
 assert.equal(await js(`${checkbox('sem confirmações repetidas')}.disabled`),true,'no grant before a file is connected');
 await js(`${checkbox('Usar Paper para criar carrosséis')}.click()`);await connect();
 await until(()=>js(`${paperSection}.textContent.includes('Carrosséis 2026')`),'connected file shown');
 assert.deepEqual(paperCalls,['get_guide','get_basic_info'],'deterministic read-only inspection');
 assert.equal(await js(`${paperSection}.querySelector('textarea').value`),paperVisualStyle,'editorial base is the editable default');
 await typeInto(`${paperSection}.querySelector('input[maxlength="120"]')`,'@pedro.cria');
 await js(`${checkbox('sem confirmações repetidas')}.click()`);
 await shot('paper-section-desktop');
 await js('document.querySelector(".drawer-footer .primary-button").click()');
 await until(()=>state.agents[0].paperDesign?.automatic===true,'saved');
 assert.deepEqual({...state.agents[0].paperDesign,visualStyle:undefined},{enabled:true,automatic:true,fileId:'01JFILEA',fileName:'Carrosséis 2026',signature:'@pedro.cria',visualStyle:undefined});
 assert.equal(state.agents[1].paperDesign,undefined,'other agents untouched');
 // 2) The saved preference is what the real binding/approval coordinator applies.
 const replies=[];
 const created=call('create_page',{fileId:'01JFILEA',name:'Carrossel 1'},replies);assert.equal(replies[0].action,'accept');assert.equal(bridge.actions.list(profile).find(r=>r.id===created).approvalSource,'paper-preference');
 const removal=call('delete_nodes',{fileId:'01JFILEA',nodeIds:['1']},replies);assert.equal(replies.length,1,'deletion waits');assert.equal(bridge.actions.list(profile).find(r=>r.id===removal).status,'pending');
 call('update_styles',{fileId:'OTHER',updates:[]},replies);assert.equal(replies.length,1,'another file waits');
 // 3) Restart: the settings persist; connecting a different file drops the grant until re-enabled.
 await js('window.mainsAgentsSaveNow?.()');win.destroy();await open(390,844);await configure('Criador de Carrosseis');await section('Paper');
 assert.equal(await js(`${checkbox('sem confirmações repetidas')}.checked`),true);assert.equal(await js(`${paperSection}.querySelector('input[maxlength="120"]').value`),'@pedro.cria');
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal scroll at phone width');
 await shot('paper-section-narrow');
 // A slow lookup: signature and style typed while it runs survive the result.
 openFile={id:'01JFILEB',name:'Outro arquivo'};paperDelayMs=1200;const lookups=paperCalls.length;await connect();
 await typeInto(`${paperSection}.querySelector('input[maxlength="120"]')`,'@editado.durante');
 await typeInto(`${paperSection}.querySelector('textarea')`,'ESTILO_EDITADO_DURANTE_A_CONEXAO');
 assert.equal(paperCalls.length,lookups,'the lookup is still pending while the person types');
 await until(()=>js(`${paperSection}.textContent.includes('Outro arquivo')`),'second file shown');paperDelayMs=0;
 assert.equal(await js(`${paperSection}.querySelector('input[maxlength="120"]').value`),'@editado.durante','signature typed during the lookup kept');
 assert.equal(await js(`${paperSection}.querySelector('textarea').value`),'ESTILO_EDITADO_DURANTE_A_CONEXAO','style typed during the lookup kept');
 assert.equal(await js(`${checkbox('sem confirmações repetidas')}.checked`),false,'a different file never inherits the grant');
 await js('document.querySelector(".drawer-footer .primary-button").click()');await until(()=>state.agents[0].paperDesign?.fileId==='01JFILEB','resaved');
 assert.equal(state.agents[0].paperDesign.signature,'@editado.durante');assert.equal(state.agents[0].paperDesign.visualStyle,'ESTILO_EDITADO_DURANTE_A_CONEXAO');
 // A lookup that finishes after the drawer closed changes nothing.
 const savedPaper=JSON.stringify(state.agents[0].paperDesign);await configure('Criador de Carrosseis');await section('Paper');openFile={id:'01JFILEC',name:'Arquivo tardio'};paperDelayMs=800;await connect();
 await js('document.querySelector(".drawer-footer .soft-button").click()');await until(()=>js('!document.querySelector(".agent-drawer")'),'closed during lookup');
 await new Promise(r=>setTimeout(r,1200));paperDelayMs=0;assert.equal(JSON.stringify(state.agents[0].paperDesign),savedPaper,'late result ignored');assert.equal(Object.keys(state['agent-drafts']??{}).length,0,'no draft from a late result');
 assert.equal(state.agents[0].paperDesign.automatic,false);
 const before=replies.length;call('create_page',{fileId:'01JFILEB',name:'x'},replies);assert.equal(replies.length,before,'without the grant every call waits');
 // 4) An unfinished Paper setup in a new agent survives closing the drawer and a restart.
 win.destroy();await open();
 await until(()=>js("Boolean(Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Criar agente'&&el.getClientRects().length))"),'create button');
 await js("Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Criar agente'&&el.getClientRects().length).click()");await until(()=>js('Boolean(document.querySelector(".agent-drawer"))'),'new drawer');
 await typeInto("document.querySelector('.agent-drawer input[required]')",'RASCUNHO_PAPER');
 await section('Paper');await js(`${checkbox('Usar Paper para criar carrosséis')}.click()`);await typeInto(`${paperSection}.querySelector('input[maxlength="120"]')`,'@rascunho');
 await js('document.querySelector(".drawer-footer .soft-button:not([type=submit])")?.click()');
 await until(()=>js('!document.querySelector(".agent-drawer")'),'drawer closed');
 const drafts=Object.values(state['agent-drafts']??{});assert.equal(drafts.length,1);assert.equal(drafts[0].values.paperDesign.signature,'@rascunho');assert.equal(drafts[0].values.paperDesign.fileId,'');
 await js('window.mainsAgentsSaveNow?.()');win.destroy();await open();
 await js("Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Criar agente'&&el.getClientRects().length).click()");await until(()=>js('Boolean(document.querySelector(".agent-drawer"))'),'reopened drawer');
 assert.equal(await js("document.querySelector('.agent-drawer input[required]').value"),'RASCUNHO_PAPER','whole form restored');
 await section('Paper');assert.equal(await js(`${paperSection}.querySelector('input[maxlength="120"]').value`),'@rascunho');assert.equal(await js(`${checkbox('Usar Paper para criar carrosséis')}.checked`),true);
 await js('document.querySelector(".drawer-footer .primary-button").click()');
 await until(()=>js('Boolean(document.querySelector(".drawer-footer .form-error")?.textContent.trim())'),'save refused while incomplete');
 assert.equal(state.agents.length,2,'incomplete agent not created');
 assert.deepEqual(errors,[]);
 console.log(`PASS: Paper section saves file/signature/style, real inspector reads guide+basic info only, saved grant applied by the real binding (create auto, delete/other file wait), restart keeps settings, new file drops the grant, incomplete draft restored. Screenshots: ${out}`);
 win.destroy();await bridge.close();server.close();app.exit(0);
}catch(e){console.error(e);if(win&&!win.isDestroyed()){try{writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());console.log((await js('document.body.innerText')).slice(0,3000));}catch{}win.destroy();}await bridge.close();server.close();app.exit(1);}});
