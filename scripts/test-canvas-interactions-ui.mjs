// Production renderer; isolated fixtures, no personal storage, CLI or external writes.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/canvas-interactions-ui-test');
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,`profile-${Date.now()}`));
const at=new Date().toISOString(),space='my-workspace',profile='handoff-test';
const state={workspaces:[{id:space,name:'Content',createdAt:at,updatedAt:at}],'current-workspace':space,agents:[{id:'editor',name:'Editor de exemplo',role:'Conteúdo',description:'Agente fictício de revisão',instructions:'Fixture only',tools:['files','web-search'],skills:[],workspaceId:space,providerId:'codex',status:'idle',createdAt:at,updatedAt:at}],sessions:[{id:'session',agentId:'editor',title:'Conversa de exemplo',createdAt:at,updatedAt:at,messages:[{id:'user',role:'user',type:'message',content:'Meu conteúdo de exemplo',createdAt:at},{id:'agent',role:'agent',type:'message',content:'Uma resposta para conferir a interface.',deliveryState:'completed',createdAt:at}]}],'active-sessions':{editor:'session'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'canvas-workspaces':{}};
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
// Exercise the production renderer with isolated storage; no personal data or live providers.
const bounds=selector=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error("Missing selector: "+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()`);
const mouse=(type,x,y,extra={})=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),...extra});
async function drag(from,to){mouse('mouseMove',from.x,from.y);mouse('mouseDown',from.x,from.y,{button:'left',clickCount:1});for(let i=1;i<=8;i++){mouse('mouseMove',from.x+(to.x-from.x)*i/8,from.y+(to.y-from.y)*i/8,{button:'left'});await new Promise(r=>setTimeout(r,20))}mouse('mouseUp',to.x,to.y,{button:'left',clickCount:1});await new Promise(r=>setTimeout(r,100))}
const key=(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})};
const selected='.react-flow__node.selected';
async function add(kind){await click('.canvas-add-trigger');await click(`.canvas-add-menu button:nth-of-type(${['note','research','image','contentIdea','hook','script','terminal','browser','chat'].indexOf(kind)+1})`);await until(()=>js(`Boolean(document.querySelector('.react-flow__node-${kind}.selected'))`));await new Promise(r=>setTimeout(r,250));}
app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(`http://127.0.0.1:${server.address().port}/`)}));
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#canvas`);
 await until(()=>js('Boolean(document.querySelector(".canvas-tool-note"))'));
 await add('note');
 const bar=await bounds('.selection-bar');assert(bar.height<70,`Selection bar stretched to ${bar.height}px`);
 assert.equal(await js('Boolean(document.querySelector(".canvas-detail,.flow-dialog"))'),false);
 assert.equal(await js('document.querySelectorAll(".canvas-resize-handle").length'),4);
 await screenshot('01-note-selected-dark');
 await js('document.querySelector(".canvas-add-trigger").focus()');key('Space');await until(()=>js('Boolean(document.querySelector(".canvas-add-menu"))'));assert.equal(await js('Boolean(document.querySelector(".canvas-space-pan"))'),false);key('Escape');await until(()=>js('!document.querySelector(".canvas-add-menu")'));
 // Selection styling must never expand the shell or the contextual toolbar.
 const shell=await bounds(selected+' .flow-node'),outer=await bounds(selected);assert(Math.abs(shell.width-outer.width)<2);assert(Math.abs(shell.height-outer.height)<2);
 // Double-click inside the editor selects text instead of opening the inspector.
 await js('document.querySelector(".note-editor").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
 assert.equal(await js('Boolean(document.querySelector(".canvas-detail"))'),false);
 await js('document.querySelector(".canvas-node-drag-handle").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
 await until(()=>js('Boolean(document.querySelector(".canvas-detail"))'));
 await screenshot('02-compact-inspector');key('Escape');await until(()=>js('!document.querySelector(".canvas-detail")'));
 // Real input through the renderer: handles must be outside the clipped article.
 const corner=await bounds(selected+' .canvas-resize-handle.bottom.right');
 const before=await bounds(selected);await drag({x:corner.x+corner.width/2,y:corner.y+corner.height/2},{x:corner.x+corner.width/2+110,y:corner.y+corner.height/2+80});
 const after=await bounds(selected);assert(after.width>before.width+90,JSON.stringify({before,after}));assert(after.height>before.height+60);
 const resizedId=await js('document.querySelector(".react-flow__node.selected").dataset.id');
 await click('.studio-zoom-controls button:first-child');await until(async()=>Math.abs((await bounds(selected)).width-before.width)<2);
 // Reapply, then validate persistence below.
 const c=await bounds(selected+' .canvas-resize-handle.bottom.right');await drag({x:c.x+4,y:c.y+4},{x:c.x+94,y:c.y+64});
 await screenshot('03-note-resized');
 // Every type has reachable controls and a content surface that follows its outer bounds.
 for(const kind of ['research','image','contentIdea','hook','script','terminal','browser','chat']){
  await add(kind);assert.equal(await js('document.querySelectorAll(".canvas-resize-handle").length'),4,kind);
  const parent=await bounds(selected),child=await bounds(selected+' .flow-node');assert(Math.abs(parent.width-child.width)<2,kind+' width');assert(Math.abs(parent.height-child.height)<2,kind+' height');
  const handle=await bounds(selected+' .canvas-resize-handle.bottom.right');
  await drag({x:handle.x+4,y:handle.y+4},{x:handle.x+54,y:handle.y+44});
  const changed=await bounds(selected);assert(changed.width>parent.width+25,kind+' did not resize');
  assert((await bounds('.selection-bar')).height<70,kind+' toolbar');
  assert.equal(await js('Boolean(document.querySelector(".canvas-detail,.flow-dialog"))'),false,kind+' unexpected popup');
  if(kind==='browser')await screenshot('04-browser-resized');
 }
 // Search is a bounded popover, can jump to objects, and closes with Escape/outside clicks.
 await click('[aria-label="Buscar objetos no Canvas"]');await until(()=>js('Boolean(document.querySelector(".canvas-objects-popover"))'));
 const search=await bounds('.canvas-objects-popover');assert(search.width<=302&&search.height<420);assert(search.y>0&&search.bottom<1000);
 assert.equal(await js('Boolean(document.querySelector(".flow-dialog"))'),false);await screenshot('05-object-search');key('Escape');await until(()=>js('!document.querySelector(".canvas-objects-popover")'));
 // Selection/hand mode and temporary Space panning do not move the selected node.
 await click('[data-od-id="canvas-pan-tool"]');assert.equal(await js('document.querySelector("[data-od-id=canvas-pan-tool]").getAttribute("aria-pressed")'),'true');
 await click('[data-od-id="canvas-select-tool"]');
 const startTransform=await js('document.querySelector(".react-flow__viewport").style.transform');
 const startPosition=await js('document.querySelector(".react-flow__node.selected").style.transform');
 const body=await bounds(selected+' .flow-node-content');await js('document.activeElement.blur()');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});await until(()=>js('document.querySelector(".canvas-space-pan")'));
 await drag({x:body.x+60,y:body.y+60},{x:body.x+140,y:body.y+110});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
 await until(()=>js('!document.querySelector(".canvas-space-pan")'));
 assert.notEqual(await js('document.querySelector(".react-flow__viewport").style.transform'),startTransform);
 assert.equal(await js('document.querySelector(".react-flow__node.selected").style.transform'),startPosition);
 // Compact dimensions at smaller window sizes and in both appearances.
 for(const width of [880,600,360]){win.setSize(width,800);await new Promise(r=>setTimeout(r,100));await click('.canvas-add-trigger');const menu=await bounds('.canvas-add-menu');assert(menu.width<260&&menu.height<500&&menu.y>=0);key('Escape');await until(()=>js('!document.querySelector(".canvas-add-menu")'));assert((await bounds('.selection-bar')).height<70);await screenshot(`06-canvas-${width}`)}
 win.setSize(1440,1000);await js('document.documentElement.dataset.appearance="light"');await screenshot('07-canvas-light');
 // A reload must preserve resized widths and heights, not just content.
 await js('document.activeElement.blur()');key('s',['control']);await new Promise(r=>setTimeout(r,300));
 const saved=state['canvas-workspaces'][space];assert.equal(saved.nodes.length,9);assert(saved.nodes.find(node=>node.id===resizedId).width>280);
 const dimensions=saved.nodes.map(node=>[node.id,node.width,node.height]);
 await win.reload();await until(()=>js('document.querySelectorAll(".react-flow__node").length===9'));
 for(const [id,width,height] of dimensions){const actual=await bounds(`[data-id="${id}"]`);const zoom=await js('Number(document.querySelector(".studio-zoom-controls button:nth-child(3)").textContent.replace("%",""))/100');assert(Math.abs(actual.width/zoom-width)<10,id+' persisted width');assert(height>0)}
 // A small working board verifies connecting, numeric sizes, zoomed resizing and multi-selection tidy.
 state['canvas-workspaces'][space]={nodes:[
  {...saved.nodes.find(n=>n.type==='note'),position:{x:30,y:170},width:280,height:240,selected:true,data:{label:'Note',text:'Ideia principal. Reunir as fontes, escolher o gancho e revisar com o agente.'}},
  {...saved.nodes.find(n=>n.type==='research'),position:{x:390,y:170},width:320,height:300,selected:false,data:{label:'Research',source:'Referencias',title:'Pesquisa para o roteiro',summary:'Conecte esta pesquisa ao chat para enviar o contexto junto com sua mensagem.'}},
  {...saved.nodes.find(n=>n.type==='chat'),position:{x:750,y:170},width:350,height:500,selected:false,data:{label:'Chat',chatAgentId:'editor',chatSessionId:'session',agentId:'editor',agentLabel:'Editor de exemplo',workspaceId:space}}
 ],edges:[],view:{viewport:{x:20,y:0,zoom:.9},width:1188,height:928,ready:true}};
 await win.reload();await until(()=>js('document.querySelectorAll(".react-flow__node").length===3'));
 const sourceHandle=await bounds('.react-flow__node-note .flow-handle.source'),targetHandle=await bounds('.react-flow__node-research .flow-handle.target');
 await drag({x:sourceHandle.x+sourceHandle.width/2,y:sourceHandle.y+sourceHandle.height/2},{x:targetHandle.x+targetHandle.width/2,y:targetHandle.y+targetHandle.height/2});
 await until(()=>js('document.querySelectorAll(".react-flow__edge").length===1'));
 // Editing exact dimensions supports shrinking and is undoable too.
 await click('.react-flow__node-note .canvas-node-drag-handle');await click('[aria-label="Editar objeto"]');
 await until(()=>js('Boolean(document.querySelector(".canvas-size-fields input"))'));
 await js('(()=>{const input=document.querySelector(".canvas-size-fields input");input.value="420";input.dispatchEvent(new FocusEvent("focusout",{bubbles:true}))})()');
 await until(()=>js('document.querySelector(".react-flow__node-note").style.width==="420px"'));
 await until(()=>state['canvas-workspaces'][space].nodes.find(n=>n.type==='note').measured?.width===420);
 key('Escape');await until(()=>js('!document.querySelector(".canvas-detail")'));
 await click('.react-flow__node-note .canvas-node-drag-handle');await until(()=>js('Boolean(document.querySelector(".react-flow__node-note .canvas-resize-handle"))'));
 const zoomBefore=await bounds('.react-flow__node-note'),zoomCorner=await bounds('.react-flow__node-note .canvas-resize-handle.bottom.right');
 await drag({x:zoomCorner.x+zoomCorner.width/2,y:zoomCorner.y+zoomCorner.height/2},{x:zoomCorner.x+zoomCorner.width/2-72,y:zoomCorner.y+zoomCorner.height/2-36});
 const zoomAfter=await bounds('.react-flow__node-note');assert(zoomAfter.width<zoomBefore.width-60);assert(zoomAfter.height<zoomBefore.height-25);assert(Math.abs(zoomBefore.width-zoomAfter.width-72)<3);const zoomContent=await bounds('.react-flow__node-note .flow-node');assert(Math.abs(zoomAfter.width-zoomContent.width)<2);assert(Math.abs(zoomAfter.height-zoomContent.height)<2);
 await screenshot('08-working-board-light');await js('document.documentElement.dataset.appearance="dark"');await screenshot('09-working-board-dark');
 // Select both compact cards with Control; align then tidy without changing content or connections.
 const r=await bounds('.react-flow__node-research .canvas-node-drag-handle');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Control'});await new Promise(r=>setTimeout(r,50));mouse('mouseDown',r.x+40,r.y+15,{button:'left',clickCount:1,modifiers:['control']});mouse('mouseUp',r.x+40,r.y+15,{button:'left',clickCount:1,modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Control'});
 await until(()=>js('document.querySelectorAll(".react-flow__node.selected").length===2'));
 await js('Array.from(document.querySelectorAll(".selection-bar button")).find(button=>button.textContent==="Organizar").click()');
 assert.equal(await js('document.querySelectorAll(".react-flow__edge").length'),1);
 await click('.studio-zoom-controls button:first-child');await screenshot('10-selection-actions');
 assert.deepEqual(errors,[]);console.log('CANVAS_INTERACTIONS_UI_OK: 9 block types, real corner resizing, resize undo, compact toolbar, header-only inspector, object popover, Space pan, 360/600/880/1440px, light/dark, persistence, exact dimensions, zoomed shrinking, connections, multi-selection tidy.');
 win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){await screenshot('failure');win.destroy()}server.close();app.exit(1)}
});
