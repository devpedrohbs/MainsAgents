// Chat provider vs edit director: actual ChatProvider/ProductionProvider and renderer; providers and production commands are
// local stubs (no real API, no personal data). Every production command the UI sends is recorded and asserted.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),dist=resolve(process.env.MAINSAGENTS_TEST_DIST??join(root,'dist')),out=process.env.MAINSAGENTS_TEST_OUT??resolve(root,'.mainsagents-workspaces/provider-editor-choice-ui',String(Date.now()));
mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'electron'));app.on('window-all-closed',()=>{});
const at=new Date().toISOString(),workspaceId='choice-fixture',profile='handoff-test';
const agent={id:'cx',name:'Editor Codex',role:'Vídeo',description:'Local fixture',tools:[],status:'idle',providerId:'codex',modelId:'cx-model',instructions:'EDITOR_OWN_INSTRUCTIONS',skills:['edit-skill'],workspaceId,createdAt:at,updatedAt:at};
const chatSession=(id,extra={})=>({id,agentId:'cx',providerId:'codex',modelId:'cx-model',title:id,messages:[],createdAt:at,updatedAt:at,...extra});
const prodChat=chatSession('prod-chat',{remoteSessionId:'codex-thread-prod',codexThreadId:'codex-thread-prod',messages:[{id:'h1',type:'message',role:'agent',content:'PRODUCTION_CHAT_HISTORY',deliveryState:'completed',createdAt:at}]});
const emptyChat=chatSession('empty-chat');
const topic={id:'t1',workspaceId,requestId:'r1',inputKind:'text',input:'x',priority:'medium',status:'approved',title:'Vídeo fixture',summary:'Resumo',createdAt:at,updatedAt:at};
const videoPath=join(out,'gravacao.mp4');writeFileSync(videoPath,'fixture');
const video={id:'v1',workspaceId,contentId:'c1',name:'gravacao.mp4',kind:'video',role:'source',currentVersionId:'vv1',versions:[{id:'vv1',path:videoPath,name:'gravacao.mp4',size:7,sha256:'a'.repeat(64),modifiedAt:at,createdAt:at}],status:'available',createdAt:at,updatedAt:at};
const baseRun={revision:1,workspaceId,contentId:'c1',topicId:'t1',flowId:'f1',name:'Produção fixture',sourceAgent:{id:'cx',name:'Editor Codex',providerId:'codex',modelId:'cx-model'},editorAgent:{id:'cx',name:'Editor Codex',providerId:'codex',modelId:'cx-model'},sourceSession:prodChat,editorSession:chatSession('prod-editor'),topic,timeZone:'America/Sao_Paulo',events:[],updatedAt:at};
// Blocked during the edit, directed by Claude while the chat is Codex (the real case reported by the user).
const blocked={...baseRun,id:'run-blocked',stage:'blocked',resumeStage:'editing',error:'Edição parou: limite de turnos do diretor.',editPreferences:{format:'original',mode:'smart',motion:'balanced'},editDirector:{name:'Editor Codex',provider:'claude',model:'cl-model',choice:'claude'},authoring:{executions:[{index:1,kind:'initial',continuation:0,legacy:true,providerId:'claude',requestedModel:'cl-model',model:null,outcome:'turn_limit',code:'editor_turn_limit',numTurns:20,maxTurns:20,callsAfter:9,revisionAfter:2,at}]}};
const script={version:1,hash:'b'.repeat(64),source:'agent',hook:'Hook',cta:'CTA',path:{title:'P',outline:'O'},text:'Texto do roteiro aprovado para gravar.',createdAt:at};
const recording={...baseRun,id:'run-recording',contentId:'c2',sourceSession:chatSession('rec-chat',{messages:[{id:'r1',type:'message',role:'agent',content:'RECORDING_CHAT_HISTORY',deliveryState:'completed',createdAt:at}]}),editorSession:chatSession('rec-editor'),stage:'recording',scriptMode:'local',scriptVersions:[script],scriptApproval:{version:1,hash:script.hash},recordingReady:true};
const limitChat=chatSession('limit-chat',{remoteSessionId:'codex-thread-limit',codexThreadId:'codex-thread-limit',messages:[{id:'l1',type:'message',role:'agent',content:'LIMIT_CHAT_HISTORY',deliveryState:'completed',createdAt:at}]});
const limit={...baseRun,id:'run-limit',contentId:'c3',sourceSession:limitChat,editorSession:chatSession('limit-editor'),stage:'blocked',resumeStage:'editing',error:'O editor (Claude Code) parou em 20 turno(s) com limite 20.',editPreferences:{format:'original',mode:'smart',motion:'balanced'},editDirector:{name:'Editor Codex',provider:'claude',model:'cl-model',choice:'claude'},
 authoring:{continuations:1,executions:[{index:1,kind:'initial',continuation:0,providerId:'claude',requestedModel:'cl-model',model:'claude-reported-model',outcome:'turn_limit',code:'editor_turn_limit',numTurns:20,maxTurns:20,callsBefore:0,callsAfter:11,revisionBefore:0,revisionAfter:3,at},{index:2,kind:'continuation',continuation:1,providerId:'claude',requestedModel:'cl-model',model:'claude-reported-model',outcome:'turn_limit',code:'editor_turn_limit',numTurns:20,maxTurns:20,callsBefore:11,callsAfter:14,revisionBefore:3,revisionAfter:3,at}],
  lastStop:{code:'editor_turn_limit',numTurns:20,maxTurns:20,callsAtStart:11,calls:14,callsLeft:6,revision:3,finalized:false,reason:'no_progress',continuable:true,continuationsUsed:1,maxContinuations:3,at}}};
