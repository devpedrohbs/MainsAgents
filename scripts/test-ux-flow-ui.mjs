// Overview without onboarding, resume, sidebar groups, Scopes header. Isolated fixtures; no personal storage, CLI or external writes.
// Run after `npm run build`: npx electron scripts/test-ux-flow-ui.mjs   (UX_DIST=<dir> serves another build folder)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.UX_DIST||resolve(root,'dist')),out=resolve(root,'.mainsagents-workspaces/ux-flow-ui-test');
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,`profile-${Date.now()}`));
const at=new Date().toISOString(),earlier=new Date(Date.now()-3600_000).toISOString(),space='my-workspace',other='empty-workspace';
// Phase A: two empty workspaces; a legacy welcome flag must not restore an introduction.
const state={workspaces:[{id:space,name:'Content',createdAt:at,updatedAt:at},{id:other,name:'Outro espaço',createdAt:at,updatedAt:at}],'current-workspace':space,agents:[],sessions:[],'active-sessions':{},language:'pt-BR','welcome-dismissed':false,'focus-mode':false};
let revision=1,editorial={schemaVersion:1,topics:[],runs:[],artifacts:[],approvals:[],contents:[],assets:[],publications:[]};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
const json=(response,payload)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(payload))};
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/content/state'){
  if(request.method==='PUT'){let text='';for await(const chunk of request)text+=chunk;editorial=JSON.parse(text).state;revision++;}
  return json(response,{revision,state:editorial});
 }
 if(url.pathname.startsWith('/api/'))return json(response,url.pathname.endsWith('/work')?{jobs:[],mediaJobs:[],worker:{running:false}}:url.pathname.endsWith('/jobs')?{jobs:[]}:url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/calendar')?{sources:[]}:url.pathname.endsWith('/delegations')?{jobs:[],sessions:[],handoffs:[]}:url.pathname.endsWith('/actions')?{actions:[]}:{ready:false,events:[],version:'test'});
 try{const file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}
});
const topic=(id,title,status,contentId)=>({id,requestId:id,workspaceId:space,inputKind:'text',input:title,category:'IA e tecnologia',priority:'normal',status,title,summary:'Resumo de exemplo.',whyItMatters:'Contexto de exemplo.',angles:[],sources:[],factualQuestions:[],contentId,createdAt:earlier,updatedAt:earlier});
const content=(id,title,productionStage,updatedAt)=>({id,workspaceId:space,topicId:`topic-${id}`,title,format:'short-video',platforms:['Instagram'],status:'planning',productionStage,taskId:'',assetIds:[],createdAt:earlier,updatedAt});
let win;const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`UX flow timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
async function home(){await js('location.hash="home"');await until(()=>js('Boolean(document.querySelector(".ov-needs"))'),'overview')}
async function reload(){const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reloadIgnoringCache();await loaded;await home()}
async function switchWorkspace(name){await click('.workspace-switcher');await until(()=>js('Boolean(document.querySelector(".workspace-option"))'),'workspace menu');await js(`Array.from(document.querySelectorAll('.workspace-option')).find(el=>el.textContent.includes(${JSON.stringify(name)})).click()`);await until(()=>js(`document.querySelector('.workspace-switcher').textContent.includes(${JSON.stringify(name)})`),`workspace ${name}`);await home()}
const noGuide=()=>js('!document.querySelector(".welcome-guide,[data-od-id=overview-start],[data-od-id=overview-start-show]")');
const noOverflow=()=>js('document.documentElement.scrollWidth<=innerWidth+1');
const sizes=async name=>{for(const width of [880,360]){win.setSize(width,800);await new Promise(resolve=>setTimeout(resolve,120));assert(await noOverflow(),`${name}: overflow at ${width}px`);await screenshot(`${name}-${width}`)}win.setSize(1440,900);await new Promise(resolve=>setTimeout(resolve,120))};
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#home`);await home();

 // Sidebar: groups named by intent (no repeated "Workspace"), ordered as the work flows, tooltips say what each area is for.
 assert.deepEqual(await js('Array.from(document.querySelectorAll(".sidebar .nav-label")).map(el=>el.textContent)'),['Conteúdo','Workspace','Equipe']);
 assert.deepEqual(await js('Array.from(document.querySelectorAll(".sidebar .nav-item[data-od-id^=nav-]")).map(el=>el.dataset.odId)').then(ids=>ids.slice(0,12)),['nav-inbox','nav-home','nav-runs','nav-content','nav-radar','nav-references','nav-calendar','nav-board','nav-canvas','nav-pipelines','nav-scopes','nav-sessions']);
 assert(await js('Boolean(document.querySelector("[aria-labelledby=nav-group-team] [data-od-id=nav-agents]"))'));
 assert.match(await js('document.querySelector("[data-od-id=nav-content]").title'),/^Estúdio: /);
 assert.equal(await js('document.querySelector("[data-od-id=nav-content]").getAttribute("aria-label")'),'Estúdio');

 // A. New workspaces open directly on the overview, including old backups that request the welcome guide.
 assert(await noGuide());
 assert(await js('document.querySelector("[data-od-id=overview-create]").classList.contains("primary-button")'));
 await js('window.dispatchEvent(new Event("mainsagents:show-welcome"))');assert(await noGuide());
 await js('document.querySelector("[data-od-id=overview-create]").focus()');
 assert.equal(await js('document.activeElement.dataset.odId'),'overview-create');
 await screenshot('new-dark');await sizes('new');

 // Scopes: visible "+" on the new-scope card and history as a secondary header button.
 await js('location.hash="scopes"');await until(()=>js('Boolean(document.querySelector(".scope-card-new"))'),'scopes');
 assert.equal(await js('getComputedStyle(document.querySelector(".scope-plus svg")).width'),'18px');
 assert.notEqual(await js('getComputedStyle(document.querySelector(".scope-plus svg")).stroke'),'none');
 assert(await js('document.querySelector(".scopes-head-actions .scope-history-link.soft-button")!==null'));
 await screenshot('scopes-dark');

 // B. Team and ideas exist, nothing scheduled, nothing waiting. The published content is touched last but is finished,
 // so "Continue" must offer the one still in editing.
 state.agents=[{id:'writer',name:'Roteirista de exemplo',role:'Roteiro',description:'Agente fictício',instructions:'Fixture only',tools:[],skills:[],workspaceId:space,providerId:'codex',status:'idle',createdAt:at,updatedAt:at}];
 editorial={...editorial,topics:[topic('topic-editing','Pauta em edição','approved','editing'),topic('topic-done','Pauta publicada','approved','done')],contents:[content('editing','Vídeo em edição de exemplo','editing',earlier),content('done','Vídeo publicado de exemplo','ready',at)]};revision++;
 await reload();
 assert(await noGuide());
 assert.equal(await js('document.querySelectorAll(".ov-needs .ov-need").length'),0,'fixture B must have nothing waiting');
 await until(()=>js('Boolean(document.querySelector("[data-od-id=overview-resume]"))'),'resume row');
 const resumeText=await js('document.querySelector("[data-od-id=overview-resume]").textContent');
 assert.match(resumeText,/Vídeo em edição de exemplo/);assert.doesNotMatch(resumeText,/publicado/);
 await screenshot('populated-dark');
 await js('document.documentElement.dataset.appearance="light"');await screenshot('populated-light');await sizes('populated');await js('document.documentElement.dataset.appearance="dark"');

 // Studio vs Calendar: sidebar opens Calendar; Continue opens Studio, not the Calendar left open.
 await click('[data-od-id=nav-calendar]');
 await until(()=>js('document.querySelector("[data-od-id=nav-calendar]")?.getAttribute("aria-current")==="page"'),'calendar from sidebar');
 await home();await click('[data-od-id=overview-resume]');
 await until(()=>js('document.querySelector("[data-od-id=nav-content]")?.getAttribute("aria-current")==="page"&&!document.querySelector(".publishing-grid")'),'studio from resume');
 await home();

 // Switching workspaces never restores an introduction.
 assert(await js('document.querySelector("[data-od-id=overview-create]").classList.contains("primary-button")'));
 await switchWorkspace('Outro espaço');
 assert(await noGuide());
 await switchWorkspace('Content');
 assert(await noGuide());

 // C. Real pending work stays visible without a guide taking over its place.
 editorial={...editorial,topics:[...editorial.topics,topic('topic-draft','Pauta aguardando pesquisa','draft')]};revision++;
 await reload();
 await until(()=>js('document.querySelectorAll(".ov-needs .ov-need").length>0'),'pending item');
 assert(await noGuide());
 assert(await js('document.querySelector("[data-od-id=overview-create]").classList.contains("primary-button")'));
 assert(await js('!document.querySelector("[data-od-id=overview-resume]")'),'no resume while something waits');
 await screenshot('pending-dark');

 // English.
 state.language='en-US';await reload();
 assert(await noGuide());
 assert.deepEqual(await js('Array.from(document.querySelectorAll(".sidebar .nav-label")).map(el=>el.textContent)'),['Content','Workspace','Team']);
 await screenshot('pending-en');

 assert.deepEqual(errors,[]);console.log('UX_FLOW_UI_OK: sidebar groups/order/hints, no introduction in any workspace, primary action, resume skips finished work, Studio vs Calendar entry, Scopes header and "+", light/dark, PT/EN, 360/880/1440px.');
 win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){await screenshot('failure').catch(()=>{});win.destroy()}server.close();app.exit(1)}
});
