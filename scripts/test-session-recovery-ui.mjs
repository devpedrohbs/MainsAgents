// Session recovery, second chat of a content, keyboard layers and agent drafts: real renderer/SQLite/FFmpeg/production
// coordinator, simulated Codex chat bridge (HTTP contract of codex-bridge: 410 thread-missing, 409 thread-not-loaded, 400
// invalid-thread-id) and simulated editor CLI. No personal profile, no AI, no network, no Notion write, no publication.
// Usage: npx electron scripts/test-session-recovery-ui.mjs   (MAINSAGENTS_UI_DIST=<built ui dir>, default dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/session-recovery-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',otherSpace='space-2',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),videoA=join(out,'LinkedinSkills-fixture.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const source={id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Use my own role and skills',description:'Fixture',skills:['own-skill'],workspaceId,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at},editor={...source,id:'editor',name:'Editor de Vídeo',role:'Vídeo',skills:['edit-skill']},elsewhere={...source,id:'elsewhere',name:'Agente do Espaço 2',workspaceId:otherSpace};
const flow={id:'flow',workspaceId,name:'Fluxo de criação de conteúdo',nodes:[{id:'content-box',kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:'input-box',kind:'video-input',title:'Vídeos da gravação',position:{x:430,y:140}},{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:'editor',position:{x:780,y:140}},{id:'publish-box',kind:'publishing-agent',title:'Preparar publicação',agentId:'source',position:{x:1130,y:140}}],edges:[],createdAt:at,updatedAt:at};
// Saved generic chats whose provider thread is in a given state. History is what must survive.
const chat=(id,title,thread)=>({id,agentId:'source',providerId:'codex',title,remoteSessionId:thread,codexThreadId:thread,delegationRuntimeVersion:2,messages:[{id:`${id}-u`,type:'message',role:'user',content:`HISTORICO_${id}: edite o LinkedinSkills.MOV`,createdAt:at},{id:`${id}-a`,type:'message',role:'agent',content:`RESPOSTA_ANTIGA_${id}`,deliveryState:'completed',createdAt:at}],createdAt:at,updatedAt:at});
const seeded=[chat('expired','Conversa expirada','thread-expired'),chat('unloaded','Conversa descarregada','thread-unloaded'),chat('auth','Conversa sem login','thread-auth'),chat('invalid','Conversa id inválido','thread-invalid'),chat('stream','Conversa interrompida','thread-stream')];
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor,elsewhere],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at},{id:otherSpace,name:'Espaço 2',createdAt:at,updatedAt:at}],sessions:seeded,'current-workspace':workspaceId,'active-sessions':{source:'expired'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}}});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
// Production editor CLI (simulated): records every prompt with its agent.
const executions=new Map(),threads=new Map(),prompts=[];let serial=0,pick=videoA,win;
const reply=text=>text.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.2,format:'original',normalizeAudio:true,fadeSeconds:.1,summary:'Acabamento discreto'}):text.includes('"removeSilences"')?JSON.stringify({removeSilences:true,normalizeAudio:true,animations:{},summary:'Silêncios removidos com margem'}):'{}';
const runtime={createSession:async()=>{const id=`cli-thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},send:async(thread,text,agent)=>{prompts.push({text,agent:agent.id});const id=`cli-execution-${++serial}`;executions.set(id,{thread,text,output:reply(text)});return {executionId:id}},events:async function*(id){const e=executions.get(id);yield {type:'message.completed',content:e.output};threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.text}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
const bridgeOptions={dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect,animate:async({inputPath,outputPath})=>copyFileSync(inputPath,outputPath),animationCapabilities:async()=>({available:true})},getConnector:()=>({upsert:async()=>{throw Error('No card may be written in this scenario')},readCard:async()=>{throw Error('No card is read in this scenario')}})};
let bridge=createContentWorkflowBridge(bridgeOptions);
// Declared fixture choice: the (simulated) editor agent directs the edit; this fixture has no Claude Code CLI.
bridge.production.setEditDirector(profile,{workspaceId,director:{providerId:'agent'}});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[pick]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
// Chat bridge (simulated) with the codex-bridge error contract.
const chatThreads=new Map(),chatRuns=new Map(),chatInputs=[],resumes=[],creates=[];let unloadedRefused=0;
const json=(response,value,status=200)=>{response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'||event.end){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){let input={};if(request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;input=JSON.parse(text||'{}');}
  if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path==='/api/codex/sessions'){
   if(input.threadId){resumes.push(input.threadId);
    if(input.threadId==='thread-expired')return json(response,{error:'This conversation is no longer available in the agent runtime.',code:'thread-missing'},410);
    if(input.threadId==='thread-auth')return json(response,{error:'Sign in to Codex to continue.'},500);
    if(input.threadId==='thread-invalid')return json(response,{error:'invalid thread id: thread-invalid',code:'invalid-thread-id'},400);
    return json(response,{threadId:input.threadId});}
   const id=`chat-thread-${++serial}`;creates.push(id);chatThreads.set(id,input);return json(response,{threadId:id});}
  if(path==='/api/codex/executions'){const thread=input.threadId??input.remoteSessionId;
   if(thread==='thread-unloaded'&&!unloadedRefused){unloadedRefused++;return json(response,{error:'Resume this session in MainsAgents before sending a message so its tool policy can be verified.',code:'thread-not-loaded'},409);}
   const executionId=`chat-turn-${++serial}`,run={events:[],streams:new Set(),done:false};chatRuns.set(executionId,run);chatInputs.push({...input,thread});run.events.push({type:'execution.started',executionId,threadId:thread});
   setTimeout(()=>{if(thread==='thread-stream'){emit(run,{type:'message.delta',executionId,delta:'PARCIAL_ANTES_DA_QUEDA'});setTimeout(()=>emit(run,{type:'noop',end:true}),150);return;}
    emit(run,{type:'message.completed',executionId,content:`RESPOSTA_${chatInputs.length}`});emit(run,{type:'execution.completed',executionId});},150);
   return json(response,{executionId});}
  const stream=path.match(/\/executions\/([^/]+)\/events$/);if(stream){const run=chatRuns.get(stream[1]);response.setHeader('content-type','application/x-ndjson');for(const event of run.events)if(event.type!=='noop')response.write(JSON.stringify(event)+'\n');if(run.done)response.end();else{run.streams.add(response);request.on('close',()=>run.streams.delete(response));}return;}
  return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Session recovery UI timed out: ${label}`)}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function button(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`),text);await js(`Array.from(document.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled).click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
const key=(name,shift=false)=>js(`(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(name)},shiftKey:${shift},bubbles:true,cancelable:true}))`);
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
const sessions=()=>store.read(profile,'sessions'),byId=id=>sessions().find(s=>s.id===id),byTitle=title=>sessions().find(s=>s.title===title),runsFor=contentId=>bridge.production.list(profile).filter(p=>p.contentId===contentId);
async function openSessions(){await js(`document.querySelector('button[title="Sessões deste agente"]').click()`);await until(()=>js('Boolean(document.querySelector(".panel-sessions"))'),'sessions tab');}
// Content spaces: the agent's Sessions tab lists one space at a time; look through the spaces until the chat is listed.
const listed=title=>js(`Array.from(document.querySelectorAll('.panel-session-main b')).some(el=>el.textContent===${JSON.stringify(title)})`);
async function showSpaceOf(title){await openSessions();if(await listed(title))return;
 const spaces=await js(`(async()=>{document.querySelector('.content-scope-picker .select-menu-trigger').click();await new Promise(r=>setTimeout(r,50));const names=Array.from(document.querySelectorAll('[role=listbox] .select-menu-option-copy b')).map(el=>el.textContent);document.querySelector('.content-scope-picker .select-menu-trigger').click();return names})()`);
 for(const space of spaces){await js(`document.querySelector('.content-scope-picker .select-menu-trigger').click()`);await until(()=>js(`Boolean(Array.from(document.querySelectorAll('[role=listbox] .select-menu-option')).find(el=>el.querySelector('.select-menu-option-copy b')?.textContent===${JSON.stringify(space)}))`),`space ${space}`);await js(`Array.from(document.querySelectorAll('[role=listbox] .select-menu-option')).find(el=>el.querySelector('.select-menu-option-copy b')?.textContent===${JSON.stringify(space)}).click()`);await openSessions();if(await listed(title))return;}
 throw Error(`Chat ${title} not listed in any space`);}
async function openSessionNamed(title){await showSpaceOf(title);await js(`Array.from(document.querySelectorAll('.panel-session-main')).find(el=>el.querySelector('b')?.textContent===${JSON.stringify(title)}).click()`);await until(()=>js(`document.querySelector('.active-session-bar')?.textContent.includes(${JSON.stringify(title)})`),`open ${title}`);}
async function newContent(title){await openSessions();await button('Novo conteúdo');await inputText('[aria-label="Nome do novo conteúdo"]',title);await button('Criar conteúdo');await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes(${JSON.stringify(title)})`),`card ${title}`);}
const idle=()=>until(()=>js('!document.querySelector(".send-button.stop")'),'idle');
async function say(text){await inputText('.composer textarea',text);await click('.send-button');}
async function open(agentName='Editor de Conteúdo'){win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="${agentName}"]'))`),'app ready');await js('window.confirm=()=>true;true');await js(`document.querySelector('.agent-nav[title="${agentName}"]').click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))'),'chat open');}
async function restart(agentName){await js('window.mainsAgentsSaveNow?.()');await pause(300);win.destroy();await bridge.close();bridge=createContentWorkflowBridge(bridgeOptions);await open(agentName);}
app.whenReady().then(async()=>{try{
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.5','-c:v','libx264','-c:a','aac',videoA]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 const report=[];
 // 1) Thread proven missing (410 thread-missing) during CONNECT: new thread, saved history sent once, visible notice, nothing replayed.
 await openSessionNamed('Conversa expirada');await say('PEDIDO_APOS_EXPIRAR');await idle();
 await until(()=>(byId('expired')?.messages??[]).some(m=>m.content==='RESPOSTA_1'),'recovered reply saved');
 let expired=byId('expired'),turns=chatInputs.filter(i=>i.content.includes('PEDIDO_APOS_EXPIRAR'));
 assert.equal(turns.length,1,'the request is sent exactly once');assert.equal(creates.length,1,'one new provider thread');
 assert.equal(turns[0].thread,creates[0]);assert.match(turns[0].content,/MainsAgents thread recovery/);assert(turns[0].content.includes('HISTORICO_expired'),'saved history goes along');assert.match(turns[0].content,/do NOT repeat them/);
 assert.equal(turns[0].content.split('PEDIDO_APOS_EXPIRAR').length,2,'current request appears once');assert(!turns[0].content.includes('HISTORICO_unloaded'),'never another chat history');
 assert.equal(expired.remoteSessionId,creates[0]);assert.equal(expired.previousCodexThreadId,'thread-expired');assert.equal(expired.threadRecoveries.length,1);
 assert.deepEqual(expired.messages.slice(0,2).map(m=>m.content),['HISTORICO_expired: edite o LinkedinSkills.MOV','RESPOSTA_ANTIGA_expired'],'history preserved');
 await until(()=>js(`document.querySelector('.chat-body')?.textContent.includes('Abri uma nova conversa no provedor')`),'visible recovery notice');await shot('recovered-thread');
 await say('SEGUNDO_PEDIDO');await idle();await until(()=>chatInputs.some(i=>i.content.includes('SEGUNDO_PEDIDO')),'second');
 const second=chatInputs.find(i=>i.content.includes('SEGUNDO_PEDIDO'));assert.equal(second.thread,creates[0],'continues the new thread');assert(!second.content.includes('thread recovery'),'briefing only once');assert.equal(creates.length,1);assert.equal(byId('expired').threadRecoveries.length,1);
 report.push(`missing thread -> ${creates[0]} (history kept, notice shown, request sent once)`);
 // 2) Thread unloaded after a restart (409 thread-not-loaded): SAME thread resumed, the turn sent once, no new thread.
 const before=chatInputs.length;await openSessionNamed('Conversa descarregada');await say('PEDIDO_DESCARREGADA');await idle();
 await until(()=>chatInputs.some(i=>i.content.includes('PEDIDO_DESCARREGADA')),'unloaded sent');
 assert.equal(unloadedRefused,1);assert.equal(chatInputs.length,before+1,'one accepted turn');assert.equal(chatInputs.at(-1).thread,'thread-unloaded');assert.equal(creates.length,1,'never recreated');
 assert.equal(resumes.filter(id=>id==='thread-unloaded').length,2,'resumed the same thread before resending');assert.equal(byId('unloaded').remoteSessionId,'thread-unloaded');assert.equal(byId('unloaded').threadRecoveries,undefined);
 report.push('unloaded thread -> same thread resumed, one turn');
 // 3) Sign-in failure and invalid id: real error, no new thread, no turn, history intact.
 for(const [title,id,pattern] of [['Conversa sem login','auth',/Sign in to Codex/],['Conversa id inválido','invalid',/invalid thread id/]]){
  const count=chatInputs.length;await openSessionNamed(title);await say(`PEDIDO_${id}`);await idle();
  await until(()=>(byId(id)?.messages??[]).some(m=>m.type==='activity'&&pattern.test(m.label??'')),`${id} error shown`);
  assert.equal(chatInputs.length,count,'no turn sent');assert.equal(creates.length,1,'no new thread');const s=byId(id);assert.equal(s.remoteSessionId,`thread-${id}`);assert.equal(s.threadRecoveries,undefined);assert.equal(s.messages[0].content,`HISTORICO_${id}: edite o LinkedinSkills.MOV`);
 }
 report.push('auth / invalid id -> honest error, thread kept');
 // 4) Failure AFTER the turn was accepted (stream dropped mid-response): no automatic resend, no new thread.
 const streamCount=chatInputs.length;await openSessionNamed('Conversa interrompida');await say('PEDIDO_STREAM');await idle();
 await until(()=>(byId('stream')?.messages??[]).some(m=>m.type==='message'&&m.deliveryState==='interrupted'),'interrupted partial');await pause(800);
 assert.equal(chatInputs.length,streamCount+1,'sent once, never replayed');assert.equal(creates.length,1);assert.equal(byId('stream').remoteSessionId,'thread-stream');
 report.push('stream lost after send -> interrupted, not replayed');
 // 5) Restart: recovered chat resumes its NEW thread; nothing replayed on reopen.
 const frozen=JSON.stringify({chat:chatInputs.length,creates:creates.length,prompts:prompts.length});await restart();await pause(1200);assert.equal(JSON.stringify({chat:chatInputs.length,creates:creates.length,prompts:prompts.length}),frozen,'reopen repeats nothing');
 await openSessionNamed('Conversa expirada');await say('DEPOIS_DO_RESTART');await idle();await until(()=>chatInputs.some(i=>i.content.includes('DEPOIS_DO_RESTART')),'after restart');
 assert.equal(chatInputs.at(-1).thread,creates[0]);assert.equal(creates.length,1);assert(resumes.filter(id=>id===creates[0]).length>=2);
 report.push('restart -> recovered thread resumed');
 // 6) Content with a recorded video started in its main chat; a NEW chat of the same content recognizes it and acts on the SAME run.
 await newContent('Vídeo LinkedIn Skills');const main=byTitle('Vídeo LinkedIn Skills');
 await button('Começar com vídeo já gravado');await until(()=>js('Boolean(document.querySelector(".recorded-entry"))'),'entry dialog');pick=videoA;await button('Associar vídeo do computador');
 await until(()=>js(`document.querySelector('[aria-label="Vídeo gravado"]')?.textContent.includes('LinkedinSkills-fixture.mp4')`),'video selected');await inputText('[aria-label="Contexto do vídeo"]','CONTEXTO_DO_VIDEO: tutorial de skills.');
 await until(()=>js(`document.querySelector('.recorded-entry .production-preflight [role=status]')?.textContent.includes('Nenhum bloqueio')`),'preflight ok');// Synthetic tone without speech: motion has nothing to animate, so the fixture explicitly chooses the existing "Sem motion" option.
 await js(`document.querySelector('.recorded-entry button[aria-label="Movimento na edição do vídeo gravado"]').click()`);await until(()=>js(`Boolean(Array.from(document.querySelectorAll('[role=listbox] .select-menu-option')).find(el=>el.textContent.includes('Sem motion')))`),'motion menu');await js(`Array.from(document.querySelectorAll('[role=listbox] .select-menu-option')).find(el=>el.textContent.includes('Sem motion')).click()`);
 await click('.recorded-entry-review .production-check input');await button('Iniciar edição do vídeo gravado');
 await until(()=>['video-review','blocked'].includes(runsFor(main.contentId)[0]?.stage),'edited');const run=runsFor(main.contentId)[0];assert.equal(run.stage,'video-review',run.error);assert.equal(run.sourceSession.id,main.id);
 const editorPrompts=prompts.filter(p=>p.agent==='editor').length,revision=run.revision;
 await click('button[aria-label="Nova sessão"]');await until(()=>sessions().filter(s=>s.contentId===main.contentId&&s.agentId==='source').length===2,'second chat of the content');
 const fresh=sessions().find(s=>s.contentId===main.contentId&&s.agentId==='source'&&s.id!==main.id);assert.equal(fresh.remoteSessionId,undefined,'never inherits the main chat thread');
 await until(()=>js(`(()=>{const c=document.querySelector('.content-session-card');return !!c&&c.textContent.includes('Abrir etapa atual')&&c.textContent.includes('LinkedinSkills-fixture.mp4')&&c.textContent.includes('conversa principal')})()`),'second chat card recognizes video');
 assert.equal(runsFor(main.contentId).length,1,'opening a session never starts a production');await shot('second-chat-card');
 await say('O vídeo já está pronto, mande para o editor');await idle();const asked=chatInputs.findLast(i=>i.content.includes('mande para o editor'));
 assert(asked.content.includes('"conductedIn":"main-session"'),'read-only snapshot reaches the agent');assert(asked.content.includes('LinkedinSkills-fixture.mp4'));assert.match(asked.content,/never say the video was sent/);assert.notEqual(asked.thread,byId(main.id).remoteSessionId);
 assert.equal(prompts.filter(p=>p.agent==='editor').length,editorPrompts,'a chat answer never edits by itself');
 // Real action from the second chat: the production controls of THAT run (coordinator command with receipt), not a chat claim.
 await button('Abrir etapa atual');await until(()=>js(`document.querySelector('.production-panel-body')?.textContent.includes('Enviar ajuste ao editor')`),'real run controls');
 assert(await js(`document.querySelector('.flow-dialog h2')?.textContent.includes('Vídeo LinkedIn Skills')||document.querySelector('.flow-dialog')?.textContent.includes('Entrada com vídeo já gravado')`),'the dialog is the content run');
 await js(`(()=>{const label=Array.from(document.querySelectorAll('.production-panel-body label')).find(l=>l.textContent.startsWith('Pedir ajuste'));const el=label.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'AJUSTE_DO_SEGUNDO_CHAT: cortar o início');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await button('Enviar ajuste ao editor');await until(()=>runsFor(main.contentId)[0].revision>revision&&['video-review','blocked'].includes(runsFor(main.contentId)[0].stage)&&prompts.filter(p=>p.agent==='editor').length>editorPrompts,'revision edited');await pause(800);
 const after=runsFor(main.contentId);assert.equal(after.length,1,'same run, no duplicate');assert.equal(after[0].id,run.id);assert.equal(after[0].sourceSession.id,main.id,'run session unchanged');assert.equal(after[0].stage,'video-review',after[0].error);
 const revisionPrompts=prompts.filter(p=>p.agent==='editor').slice(editorPrompts);assert(revisionPrompts.length>=1&&revisionPrompts.every(p=>p.agent==='editor'));assert(revisionPrompts.some(p=>p.text.includes('AJUSTE_DO_SEGUNDO_CHAT')),'the real editor received the note');
 assert(after[0].events.some(e=>e.action==='revise-video'),'coordinator receipt recorded');
 assert(!byId(fresh.id).messages.some(m=>m.id.startsWith('production:')),'production messages stay in the main chat');assert(byId(main.id).productionContext,'main chat keeps commanding the run');assert.equal(byId(main.id).productionContext.conductedIn,undefined);
 await click('.flow-dialog header button');await shot('second-chat-after-revision');
 report.push(`second chat of content -> run ${run.id} revised by the real editor (${revisionPrompts.length} editor turn(s)), no new run`);
 // 7) Keyboard layers: Escape closes an open menu first, the dialog only on the next Escape; focus returns to the trigger.
 await openSessionNamed('Conversa expirada');await button('Ver produção');await until(()=>js('Boolean(document.querySelector(".flow-dialog"))'),'production dialog');
 await click('.flow-dialog .select-menu-trigger');await until(()=>js('Boolean(document.querySelector(".select-menu-popover"))'),'menu open');
 await key('Escape');await pause(100);assert.equal(await js('Boolean(document.querySelector(".select-menu-popover"))'),false,'menu closed');assert.equal(await js('Boolean(document.querySelector(".flow-dialog"))'),true,'dialog still open');
 assert.equal(await js(`document.activeElement?.classList.contains('select-menu-trigger')`),true,'focus back on the menu trigger');
 await key('Escape');await until(()=>js('!document.querySelector(".flow-dialog")'),'dialog closed on second Escape');
 report.push('Escape: menu -> dialog');
 // 8) Agent editor: Tab contained, Escape menu-first, focus restored, drafts per workspace.
 const creatorButton="Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Criar agente'&&el.getClientRects().length)";
 const openCreator=async()=>{
  if(!await js(`Boolean(${creatorButton})`)){await js(`(()=>{const nav=Array.from(document.querySelectorAll('button,a')).find(el=>['Agentes','Gerenciar equipe'].includes(el.textContent.trim())||el.getAttribute('title')==='Agentes');nav?.click();return !!nav})()`);await until(()=>js(`Boolean(${creatorButton})`),'agents page');}
  await js(`(()=>{const b=${creatorButton};b.setAttribute('data-qa-trigger','1');b.focus();b.click();return true})()`);await until(()=>js('Boolean(document.querySelector(".agent-drawer"))'),'drawer');};
 await openCreator();await until(()=>js(`document.activeElement?.tagName==='INPUT'&&!!document.activeElement.closest('.agent-drawer')`),'name focused');
 await js(`(()=>{const el=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'RASCUNHO_ESPACO_1');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const focusables=`Array.from(document.querySelector('.agent-drawer').querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')).filter(i=>i.tabIndex>=0&&i.getClientRects().length)`;
 await js(`${focusables}.at(-1).focus()`);await key('Tab');assert.equal(await js(`document.activeElement===${focusables}[0]`),true,'Tab wraps to the first control');
 await key('Tab',true);assert.equal(await js(`document.activeElement===${focusables}.at(-1)`),true,'Shift+Tab wraps to the last control');
 await js('document.querySelector("[data-qa-trigger]").focus()');await key('Tab');assert.equal(await js(`!!document.activeElement.closest('.agent-drawer')`),true,'focus outside is pulled back in');
 await js(`(()=>{const b=Array.from(document.querySelectorAll('.agent-drawer button[aria-pressed]')).find(el=>el.textContent.includes('Provedor de IA'));b?.click();return !!b})()`);await pause(100);
 const drawerMenu=await js(`(()=>{const t=Array.from(document.querySelectorAll('.agent-drawer .select-menu-trigger')).find(i=>i.getClientRects().length&&!i.disabled);if(!t)return false;t.click();return true})()`);
 if(drawerMenu){await until(()=>js('Boolean(document.querySelector(".agent-drawer .select-menu-popover"))'),'drawer menu');await key('Escape');await pause(100);assert.equal(await js('Boolean(document.querySelector(".select-menu-popover"))'),false);assert.equal(await js('Boolean(document.querySelector(".agent-drawer"))'),true,'drawer stays after the menu Escape');report.push('drawer menu Escape first');}else throw Error('No visible SelectMenu in the agent drawer provider section');
 await key('Escape');await until(()=>js('!document.querySelector(".agent-drawer")'),'drawer closed');await until(()=>js('document.activeElement?.hasAttribute("data-qa-trigger")'),'focus restored to the trigger');
 await openCreator();assert.equal(await js(`document.querySelector('.agent-drawer input[required]')?.value`),'RASCUNHO_ESPACO_1','draft kept after close/reopen');await key('Escape');await until(()=>js('!document.querySelector(".agent-drawer")'),'closed again');
 await js('window.mainsAgentsSaveNow?.()');await pause(400);
 const keys=Object.keys(store.read(profile,'agent-drafts')??{});assert.equal(keys.length,1);assert.deepEqual(JSON.parse(keys[0]),[profile,workspaceId,'new:'],'scoped by profile and workspace');
 // Another workspace (after restart, as the user would switch): empty creation, current workspace; back to the first: draft restored.
 store.write(profile,'current-workspace',otherSpace);await restart('Agente do Espaço 2');
 await openCreator();assert.equal(await js(`document.querySelector('.agent-drawer input[required]')?.value`),'','no draft from another workspace');
 await js(`(()=>{const el=document.querySelector('.agent-drawer input[required]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'RASCUNHO_ESPACO_2');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await key('Escape');await until(()=>js('!document.querySelector(".agent-drawer")'),'closed ws2');
 await js('window.mainsAgentsSaveNow?.()');await pause(400);store.write(profile,'current-workspace',workspaceId);await restart();
 await openCreator();assert.equal(await js(`document.querySelector('.agent-drawer input[required]')?.value`),'RASCUNHO_ESPACO_1','first workspace draft restored after restart');await key('Escape');
 assert.equal(Object.keys(store.read(profile,'agent-drafts')).length,2,'one creation slot per workspace');
 report.push('agent drafts per profile+workspace, Tab contained, focus restored');
 assert.deepEqual(errors,[]);
 console.log(`SESSION_RECOVERY_UI_OK:\n - ${report.join('\n - ')}\nScreenshots: ${out}`);
 win.destroy();await bridge.close();store.close();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);console.error('DEBUG',JSON.stringify({creates,resumes,inputs:chatInputs.map(i=>({thread:i.thread,len:i.content.length,head:i.content.slice(0,80)})),expired:(store.read(profile,'sessions')??[]).find(s=>s.id==='expired')?.messages?.map(m=>[m.type,m.status,(m.content??m.label??'').slice(0,120)])}));if(win&&!win.isDestroyed()){console.log((await js('document.body.innerText').catch(()=>'')).slice(0,3000));await shot('failure').catch(()=>{});win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