let runs=[blocked],workspaceDirector={providerId:'claude',source:'default'};const commands=[],directorWrites=[];
const state={agents:[agent],workspaces:[{id:workspaceId,name:'Choice fixture',createdAt:at,updatedAt:at}],sessions:[emptyChat,prodChat],'active-sessions':{cx:'empty-chat'},'current-workspace':workspaceId,language:'pt-BR','focus-mode':false,'welcome-dismissed':true,
 'chat-drafts':{'["cx","empty-chat"]':{text:'EMPTY_CHAT_DRAFT',skill:null},'["cx","prod-chat"]':{text:'PROD_CHAT_DRAFT',skill:null}}};
ipcMain.handle('test:read',(_e,key)=>state[key]);ipcMain.handle('test:write',(_e,key,value)=>state[key]=value);ipcMain.handle('test:all',()=>state);
const dbPath=join(out,'state.sqlite'),bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>state.agents,getSessions:()=>state.sessions});
const content=(id,title)=>({id,workspaceId,topicId:'t1',title,format:'video',platforms:['Instagram'],status:'draft',taskId:'task',createdAt:at,updatedAt:at});
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT OR REPLACE INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[topic],contents:[content('c1','Vídeo fixture'),content('c2','Vídeo gravando')],artifacts:[],approvals:[],runs:[],assets:[video,{...video,id:'v2',contentId:'c2'}],publications:[]}),at);seed.close();
const creates=[],sends=[],streams=new Map();let serial=0,win,claudeReady=true;
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
async function body(req){let data='';for await(const chunk of req)data+=chunk;return data?JSON.parse(data):{}}
const directorView=(run,director)=>director.providerId==='agent'?{name:run.editorAgent.name,provider:run.editorAgent.providerId,model:run.editorAgent.modelId,choice:'agent'}:{name:run.editorAgent.name,provider:director.providerId,model:director.modelId??(director.providerId===run.editorAgent.providerId?run.editorAgent.modelId:undefined),choice:director.providerId};
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),path=url.pathname,provider=path.startsWith('/api/codex')?'codex':path.startsWith('/api/providers/claude')?'claude':null;
 if(provider){const local=path.replace(provider==='codex'?'/api/codex':'/api/providers/claude','');
  if(local==='/health'||local==='/status')return json(res,{providerId:provider,ready:provider==='codex'||claudeReady,status:provider==='claude'&&!claudeReady?'error':'connected',state:provider==='claude'&&!claudeReady?'error':'connected',authMode:'cli',accountType:'chatgpt'});
  if(local==='/models')return json(res,{models:provider==='codex'?[{id:'cx-model',name:'Codex fixture model'},{id:'cx-model-2',name:'Codex fixture model 2'}]:[{id:'cl-model',name:'Claude fixture model'}]});
  if(local.endsWith('/images'))return json(res,{events:[]});
  if(local==='/sessions'||local.endsWith('/resume')){const input=await body(req),config=input.config??input;const remote=input.threadId??(local.endsWith('/resume')?local.split('/')[2]:`${provider}-remote-${++serial}`);if(!input.threadId&&!local.endsWith('/resume'))creates.push({provider,config,remote});return json(res,provider==='codex'?{threadId:remote}:{remoteSessionId:remote})}
  if(local==='/executions'){const input=await body(req),id=`${provider}-execution-${++serial}`;sends.push({provider,input,id});return json(res,provider==='codex'?{executionId:id,threadId:input.threadId}:{executionId:id,remoteSessionId:input.remoteSessionId})}
  if(local.endsWith('/events')){const id=local.split('/')[2];res.setHeader('content-type','application/x-ndjson');streams.set(id,res);res.write(JSON.stringify({type:'execution.started',executionId:id})+'\n');return}
  return json(res,{});
 }
 // Production stub: list, workspace default and per-run commands (recorded; never executes anything).
 if(path==='/api/content/productions/edit-director'){if(req.method==='POST'){const input=await body(req);directorWrites.push(input);workspaceDirector={...input.director,source:'user'};}return json(res,{director:workspaceDirector});}
 if(path==='/api/content/productions'&&req.method!=='POST')return json(res,{productions:runs});
 const command=path.match(/^\/api\/content\/productions\/([^/]+)$/);
 if(command&&req.method==='POST'){const input=await body(req),run=runs.find(item=>item.id===decodeURIComponent(command[1]));commands.push({run:run?.id,...input});if(!run)return json(res,{error:'missing'},404);
  let next={...run,revision:run.revision+1};
  if(input.action==='set-edit-director'){const view=directorView(run,input.director);if(JSON.stringify(view)===JSON.stringify(run.editDirector))return json(res,{production:run});next={...next,editDirector:view,...(['blocked','paused'].includes(run.stage)?{authoring:{...run.authoring,restartPending:{at:new Date().toISOString(),reason:'director-changed'}}}:{stage:'planning-edit'})};}
  if(input.action==='resume')next={...next,stage:'planning-edit',resumeStage:undefined,error:undefined,authoring:run.authoring&&{...run.authoring,restartPending:undefined}};
  if(input.action==='video')next={...next,stage:'planning-edit',editPreferences:{format:input.format,mode:input.editMode,motion:input.motion},editDirector:directorView(run,input.director??workspaceDirector)};
  runs=runs.map(item=>item.id===run.id?next:item);return json(res,{production:next});}
 if(await bridge.handle(req,res,url))return;
 if(path.startsWith('/api/'))return json(res,{ready:false,state:'not-installed',sessions:[],jobs:[],actions:[],models:[]});
 const file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
 }catch(error){json(res,{error:error.message},500)}});
