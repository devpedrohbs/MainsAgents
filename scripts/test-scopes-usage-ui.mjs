// Scopes and per-provider Usage in the real renderer (hidden Electron, isolated SQLite fixture, simulated Codex chat and plan limits;
// no AI accounts, no network). Creates scopes with agents, opens a scope chat whose reply reports usage, and checks that the turn
// lands in the usage ledger under its scope, the sidebar meters, both provider pages, light/dark and a narrow window.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/scopes-usage-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date(Date.now()-3600_000).toISOString(),dbPath=join(out,'workspace-state.sqlite'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const agent=(id,name,role,providerId)=>({id,name,role,instructions:'Fixture',description:role,skills:[],workspaceId,providerId,tools:['files'],status:'idle',createdAt:at,updatedAt:at});
const agents=[agent('writer','Roteirista','Roteiro','codex'),agent('editor','Editor de vídeo','Vídeo','claude'),agent('cover','Designer de capa','Capas','claude'),agent('publisher','Publicador','Publicação','codex')];
// Thirty days of reported turns: Claude with its own cost estimate, Codex with tokens only.
const ledger=[];let serialEntry=0;const today=new Date();
for(let day=29;day>=0;day--)for(const [provider,agentId] of [['claude','editor'],['claude','cover'],['codex','writer'],['codex','publisher']]){const k=(day*7+agentId.length*3)%5;if(!k)continue;
 ledger.push({id:`seed-${serialEntry++}`,at:new Date(today.getFullYear(),today.getMonth(),today.getDate()-day,9+k).toISOString(),provider,agentId,workspaceId,sessionId:'seed',model:provider==='claude'?'claude-opus-5-5':'gpt-5.5-codex',tokens:{input:2000*k,output:400*k,cacheRead:20000*k,...(provider==='claude'?{cacheCreation:3000*k}:{})},...(provider==='claude'?{costUsd:0.04*k}:{})});}
const store=createDesktopStateStore(out,'test');
store.initialize(profile,{agents,workspaces:[{id:workspaceId,name:'Conteúdos',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,'usage-ledger':ledger,language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
const runtime={createSession:async()=>'cli',resumeSession:async()=>{},readThread:async()=>({turns:[]}),cancel:async()=>{},send:async()=>{throw Error('No CLI run in this scenario')},events:async function*(){}};
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{throw Error('No Notion')},readCard:async()=>{throw Error('No Notion')}})});
const reset=Math.floor(Date.now()/1000)+3*3600;
const chatRuns=new Map();let serial=0,completedTurns=0,claudeRefreshes=0,claudeSignedOut=false;
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path==='/api/providers/claude/usage'){if(url.searchParams.get('refresh')==='1')claudeRefreshes++;return json(response,claudeSignedOut?{fiveHours:null,weekly:null,error:'login-required',source:'account'}:{fiveHours:{usedPercent:claudeRefreshes?19:18,resetsAt:reset},weekly:{usedPercent:34,resetsAt:reset+4*86400},source:'account',plan:'pro',observedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()});}
 if(path.startsWith('/api/codex/')){let input={};if(request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;input=JSON.parse(text||'{}');}
  if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path.endsWith('/usage'))return json(response,{rateLimits:{planType:'plus',primary:{usedPercent:40+2*completedTurns,windowDurationMins:300,resetsAt:reset},secondary:{usedPercent:61,windowDurationMins:10080,resetsAt:reset+2*86400}},fetchedAt:new Date().toISOString()});
  if(path==='/api/codex/sessions')return json(response,{threadId:input.threadId??`chat-thread-${++serial}`});
  if(path==='/api/codex/executions'){const executionId=`chat-turn-${++serial}`,run={events:[],streams:new Set(),done:false};chatRuns.set(executionId,run);run.events.push({type:'execution.started',executionId,threadId:input.remoteSessionId});
   setTimeout(()=>{emit(run,{type:'message.completed',executionId,content:'RESPOSTA_DO_ESCOPO'});emit(run,{type:'usage.reported',executionId,usage:{version:1,status:'reported',provider:'codex',tokens:{input:777,output:111,cacheRead:2222}}});completedTurns++;emit(run,{type:'execution.completed',executionId});},200);return json(response,{executionId});}
  const stream=path.match(/\/executions\/([^/]+)\/events$/);if(stream){const run=chatRuns.get(stream[1]);response.setHeader('content-type','application/x-ndjson');for(const event of run.events)response.write(JSON.stringify(event)+'\n');if(run.done)response.end();else{run.streams.add(response);request.on('close',()=>run.streams.delete(response));}return;}
  return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
