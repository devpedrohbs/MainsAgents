// Run with: electron scripts/test-chat-interaction-ui.mjs (after npm run build).
// Uses an isolated profile and deterministic provider; never reads user data or consumes AI tokens.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/chat-interaction-ui-test');mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'profile'));
const now=new Date().toISOString(),workspaceId='my-workspace';
const imageBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9sAAAAASUVORK5CYII=','base64');
const image={id:'test-generated-image',url:`/api/codex/images/${'a'.repeat(64)}.png`,mimeType:'image/png',filename:'image.png',alt:'Generated image'};
const base={workspaceId,role:'Specialist',description:'Test specialist',instructions:'Follow the user request.',tools:['files'],status:'idle',createdAt:now,updatedAt:now};
const state={agents:[{...base,id:'content',name:'Editor de Conteúdo',tools:['files','subagents']},{...base,id:'video',name:'Editor de Vídeo'}],workspaces:[{id:workspaceId,name:'Test Workspace',createdAt:now,updatedAt:now}],sessions:[{id:'source-session',agentId:'content',title:'Conversa conectada',messages:[],agentConnection:{enabled:true,targetAgentId:'video'},createdAt:now,updatedAt:now}],'active-sessions':{content:'source-session'},language:'pt-BR','focus-mode':false,'welcome-dismissed':true};
state.agents.push({...base,id:'linkedin',name:'Linkedin Agent',skills:['linkedin-post-writer','linkedin-humanizer'],skillsDirectory:'C:/mock-skills',skillFiles:{'linkedin-post-writer':'C:/mock-skills/post.md','linkedin-humanizer':'C:/mock-skills/humanizer.md'}});
state['focus-mode']=true;
ipcMain.handle('test:read',(_event,key)=>state[key]);ipcMain.handle('test:write',(_event,key,value)=>{state[key]=value;});ipcMain.handle('test:all',()=>state);
let serial=0;const threads=new Map(),runs=new Map();
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'||event.type==='execution.cancelled'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;let input={};if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;input=JSON.parse(text||'{}');}
 if(path.endsWith('/health'))return json(res,{ready:true,status:'connected',accountType:'chatgpt'});
 if(path.endsWith('/models'))return json(res,{models:[{id:'test-model',name:'Test model'}]});
 if(path.endsWith('/usage'))return json(res,{rateLimits:null});
 if(path.endsWith('/images')&&path.includes('/sessions/'))return json(res,{events:[]});
 if(path===image.url){res.setHeader('content-type','image/png');return res.end(imageBytes);}
 if(path==='/api/codex/sessions'){const id=input.threadId??`thread-${++serial}`;if(input.config)threads.set(id,input.config);return json(res,{threadId:id});}
 if(path==='/api/codex/executions'){
  const executionId=`turn-${++serial}`,run={executionId,input,events:[],streams:new Set(),done:false};runs.set(executionId,run);
  const started={type:'execution.started',executionId,threadId:input.threadId};run.events.push(started);
  setTimeout(()=>{if(run.done)return;emit(run,{type:'image.completed',executionId,image});emit(run,{type:'message.completed',executionId,content:'Plano técnico recebido.\n\n'+('Preservar os brutos e revisar o corte base.\n\n'.repeat(20))+'CHAT_RESULT_OK'});emit(run,{type:'execution.completed',executionId});},1800);
  return json(res,{executionId,threadId:input.threadId});
 }
 const streamMatch=path.match(/\/executions\/([^/]+)\/events$/);
 if(streamMatch){const run=runs.get(streamMatch[1]);res.setHeader('content-type','application/x-ndjson');for(const event of run.events)res.write(JSON.stringify(event)+'\n');if(run.done)res.end();else{run.streams.add(res);req.on('close',()=>run.streams.delete(res));}return;}
 const resolveMatch=path.match(/\/executions\/([^/]+)\/delegations\/([^/]+)$/);
 if(resolveMatch){assert.equal(input.success,true);assert.match(input.content,/CHAT_RESULT_OK/);const run=runs.get(resolveMatch[1]);emit(run,{type:'message.completed',executionId:run.executionId,content:'Editor de Vídeo devolveu o plano. Aguardo sua revisão. PARENT_RESULT_OK'});emit(run,{type:'execution.completed',executionId:run.executionId});return json(res,{});}
 const cancelMatch=path.match(/\/executions\/([^/]+)\/cancel$/);if(cancelMatch){const run=runs.get(cancelMatch[1]);if(run&&!run.done)emit(run,{type:'execution.cancelled',executionId:run.executionId});return json(res,{});}
 if(path==='/api/content/state')return json(res,{revision:0,state:{schemaVersion:1,topics:[],contents:[],runs:[],artifacts:[],approvals:[]}});
 if(path==='/api/content/jobs')return json(res,{jobs:[]});
 if(path==='/api/content/connection')return json(res,{dataSourceId:'',autoSync:false});
 if(path.startsWith('/api/'))return json(res,{});
 try{const file=resolve(root,'dist',path==='/'?'app.html':path.slice(1));assert(file.startsWith(resolve(root,'dist')+'\\'));const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extname(file)];if(mime)res.setHeader('content-type',mime);res.end(readFileSync(file));}catch{res.statusCode=404;res.end();}
});
app.whenReady().then(async()=>{
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const window=new BrowserWindow({show:false,width:1440,height:940,webPreferences:{preload:resolve(root,'tests/fixtures/handoff-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
const errors=[];window.webContents.on('console-message',(event)=>{console.log('renderer:',event.message);if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message);});
const evaluate=code=>window.webContents.executeJavaScript(code);
async function until(check,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,60));}throw new Error('UI assertion timed out');}
async function screenshot(name){try{writeFileSync(resolve(out,name),(await window.webContents.capturePage()).toPNG());}catch{console.log('Screenshot unavailable:',name);}}
async function draft(text,caret=text.length){
 await evaluate(`(()=>{const input=document.querySelector('.composer textarea');input.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.setSelectionRange(${caret},${caret});input.dispatchEvent(new Event('input',{bubbles:true}));document.dispatchEvent(new Event('selectionchange'));})()`);
}
async function key(keyCode){window.webContents.sendInputEvent({type:'keyDown',keyCode});window.webContents.sendInputEvent({type:'keyUp',keyCode});await new Promise(r=>setTimeout(r,80));}
async function focusShape(appearance){
 await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)}`);
 await pointer('.composer textarea');await new Promise(r=>setTimeout(r,200));
 const style=await evaluate(`(()=>{const input=getComputedStyle(document.querySelector('.composer textarea')),composer=getComputedStyle(document.querySelector('.composer'));return {outline:input.outlineWidth,shadow:input.boxShadow,glow:composer.boxShadow,radius:composer.borderRadius}})()`);
 assert.equal(style.outline,'0px');assert.equal(style.shadow,'none');assert.notEqual(style.glow,'none');assert.equal(style.radius,'22px');
}
async function pointer(selector){
 const point=await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw new Error('Missing ${selector}');const rect=element.getBoundingClientRect();const x=rect.left+rect.width/2,y=rect.top+rect.height/2;const top=document.elementFromPoint(x,y);return {x,y,blocked:!(top===element||element.contains(top)),top:top?.className,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},disabled:element.disabled}})()`);
 assert(!point.blocked,`${selector} is covered by ${point.top}: ${JSON.stringify(point.rect)}`);assert(!point.disabled,`${selector} is disabled`);
 window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});
 window.webContents.sendInputEvent({type:'mouseDown',x:Math.round(point.x),y:Math.round(point.y),button:'left',clickCount:1});
 window.webContents.sendInputEvent({type:'mouseUp',x:Math.round(point.x),y:Math.round(point.y),button:'left',clickCount:1});
}
try{
 await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);
 await until(()=>evaluate("document.querySelectorAll('.agent-nav').length===3"));
 await pointer('.agent-nav[title="Linkedin Agent"]');
 await until(()=>evaluate("!!document.querySelector('.composer textarea')"));
 const layout=await evaluate("(()=>{const layer=document.querySelector('.chat-layer'),input=document.querySelector('.composer textarea');return {display:getComputedStyle(layer).display,layerRect:layer.getBoundingClientRect().toJSON(),inputRect:input.getBoundingClientRect().toJSON(),atInput:document.elementFromPoint(input.getBoundingClientRect().x+20,input.getBoundingClientRect().y+20)?.outerHTML.slice(0,250)}})()");
 console.log('Chat layout:',JSON.stringify(layout));
 await until(()=>evaluate("!document.querySelector('.composer textarea').disabled"));
 await pointer('.composer textarea');
 await until(()=>evaluate("document.activeElement===document.querySelector('.composer textarea')"));
 await focusShape('dark');await focusShape('light');
 await window.webContents.insertText('Teste de envio pelo clique real');
 await until(()=>evaluate("!document.querySelector('.send-button').disabled"));
 await pointer('.send-button');
 await until(()=>evaluate("!!document.querySelector('.send-button.stop')"));
 await pointer('.composer textarea');
 await window.webContents.insertText('Rascunho enquanto responde');
 await until(()=>state.sessions.some(session=>session.agentId==='linkedin'&&session.messages.some(item=>item.content?.includes('CHAT_RESULT_OK'))));
 await until(()=>evaluate("document.querySelector('.chat-generated-image img')?.naturalWidth===1"));
 assert.equal(state.sessions.find(session=>session.agentId==='linkedin').messages.find(item=>item.role==='agent').images.length,1);
 assert.equal(await evaluate("document.querySelector('.composer textarea').value"),'Rascunho enquanto responde');
 await evaluate("(()=>{const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 assert.equal(state.sessions.find(session=>session.agentId==='linkedin').messages.find(item=>item.role==='user').content,'Teste de envio pelo clique real');
 await screenshot('side-chat.png');
 await pointer('.conversation-expand');
 await until(()=>evaluate("!!document.querySelector('.chat-layer.floating')"));
 await evaluate("document.querySelector('.chat-image-open').click()");
 await until(()=>evaluate("document.querySelector('.chat-image-preview img')?.naturalWidth===1"));
 assert.equal(await evaluate("document.querySelector('.chat-image-preview a').getAttribute('download')"),'image.png');
 await key('Escape');await until(()=>evaluate("!document.querySelector('.chat-image-preview')"));
 assert.equal(await evaluate("!!document.querySelector('.chat-layer.floating')"),true);
 await pointer('.composer textarea');
 // A skill inserted into an existing request must keep both sides of its text.
 await draft('Faça um /post sobre IA',13);
 await until(()=>evaluate("document.querySelector('.skill-command-menu [role=option]')?.textContent.includes('linkedin-post-writer')"));
 await key('Return');
 await until(()=>evaluate("!!document.querySelector('.composer-selected-skill')"));
 assert.equal(await evaluate("document.querySelector('.composer textarea').value"),'Faça um sobre IA');
 assert.equal(await evaluate("document.querySelector('.composer textarea').selectionStart"),8);
 // Escape closes only the skill list, preserving the fullscreen conversation.
 await draft('Não apague este rascunho /human');
 await until(()=>evaluate("!!document.querySelector('.skill-command-menu')"));await key('Escape');
 await until(()=>evaluate("!document.querySelector('.skill-command-menu')"));
 assert.equal(await evaluate("document.querySelector('.composer textarea').value"),'Não apague este rascunho /human');
 assert.equal(await evaluate("!!document.querySelector('.chat-layer.floating')"),true);
 await draft('Uma referência https://example.com/video');
 assert.equal(await evaluate("!!document.querySelector('.skill-command-menu')"),false);
 await draft('');await pointer('.composer-selected-skill button');
 await focusShape('dark');await screenshot('floating-composer-focus-dark.png');
 await focusShape('light');await screenshot('floating-composer-focus-light.png');
 await window.webContents.insertText('Mensagem no chat flutuante');
 await until(()=>evaluate("!document.querySelector('.send-button').disabled"));
 await pointer('.send-button');
 await until(()=>state.sessions.find(session=>session.agentId==='linkedin').messages.some(item=>item.content==='Mensagem no chat flutuante'));
 await until(()=>evaluate("!document.querySelector('.send-button.stop')"));
 await screenshot('floating-chat.png');
 await pointer('.conversation-expand');
 await until(()=>evaluate("!!document.querySelector('.chat-layer:not(.floating)')"));
 window.setSize(880,720);
 await new Promise(resolve=>setTimeout(resolve,200));
 await pointer('.composer textarea');
 await window.webContents.insertText('Mensagem em tela menor');
 await until(()=>evaluate("!document.querySelector('.send-button').disabled"));
 await pointer('.send-button');
 await until(()=>state.sessions.find(session=>session.agentId==='linkedin').messages.some(item=>item.content==='Mensagem em tela menor'));
 await until(()=>evaluate("!document.querySelector('.send-button.stop')"));
 await screenshot('compact-chat.png');
 window.setSize(1440,940);
 await new Promise(resolve=>setTimeout(resolve,150));
 await pointer('.chat-toggle');
 await until(()=>evaluate("!document.querySelector('.chat-layer')"));
 await pointer('.specialist-open[aria-label="Ver detalhes de Editor de Vídeo"]');
 await until(()=>evaluate("!!document.querySelector('.studio-detail-panel')"));
 await pointer('.studio-detail-panel > footer .primary-button');
 await until(()=>evaluate("!!document.querySelector('.composer textarea[aria-label=\"Pergunte para Editor de Vídeo\"]') && !document.querySelector('.studio-detail-panel')"));
 await pointer('.composer textarea');
 await pointer('.specialist-chat[aria-label="Conversar com Editor de Conteúdo"]');
 await until(()=>evaluate("!!document.querySelector('.composer textarea[aria-label=\"Pergunte para Editor de Conteúdo\"]')"));
 await pointer('.composer textarea');
 await pointer('.agent-nav[title="Linkedin Agent"]');
 await until(()=>evaluate("!!document.querySelector('.composer textarea[aria-label=\"Pergunte para Linkedin Agent\"]')"));
 await pointer('.composer textarea');
 await window.reload();
 await until(()=>evaluate("document.querySelectorAll('.agent-nav').length===3"));
 await pointer('.agent-nav[title="Linkedin Agent"]');
 await until(()=>evaluate("document.querySelector('.chat-generated-image img')?.naturalWidth===1"));
 assert.equal(state.sessions.find(session=>session.agentId==='linkedin').messages.filter(item=>item.role==='user').length,3);
 await screenshot('agent-chat-access.png');
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'result.json'),JSON.stringify({passed:true,pointerOpensChat:true,composerReceivesFocus:true,pointerSendsMessage:true,floatingChatWorks:true,compactChatWorks:true,draftWhileWorking:true,directCardChat:true,detailsCloseOnChat:true,switchAgents:true,roundedFocusBothThemes:true,inlineSkillInFullscreen:true,requestPreserved:true,escapePreservesDraft:true,urlsAreNotCommands:true},null,2));
 console.log('CHAT_INTERACTION_OK');
}catch(error){console.error(error);await screenshot('failure.png');process.exitCode=1;}finally{window.destroy();server.close();app.exit(process.exitCode??0);}
}).catch(error=>{console.error(error);app.exit(1);});