const errors=[],js=async code=>{try{return await win.webContents.executeJavaScript(code)}catch(error){console.error('FAILED_RENDERER_CODE',code);throw error}};
async function until(check,label='condition'){const deadline=Date.now()+15000;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,30))}throw Error(`Provider/editor choice timed out: ${label}`)}
const q=selector=>`document.querySelector(${JSON.stringify(selector)})`;
async function click(selector){await until(()=>js(`Boolean(${q(selector)}&&!${q(selector)}.disabled)`),selector);await js(`${q(selector)}.click()`)}
async function option(text){const find=`Array.from(document.querySelectorAll('.select-menu-popover button')).find(b=>(b.querySelector('.select-menu-option-copy b')?.textContent??b.textContent).trim()===${JSON.stringify(text)}&&!b.disabled)`;await until(()=>js(`Boolean(${find})`),`option ${text}`);await js(`${find}.click()`)}
const textOf=selector=>js(`${q(selector)}?.textContent??''`);
async function shot(name){writeFileSync(join(out,name+'.png'),await captureReadyPng(win.webContents))}
async function open(width=1440){win=new BrowserWindow({show:false,width,height:1000,webPreferences:{preload:join(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);if(['http:','https:'].includes(url.protocol)&&url.hostname!=='127.0.0.1'){blockedRequests.push(details.url);callback({cancel:true})}else callback({})});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="Editor Codex"]'))`),'agent nav');await js(`document.querySelector('.agent-nav[title="Editor Codex"]').click()`);await until(()=>js('Boolean(document.querySelector(".chat-compose textarea"))'),'composer')}
async function reopen(active,width){await js('window.mainsAgentsSaveNow()');win.destroy();delete state['content-scopes'];state['active-sessions']={cx:active};await open(width);}
const blockedRequests=[];const session=id=>state.sessions.find(s=>s.id===id);
const originalAgent=structuredClone(agent),originalProdChat=structuredClone(prodChat);
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await open();
 // 1. Empty chat (never talked to a provider): the choice applies to it in place; same chat, same draft, nothing sent.
 await until(async()=>(await textOf('[data-od-id="generate-with"]'))==='Conversa: Codex','chat chip codex');
 assert.equal(await js(`Boolean(${q('[data-od-id="production-editing-provider"]')})`),false,'no editing chip without a production');
 await click('[data-od-id="generate-with"]');await click('[data-od-id="provider-choice-claude"]');
 assert.equal(await js(`${q('[data-od-id="provider-choice"]')}.dataset.plan`),'in-place');
 await until(async()=>(await textOf('[data-od-id="provider-choice-open-single"]'))==='Usar Claude nesta conversa','in-place label');await shot('01-in-place-choice-light');
 await click('[data-od-id="provider-choice-open-single"]');await until(()=>session('empty-chat').providerId==='claude','in-place provider');
 assert.equal(state.sessions.length,2,'no extra chat');assert.equal(session('empty-chat').remoteSessionId,undefined);
 assert.equal(await js(`${q('.chat-compose textarea')}.value`),'EMPTY_CHAT_DRAFT');assert.equal(sends.length,0);assert.equal(creates.length,0);
 await until(async()=>(await textOf('[data-od-id="generate-with"]'))==='Conversa: Claude','chip claude');
 // 2. Disconnected provider: the chat can be prepared but never sends.
 claudeReady=false;await reopen('empty-chat');
 await until(async()=>(await textOf('[data-od-id="conversation-provider"]')).includes('Conexão indisponível'),'offline status');
 assert.equal(await js(`${q('.chat-compose .send-button')}.disabled`),true);await shot('02-offline-light');claudeReady=true;
 // 2b. The default Codex model changed in Settings AFTER the app mounted: an in-place switch applies the NEW default.
 await js(`location.hash='#settings'`);await click('.model-settings-select .select-menu-trigger');await option('Codex fixture model');await until(()=>js(`${q('.model-settings-select .select-menu-value')}?.textContent==='Codex fixture model'`),'default model');
 await js(`location.hash='#agents'`);await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="Editor Codex"]'))`),'back');await js(`document.querySelector('.agent-nav[title="Editor Codex"]').click()`);await until(()=>js('Boolean(document.querySelector(".chat-compose textarea"))'),'composer again');
 await click('[data-od-id="generate-with"]');await click('[data-od-id="provider-choice-codex"]');assert.equal(await js(`${q('[data-od-id="provider-choice"]')}.dataset.plan`),'in-place');await click('[data-od-id="provider-choice-open-single"]');
 await until(()=>session('empty-chat').providerId==='codex','back to codex');assert.equal(session('empty-chat').modelId,'cx-model','new default applies (no stale closure)');assert.equal(sends.length,0);assert.equal(creates.length,0);
 // 3. A production chat with history: Conversa: Codex and Edição: Claude shown separately, read from each record.
 await reopen('prod-chat');
 await until(async()=>(await textOf('[data-od-id="production-editing-provider"]'))==='Edição: Claude','editing chip');
 assert.equal(await textOf('[data-od-id="generate-with"]'),'Conversa: Codex');assert.match(await js(`${q('[data-od-id="generate-with"]')}.title`),/Conversa: Codex · Codex fixture model/);assert.match(await js(`${q('[data-od-id="production-editing-provider"]')}.title`),/^Edição: Claude · cl-model/);await shot('03-chat-codex-editor-claude-light');
 await js('document.documentElement.dataset.appearance="dark"');await shot('04-chat-codex-editor-claude-dark');
 win.setSize(560,1000);await until(()=>js(`(()=>{const r=${q('[data-od-id="conversation-provider"]')}.getBoundingClientRect();return r.width>0&&r.right<=innerWidth+1})()`),'narrow fits');await shot('05-chat-codex-editor-claude-narrow-dark');
 await js('document.documentElement.dataset.appearance="light"');win.setSize(1440,1000);
 await click('[data-od-id="generate-with"]');await click('[data-od-id="provider-choice-claude"]');
 assert.equal(await js(`${q('[data-od-id="provider-choice"]')}.dataset.plan`),'new-chat');
 assert.match(await textOf('[data-od-id="provider-choice-effect"]'),/continua com Codex/);assert.match(await textOf('.provider-choice-fields'),/Edição: Claude · cl-model é uma escolha separada/);
 assert.doesNotMatch(await textOf('.provider-choice-fields'),/continua usando Codex/);await shot('06-new-chat-choice-light');
 await click('[data-od-id="provider-choice-open-single"]');await until(()=>state.sessions.length===3,'new chat');
 const fresh=state.sessions.find(s=>!['empty-chat','prod-chat'].includes(s.id));assert.equal(fresh.providerId,'claude');assert.equal(fresh.remoteSessionId,undefined);assert.equal(fresh.contentId,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(session('prod-chat'))),originalProdChat,'production chat keeps history and binding');
 assert.equal(state['chat-drafts']['["cx","prod-chat"]'].text,'PROD_CHAT_DRAFT','original draft kept');assert.equal(await js(`${q('.chat-compose textarea')}.value`),'PROD_CHAT_DRAFT','draft copied');
 assert.equal(sends.length,0);assert.equal(creates.length,0);assert.equal(commands.length,0,'switching the chat never commands the production');
 // 4. Busy guard: while the chat responds, its provider cannot change.
 await click('.chat-compose .send-button');await until(()=>sends.length===1&&streams.has(sends[0].id),'send');assert.equal(sends[0].provider,'claude');assert.equal(sends[0].input.instructions,agent.instructions);
 await until(()=>js(`${q('[data-od-id="generate-with"]')}.disabled`),'busy disables');
 const stream=streams.get(sends[0].id);stream.end(JSON.stringify({type:'message.completed',executionId:sends[0].id,content:'CLAUDE_REPLY'})+'\n'+JSON.stringify({type:'execution.completed',executionId:sends[0].id})+'\n');streams.delete(sends[0].id);
 await until(()=>js(`!${q('[data-od-id="generate-with"]')}.disabled`),'idle again');
 // 5. Blocked production: change who directs this edit (model reset to the new provider), then pick a model. No execution starts.
 await reopen('prod-chat');await click('[data-od-id="production-editing-provider"]');await until(()=>js(`Boolean(${q('[data-od-id="production-roles"]')})`),'production dialog');
 assert.match(await textOf('[data-od-id="production-roles"]'),/conteúdo Codex · cx-model/);
 assert.equal(await textOf('[data-od-id="production-edit-director"]'),'Direção de cortes/motion: Editor Codex · Claude Code · cl-model');
 assert.equal(await js(`${q('[data-od-id="edit-director"]')}.dataset.mode`),'run');assert.equal(await js(`${q('[data-od-id="production-resume"]')}.dataset.mode`),'generic');assert.equal(await textOf('[data-od-id="production-resume-button"]'),'Retomar e verificar produção');assert.equal(await js(`${q('[data-od-id="production-resume"]')}.querySelectorAll('input[type=checkbox]').length`),1,'uncertain interruptions keep the resend authorization');await js(`${q('[data-od-id="production-roles"]')}.scrollIntoView({block:'start'})`);await shot('07-blocked-production-light');
 await click('[aria-label="Quem dirige a edição"]');await option('Codex');await until(()=>commands.length===1,'set director');
 assert.equal(commands[0].action,'set-edit-director');assert.equal(commands[0].authorize,true);assert.deepEqual(commands[0].director,{providerId:'codex'},'model reset when the provider changes');
 await until(async()=>(await textOf('[data-od-id="production-edit-director"]'))==='Direção de cortes/motion: Editor Codex · Codex · cx-model','run director updated');
 await click('[aria-label="Modelo de quem dirige a edição"]');await option('Codex fixture model 2');await until(()=>commands.length===2,'set model');assert.deepEqual(commands[1].director,{providerId:'codex',modelId:'cx-model-2'});
 assert.equal(directorWrites.length,0,'a production choice never writes the workspace default');assert.equal(sends.length,1);assert.equal(creates.length,1);
 // Still blocked until Resume (no AI started by choosing); the hint says so, and the Resume button stays.
 assert.equal(runs.find(r=>r.id==='run-blocked').stage,'blocked');assert.match(await textOf('[data-od-id="edit-director"]'),/Nada roda agora: ao retomar, a edição recomeça o planejamento com este diretor e modelo/);
 await until(()=>js(`${q('[data-od-id="production-resume"]')}?.dataset.mode==='restart'`),'restart mode');assert.equal(await textOf('[data-od-id="production-resume-button"]'),'Retomar com o novo diretor');assert.match(await textOf('[data-od-id="production-edit-restart"]'),/recomeça o planejamento com Codex · cx-model-2; o plano anterior serve de referência/);assert.doesNotMatch(await textOf('[data-od-id="production-resume"]'),/checkpoint salvo/,'no old-checkpoint promise');assert.equal(await js(`${q('[data-od-id="production-resume"]')}.querySelectorAll('input[type=checkbox]').length`),0);
 // Opening the selector and picking the same choice sends nothing.
 await click('[aria-label="Quem dirige a edição"]');await option('Codex');await until(async()=>(await textOf('[data-od-id="production-edit-director"]'))==='Direção de cortes/motion: Editor Codex · Codex · cx-model-2','explicit model');await click('[aria-label="Modelo de quem dirige a edição"]');await option('Codex fixture model 2');await new Promise(r=>setTimeout(r,400));assert.equal(commands.length,2,'same choice is a no-op');
 await js('document.documentElement.dataset.appearance="dark"');await js(`${q('[data-od-id="edit-director"]')}.scrollIntoView({block:'center'})`);await shot('08-director-changed-dark');await js('document.documentElement.dataset.appearance="light"');
 // 6. Before the edit (recording): the choice is kept for THIS production and sent with the video; workspace default untouched.
 runs=[blocked,recording];state.sessions.push(recording.sourceSession);await reopen('rec-chat');
 await until(async()=>(await textOf('[data-od-id="production-editing-provider"]'))==='Edição: Claude (padrão)','workspace default chip');
 await click('[data-od-id="production-editing-provider"]');await until(()=>js(`${q('[data-od-id="edit-director"]')}?.dataset.mode==='production'`),'production mode');
 await click('[aria-label="Vídeo da produção"]');await option('gravacao.mp4');
 await click('[aria-label="Quem dirige a edição"]');await option('Codex');
 await until(async()=>(await textOf('[data-od-id="production-edit-director"]')).includes('Codex (só nesta produção, ao enviar o vídeo)'),'pending label');
 assert.equal(commands.length,2,'choosing before sending sends nothing');await js(`${q('[data-od-id="edit-director"]')}.scrollIntoView({block:'center'})`);await shot('09-recording-choice-light');
 await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Enviar vídeo e iniciar edição automática').click()`);await until(()=>commands.length===3,'video');
 assert.equal(commands[2].action,'video');assert.deepEqual(commands[2].director,{providerId:'codex'});assert.equal(directorWrites.length,0);assert.equal(workspaceDirector.providerId,'claude');
 win.setSize(560,1000);await shot('10-after-video-narrow-light');
 assert.equal(state.agents.length,1);assert.deepEqual(state.agents[0],originalAgent,'agent profile unchanged');assert.deepEqual(errors,[]);assert.deepEqual(blockedRequests,[]);
 // 7. Turn-limit stop: useful diagnostics, effective vs configured, one Resume (no step-by-step approvals); opening sends nothing.
 runs=[blocked,recording,limit];state.sessions.push(limitChat);state['chat-drafts'][JSON.stringify(['cx','limit-chat'])]={text:'LIMIT_DRAFT',skill:null};
 const limitBefore=structuredClone(limitChat),before={sends:sends.length,creates:creates.length,commands:commands.length};await reopen('limit-chat',1440);
 await until(async()=>(await textOf('[data-od-id="production-editing-provider"]'))==='Edição: Claude','limit chip');
 assert.match(await js(`${q('[data-od-id="production-editing-provider"]')}.title`),/Última execução: Claude Code · claude-reported-model · parou no limite de turnos \(20\/20 turnos\)/);
 await click('[data-od-id="production-editing-provider"]');await until(()=>js(`Boolean(${q('[data-od-id="production-edit-stop"]')})`),'stop card');
 assert.equal(await textOf('[data-od-id="production-edit-director"]'),'Direção de cortes/motion: Editor Codex · Claude Code · cl-model','configured');
 assert.equal(await textOf('[data-od-id="production-edit-execution"]'),'Última execução da edição: Claude Code · claude-reported-model · parou no limite de turnos (20/20 turnos)','effective');
 const stopText=await textOf('[data-od-id="production-edit-stop"]');
 assert.match(stopText,/20\/20 turnos · revisão 3 · 14 chamada\(s\) de ferramenta · 6 restante\(s\) · continuações 1\/3/);assert.match(stopText,/Motivo: a última execução não avançou o checkpoint/);assert.match(stopText,/Retomar continua do checkpoint salvo/);assert.match(stopText,/original e o histórico estão preservados/);
 await js(`${q('[data-od-id="production-edit-executions"]')}.open=true`);assert.match(await textOf('[data-od-id="production-edit-executions"]'),/continuação 1 · Claude Code · claude-reported-model · parou no limite de turnos \(20\/20 turnos\) · revisão 3 · 11→14 chamada\(s\)/);
 assert.deepEqual({sends:sends.length,creates:creates.length,commands:commands.length},before,'opening sends nothing');
 // Re-picking the configured director keeps the run (and its diagnostics) untouched.
 await click('[aria-label="Quem dirige a edição"]');await option('Claude Code (recomendado para edição/motion)');await new Promise(r=>setTimeout(r,400));
 assert.deepEqual({sends:sends.length,creates:creates.length,commands:commands.length},before,'same director sends nothing');assert.equal(await js(`${q('[data-od-id="production-resume"]')}.dataset.mode`),'checkpoint');assert.equal(await textOf('[data-od-id="production-resume-button"]'),'Retomar do ponto salvo');assert.equal(await js(`${q('[data-od-id="production-resume"]')}.querySelectorAll('input[type=checkbox]').length`),0,'confirmed stop: no resend checkbox');assert.doesNotMatch(await textOf('[data-od-id="production-resume"]'),/envio externo incerto/);assert.equal(await js(`Boolean(${q('[data-od-id="production-edit-stop"]')})`),true,'diagnostics kept');
 await js(`${q('[data-od-id="production-roles"]')}.scrollIntoView({block:'start'})`);await shot('10b-configured-vs-effective-light');
 await js(`${q('[data-od-id="production-edit-stop"]')}.scrollIntoView({block:'start'})`);await shot('11-turn-limit-light');
 await js('document.documentElement.dataset.appearance="dark"');await shot('12-turn-limit-dark');win.setSize(560,1000);await js(`${q('[data-od-id="production-edit-stop"]')}.scrollIntoView({block:'start'})`);await shot('13-turn-limit-narrow-dark');await js('document.documentElement.dataset.appearance="light"');win.setSize(1440,1000);
 await click('[data-od-id="production-resume-button"]');await until(()=>commands.length===before.commands+1,'resume');await new Promise(r=>setTimeout(r,300));assert.equal(commands.length,before.commands+1,'exactly one resume');
 const resume=commands.at(-1);assert.equal(resume.run,'run-limit');assert.equal(resume.action,'resume');assert.equal(resume.authorize,true);assert.equal(resume.resend,false,'no resend authorized implicitly');
 assert.deepEqual(Object.keys(resume).sort(),['action','authorize','requestId','resend','revision','run'],'one command, no per-step approvals');
 assert.equal(sends.length,before.sends);assert.equal(creates.length,before.creates);
 assert.deepEqual(JSON.parse(JSON.stringify(session('limit-chat'))),limitBefore,'history preserved');assert.equal(state['chat-drafts'][JSON.stringify(['cx','limit-chat'])].text,'LIMIT_DRAFT','draft preserved');
 assert.deepEqual(errors,[]);
 writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,out,sends:sends.length,creates:creates.length,commands,directorWrites,checks:['empty chat switches in place, draft kept, nothing sent','offline provider prepares but cannot send','Conversa: Codex + Edição: Claude read from separate records','history chat opens a new chat, original history/binding/draft kept','busy chat cannot switch','blocked run: set-edit-director with model reset, then explicit model','production choice never writes workspace default','recording: director sent with video only','turn-limit stop diagnostics, configured vs effective, opening sends nothing','single Resume command, history/draft preserved','new default Codex model applies in place after Settings change','director change keeps blocked until Resume, same choice no-op','restart mode after director change (no old-checkpoint promise)','confirmed turn-limit: Retomar do ponto salvo, zero checkboxes, one exact resume; generic flow keeps resend checkbox','light/dark/narrow']},null,2));
 console.log('PROVIDER_EDITOR_CHOICE_UI_OK '+out);win.destroy();await bridge.close();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log(await js('document.body.innerText'));try{await shot('failure')}catch{}win.destroy()}for(const stream of streams.values())stream.end();await bridge.close();server.close();app.exit(1)}});
