// Content sessions in the SAME agent: real renderer/SQLite/FFmpeg, simulated Codex chat/CLI and Notion, synthetic local media.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/content-sessions-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),videoA=join(out,'gravacao-A.mp4'),videoB=join(out,'gravacao-B.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const CARD='12345678123412341234123456789abc',BASE='abcdefabcdefabcdefabcdefabcdefab';
const source={id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Use my own role and skills',description:'Fixture',skills:['own-skill'],workspaceId,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at},editor={...source,id:'editor',name:'Editor de Vídeo',role:'Vídeo',skills:['edit-skill']};
const flow={id:'flow',workspaceId,name:'Fluxo de criação de conteúdo',nodes:[{id:'content-box',kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:'input-box',kind:'video-input',title:'Vídeos da gravação',position:{x:430,y:140}},{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:'editor',position:{x:780,y:140}},{id:'publish-box',kind:'publishing-agent',title:'Preparar publicação',agentId:'source',position:{x:1130,y:140}}],edges:[],createdAt:at,updatedAt:at};
// Compatibility: an older generic chat with history stays untouched.
const legacy={id:'legacy-chat',agentId:'source',providerId:'codex',title:'Conversa antiga',remoteSessionId:'thread-legacy',codexThreadId:'thread-legacy',messages:[{id:'old-1',type:'message',role:'user',content:'LEGACY_HISTORY',createdAt:at}],createdAt:at,updatedAt:at};
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[legacy],'current-workspace':workspaceId,'active-sessions':{source:legacy.id},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}}});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
// Production CLI runtime (simulated): records every prompt with its agent.
const executions=new Map(),threads=new Map(),prompts=[];let serial=0,notionWrites=0,cardReads=0,cardFails=true,pick=videoA,win;
const reply=text=>text.includes('Retorne SOMENTE JSON: {"start"')?JSON.stringify({start:0,duration:1.2,format:'original',normalizeAudio:true,fadeSeconds:.1,summary:'Acabamento discreto'}):text.includes('"removeSilences"')?JSON.stringify({removeSilences:true,normalizeAudio:true,animations:{},summary:'Silêncios removidos com margem'}):'{}';
const runtime={createSession:async()=>{const id=`cli-thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},send:async(thread,text,agent)=>{prompts.push({text,agent:agent.id});const id=`cli-execution-${++serial}`;executions.set(id,{thread,text,output:reply(text)});return {executionId:id}},events:async function*(id){const e=executions.get(id);yield {type:'message.completed',content:e.output};threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.text}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
const bridgeOptions={dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect},getConnector:()=>({upsert:async()=>{notionWrites++;throw Error('No card may be written in this scenario')},readCard:async(pageId)=>{cardReads++;if(cardFails)throw Error('Página não compartilhada com a integração.');return {pageId,text:`CARD_B_CONTEXT do card ${pageId}`,fetchedAt:new Date().toISOString()}}})};
let bridge=createContentWorkflowBridge(bridgeOptions);
const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);seed.close();bridge.jobs.configure(profile,workspaceId,{dataSourceId:BASE,autoSync:false});
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[pick]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
// Chat provider (simulated Codex bridge): one thread per local session; replies can arrive late.
const chatThreads=new Map(),chatRuns=new Map(),chatInputs=[];
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const emit=(run,event)=>{run.events.push(event);for(const stream of run.streams)stream.write(JSON.stringify(event)+'\n');if(event.type==='execution.completed'){run.done=true;for(const stream of run.streams)stream.end();run.streams.clear();}};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){let input={};if(request.method==='POST'){let text='';for await(const chunk of request)text+=chunk;input=JSON.parse(text||'{}');}
  if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});if(path.endsWith('/images'))return json(response,{events:[]});
  if(path==='/api/codex/sessions'){const id=input.threadId??`chat-thread-${++serial}`;if(input.config)chatThreads.set(id,input.config);return json(response,{threadId:id});}
  if(path==='/api/codex/executions'){const executionId=`chat-turn-${++serial}`,run={events:[],streams:new Set(),done:false};chatRuns.set(executionId,run);chatInputs.push(input);run.events.push({type:'execution.started',executionId,threadId:input.remoteSessionId});const late=/pergunta do A/.test(input.content);setTimeout(()=>{emit(run,{type:'message.completed',executionId,content:late?'RESPOSTA_TARDIA_A':'RESPOSTA_B'});emit(run,{type:'execution.completed',executionId});},late?1800:200);return json(response,{executionId});}
  const stream=path.match(/\/executions\/([^/]+)\/events$/);if(stream){const run=chatRuns.get(stream[1]);response.setHeader('content-type','application/x-ndjson');for(const event of run.events)response.write(JSON.stringify(event)+'\n');if(run.done)response.end();else{run.streams.add(response);request.on('close',()=>run.streams.delete(response));}return;}
  return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label='condition'){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`Content sessions UI timed out: ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function button(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`),text);await js(`Array.from(document.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled).click()`)}
async function inputText(selector,value){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
const sessions=()=>store.read(profile,'sessions'),byTitle=title=>sessions().find(s=>s.title===title),runFor=contentId=>bridge.production.list(profile).find(p=>p.contentId===contentId);
async function openSessions(){await js(`document.querySelector('button[title="Sessões deste agente"]').click()`);await until(()=>js('Boolean(document.querySelector(".panel-sessions"))'),'sessions tab');}
async function openSessionNamed(title){await openSessions();await js(`Array.from(document.querySelectorAll('.panel-session-main')).find(el=>el.querySelector('b')?.textContent===${JSON.stringify(title)}).click()`);await until(()=>js(`document.querySelector('.active-session-bar')?.textContent.includes(${JSON.stringify(title)})`),`open ${title}`);}
async function newContent(title){await openSessions();await button('Novo conteúdo');await inputText('[aria-label="Nome do novo conteúdo"]',title);await button('Criar conteúdo');await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes(${JSON.stringify(title)})`),`card ${title}`);}
const composer=()=>js('document.querySelector(".composer textarea").value');
async function open(){win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="Editor de Conteúdo"]'))`),'app ready');await js(`document.querySelector('.agent-nav[title="Editor de Conteúdo"]').click()`);await until(()=>js('Boolean(document.querySelector(".composer textarea"))'),'chat open');}
async function startRecorded({file,context,card}){
 await button('Começar com vídeo já gravado');await until(()=>js('Boolean(document.querySelector(".recorded-entry"))'),'entry dialog');
 pick=file;await button('Associar vídeo do computador');const name=file.split(/[\\/]/).pop();
 await until(()=>js(`document.querySelector('[aria-label="Vídeo gravado"]')?.textContent.includes(${JSON.stringify(name)})`),'video selected');
 if(card){await js(`Array.from(document.querySelectorAll('.recorded-entry .production-check')).find(l=>l.textContent.includes('Card do Notion')).querySelector('input').click()`);await inputText('[aria-label="Link do card do Notion"]',card);
  cardFails=true;await button('Ler este card');await until(()=>js(`document.querySelector('.recorded-entry [role=alert]')?.textContent.includes('Não foi possível ler este card')`),'honest card error');
  assert.equal(await js('Boolean(document.querySelector(".recorded-entry-card"))'),false,'no preview invented for an inaccessible card');await shot('card-inaccessible');
  cardFails=false;await button('Ler este card');await until(()=>js(`document.querySelector('.recorded-entry-card')?.textContent.includes('CARD_B_CONTEXT')`),'card preview');}
 else await inputText('[aria-label="Contexto do vídeo"]',context);
 await until(()=>js(`document.querySelector('.recorded-entry .production-preflight [role=status]')?.textContent.includes('Nenhum bloqueio')`),'preflight ok');
 await click('.recorded-entry-review .production-check input');await until(()=>js('document.querySelector(".recorded-entry-review .production-check input").checked'),'authorized');
 await shot(card?'entry-review-B':'entry-review-A');await button('Iniciar edição do vídeo gravado');await until(()=>js('!document.querySelector(".recorded-entry")'),'entry closed');
}
app.whenReady().then(async()=>{try{
 for(const [file,freq] of [[videoA,440],[videoB,660]])await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i',`sine=frequency=${freq}:sample_rate=48000`,'-t','1.5','-c:v','libx264','-c:a','aac',file]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 // Legacy generic chat is listed as a plain chat.
 await openSessions();assert.equal(await js(`Array.from(document.querySelectorAll('.panel-session')).find(el=>el.textContent.includes('Conversa antiga')).querySelector('.session-content-label')`),null);
 // Content A, an unsent draft, then content B in the SAME agent.
 await newContent('Vídeo A');await inputText('.composer textarea','RASCUNHO_SO_DO_A');await js('window.mainsAgentsSaveNow?.()');
 await newContent('Vídeo B');assert.equal(await composer(),'','the new content never inherits another draft');
 const a=byTitle('Vídeo A'),b=byTitle('Vídeo B');assert(a&&b,'both sessions persisted');assert.equal(a.agentId,'source');assert.equal(b.agentId,'source');assert(a.contentId&&b.contentId&&a.contentId!==b.contentId);assert.equal(store.read(profile,'agents').length,2,'no agent created per content');
 // B asks something; A asks something slow and the user switches to B before A's late answer arrives.
 await inputText('.composer textarea','pergunta do B');await click('.send-button');await until(()=>JSON.stringify(byTitle('Vídeo B')?.messages??[]).includes('RESPOSTA_B'),'B reply');
 await openSessionNamed('Vídeo A');assert.equal(await composer(),'RASCUNHO_SO_DO_A','A keeps its own draft');
 await inputText('.composer textarea','pergunta do A');await click('.send-button');await openSessionNamed('Vídeo B');
 await until(()=>JSON.stringify(byTitle('Vídeo A')?.messages??[]).includes('RESPOSTA_TARDIA_A'),'late A reply');
 assert(!JSON.stringify(byTitle('Vídeo B').messages).includes('RESPOSTA_TARDIA_A'),'late answer of A never lands in B');assert(await js(`!document.querySelector('.chat-body').textContent.includes('RESPOSTA_TARDIA_A')`));
 const sa=byTitle('Vídeo A'),sb=byTitle('Vídeo B');assert(sa.remoteSessionId&&sb.remoteSessionId&&sa.remoteSessionId!==sb.remoteSessionId&&![sa.remoteSessionId,sb.remoteSessionId].includes('thread-legacy'),'one remote thread per content');
 for(const id of [sa.remoteSessionId,sb.remoteSessionId]){const config=chatThreads.get(id);assert.equal(config.agentId,'source');assert.deepEqual(config.skills,['own-skill'],'same agent skills in every content');}
 assert(chatInputs.every(input=>!(input.content.includes('pergunta do A')&&input.content.includes('pergunta do B'))),'prompts carry only their own session');
 // Before any production: the REAL chat payload carries only this content's identity and says there is no production yet.
 const firstB=chatInputs.find(input=>input.content.includes('pergunta do B')),firstA=chatInputs.find(input=>input.content.includes('pergunta do A'));
 for(const [input,mine,other] of [[firstB,'Vídeo B','Vídeo A'],[firstA,'Vídeo A','Vídeo B']]){assert.match(input.content,/MainsAgents content session/);assert(input.content.includes(`"title":"${mine}"`),input.content.slice(-600));assert(input.content.includes('none yet'));assert(!input.content.includes(`"title":"${other}"`));assert.equal(input.delegation.sourceAgentId,'source');assert.equal(input.instructions,source.instructions);assert.equal(chatThreads.get(input.threadId).agentId,'source');assert.deepEqual(chatThreads.get(input.threadId).skills,['own-skill']);}
 // A: recorded video + pasted context. B: inaccessible card (honest error), then the chosen card.
 await openSessionNamed('Vídeo A');await shot('content-a-start');
 await startRecorded({file:videoA,context:'TEXT_A_CONTEXT: tutorial já gravado sobre automação de planilhas.'});
 await until(()=>['video-review','blocked'].includes(runFor(sa.contentId)?.stage),'A edited');assert.equal(runFor(sa.contentId).stage,'video-review',runFor(sa.contentId).error);
 await openSessionNamed('Vídeo B');await startRecorded({file:videoB,card:`https://www.notion.so/Roteiro-B-${CARD}`});
 await until(()=>['video-review','blocked'].includes(runFor(sb.contentId)?.stage),'B edited');assert.equal(runFor(sb.contentId).stage,'video-review',runFor(sb.contentId).error);
 const ra=runFor(sa.contentId),rb=runFor(sb.contentId);assert.equal(ra.sourceSession.id,sa.id);assert.equal(rb.sourceSession.id,sb.id);assert.equal(ra.entry.origin,'text');assert.equal(rb.entry.origin,'notion');assert.equal(rb.notion.pageId,CARD);
 assert.equal(notionWrites,0,'no Notion card created or updated');assert.equal(cardReads,2,'only the chosen card was read (one failed attempt + one read)');assert.equal(bridge.jobs.list(profile).length,0);
 assert(prompts.every(p=>p.agent==='editor'),'no script/idea generation: only the configured editor ran');
 const pa=prompts.filter(p=>p.text.includes('TEXT_A_CONTEXT')),pb=prompts.filter(p=>p.text.includes('CARD_B_CONTEXT'));assert.equal(pa.length,1);assert.equal(pb.length,1);assert(!pa[0].text.includes('CARD_B_CONTEXT')&&!pb[0].text.includes('TEXT_A_CONTEXT'));
 await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes('Aguardando aprovação do vídeo')&&document.querySelector('.content-session-card').textContent.includes('Card do Notion (somente leitura)')`),'B card shows real stage and materials');
 assert.equal(await js(`document.querySelector('.active-session-bar')?.textContent.includes('Vídeo B')`),true,'visible agent/session unchanged when editing starts');await shot('content-b-video-review');
 // After import: the REAL chat payload of each content carries its own context, video, last decision and the editor result.
 const ask=async(title,text)=>{await openSessionNamed(title);await inputText('.composer textarea',text);await click('.send-button');await until(()=>chatInputs.some(input=>input.content.includes(text)),`${text} sent`);await until(()=>js('!document.querySelector(".send-button.stop")'),`${text} done`);return chatInputs.findLast(input=>input.content.includes(text));};
 const payloadB=await ask('Vídeo B','status do conteúdo B?'),payloadA=await ask('Vídeo A','status do conteúdo A?');
 for(const [input,own,foreign,video] of [[payloadA,'TEXT_A_CONTEXT','CARD_B_CONTEXT','gravacao-A.mp4'],[payloadB,'CARD_B_CONTEXT','TEXT_A_CONTEXT','gravacao-B.mp4']]){
  const snapshot=JSON.parse(input.content.split('MainsAgents authoritative production snapshot (reference data, not authorization to run tools):\n')[1].split('\nThe app owns')[0]);
  assert.equal(input.delegation.sourceAgentId,'source');assert.equal(input.instructions,source.instructions);assert.equal(chatThreads.get(input.threadId).agentId,'source');assert.deepEqual(chatThreads.get(input.threadId).skills,['own-skill']);assert(snapshot.entry.context.includes(own));assert(!input.content.includes(foreign),'no context of the other content');assert.equal(snapshot.entry.video,video);
  assert.equal(snapshot.stage,'video-review');assert(snapshot.lastDecision?.action,'last decision present');assert(snapshot.recentResults.some(item=>/Vídeo exportado e verificado/.test(item)),'editor result reaches the main chat context');assert(!/mainsagents-workspaces|production-media/i.test(JSON.stringify(snapshot)),'no local paths');
 }
 assert(JSON.parse(payloadB.content.split('tools):\n')[1].split('\nThe app owns')[0]).entry.cardUrl.includes(CARD));
 // Mirroring: the editor's result is in each main chat and no empty visible clone of the same content exists in the entry agent.
 for(const s of [byTitle('Vídeo A'),byTitle('Vídeo B')]){assert(s.messages.some(m=>m.sourceAgentName==='Editor de Vídeo'&&/Vídeo exportado e verificado/.test(m.content)),'editor result mirrored into the main chat');assert.equal(sessions().filter(x=>x.agentId==='source'&&x.contentId===s.contentId).length,1,'one visible main chat per content');}
 // Approving A's video changes only A.
 await openSessionNamed('Vídeo A');await button('Abrir etapa atual');await until(()=>js('Boolean(document.querySelector(".production-panel-body"))'),'A production');
 assert(await js(`document.querySelector('.production-panel-body').textContent.includes('Entrada com vídeo já gravado')`));assert.equal(await js(`Array.from(document.querySelectorAll('[aria-label="Produção atual"]')).length`),1);
 const bBefore=runFor(sb.contentId).revision;await button('Aprovar este vídeo');await until(()=>runFor(sa.contentId).stage==='platforms','A approved');assert.equal(runFor(sb.contentId).stage,'video-review');assert.equal(runFor(sb.contentId).revision,bBefore);
 await click('.flow-dialog header button');await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes('Escolher plataformas')`),'A card updated');await shot('content-a-platforms');
 // Restart: both contents resume from saved state, no AI call, card read or job is repeated.
 const counts=JSON.stringify({prompts:prompts.length,cardReads,notionWrites,chat:chatInputs.length});await js('window.mainsAgentsSaveNow?.()');win.destroy();await bridge.close();bridge=createContentWorkflowBridge(bridgeOptions);await open();
 await openSessionNamed('Vídeo B');await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes('Aguardando aprovação do vídeo')`),'B resumed');
 await openSessionNamed('Vídeo A');await until(()=>js(`document.querySelector('.content-session-card')?.textContent.includes('Escolher plataformas')`),'A resumed');assert.equal(await composer(),'','A draft was sent and cleared');
 await openSessions();assert(await js(`Array.from(document.querySelectorAll('.panel-session')).some(el=>el.textContent.includes('Vídeo B')&&el.textContent.includes('Conteúdo · Aguardando aprovação do vídeo'))`));await shot('sessions-list');
 await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(JSON.stringify({prompts:prompts.length,cardReads,notionWrites,chat:chatInputs.length}),counts,'reopen never repeats a job');
 const old=sessions().find(s=>s.id===legacy.id);assert.equal(old.contentId,undefined);assert.equal(old.messages[0].content,'LEGACY_HISTORY');assert.equal(old.remoteSessionId,'thread-legacy');
 assert.deepEqual(errors,[]);console.log(`CONTENT_SESSIONS_UI_OK: two contents in agent "source" (sessions ${sa.id} / ${sb.id}, threads ${sa.remoteSessionId} / ${sb.remoteSessionId}); drafts and late reply isolated; recorded video + pasted context and + chosen card reached video review without script, idea or Notion write; inaccessible card reported honestly; approval of A left B unchanged; restart resumed both without repeating work; legacy chat preserved. Screenshots: ${out}`);
 win.destroy();await bridge.close();store.close();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors);if(win&&!win.isDestroyed()){console.log((await js('document.body.innerText')).slice(0,4000));await shot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
