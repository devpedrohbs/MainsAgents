// Content spaces in the real renderer (hidden Electron, isolated SQLite fixture, simulated Codex chat; no AI accounts, no network).
// Two contents in the same agent and the same editor, concurrent replies, scoped lists and targets, organize/family conflicts,
// recovery bucket, restart persistence per profile, new chats inheriting the selection, desktop light/dark and narrow captures.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/content-scopes-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',otherProfile='other-profile',workspaceId='space',at=new Date(Date.now()-3600_000).toISOString(),dbPath=join(out,'workspace-state.sqlite'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const writer={id:'writer',name:'Agente de Conteúdo',role:'Conteúdo',instructions:'Fixture',description:'Fixture',skills:['own-skill'],workspaceId,providerId:'codex',tools:['files','subagents'],status:'idle',createdAt:at,updatedAt:at},editor={...writer,id:'editor',name:'Editor de Vídeo',role:'Vídeo',skills:['edit-skill'],tools:['files']};
const seeded={id:'content-seeded',workspaceId,topicId:'topic-seeded',title:'Vídeo Antigo',format:'short-video',platforms:[],status:'planning',productionStage:'planning',taskId:'task-seeded',createdAt:at,updatedAt:at};
const older=new Date(Date.now()-7200_000).toISOString();
const message=(id,content,extra={})=>({id,type:'message',role:'user',content,createdAt:at,...extra});
const sessionsSeed=[
 // Legacy active chats are OLDER than siblings of the same scope: migration must restore exactly them, not the newest.
 {id:'legacy',agentId:'writer',providerId:'codex',title:'Conversa antiga',remoteSessionId:'thread-legacy',codexThreadId:'thread-legacy',messages:[message('old-1','LEGACY_HISTORY')],createdAt:older,updatedAt:older},
 {id:'editor-older',agentId:'editor',providerId:'codex',title:'Edição antiga escolhida',contentId:'content-seeded',topicId:'topic-seeded',remoteSessionId:'thread-editor-older',messages:[message('eo-1','OLDER_EDITOR_HISTORY')],createdAt:older,updatedAt:older},
 {id:'idea',agentId:'writer',providerId:'codex',title:'Ideia conectada',agentConnection:{enabled:true,targetAgentId:'editor',targetSessionId:'editor-generic'},messages:[message('idea-1','IDEA_HISTORY')],createdAt:at,updatedAt:at},
 {id:'editor-generic',agentId:'editor',providerId:'codex',title:'Edição solta',messages:[message('eg-1','EDITOR_GENERIC_HISTORY')],createdAt:at,updatedAt:at},
 {id:'mixed',agentId:'writer',providerId:'codex',title:'Chat com arquivo do Vídeo Antigo',messages:[message('mx-1','MIXED',{role:'agent',deliveryState:'completed',receipts:[{id:'r1',contentId:'content-seeded',workspaceId,name:'antigo.mp4',path:'C:/fixture/antigo.mp4',size:1,sha256:'x',fileKind:'video',version:1,createdAt:at,source:{kind:'media-export',id:'job'}}]})],createdAt:at,updatedAt:at},
 {id:'broken',agentId:'writer',providerId:'codex',title:'Vínculo quebrado',contentId:'content-deleted',topicId:'topic-deleted',messages:[message('br-1','BROKEN_HISTORY')],createdAt:at,updatedAt:at},
 {id:'seeded-chat',agentId:'writer',providerId:'codex',title:'Chat do Vídeo Antigo',contentId:'content-seeded',topicId:'topic-seeded',contentTitle:'Vídeo Antigo',agentConnection:{enabled:true,targetAgentId:'editor',targetSessionId:'editor-generic'},messages:[message('sd-1','SEEDED_HISTORY')],createdAt:at,updatedAt:at},
 // Imported editor chat of the old content, shown WITHOUT any saved pointer (B2).
 {id:'editor-imported',agentId:'editor',providerId:'codex',title:'Edição importada',contentId:'content-seeded',topicId:'topic-seeded',messages:[message('ei-1','IMPORTED_HISTORY')],createdAt:at,updatedAt:at},
 // Chat of an archived content (I3): must stay reachable on its own thread.
 {id:'archived-chat',agentId:'writer',providerId:'codex',title:'Chat arquivado',contentId:'content-archived',topicId:'topic-archived',remoteSessionId:'thread-archived',codexThreadId:'thread-archived',messages:[message('ar-1','ARCHIVED_HISTORY')],createdAt:at,updatedAt:at},
];
const archivedContent={...seeded,id:'content-archived',topicId:'topic-archived',title:'Vídeo Arquivado',productionStage:'archived',taskId:'task-archived'};
const legacyDraftKey=JSON.stringify(['editor',null]),legacyDraft={text:'RASCUNHO_GERAL_ANTIGO',skill:null,context:[]};
const store=createDesktopStateStore(out,'test');
store.initialize(profile,{agents:[writer,editor],workspaces:[{id:workspaceId,name:'Conteúdos',createdAt:at,updatedAt:at}],sessions:sessionsSeed,'chat-drafts':{[legacyDraftKey]:legacyDraft},'current-workspace':workspaceId,'active-sessions':{writer:'legacy',editor:'editor-older'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
store.initialize(otherProfile,{agents:[],workspaces:[],sessions:[],language:'pt-BR'});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
const runtime={createSession:async()=>'cli',resumeSession:async()=>{},readThread:async()=>({turns:[]}),cancel:async()=>{},send:async()=>{throw Error('No CLI run in this scenario')},events:async function*(){}};
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{throw Error('No Notion in this scenario')},readCard:async()=>{throw Error('No Notion in this scenario')}})});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[{id:'topic-seeded',workspaceId,requestId:'r',inputKind:'text',input:'x',title:'Vídeo Antigo',category:'Vídeo',summary:'s',whyItMatters:'w',angles:[],sources:[],factualQuestions:[],priority:'normal',status:'review',contentId:'content-seeded',createdAt:at,updatedAt:at},{id:'topic-archived',workspaceId,requestId:'r2',inputKind:'text',input:'x',title:'Vídeo Arquivado',category:'Vídeo',summary:'s',whyItMatters:'w',angles:[],sources:[],factualQuestions:[],priority:'normal',status:'review',contentId:'content-archived',createdAt:at,updatedAt:at}],contents:[seeded,archivedContent],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();
let win;registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
// Simulated Codex chat: one thread per local session; a question mentioning "Alfa" answers late (concurrent update).
const chatRuns=new Map(),chatInputs=[];let serial=0,delayStateMs=0,nativeSnapshot=null;
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){let input={};if(request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;input=JSON.parse(text||'{}');}
  if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path==='/api/codex/sessions')return json(response,{threadId:input.threadId??`chat-thread-${++serial}`});
  if(path==='/api/codex/executions'){const executionId=`chat-turn-${++serial}`,run={events:[],streams:new Set(),done:false};chatRuns.set(executionId,run);chatInputs.push(input);run.events.push({type:'execution.started',executionId,threadId:input.remoteSessionId});const late=/Alfa/.test(input.content);setTimeout(()=>{emit(run,{type:'message.completed',executionId,content:late?'RESPOSTA_TARDIA_ALFA':'RESPOSTA_BETA'});emit(run,{type:'execution.completed',executionId});},late?2200:200);return json(response,{executionId});}
  const stream=path.match(/\/executions\/([^/]+)\/events$/);if(stream){const run=chatRuns.get(stream[1]);response.setHeader('content-type','application/x-ndjson');for(const event of run.events)response.write(JSON.stringify(event)+'\n');if(run.done)response.end();else{run.streams.add(response);request.on('close',()=>run.streams.delete(response));}return;}
  return json(response,{});}
 // Native specialist queue (simulated): its snapshot imports sessions into the renderer like the real runtime does.
 if(path==='/api/content/delegations'&&request.method==='GET'&&nativeSnapshot)return json(response,nativeSnapshot);
 // Slow saved-contents load (hydration): the saved scope must be kept and scope actions wait.
 if(path==='/api/content/state'&&request.method==='GET'&&delayStateMs)await new Promise(resolve=>setTimeout(resolve,delayStateMs));
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code),log=[];
async function until(check,label='condition'){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Content scopes UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
const findButton=text=>`Array.from(document.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`;
async function button(text){await until(()=>js(`Boolean(${findButton(text)})`),text);await js(`${findButton(text)}.click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function shot(name,{dark=false}={}){await js(`document.documentElement.dataset.appearance=${JSON.stringify(dark?'dark':'light')}`);writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));log.push(`${name}.png`);}
const sessions=()=>store.read(profile,'sessions'),byTitle=title=>sessions().find(s=>s.title===title),scopes=()=>store.read(profile,'content-scopes');
const save=()=>js('window.mainsAgentsSaveNow?.()');
const scopeLabel=()=>js(`document.querySelector('.content-scope-picker .select-menu-value')?.textContent??''`);
const activeBar=()=>js(`document.querySelector('.active-session-bar span')?.textContent??''`);
const chatText=()=>js(`document.querySelector('.chat-body')?.innerText??''`);
const option=text=>`Array.from(document.querySelectorAll('[role=listbox] .select-menu-option')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)})`;
async function chooseOption(text){await until(()=>js(`Boolean(${option(text)})`),`option ${text}`);await js(`${option(text)}.click()`);}
async function pickScope(title){await click('.content-scope-picker .select-menu-trigger');await chooseOption(title);await until(async()=>(await scopeLabel())===title,`scope ${title}`);}
async function openPanelSessions(){await js(`document.querySelector('button[title="Sessões deste agente"]').click()`);await until(()=>js('Boolean(document.querySelector(".panel-sessions"))'),'sessions tab');}
const panelTitles=()=>js(`Array.from(document.querySelectorAll('.panel-session-main b')).map(el=>el.textContent)`);
async function openPanelSession(title){await openPanelSessions();await js(`Array.from(document.querySelectorAll('.panel-session-main')).find(el=>el.querySelector('b')?.textContent===${JSON.stringify(title)}).click()`);await until(async()=>(await activeBar())===title,`open ${title}`);}
async function selectAgent(name){await js(`Array.from(document.querySelectorAll('.content-scope-agents button')).find(el=>el.querySelector('span')?.textContent===${JSON.stringify(name)}).click()`);await until(()=>js(`document.querySelector('.content-scope-agents button[aria-pressed=true] span')?.textContent===${JSON.stringify(name)}`),`agent ${name}`);}
async function newContent(title){await click('.content-scope-new');await inputText('[aria-label="Nome do novo conteúdo"]',title);await button('Criar conteúdo');await until(async()=>(await scopeLabel())===title,`content ${title}`);}
async function send(text){await inputText('.composer textarea',text);await click('.send-button');}
async function open({width=1440,height=1000}={}){win=new BrowserWindow({show:false,width,height,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="Agente de Conteúdo"]'))`),'app ready');await js(`document.querySelector('.agent-nav[title="Agente de Conteúdo"]').click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea")&&document.querySelector(".content-scope-bar"))'),'chat open');}
async function restart(options){await save();win.destroy();win=null;await open(options);}

app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 // 1. Legacy users land where they were: General, the old chat, nothing regrouped by title.
 assert.equal(await scopeLabel(),'Geral');assert.equal(await activeBar(),'Conversa antiga');
 await openPanelSessions();assert.deepEqual((await panelTitles()).sort(),['Chat com arquivo do Vídeo Antigo','Conversa antiga','Ideia conectada'].sort(),'General lists only unlinked writer chats');
 await js(`document.querySelector('.chat-tabs button')?.click()`);
 // 1a. The first shown chat initializes the workspace selection (absent before); switching to the editor keeps General and shows
 // its General chat, never its legacy chat of Vídeo Antigo.
 await until(()=>store.read(profile,'content-scopes')?.selected?.[workspaceId]==='general','selection initialized from the shown chat');
 await click('.conversation-agent-picker .select-menu-trigger');await chooseOption('Editor de Vídeo');
 await until(async()=>(await activeBar())==='Edição solta','editor stays in General');assert.equal(await scopeLabel(),'Geral');
 await click('.conversation-agent-picker .select-menu-trigger');await chooseOption('Agente de Conteúdo');await until(async()=>(await activeBar())==='Conversa antiga','back to writer');
 // 1b. Legacy migration: the editor's saved active chat is the OLDER of two chats of Vídeo Antigo; it comes back exactly and is pinned.
 await pickScope('Vídeo Antigo');await until(async()=>(await activeBar())==='Chat do Vídeo Antigo','writer has no legacy chat here: newest of the scope');
 await selectAgent('Editor de Vídeo');await until(async()=>(await activeBar())==='Edição antiga escolhida','older legacy editor chat restored');
 await until(()=>Object.values(store.read(profile,'content-scopes')?.active??{}).includes('editor-older'),'restored legacy chat pinned');
 assert.equal(sessions().find(s=>s.id==='editor-older').remoteSessionId,'thread-editor-older','thread untouched');
 await selectAgent('Agente de Conteúdo');await pickScope('Geral');await until(async()=>(await activeBar())==='Conversa antiga','General legacy restored exactly');
 // 2. Two new contents by name only (no approved idea), each with a fresh chat; concurrent replies never cross.
 await newContent('Vídeo Alfa');assert.equal(await js('document.querySelector(".composer textarea").value'),'');
 const alfa=()=>sessions().find(s=>s.title==='Vídeo Alfa'&&s.agentId==='writer');await until(()=>alfa(),'alfa saved');
 await send('pergunta sobre o Alfa');
 await newContent('Vídeo Beta');assert.equal(await js('document.querySelector(".composer textarea").value'),'','no draft inherited');
 await send('pergunta sobre o Beta');
 await until(async()=>JSON.stringify(sessions().find(s=>JSON.stringify(s.messages).includes('pergunta sobre o Beta'))?.messages??[]).includes('RESPOSTA_BETA'),'beta reply');
 await until(()=>JSON.stringify(sessions()).includes('RESPOSTA_TARDIA_ALFA'),'late alfa reply');
 const alfaChat=sessions().find(s=>JSON.stringify(s.messages).includes('pergunta sobre o Alfa')),betaChat=sessions().find(s=>JSON.stringify(s.messages).includes('pergunta sobre o Beta'));
 assert(alfaChat.contentId&&betaChat.contentId&&alfaChat.contentId!==betaChat.contentId,'distinct content ids');
 assert(!JSON.stringify(betaChat.messages).includes('ALFA'),'Alfa reply never written into Beta');
 assert.equal(await scopeLabel(),'Vídeo Beta','late background reply does not steal the selection');
 assert(!(await chatText()).includes('RESPOSTA_TARDIA_ALFA'),'Beta view never shows Alfa');
 const alfaThread=chatInputs.find(i=>i.content.includes('Alfa')).threadId,betaThread=chatInputs.find(i=>i.content.includes('Beta')).threadId;assert(alfaThread&&betaThread);assert.notEqual(alfaThread,betaThread,'own provider thread per content chat');
 assert(chatInputs.find(i=>i.content.includes('Beta')).content.includes(betaChat.contentId)&&!chatInputs.find(i=>i.content.includes('Beta')).content.includes(alfaChat.contentId),'turn snapshot carries only its own content');
 await shot('01-beta-writer-desktop-light');await shot('02-beta-writer-desktop-dark',{dark:true});
 // 3. Switching agent keeps the content: no Beta chat for the editor → empty state, never its unrelated last chat.
 await selectAgent('Editor de Vídeo');
 await until(()=>js(`document.querySelector('.scope-empty')?.textContent.includes('Editor de Vídeo ainda não conversou sobre “Vídeo Beta”')`),'editor empty state');
 assert(!(await chatText()).includes('EDITOR_GENERIC_HISTORY'),'editor General chat not shown in Beta');
 await shot('03-editor-empty-in-beta-light');
 assert(await js(`Boolean(${findButton('Começar conversa sobre “Vídeo Beta”')})`),'start action offered');
 // B1: unsent text without a chat belongs to THIS content: Beta's text never shows in Alfa and survives switching back.
 const composer=()=>js('document.querySelector(".composer textarea").value');
 await inputText('.composer textarea','editor no Beta');
 await pickScope('Vídeo Alfa');await until(()=>js(`Boolean(document.querySelector('.scope-empty'))`),'editor empty in alfa');
 await until(async()=>(await composer())==='','Alfa composer starts empty');
 await inputText('.composer textarea','corte ALFA');
 await pickScope('Vídeo Beta');await until(async()=>(await composer())==='editor no Beta','Beta draft restored');
 await click('.send-button');await until(()=>sessions().some(s=>s.agentId==='editor'&&s.contentId===betaChat.contentId&&JSON.stringify(s.messages).includes('RESPOSTA_BETA')),'editor beta reply');
 const editorBeta=sessions().find(s=>s.agentId==='editor'&&s.contentId===betaChat.contentId);assert(JSON.stringify(editorBeta.messages).includes('editor no Beta'));assert(!JSON.stringify(editorBeta.messages).includes('corte ALFA'),'Alfa text never sent in Beta');
 // Same agent, other content: still empty (the Beta editor chat never appears in Alfa) and Alfa's text is still there.
 await pickScope('Vídeo Alfa');await until(()=>js(`Boolean(document.querySelector('.scope-empty'))`),'editor empty in alfa again');
 await until(async()=>(await composer())==='corte ALFA','Alfa draft kept after sending in Beta');
 await selectAgent('Agente de Conteúdo');await until(async()=>(await activeBar())==='Vídeo Alfa','writer alfa chat');
 assert((await chatText()).includes('RESPOSTA_TARDIA_ALFA'),'Alfa chat shows its own late reply');
 // 4. Opening an existing chat synchronizes the scope; a stale cross-content connection target is never shown as current.
 await pickScope('Vídeo Antigo');await until(async()=>(await activeBar())==='Chat do Vídeo Antigo','seeded chat');
 await until(()=>js(`document.querySelector('.agent-connection-bar p')?.textContent.includes('era de outro conteúdo')`),'stale target explained');
 assert(!(await js(`document.querySelector('.agent-connection-bar p').textContent`)).includes('Edição solta'));
 // B2: the imported editor chat shown without a saved pointer stays shown when the native queue imports newer siblings.
 await selectAgent('Editor de Vídeo');await until(async()=>(await activeBar())==='Edição antiga escolhida','pinned legacy editor chat shown');
 const stamp=new Date().toISOString(),native=(id,title,contentId,topicId)=>({id,agentId:'editor',providerId:'codex',title,contentId,topicId,messages:[],createdAt:stamp,updatedAt:stamp});
 nativeSnapshot={sessions:[native('native-old','Resultado nativo','content-seeded','topic-seeded'),native('native-beta','Resultado nativo B',betaChat.contentId,betaChat.topicId)],handoffs:[],jobs:[]};
 await until(()=>['native-old','native-beta'].every(id=>sessions().some(s=>s.id===id)),'native sessions imported');
 await new Promise(resolve=>setTimeout(resolve,1200));
 assert.equal(await activeBar(),'Edição antiga escolhida','newer same-scope siblings (imported, native) never take over');
 await pickScope('Vídeo Beta');await until(async()=>(await activeBar())==='editor no Beta','Beta keeps its shown editor chat');
 await pickScope('Vídeo Antigo');await selectAgent('Agente de Conteúdo');await until(async()=>(await activeBar())==='Chat do Vídeo Antigo','back to writer');
 // 5. Recovery bucket keeps invalid links visible.
 await pickScope('Precisa de atenção');await until(async()=>(await activeBar())==='Vínculo quebrado','recovery chat');
 assert((await chatText()).includes('Vínculo de conteúdo inválido'));await shot('04-recovery-light');
 // I3: archived content holding chats is listed ("Arquivado") and opens its chat on the SAME thread.
 await pickScope('Vídeo Arquivado');await until(async()=>(await activeBar())==='Chat arquivado','archived chat');
 assert.equal(await js(`document.querySelector('.content-scope-stage')?.textContent`),'Arquivado');
 assert.equal(sessions().find(s=>s.id==='archived-chat').remoteSessionId,'thread-archived','no forced new thread');
 // 6. Organize: a connected General family moves explicitly; a chat with another content's file is refused with a fresh-chat option.
 await pickScope('Geral');await openPanelSession('Ideia conectada');
 await button('Organizar em conteúdo');await until(()=>js('Boolean(document.querySelector(".organize-chat-form"))'),'organize dialog');
 await click('.organize-chat-form .select-menu-trigger');await chooseOption('Vídeo Alfa');
 await js(`document.querySelector('.organize-family input').click()`);await until(()=>js(`document.querySelectorAll('.organize-members li').length===2`),'family listed');
 // I2: a historical link from another content's chat is reported, never moved nor treated as this family.
 assert(await js(`document.querySelector('.organize-note')?.textContent.includes('Chat do Vídeo Antigo')`),'cross-scope link explained');
 await shot('05-organize-family-light');
 await js(`document.querySelector('.organize-chat-form footer .primary-button').click()`);
 await until(()=>byTitle('Ideia conectada')?.contentId===alfaChat.contentId&&byTitle('Edição solta')?.contentId===alfaChat.contentId,'family organized');
 await until(async()=>(await scopeLabel())==='Vídeo Alfa'&&(await activeBar())==='Ideia conectada','organized chat stays on screen');
 assert.equal(byTitle('Ideia conectada').messages[0].content,'IDEA_HISTORY','history kept');
 await until(()=>js(`document.querySelector('.agent-connection-bar p')?.textContent.includes('Continua em: Edição solta')`),'family target valid again');
 await pickScope('Geral');await openPanelSession('Chat com arquivo do Vídeo Antigo');await button('Organizar em conteúdo');await click('.organize-chat-form .select-menu-trigger');await chooseOption('Vídeo Alfa');
 await until(()=>js(`document.querySelector('.organize-chat-form .organize-problem')?.textContent.includes('arquivos ou entregas de outro conteúdo')`),'conflict shown');
 assert.equal(await js(`document.querySelector('.organize-chat-form footer .primary-button').disabled`),true,'move refused');await shot('06-organize-conflict-dark',{dark:true});
 await button('Começar conversa nova aqui');await until(async()=>(await scopeLabel())==='Vídeo Alfa','fresh chat in content');
 assert.equal(byTitle('Chat com arquivo do Vídeo Antigo').contentId,undefined,'old chat stays General');
 // 7. Sessions page: content boxes and a list of ONLY the selected content.
 await js('location.hash="sessions"');await until(()=>js('Boolean(document.querySelector(".content-space-grid"))'),'sessions page');
 const boxes=await js(`Array.from(document.querySelectorAll('.content-space-box b')).map(el=>el.textContent)`);
 for(const title of ['Geral','Vídeo Alfa','Vídeo Beta','Vídeo Antigo','Precisa de atenção'])assert(boxes.includes(title),`box ${title}`);
 await js(`Array.from(document.querySelectorAll('.content-space-box')).find(el=>el.querySelector('b').textContent==='Vídeo Beta').click()`);
 await until(()=>js(`document.querySelector('.result-count')?.textContent.includes('Vídeo Beta')`),'beta list');
 const rows=await js(`Array.from(document.querySelectorAll('.conversation-row .conversation-open b')).map(el=>el.textContent)`);
 assert.deepEqual(rows.sort(),['editor no Beta','Resultado nativo B','Vídeo Beta'].sort(),'only Beta chats of both agents');
 assert(boxes.includes('Vídeo Arquivado'),'archived content with chats has a box');
 await shot('07-sessions-beta-light');await shot('08-sessions-beta-dark',{dark:true});
 // Explicit "open content" (Studio card/event) selects that content in the chat, with its own shown chat or empty state.
 const alfaId=alfaChat.contentId;await js(`window.dispatchEvent(new CustomEvent('mainsagents:open-content',{detail:{contentId:${JSON.stringify(alfaId)}}}))`);
 await until(async()=>(await scopeLabel())==='Vídeo Alfa','explicit open selects Alfa');
 await until(async()=>{const bar=await activeBar();return !!bar&&sessions().some(s=>s.contentId===alfaId&&s.agentId==='writer'&&s.title===bar);},'Alfa shows one of its own chats');
 await pickScope('Vídeo Beta');
 // 8. Restart: selection and active chat per agent+content come back; another profile has no scopes.
 // Hydration: while saved contents load slowly, the saved scope is kept (never Recovery or a General chat) and sending waits.
 delayStateMs=3000;const sessionCount=sessions().length;await save();win.destroy();win=null;await open();
 assert.equal(await scopeLabel(),'Carregando conteúdo…','saved scope kept while loading');
 await inputText('.composer textarea','enviar cedo');assert.equal(await js(`document.querySelector('.send-button').disabled`),true,'send waits for the real scope');
 await until(async()=>(await scopeLabel())==='Vídeo Beta','restored scope');assert.equal(await activeBar(),'Vídeo Beta');delayStateMs=0;
 assert.equal(sessions().length,sessionCount,'no chat created during hydration');await shot('12-restored-after-slow-load-light');await inputText('.composer textarea','');
 await selectAgent('Editor de Vídeo');await until(async()=>(await activeBar())==='editor no Beta','editor pointer restored');
 const saved=scopes();assert.equal(saved.selected[workspaceId],`content:${betaChat.contentId}`);assert.equal(store.read(otherProfile,'content-scopes'),undefined,'scopes are per profile');
 // 9. Invalid selected link after restart falls back to the recoverable bucket; the "+" new chat inherits the selected content.
 await selectAgent('Agente de Conteúdo');await save();win.destroy();win=null;
 store.write(profile,'content-scopes',{...saved,selected:{[workspaceId]:'content:content-deleted'}});
 await open();await until(async()=>(await scopeLabel())==='Precisa de atenção','invalid selection falls back to recovery');
 await pickScope('Vídeo Alfa');const before=sessions().filter(s=>s.contentId===alfaChat.contentId&&s.agentId==='writer').length;
 await click('button[aria-label="Nova sessão"]');await until(()=>sessions().filter(s=>s.contentId===alfaChat.contentId&&s.agentId==='writer').length===before+1,'new chat inherits Alfa');
 // Provider choice from a content chat: a fresh chat with the SAME saved content link and its own (new) thread.
 await pickScope('Vídeo Alfa');await openPanelSession('Vídeo Alfa');await js(`document.querySelector('.chat-tabs button')?.click()`);
 const alfaBefore=sessions().filter(s=>s.contentId===alfaChat.contentId).length;
 await click('[data-od-id="generate-with"]');await click('[data-od-id="provider-choice-codex"]');await click('[data-od-id="provider-choice-open-single"]');
 await until(()=>sessions().filter(s=>s.contentId===alfaChat.contentId).length===alfaBefore+1,'provider chat inherits Alfa');
 const fresh=sessions().filter(s=>s.contentId===alfaChat.contentId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 assert.equal(fresh.topicId,alfaChat.topicId);assert.equal(fresh.remoteSessionId,undefined,'own fresh thread');
 // Long content name: the title keeps the row, the stage sits below.
 await newContent('Tutorial completo de automação no Excel com Power Query');await shot('11-long-name-desktop-light');
 // 10. Narrow layout.
 await restart({width:760,height:900});await shot('09-narrow-light');await shot('10-narrow-dark',{dark:true});
 assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'),true,'no horizontal page scroll at narrow width');
 assert.equal(sessions().find(s=>s.id==='legacy').messages[0].content,'LEGACY_HISTORY','legacy history intact');
 assert.equal(store.read(profile,'agents').length,2,'no agent created per content');
 assert.deepEqual(store.read(profile,'chat-drafts')[legacyDraftKey],legacyDraft,'old General draft unchanged');
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'report.json'),JSON.stringify({ok:true,screenshots:log,chatTurns:chatInputs.length},null,1));
 console.log(`CONTENT_SCOPES_UI_OK ${out}`);win.destroy();server.close();app.exit(0);
}catch(error){console.error(error);if(win&&!win.isDestroyed()){console.log((await js('document.body.innerText').catch(()=>'')).slice(0,3000));writeFileSync(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();}server.close();app.exit(1);}});
