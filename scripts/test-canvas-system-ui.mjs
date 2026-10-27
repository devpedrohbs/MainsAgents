// The coordinator runs this against its final dist. No personal storage, live CLI or external requests.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/canvas-system-ui-test');
mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,`profile-${Date.now()}`));
const at=new Date().toISOString(),a='my-workspace',b='other-workspace';
const agent=(id,workspaceId)=>({id,workspaceId,name:id,role:'Research',description:'Isolated fixture',instructions:'Do not execute',tools:[],skills:[],providerId:'codex',status:'idle',createdAt:at,updatedAt:at});
const note=(text)=>({id:'shared-note',type:'note',position:{x:80,y:200},width:280,height:240,selected:true,data:{label:'Note',text}});
const chat=(id,agentId,sessionId,workspaceId,x)=>({id,type:'chat',position:{x,y:140},width:420,height:560,data:{label:'Chat',workspaceId,chatAgentId:agentId,chatSessionId:sessionId}});
const state={
  workspaces:[{id:a,name:'Canvas A',createdAt:at,updatedAt:at},{id:b,name:'Canvas B',createdAt:at,updatedAt:at}],
  'current-workspace':a,agents:[agent('local-agent',a),agent('foreign-agent',b)],
  sessions:[{id:'session-a',agentId:'local-agent',title:'Local conversation',createdAt:at,updatedAt:at,messages:[{id:'local-message',type:'message',role:'agent',content:'LOCAL HISTORY',createdAt:at}]},{id:'session-b',agentId:'foreign-agent',title:'Foreign conversation',createdAt:at,updatedAt:at,messages:[{id:'foreign-message',type:'message',role:'agent',content:'FOREIGN SECRET MUST NEVER RENDER IN A',createdAt:at}]}],
  'active-sessions':{'local-agent':'session-a','foreign-agent':'session-b'},
  language:'pt-BR','welcome-dismissed':true,'focus-mode':false,
  'chat-drafts':{[JSON.stringify(['local-agent','session-a'])]:{text:'Keep this draft',skill:null,context:[{nodeId:'shared-note',workspaceId:a,label:'Original note'}]}},
  'canvas-workspaces':{
    [a]:{nodes:[note('Original note'),chat('local-chat','local-agent','session-a',a,680),chat('foreign-chat','foreign-agent','session-b',a,1200),chat('mismatched-chat','foreign-agent','session-b',b,1700),{id:'terminal',type:'terminal',position:{x:80,y:740},width:560,height:360,data:{label:'Terminal',workspaceId:a,command:'',terminalOutput:'Before stream\n',terminalStatus:'running',terminalExecutionId:'fixture-run',terminalEventCursor:-1}}],edges:[{id:'note-chat',source:'shared-note',target:'local-chat',type:'smoothstep'}],view:{viewport:{x:0,y:0,zoom:1},width:1356,height:920,ready:true}},
    [b]:{nodes:[{...note('WORKSPACE B CONTENT'),data:{label:'Note',workspaceId:b,text:'WORKSPACE B CONTENT'}}],edges:[],view:{viewport:{x:20,y:30,zoom:.7},width:900,height:640,ready:true}},
  },
};
const originalB=JSON.stringify(state['canvas-workspaces'][b]);
const originalMessages=structuredClone(state.sessions.map(session=>session.messages));
const streams=new Set();let sequence=0,commandPosts=0;
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value});ipcMain.handle('test:all',()=>state);
const json=(response,payload)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(payload))};
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/api/canvas/executions/fixture-run/events'){
    response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
    response.write(`data: ${JSON.stringify({type:'started',sequence:sequence++,cwd:'C:/fixture'})}\n\n`);
    streams.add(response);request.on('close',()=>streams.delete(response));return;
  }
  if(url.pathname==='/api/canvas/executions'&&request.method==='POST')commandPosts++;
  if(url.pathname==='/api/content/state')return json(response,{revision:1,state:{schemaVersion:1,topics:[],runs:[],artifacts:[],approvals:[],contents:[],assets:[],publications:[]}});
  if(url.pathname.startsWith('/api/'))return json(response,url.pathname.endsWith('/work')?{jobs:[],mediaJobs:[],worker:{running:false}}:url.pathname.endsWith('/jobs')?{jobs:[]}:url.pathname.endsWith('/models')?{models:[]}:url.pathname.endsWith('/calendar')?{sources:[]}:url.pathname.endsWith('/delegations')?{jobs:[],sessions:[],handoffs:[]}:url.pathname.endsWith('/actions')?{actions:[]}:{ready:false,events:[],version:'fixture'});
  try{
    const file=resolve(root,'dist',url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(resolve(root,'dist')+sep));
    response.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));
  }catch{response.statusCode=404;response.end()}
});
let win;const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Canvas system timeout: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.click()})()`)}
async function screenshot(name){writeFileSync(resolve(out,`${name}.png`),await captureReadyPng(win.webContents))}
const key=(keyCode,modifiers=[])=>{win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers})};
const bounds=selector=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
async function drag(from,to){const mouse=(type,x,y,extra={})=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),...extra});mouse('mouseMove',from.x,from.y);mouse('mouseDown',from.x,from.y,{button:'left',clickCount:1});for(let i=1;i<=8;i++){mouse('mouseMove',from.x+(to.x-from.x)*i/8,from.y+(to.y-from.y)*i/8,{button:'left'});await new Promise(r=>setTimeout(r,20))}mouse('mouseUp',to.x,to.y,{button:'left',clickCount:1})}
const graph=()=>state['canvas-workspaces'][a];
const find=id=>graph().nodes.find(node=>node.id===id);
async function focusNode(id){await js(`document.querySelector('[data-id=${JSON.stringify(id)}]').focus()`)}
async function duplicate(id){await js(`document.querySelector('[data-id=${JSON.stringify(id)}]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:400}))`);await click('.canvas-context-menu button:nth-of-type(3)')}

app.whenReady().then(async()=>{try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(`http://127.0.0.1:${server.address().port}/`)}));
  win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#canvas`);
  await until(()=>js('document.querySelectorAll(".react-flow__node").length===5'),'five fixture blocks');
  await until(()=>streams.size>0,'mock stream attached');
  assert.equal(await js('document.body.innerText.includes("FOREIGN SECRET")'),false);
  assert.equal(await js('document.querySelector("[data-id=foreign-chat]").innerText.includes("LOCAL HISTORY")'),false);
  assert.equal(await js('document.querySelector("[data-id=local-chat]").innerText.includes("LOCAL HISTORY")'),true);

  const before={...find('shared-note').position};
  const header=await bounds('[data-id=shared-note] .canvas-node-drag-handle');
  await drag({x:header.x+60,y:header.y+15},{x:header.x+150,y:header.y+65});
  await until(()=>find('shared-note').position.x!==before.x,'note moved');const moved={...find('shared-note').position};
  await focusNode('shared-note');key('Z',['control','shift']);await new Promise(r=>setTimeout(r,80));
  assert.deepEqual(find('shared-note').position,moved,'Ctrl+Shift+Z must not run Undo');
  await js('(()=>{const input=document.querySelector(".note-editor");input.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Text edited after moving");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
  await until(()=>find('shared-note').data.text==='Text edited after moving','note edit persisted');
  key('z',['control']);await new Promise(r=>setTimeout(r,80));assert.deepEqual(find('shared-note').position,moved,'native text Undo must not rewind canvas geometry');
  for(const stream of streams)stream.write(`data: ${JSON.stringify({type:'output',sequence:sequence++,text:'LATE STREAM MUST SURVIVE UNDO\n'})}\n\n`);
  await until(()=>find('terminal').data.terminalOutput.includes('LATE STREAM'),'new terminal output');
  const editedText=find('shared-note').data.text;
  await focusNode('shared-note');key('z',['control']);await until(()=>find('shared-note').position.x===before.x,'geometry undo');
  assert.equal(find('shared-note').data.text,editedText);assert(find('terminal').data.terminalOutput.includes('LATE STREAM'));
  await screenshot('01-undo-preserves-live-data-dark');

  // Keyboard deletion prunes persisted edges, retains historical messages and leaves workspace B untouched.
  await focusNode('shared-note');key('Delete');await until(()=>!find('shared-note'),'node deletion');
  assert.equal(graph().edges.some(edge=>edge.source==='shared-note'||edge.target==='shared-note'),false);
  assert.equal(JSON.stringify(state['canvas-workspaces'][b]),originalB);
  assert.deepEqual(state.sessions.map(session=>session.messages),originalMessages);
  assert.equal(state['chat-drafts'][JSON.stringify(['local-agent','session-a'])].text,'Keep this draft');
  assert.equal(await js('document.querySelector("[data-id=local-chat]").innerText.includes("Contexto indisponível")'),true);
  await click('.studio-zoom-controls button:first-child');await until(()=>Boolean(find('shared-note')),'deletion undo');
  assert.equal(find('shared-note').data.text,editedText);assert(graph().edges.some(edge=>edge.id==='note-chat'));

  // Copying active blocks must never attach another node to the same shell or conversation.
  await duplicate('terminal');await until(()=>graph().nodes.filter(node=>node.type==='terminal').length===2,'terminal copy');
  const copiedTerminal=graph().nodes.find(node=>node.type==='terminal'&&node.id!=='terminal');
  assert.equal(copiedTerminal.data.terminalExecutionId,undefined);assert.equal(copiedTerminal.data.terminalStatus,'idle');assert.equal(copiedTerminal.data.terminalOutput,'');
  assert.equal(find('terminal').data.terminalExecutionId,'fixture-run');
  const sessionCount=state.sessions.length;
  await duplicate('local-chat');await until(()=>graph().nodes.filter(node=>node.type==='chat').length===4,'chat copy');
  const copiedChat=graph().nodes.find(node=>node.type==='chat'&&!['local-chat','foreign-chat','mismatched-chat'].includes(node.id));
  assert.equal(copiedChat.data.chatSessionId,undefined);assert.equal(copiedChat.data.chatAgentId,undefined);assert.equal(state.sessions.length,sessionCount);
  assert.equal(find('local-chat').data.chatSessionId,'session-a');assert.equal(commandPosts,0);
  await js('document.documentElement.dataset.appearance="light"');await screenshot('02-isolated-copies-light');

  // Reload an old-format workspace with the same node ID: it must retain its own text and camera.
  await js('document.activeElement.blur()');key('s',['control']);await new Promise(r=>setTimeout(r,200));
  state['current-workspace']=b;state.language='en-US';await win.reload();await until(()=>js('document.querySelectorAll(".react-flow__node").length===1'),'workspace B loaded');
  assert.equal(await js('document.querySelector(".note-editor").value'),'WORKSPACE B CONTENT');
  assert.equal(await js('document.body.innerText.includes("LOCAL HISTORY")'),false);
  assert.equal(await js('document.querySelector(".studio-zoom-controls button:nth-child(3)").textContent'),'70%');
  assert.equal(await js('document.querySelector(".studio-zoom-controls button:first-child").disabled'),true);
  assert.deepEqual(errors,[]);console.log('CANVAS_SYSTEM_UI_OK: foreign sessions blocked, live stream and edits preserved by Undo, native/Shift shortcuts protected, delete/undo edges, independent duplicates, snapshots and workspace camera.');
  win.destroy();for(const stream of streams)stream.end();server.close();app.exit(0);
}catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){await screenshot('failure');win.destroy()}for(const stream of streams)stream.end();server.close();app.exit(1)}});
