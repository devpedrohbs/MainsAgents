import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
// Run with: electron scripts/test-agent-handoff-ui.mjs (after npm run build).
// Uses an isolated profile and deterministic provider; never reads user data or consumes AI tokens.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/handoff-ui-test');mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'profile'));
const now=new Date().toISOString(),workspaceId='my-workspace';
const base={workspaceId,role:'Specialist',description:'Test specialist',instructions:'Follow the user request.',tools:['files'],status:'idle',createdAt:now,updatedAt:now};
const state={agents:[{...base,id:'content',name:'Editor de Conteúdo',tools:['files','subagents']},{...base,id:'video',name:'Editor de Vídeo'}],workspaces:[{id:workspaceId,name:'Test Workspace',createdAt:now,updatedAt:now}],sessions:[{id:'source-session',agentId:'content',title:'Conversa conectada',messages:[],agentConnection:{enabled:true,targetAgentId:'video'},createdAt:now,updatedAt:now}],'active-sessions':{content:'source-session'},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value;});ipcMain.handle('test:all',()=>state);
let serial=0;const threads=new Map(),runs=new Map();
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'||event.type==='execution.cancelled'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const bridge=createContentWorkflowBridge({dbPath:resolve(out,`fixture-${Date.now()}.sqlite`),getCurrentProfile:()=> 'handoff-test',getAgents:()=>state.agents,getSessions:()=>state.sessions});
const server=createServer(async(req,res)=>{
 if(await bridge.handle(req,res,new URL(req.url,'http://localhost')))return;
 const path=new URL(req.url,'http://localhost').pathname;let input={};if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;input=JSON.parse(text||'{}');}
 if(path.endsWith('/health'))return json(res,{ready:true,status:'connected',accountType:'chatgpt'});
 if(path.endsWith('/models'))return json(res,{models:[{id:'test-model',name:'Test model'}]});
 if(path.endsWith('/usage'))return json(res,{rateLimits:null});
 if(path==='/api/codex/sessions'){const id=input.threadId??`thread-${++serial}`;if(input.config)threads.set(id,input.config);return json(res,{threadId:id});}
 if(path==='/api/codex/executions'){
  const executionId=`turn-${++serial}`,run={executionId,input,events:[],streams:new Set(),done:false};runs.set(executionId,run);
  const started={type:'execution.started',executionId,threadId:input.threadId};run.events.push(started);
  if(threads.get(input.threadId)?.agentId==='content')run.events.push({type:'agent.delegate',executionId,callId:'handoff-call',request:{targetAgentId:'video',title:'Corte base — teste',instructions:'Roteiro v1 aprovado. Analise o arquivo e devolva um plano de corte.',files:['C:\\Videos\\take.mp4']}});
  else setTimeout(()=>{if(run.done)return;emit(run,{type:'message.completed',executionId,content:'Plano técnico recebido.\n\n'+('Preservar os brutos e revisar o corte base.\n\n'.repeat(20))+'VIDEO_RESULT_OK'});emit(run,{type:'execution.completed',executionId});},1800);
  return json(res,{executionId,threadId:input.threadId});
 }
 const streamMatch=path.match(/\/executions\/([^/]+)\/events$/);
 if(streamMatch){const run=runs.get(streamMatch[1]);res.setHeader('content-type','application/x-ndjson');for(const event of run.events)res.write(JSON.stringify(event)+'\n');if(run.done)res.end();else{run.streams.add(res);req.on('close',()=>run.streams.delete(res));}return;}
 const resolveMatch=path.match(/\/executions\/([^/]+)\/delegations\/([^/]+)$/);
 if(resolveMatch){assert.equal(input.success,true);assert.match(input.content,/VIDEO_RESULT_OK/);const run=runs.get(resolveMatch[1]);emit(run,{type:'message.completed',executionId:run.executionId,content:'Editor de Vídeo devolveu o plano. Aguardo sua revisão. PARENT_RESULT_OK'});emit(run,{type:'execution.completed',executionId:run.executionId});return json(res,{});}
 const cancelMatch=path.match(/\/executions\/([^/]+)\/cancel$/);if(cancelMatch){const run=runs.get(cancelMatch[1]);if(run&&!run.done)emit(run,{type:'execution.cancelled',executionId:run.executionId});return json(res,{});}
 if(path.startsWith('/api/'))return json(res,{schemaVersion:1,revision:0,topics:[],contents:[],runs:[],artifacts:[],approvals:[]});
 try{const file=resolve(root,'dist',path==='/'?'app.html':path.slice(1));assert(file.startsWith(resolve(root,'dist')+'\\'));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}
});
app.whenReady().then(async()=>{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const window=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:resolve(root,'tests/fixtures/handoff-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
const errors=[];window.webContents.on('console-message',(event)=>{console.log('renderer:',event.message);if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message);});
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(check,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('UI assertion timed out');}
async function screenshot(name){try{writeFileSync(resolve(out,name),(await window.webContents.capturePage()).toPNG());}catch{console.log('Screenshot unavailable:',name);}}
try{
 await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#home`);
 console.log('Loaded test UI');
 await until(()=>evaluate("!!document.querySelector('.sidebar')"));
 await until(()=>evaluate("document.body.textContent.includes('Editor de Conteúdo')"));
 console.log('Agents restored');
 if(!await evaluate("!!document.querySelector('.composer textarea')"))await evaluate("document.querySelector('.chat-toggle').click()");
 await until(()=>evaluate("!!document.querySelector('.composer textarea') && !document.querySelector('.composer textarea').disabled"));
 await evaluate("(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Encaminhe para o Editor de Vídeo.');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await until(()=>evaluate("!document.querySelector('.send-button').disabled"));
 console.log('Sending from source');
 await evaluate("document.querySelector('.send-button').click()");
 await until(()=>evaluate("!!document.querySelector('.collaboration-window')"));
 console.log('Both chats opened');
 await screenshot('working-desktop.png');
 await until(()=>state.sessions?.some(session=>session.handoffs?.some(item=>item.status==='completed')));
 await until(()=>evaluate("document.querySelector('.collaboration-source')?.textContent.includes('PARENT_RESULT_OK')"));
 const source=state.sessions.find(session=>session.agentId==='content'),target=state.sessions.find(session=>session.agentId==='video');
 assert.equal(source.handoffs.length,1);assert.equal(source.handoffs[0].targetSessionId,target.id);assert.equal(target.originHandoffId,source.handoffs[0].id);
 assert.match(target.messages.find(item=>item.type==='message'&&item.role==='user').content,/C:\\Videos\\take.mp4/);
 assert.equal(target.messages.find(item=>item.type==='message'&&item.role==='user').sourceAgentName,'Editor de Conteúdo');
 assert.equal(source.messages.some(item=>item.type==='message'&&item.content.includes('VIDEO_RESULT_OK')),false);
 const bounds=await evaluate("(()=>{const panel=document.querySelector('.collaboration-target');const body=panel.querySelector('.chat-body');const composer=panel.querySelector('.chat-compose');const before=composer.getBoundingClientRect().top;body.scrollTop=0;return {panelWidth:panel.getBoundingClientRect().width,dialogWidth:document.querySelector('.collaboration-window').getBoundingClientRect().width,scrollable:body.scrollHeight>body.clientHeight,composerFixed:before===composer.getBoundingClientRect().top,bodyHeight:body.clientHeight,composerBottom:composer.getBoundingClientRect().bottom,windowHeight:window.innerHeight};})()");
 assert(bounds.scrollable);assert(bounds.composerFixed);assert(bounds.composerBottom<=bounds.windowHeight);assert(bounds.bodyHeight>100);assert(bounds.panelWidth>400);assert(bounds.dialogWidth>1000);
 await screenshot('completed-desktop.png');
 window.setSize(680,850);await new Promise(resolve=>setTimeout(resolve,150));await screenshot('completed-mobile.png');
 assert(await evaluate("getComputedStyle(document.querySelector('.collaboration-source')).display==='none'"));
 await evaluate("document.querySelector('[data-close]').click()");
 await until(()=>evaluate("!document.querySelector('.collaboration-window')"));
 await evaluate("Array.from(document.querySelectorAll('.handoff-card button')).find(button=>button.textContent.includes('Ver os dois')).click()");
 await until(()=>evaluate("!!document.querySelector('.collaboration-window')"));assert.equal(state.sessions.length,2);
 window.setSize(1440,940);
 await evaluate("document.querySelector('.collaboration-create-canvas').click()");
 await until(()=>evaluate("location.hash==='#canvas' && document.querySelectorAll('.flow-node.chat').length===2 && !document.querySelector('.collaboration-window')"));
 await until(()=>state['canvas-workspaces']?.[workspaceId]?.nodes.every(node=>node.measured?.height));
 await new Promise(resolve=>setTimeout(resolve,350));
 const canvas=state['canvas-workspaces'][workspaceId];
 assert.equal(canvas.nodes.length,2);assert.equal(canvas.edges.length,1);assert.equal(state.sessions.length,2);
 const from=canvas.nodes.find(node=>node.data.chatSessionId===source.id),to=canvas.nodes.find(node=>node.data.chatSessionId===target.id);
 assert.equal(from.data.chatAgentId,'content');assert.equal(to.data.chatAgentId,'video');assert.equal(canvas.edges[0].source,from.id);assert.equal(canvas.edges[0].target,to.id);
 assert(await evaluate("document.querySelectorAll('.canvas-chat-composer').length===2 && document.querySelector('.react-flow__edge-path')!==null"));
 assert(await evaluate("document.querySelector('.react-flow').textContent.includes('PARENT_RESULT_OK') && document.querySelector('.react-flow').textContent.includes('VIDEO_RESULT_OK')"));
 assert(await evaluate("Array.from(document.querySelectorAll('.flow-node.chat')).every(node=>{const rect=node.getBoundingClientRect();return rect.left>=0 && rect.right<=innerWidth && rect.top>=0 && rect.bottom<=innerHeight})"));
 const chatBounds=await evaluate("(()=>{const node=Array.from(document.querySelectorAll('.react-flow__node')).find(node=>node.getAttribute('data-id')==="+JSON.stringify(to.id)+");const body=node.querySelector('.canvas-chat-transcript'),composer=node.querySelector('.canvas-chat-composer');const before=composer.getBoundingClientRect().top;body.scrollTop=0;return {scrollable:body.scrollHeight>body.clientHeight,composerFixed:before===composer.getBoundingClientRect().top,transcriptHeight:body.clientHeight}})()");
 assert(chatBounds.scrollable);assert(chatBounds.composerFixed);assert(chatBounds.transcriptHeight>200);
 await screenshot('linked-canvas-desktop.png');
 // Reopening the collaboration finds the same Canvas objects, rather than duplicating them.
 await evaluate("document.querySelector('.chat-toggle').click()");
 await until(()=>evaluate("!!Array.from(document.querySelectorAll('.handoff-card button')).find(button=>button.textContent.includes('Ver os dois'))"));
 await evaluate("Array.from(document.querySelectorAll('.handoff-card button')).find(button=>button.textContent.includes('Ver os dois')).click()");
 await until(()=>evaluate("!!document.querySelector('.collaboration-create-canvas')"));
 await evaluate("document.querySelector('.collaboration-create-canvas').click()");
 await until(()=>evaluate("!document.querySelector('.collaboration-window')"));
 assert.equal(state['canvas-workspaces'][workspaceId].nodes.length,2);assert.equal(state['canvas-workspaces'][workspaceId].edges.length,1);
 // Canvas composer continues the recipient's actual thread and includes the connected source.
 const beforeCount=state.sessions.find(session=>session.id===target.id).messages.length;
 await evaluate("(()=>{const node=Array.from(document.querySelectorAll('.react-flow__node')).find(node=>node.getAttribute('data-id')==="+JSON.stringify(to.id)+");const input=node.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Continue pela mesma conversa.');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await until(()=>evaluate("!!Array.from(document.querySelectorAll('.canvas-chat-send')).find(button=>!button.disabled)"));
 await evaluate("Array.from(document.querySelectorAll('.canvas-chat-send')).find(button=>!button.disabled).click()");
 await until(()=>state.sessions.find(session=>session.id===target.id).messages.length>beforeCount+1);
 assert.equal(state.sessions.length,2);
 const continued=state.sessions.find(session=>session.id===target.id),sent=continued.messages.find(message=>message.content==='Continue pela mesma conversa.');
 assert.equal(continued.codexThreadId,target.codexThreadId);assert.equal(sent.contextNodes[0].nodeId,from.id);assert.match(sent.contextNodes[0].content,/PARENT_RESULT_OK/);
 await until(()=>evaluate("!document.querySelector('.canvas-chat-thinking')"));
 // The linked agents keep working in their Canvas chats without forcing the popup back open.
 await evaluate("(()=>{const node=Array.from(document.querySelectorAll('.react-flow__node')).find(node=>node.getAttribute('data-id')==="+JSON.stringify(from.id)+");const input=node.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Peça uma nova revisão ao Editor de Vídeo.');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await until(()=>evaluate("!!Array.from(document.querySelectorAll('.canvas-chat-send')).find(button=>!button.disabled)"));
 await evaluate("Array.from(document.querySelectorAll('.canvas-chat-send')).find(button=>!button.disabled).click()");
 await until(()=>state.sessions.find(session=>session.id===source.id).handoffs.length===2);
 assert(await evaluate("!document.querySelector('.collaboration-window') && !!document.querySelector('.canvas-chat-thinking')"));
 await until(()=>state.sessions.find(session=>session.id===source.id).handoffs.at(-1).status==='completed');
 await until(()=>evaluate("!document.querySelector('.canvas-chat-thinking')"));
 assert.equal(state.sessions.length,2);assert.equal(state.sessions.find(session=>session.id===source.id).handoffs.at(-1).targetSessionId,target.id);
 assert(await evaluate("!document.querySelector('.collaboration-window') && document.querySelector('.react-flow').textContent.includes('Peça uma nova revisão')"));
 await window.reload();
 await until(()=>evaluate("document.querySelectorAll('.flow-node.chat').length===2 && document.querySelector('.react-flow').textContent.includes('Continue pela mesma conversa.')"));
 assert.equal(state.sessions.length,2);assert.equal(state['canvas-workspaces'][workspaceId].edges.length,1);
 window.setSize(680,850);await new Promise(resolve=>setTimeout(resolve,150));await screenshot('linked-canvas-mobile.png');
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:true,independentSessions:true,automaticChild:true,parentContinued:true,reopenWithoutDuplication:true,linkedCanvas:true,canvasContinuesSameThread:true,liveDelegationStaysOnCanvas:true,canvasRestoredAfterReload:true,canvasChatBounds:chatBounds,...bounds},null,2));
 console.log('HANDOFF_UI_OK: delegation, linked live Canvas chats, same thread, connected context, pinned composers, reload, no duplication');
}catch(error){console.error(error);await screenshot('failure.png');process.exitCode=1;}finally{window.destroy();await bridge.close();server.close();app.exit(process.exitCode??0);}
}).catch(error=>{console.error(error);app.exit(1);});