let win;const errors=[],js=code=>win.webContents.executeJavaScript(code),log=[];
async function until(check,label='condition'){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Scopes/usage UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function shot(name,{dark=true}={}){await js(`document.documentElement.dataset.appearance=${JSON.stringify(dark?'dark':'light')}`);writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));log.push(`${name}.png`);}
const text=selector=>js(`document.querySelector(${JSON.stringify(selector)})?.textContent??''`);
async function createScope(title,goal,names){
 await click('[data-od-id="create-scope"]');await inputText('.scope-form input:not([type])',title);await inputText('.scope-form textarea',goal);
 await js(`for(const label of document.querySelectorAll('.scope-pick'))if(${JSON.stringify(names)}.some(name=>label.textContent.includes(name)))label.querySelector('input').click()`);
 await until(async()=>(await text('.scope-form legend b')).startsWith(String(names.length)),'agents picked');
}
async function open({width=1440,height=1000}={}){win=new BrowserWindow({show:false,width,height,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#scopes`);await until(()=>js('Boolean(document.querySelector(".scopes-page"))'),'scopes page');}

app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 assert.equal(await js('document.querySelector(\'[data-od-id="nav-scopes"]\').getAttribute("aria-current")'),'page','Escopos is the active sidebar item');
 assert.equal(await js('document.querySelectorAll(".scope-card:not(.scope-card-new)").length'),0);
 await until(async()=>(await text('[data-od-id="nav-usage-codex"] b'))==='40%','Codex meter before any reply');
 await shot('01-scopes-empty');
 // 1. A new scope: one content, one chat per chosen agent inside it, collaboration turned on for them.
 await createScope('Post para LinkedIn','Carrossel semanal sobre automação no Excel.',['Roteirista','Designer de capa','Publicador']);
 await shot('02-new-scope-dialog');
 await click('.scope-form button[type=submit]');await until(()=>js('Boolean(document.querySelector(".scope-page"))'),'scope detail');
 await until(()=>store.read(profile,'sessions')?.some(session=>session.contentTitle==='Post para LinkedIn'&&session.contentId),'scoped chat saved');
 const content={id:store.read(profile,'sessions').find(session=>session.contentTitle==='Post para LinkedIn').contentId};
 await until(()=>store.read(profile,'sessions')?.filter(session=>session.contentId===content.id).length===3,'three scoped chats saved');
 assert.deepEqual(store.read(profile,'sessions').filter(session=>session.contentId===content.id).map(session=>session.agentId).sort(),['cover','publisher','writer']);
 await until(()=>store.read(profile,'agents').filter(item=>item.tools.includes('subagents')).length===3,'collaboration on for the chosen agents');
 assert.equal(await js('document.querySelectorAll(".scope-agent").length'),3);
 assert.equal(await text('.scope-head p'),'Carrossel semanal sobre automação no Excel.','goal shown');
 await shot('03-scope-detail');await shot('04-scope-detail-light',{dark:false});
 // 2. "Abrir chat" opens that agent's chat of THIS scope; its reply reports usage, recorded under the scope.
 await js(`Array.from(document.querySelectorAll('.scope-agent')).find(el=>el.textContent.includes('Roteirista')).querySelector('.primary-button').click()`);
 await until(()=>js(`document.querySelector('.content-scope-picker .select-menu-value')?.textContent==='Post para LinkedIn'`),'chat opened in the scope');
 await inputText('.composer textarea','Escreva o primeiro slide');await click('.send-button');
 await until(()=>js(`document.querySelector('.chat-body')?.innerText.includes('RESPOSTA_DO_ESCOPO')`),'scope reply');
 await until(()=>store.read(profile,'usage-ledger')?.some(entry=>entry.contentId===content.id),'usage recorded');
 const recorded=store.read(profile,'usage-ledger').find(entry=>entry.contentId===content.id);
 assert.deepEqual({provider:recorded.provider,agentId:recorded.agentId,workspaceId:recorded.workspaceId,tokens:recorded.tokens},{provider:'codex',agentId:'writer',workspaceId,tokens:{input:777,output:111,cacheRead:2222}});
 // Live: the reply refreshes the Codex meter at once (the periodic read is minutes away).
 await until(async()=>(await text('[data-od-id="nav-usage-codex"] b'))==='42%','Codex meter refreshed by the reply');
 await shot('05-scope-chat');
 // 3. A second scope runs beside the first one, separated.
 await js(`document.querySelector('[data-od-id="nav-scopes"]').click()`);await until(()=>js('Boolean(document.querySelector(".scopes-page"))'),'back to list');
 await createScope('Tutorial de automação no Excel','Vídeo curto para Reels e TikTok.',['Roteirista','Editor de vídeo']);
 await click('.scope-form button[type=submit]');await until(()=>js('Boolean(document.querySelector(".scope-page"))'),'second scope');
 await js(`document.querySelector('.scope-trail a').click()`);await until(()=>js('document.querySelectorAll(".scope-card:not(.scope-card-new)").length===2'),'two scope cards');
 await shot('06-scopes-list');await shot('07-scopes-list-light',{dark:false});
 // 4. Sidebar meters and the provider pages.
 await until(async()=>(await text('[data-od-id="nav-usage-claude"] b'))==='18%','Claude meter');
 await until(async()=>(await text('[data-od-id="nav-usage-codex"] b'))==='42%','Codex meter');
 await click('[data-od-id="nav-usage-claude"]');await until(()=>js('Boolean(document.querySelector(".usage-page.usage-claude"))'),'Claude usage');
 assert.match(await text('.usage-headline strong'),/US\$/);
 assert.equal(await js('document.querySelectorAll(".usage-chart button").length'),30);
 await until(()=>js(`document.querySelector('.usage-limit small')?.textContent.includes('Lido da conta Claude')`),'Claude account source before a Claude conversation');
 await until(()=>js(`!document.querySelector('.usage-refresh').disabled`),'refresh ready');
 await click('.usage-refresh');
 await until(async()=>(await js(`Array.from(document.querySelectorAll('.usage-limit text')).map(el=>el.textContent).join(',')`))==='19%,34%','manual refresh reads new account limits');
 assert.equal(claudeRefreshes,1);
 await shot('08-usage-claude');await shot('09-usage-claude-light',{dark:false});
 claudeSignedOut=true;
 await until(()=>js(`!document.querySelector('.usage-refresh').disabled`),'sign-out refresh ready');await click('.usage-refresh');
 await until(()=>js(`document.querySelector('.usage-limit small')?.textContent.includes('claude auth login')`),'sign-in instruction on rejected credentials');
 assert.equal(await js(`document.querySelector('.usage-limit text').textContent.includes('%')`),false,'old account numbers cleared');
 claudeSignedOut=false;
 await click('[data-od-id="nav-usage-codex"]');await until(()=>js('Boolean(document.querySelector(".usage-page.usage-codex"))'),'Codex usage');
 await until(async()=>(await js(`Array.from(document.querySelectorAll('.usage-limit text')).map(el=>el.textContent).join(',')`))==='42%,61%','Codex limits');
 await js(`Array.from(document.querySelectorAll('.usage-segment button')).find(el=>el.textContent==='Escopo').click()`);
 await until(()=>js(`Array.from(document.querySelectorAll('.usage-row-name')).some(el=>el.textContent.includes('Post para LinkedIn'))`),'scope breakdown');
 await shot('10-usage-codex');await shot('11-usage-codex-light',{dark:false});
 // 4a. Overview with the scopes, chats and usage above.
 await js(`document.querySelector('[data-od-id="nav-home"]').click()`);await until(()=>js('Boolean(document.querySelector("[data-od-id=workspace-overview]"))'),'overview');
 await shot('15-home');await shot('16-home-light',{dark:false});
 await js(`(()=>{const v=document.querySelector('[data-od-id="workspace-overview"]');let e=v;while(e&&e.scrollHeight<=e.clientHeight)e=e.parentElement;if(e)e.scrollTop=e.scrollHeight;})()`);await shot('17-home-bottom');
 await js(`(()=>{let e=document.querySelector('[data-od-id="workspace-overview"]');while(e&&e.scrollHeight<=e.clientHeight)e=e.parentElement;if(e)e.scrollTop=0;})()`);
 { const close=await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.match(/Fechar chat|Close chat|Fechar painel/));if(b){b.click();return true}return false})()`); if(close){await new Promise(r=>setTimeout(r,400));await shot('18-home-wide');} }
 // Round 6 pages, chat closed: Board, Agents, History, Canvas, Calendar.
 for(const [hash,name,ready] of [['board','20-board','.qb'],['agents','21-agents','.ag'],['sessions','22-history','[data-od-id="sessions-page"],.sessions-page,.hs'],['canvas','23-canvas','.react-flow'],['content','24-studio','.page']]){await js(`location.hash=${JSON.stringify(hash)}`);await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(ready)}))`),hash);await new Promise(r=>setTimeout(r,500));await shot(name);}
 await js(`window.dispatchEvent(new CustomEvent('mainsagents:publication-calendar'))`);await until(()=>js(`Boolean(document.querySelector('[data-od-id="publication-calendar"]'))`),'calendar');await new Promise(r=>setTimeout(r,400));await shot('25-calendar');
 await js(`location.hash='home'`);
 // 4b. Studio keeps the new-topic form in the list column; Flow has the floating tool bar and the box sheet.
 await js(`document.querySelector('[data-od-id="nav-content"]').click()`);await until(()=>js('Boolean(document.querySelector(".editorial-rail .editorial-intake"))'),'studio intake in the list column');
 await shot('13-studio');
 // Flow page was retired (#flow → Canvas); V2 shows the production flow on Pipelines.
 await js(`document.querySelector('[data-od-id="nav-pipelines"]').click()`);await until(()=>js('Boolean(document.querySelector("[data-od-id=pipelines-page]"))'),'pipelines page');
 await shot('14-pipelines');
 // 5. Narrow window: no horizontal page scroll on either page.
 win.setSize(760,900);await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true,'usage fits a narrow window');
 await js(`document.querySelector('[data-od-id="nav-scopes"]').click()`);await until(()=>js('Boolean(document.querySelector(".scopes-page"))'),'scopes narrow');
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true,'scopes fit a narrow window');
 await shot('12-scopes-narrow');
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'report.json'),JSON.stringify({ok:true,screenshots:log},null,1));
 console.log(`SCOPES_USAGE_UI_OK ${out}`);win.destroy();server.close();app.exit(0);
}catch(error){console.error(error);if(win&&!win.isDestroyed()){console.log((await js('document.body.innerText').catch(()=>'')).slice(0,3000));writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();}server.close();app.exit(1);}});
