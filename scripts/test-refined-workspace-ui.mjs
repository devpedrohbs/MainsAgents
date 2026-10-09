// Production renderer; isolated fixtures, no personal storage, CLI or external writes.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/refined-ui-test');
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,`profile-${Date.now()}`));
const at=new Date().toISOString(),space='my-workspace',profile='handoff-test';
const state={workspaces:[{id:space,name:'Content',createdAt:at,updatedAt:at}],'current-workspace':space,agents:[{id:'editor',name:'Editor de exemplo',role:'Conteúdo',description:'Agente fictício de revisão',instructions:'Fixture only',tools:['files','web-search'],skills:[],workspaceId:space,providerId:'codex',status:'idle',createdAt:at,updatedAt:at}],sessions:[{id:'session',agentId:'editor',title:'Conversa de exemplo',createdAt:at,updatedAt:at,messages:[{id:'user',role:'user',type:'message',content:'Meu conteúdo de exemplo',createdAt:at},{id:'agent',role:'agent',type:'message',content:'Uma resposta para conferir a interface.',deliveryState:'completed',createdAt:at}]}],'active-sessions':{editor:'session'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false};
const date=at.slice(0,10),cover='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#243852"/><text x="20" y="90" fill="white" font-size="24">Exemplo visual</text></svg>').toString('base64');
let revision=1,editorial={schemaVersion:1,topics:[],runs:[],artifacts:[],approvals:[],contents:[{id:'content',workspaceId:space,title:'Conteúdo de exemplo',platforms:['Instagram'],status:'planning'}],assets:[],publications:[{id:'post',workspaceId:space,contentId:'content',platform:'Instagram',text:'Conteúdo de exemplo',media:[],history:[],status:'draft',version:1,timeZone:'UTC',plannedAt:`${date}T15:00:00Z`,createdAt:at,updatedAt:at}]};
editorial.topics.push({id:'topic',requestId:'topic',workspaceId:space,inputKind:'text',input:'Exemplo de pauta para conferir a interface',category:'IA e tecnologia',priority:'normal',status:'approved',title:'Uma pauta com fontes para conferir o Estúdio',summary:'Uma pesquisa de exemplo com contexto suficiente para conferir a estrutura do painel.',whyItMatters:'Este dado isolado permite conferir o resumo, os ângulos, as fontes e os metadados.',angles:['Demonstrar uma aplicação prática','Explicar os limites e os próximos passos'],sources:[{title:'Fonte de exemplo',url:'https://example.com/reference'}],factualQuestions:[],researchArtifactId:'research',contentId:'content',createdAt:at,updatedAt:at});editorial.contents[0].topicId='topic';editorial.artifacts.push({id:'research',topicId:'topic',workspaceId:space,type:'research',version:1,data:{title:'Fixture',summary:'Fixture'},createdAt:at});
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
Object.assign(editorial.contents[0],{topicId:'topic',format:'short-video',productionStage:'planning',createdAt:at,updatedAt:at,assetIds:[]});
const json=(response,payload)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(payload))};
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://localhost');
 if(url.pathname==='/api/content/state'){
  if(request.method==='PUT'){let text='';for await(const chunk of request)text+=chunk;const input=JSON.parse(text);editorial=input.state;revision++;}
  return json(response,{revision,state:editorial});
 }
 if(url.pathname.startsWith('/api/'))return json(response,url.pathname.endsWith('/work')?{jobs:[],mediaJobs:[],worker:{running:false}}:url.pathname.endsWith('/jobs')?{jobs:[]}:url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/calendar')?{sources:[]}:url.pathname.endsWith('/delegations')?{jobs:[],sessions:[],handoffs:[]}:url.pathname.endsWith('/actions')?{actions:[]}:{ready:false,events:[],version:'test'});
 try{const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));response.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}
});
let win;const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
async function until(check){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('Refined UI timed out')}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#home`);
 await until(()=>js('Boolean(document.querySelector(".overview-priorities"))'));
 assert.equal(await js('getComputedStyle(document.querySelector(".sidebar")).width'),'244px');
 assert.equal(await js('getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()'),'#3557f5');
 await js('document.fonts.ready');assert(await js('document.fonts.check("500 13px Geist")'));
 await screenshot('overview-light');await js('document.documentElement.dataset.appearance="dark"');await screenshot('overview-dark');await js('document.documentElement.dataset.appearance="light"');await click('[data-od-id="nav-calendar"]');
 await until(()=>js('Boolean(document.querySelector(".publishing-grid"))'));
 await click('[data-od-id="calendar-view-week"]');assert.equal(await js('document.querySelectorAll(".publishing-day").length'),7);
 await click('[data-od-id="calendar-view-agenda"]');assert.equal(await js('getComputedStyle(document.querySelector(".publishing-agenda")).display'),'block');
 await click('[data-od-id="calendar-view-month"]');await screenshot('calendar-light');
 await click('.publishing-day .publication-tile');await until(()=>js('Boolean(document.querySelector(".publication-preview"))'));
 await click('.flow-dialog header button');
 await js('document.documentElement.dataset.appearance="dark"');await screenshot('calendar-dark');
 for(const width of [880,360]){win.setSize(width,800);await new Promise(resolve=>setTimeout(resolve,100));assert(await js('document.documentElement.scrollWidth<=innerWidth+1'));if(width===360)assert.equal(await js('getComputedStyle(document.querySelector(".publishing-grid")).display'),'none');await screenshot(`calendar-${width}`)}
 win.setSize(1440,1000);await js('document.documentElement.dataset.appearance="light"');await click('[data-od-id="nav-agents"]');await screenshot('agents');
 await click('[data-od-id="nav-content"]');await until(()=>js('Boolean(document.querySelector(".studio-topic-body"))'));const studioBounds=await js('(()=>{const bounds=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {intake:bounds(".editorial-intake"),list:bounds(".editorial-list"),detail:bounds(".editorial-detail")}})()');assert(studioBounds.intake.bottom<=studioBounds.list.top);assert(studioBounds.list.right<=studioBounds.detail.left);assert(await js('document.querySelectorAll(".editorial-detail .editorial-progress li").length===6'));await screenshot('studio-light');await js('document.documentElement.dataset.appearance="dark"');await screenshot('studio-dark');await js('document.documentElement.dataset.appearance="light"');await click('[data-od-id="nav-agents"]');
 await click('[data-od-id="create-agent"]');await until(()=>js('Boolean(document.querySelector(".agent-editor-nav"))'));await screenshot('agent-editor-identity');
 await js('Array.from(document.querySelectorAll(".agent-editor-nav button")).find(el=>el.textContent.includes("Comportamento")).click()');await screenshot('agent-editor-behavior');
 const editorBounds=await js('({footer:document.querySelector(".drawer-footer").getBoundingClientRect().bottom,height:innerHeight,visibleSections:Array.from(document.querySelectorAll(".drawer-section")).filter(el=>el.getClientRects().length>0).length})');assert(editorBounds.footer<=editorBounds.height);assert.equal(editorBounds.visibleSections,1);
 await click('.drawer-footer .primary-button');await until(()=>js('document.querySelector(".agent-editor-nav button[aria-pressed=true]").textContent.includes("Identidade")'));await until(()=>js('document.activeElement.closest(".drawer-section")?.dataset.editorSection==="identity"'));
 win.setSize(360,800);await screenshot('agent-editor-compact');assert(await js('document.documentElement.scrollWidth<=innerWidth+1'));assert(await js('document.querySelector(".drawer-footer").getBoundingClientRect().bottom<=innerHeight'));await click('.drawer-head .icon-button');win.setSize(1440,1000);
 await click('[data-od-id="nav-canvas"]');await until(()=>js('Boolean(document.querySelector(".canvas-tool-note"))'));
 const before=await js('document.querySelectorAll(".react-flow__node").length');await click('.canvas-tool-note');await until(()=>js(`document.querySelectorAll('.react-flow__node').length===${before+1}`));
 await click('[aria-label="Desfazer ação"]');await until(()=>js(`document.querySelectorAll('.react-flow__node').length===${before}`));
 await click('[data-od-id="canvas-select-tool"]');assert.equal(await js('document.querySelector("[data-od-id=canvas-select-tool]").getAttribute("aria-pressed")'),'true');await screenshot('canvas');
 const toolbarBounds=await js('({toolbar:{top:document.querySelector(".canvas-toolbar").getBoundingClientRect().top,left:document.querySelector(".canvas-toolbar").getBoundingClientRect().left,width:document.querySelector(".canvas-toolbar").getBoundingClientRect().width,transform:getComputedStyle(document.querySelector(".canvas-toolbar")).transform,animations:document.querySelector(".canvas-toolbar").getAnimations().map(a=>a.effect.getKeyframes()),childPosition:getComputedStyle(document.querySelector(".canvas-tools")).position,childWidth:getComputedStyle(document.querySelector(".canvas-tools")).width},height:innerHeight,canvasCenter:(document.querySelector(".canvas-layout").getBoundingClientRect().left+document.querySelector(".canvas-layout").getBoundingClientRect().right)/2,controls:Array.from(document.querySelectorAll(".canvas-tools>.canvas-tool")).map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))})');assert(toolbarBounds.toolbar.top>toolbarBounds.height-120);assert(Math.abs(toolbarBounds.toolbar.left+toolbarBounds.toolbar.width/2-toolbarBounds.canvasCenter)<2);for(let index=1;index<toolbarBounds.controls.length;index++)assert(toolbarBounds.controls[index].left>=toolbarBounds.controls[index-1].right);
 await click('.agent-nav');await until(()=>js('Boolean(document.querySelector(".composer textarea"))'));
 assert(await js('document.querySelector(".composer textarea").getBoundingClientRect().bottom<=innerHeight'));await screenshot('chat');
 assert.deepEqual(errors,[]);console.log('REFINED_WORKSPACE_UI_OK: navigation, month/week/list, preview, 360/880/1440px, light/dark, Canvas add/undo/select, pinned chat.');
 win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(await js('document.body.innerText'));await screenshot('failure');win.destroy()}server.close();app.exit(1)}
});
