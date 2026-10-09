// B07/B09/B10 — real renderer (dist), real SQLite bridge and real FFmpeg; simulated LLM runtime, Notion, Zernio and Whisper.
// No personal profile, account, Notion workspace or video. Each external call is counted and asserted.
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerEditorialFilesIpc} from '../editorial-files-ipc.mjs';
import {createChatImageArtifacts} from '../chat-image-artifacts.mjs';
import {runMediaProcess} from '../editorial-media.mjs';
import {inspectLocalAsset} from '../editorial-local-files.mjs';
import {createZernioPublicationConnector} from '../zernio-publication-connector.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/b07-b09-b10-ui',String(Date.now()));mkdirSync(out,{recursive:true});app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='handoff-test',workspaceId='space',at=new Date().toISOString(),dbPath=join(out,'workspace-state.sqlite'),input=join(out,'original.mp4'),reference=join(out,'reference.mp4'),inspect=path=>inspectLocalAsset(path,{stabilityMs:0});
const source={id:'source',name:'Editor de Conteúdo',role:'Conteúdo',instructions:'Use my own role and skills',description:'Fixture',skills:['own-skill'],workspaceId,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at},editor={...source,id:'editor',name:'Editor de Vídeo',role:'Vídeo'};
const flow={id:'flow',workspaceId,name:'Fluxo de criação de conteúdo',nodes:[{id:'content-box',kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:'input-box',kind:'video-input',title:'Vídeos da gravação',position:{x:430,y:140}},{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:'editor',position:{x:780,y:140}},{id:'publish-box',kind:'publishing-agent',title:'Preparar publicação',agentId:'source',position:{x:1130,y:140}}],edges:[],createdAt:at,updatedAt:at};
const topic={id:'topic',workspaceId,requestId:'idea',inputKind:'text',input:'Automation',priority:'normal',status:'review',title:'Minha ideia de automação',category:'Tech',summary:'Uma demonstração prática de automação.',whyItMatters:'Explica como economizar tempo no dia a dia.',angles:['Demo','Explicação'],sources:[{title:'Referência',url:'https://example.com'}],factualQuestions:[],createdAt:at,updatedAt:at};
const transcriber={capabilities:async()=>({available:true}),transcribe:async({duration})=>({origin:'local-whisper',engine:'whisper.cpp',model:'fixture',language:'pt',segments:[{start:0.2,end:Math.min(2,duration),text:'Você perde horas editando vídeos'}],speech:[]})};
const store=createDesktopStateStore(out,'test');store.initialize(profile,{agents:[source,editor],workspaces:[{id:workspaceId,name:'Content',createdAt:at,updatedAt:at}],sessions:[],'current-workspace':workspaceId,'active-sessions':{},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[workspaceId]:flow.id}}});
ipcMain.handle('test:read',(_e,key)=>store.read(profile,key));ipcMain.handle('test:write',(_e,key,value)=>store.write(profile,key,value));ipcMain.handle('test:all',()=>store.readAll(profile));
const images=createChatImageArtifacts(join(out,'images')),executions=new Map(),threads=new Map();let serial=0,sends=0,analysisSends=0,win;const analysisPrompts=[];
const notion={upserts:0,reads:0},zernio={creates:0,writes:0,reads:0,offline:false};let post;
const options={hooks:['Primeira opção','Segunda opção','Terceira opção'],ctas:['Salve','Experimente'],paths:[{title:'Demo',outline:'Mostre o problema e a solução em uma demonstração clara.'},{title:'História',outline:'Explique o contexto do problema e como chegou à solução.'}],improvisationTopics:['Demo','Contexto'],thumbnailDirection:'Capa profissional',draftScript:'Uma automação prática pode economizar tempo em uma tarefa repetitiva. Comece pelo problema, demonstre a solução funcionando e explique como o público pode aplicar a mesma ideia na própria rotina.'};
const analysis={hook:{text:'Você perde horas editando vídeos',startSeconds:0.2,endSeconds:2,why:'Nomeia a dor logo no início.'},rhythm:{pace:'medium',summary:'Fala curta seguida de pausa.'},structure:[{label:'Dor',startSeconds:0,endSeconds:2,summary:'Problema'},{label:'Resto',startSeconds:2,endSeconds:5,summary:'Sem fala'}],takeaways:['Nomear a dor antes da solução.'],limitations:[]};
const runtime={createSession:async()=>{const id=`thread-${++serial}`;threads.set(id,{turns:[]});return id},resumeSession:async()=>{},readThread:async id=>threads.get(id),cancel:async()=>{},imageFile:image=>images.pathForImage(image),send:async(thread,text)=>{sends++;const isAnalysis=text.includes('REFERÊNCIA fornecido');if(isAnalysis){analysisSends++;analysisPrompts.push(text)}const id=`execution-${++serial}`,output=isAnalysis?JSON.stringify(analysis):JSON.stringify(options);executions.set(id,{thread,text,output});return {executionId:id}},events:async function*(id){const e=executions.get(id);yield {type:'message.completed',content:e.output};threads.get(e.thread).turns.push({id,status:'completed',items:[{type:'userMessage',content:[{type:'text',text:e.text}]},{type:'agentMessage',text:e.output}]});yield {type:'execution.completed'}}};
const fetchImpl=async(url,init={})=>{const path=new URL(url).pathname.split('/api/v1/')[1],method=init.method??'GET';if(method!=='GET'&&zernio.armed)zernio.writes++;if(path==='accounts')return Response.json({accounts:[{_id:'li-fixture',platform:'linkedin',username:'Conta de teste',isActive:true}]});if(path==='posts'&&method==='POST'){zernio.creates++;const body=JSON.parse(init.body);post={...body,_id:'post-fixture',status:'scheduled',platforms:body.platforms.map(t=>({...t,status:'scheduled'}))};return Response.json({post});}if(path==='posts/post-fixture'&&method==='GET'){zernio.reads++;if(zernio.offline)throw Error('offline');return Response.json({post});}throw Error(`Unexpected provider request ${method} ${path}`)};
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>profile,getAgents:()=>store.read(profile,'agents'),getFlows:()=>store.read(profile,'production-flows'),getSessions:()=>store.read(profile,'sessions'),getRuntime:()=>runtime,inspect,mediaOptions:{inspect,transcriber},getPublicationConnector:()=>createZernioPublicationConnector(()=> 'fixture',{fetchImpl}),getConnector:()=>({upsert:async(payload,ctx)=>{ctx.authorize();notion.upserts++;return {pageId:'12345678-1234-1234-1234-123456789abc',url:'https://www.notion.so/12345678123412341234123456789abc',artifactVersion:payload.artifact.version,verifiedAt:at}},readCard:async()=>{notion.reads++;return {text:'Notas',fetchedAt:at}}})});
registerEditorialFilesIpc({ipcMain,dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[input]})},shell:{openPath:async()=>''},getWindow:()=>win,getStore:()=>store});
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value))};
const external=[];const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');if(images.handle(request,response,url))return;if(await bridge.handle(request,response,url))return;if(url.pathname.endsWith('/health'))return json(response,{ready:true,accountType:'chatgpt'});if(url.pathname.endsWith('/models'))return json(response,{models:[]});if(url.pathname.endsWith('/images'))return json(response,{events:[]});if(url.pathname.startsWith('/api/'))return json(response,{});try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,url.pathname==='/'?'app.html':url.pathname.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file))}catch{response.statusCode=404;response.end()}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);async function until(check,label=''){const end=Date.now()+25000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error(`UI timed out ${label}`)}
async function click(selector){await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function button(text){await until(()=>js(`Array.from(document.querySelectorAll('button')).some(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled)`),text);await js(`Array.from(document.querySelectorAll('button')).find(el=>(el.querySelector('.select-menu-option-copy b')?.textContent??el.textContent).trim()===${JSON.stringify(text)}&&!el.disabled).click()`)}
async function select(label,value){await js(`(()=>{const el=document.querySelector(${JSON.stringify(`select[aria-label="${label}"]`)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents))}
const text=()=>js('document.body.innerText'),run=()=>bridge.production.list(profile)[0];
const state=()=>{const d=new DatabaseSync(dbPath);try{return JSON.parse(d.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json)}finally{d.close()}};
async function open(hash){win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message)});win.webContents.session.webRequest.onBeforeRequest((details,done)=>{if(!/^(http:\/\/127\.0\.0\.1|file:|devtools:|data:|blob:)/.test(details.url))external.push(details.url);done({cancel:false})});await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#${hash}`)}
app.whenReady().then(async()=>{try{
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1.5','-c:v','libx264','-c:a','aac',input]);
 await runMediaProcess('ffmpeg',['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=192x108:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-c:a','aac',reference]);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const file=await inspect(reference),seed=new DatabaseSync(dbPath);
 seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[topic,{...topic,id:'topic2',requestId:'idea2',title:'Pauta da entrega agendada',status:'approved',contentId:'c1'}],contents:[{id:'c1',workspaceId,topicId:'topic2',title:'Conteúdo com entrega agendada',format:'short-video',platforms:['LinkedIn'],status:'planning',createdAt:at,updatedAt:at}],artifacts:[],approvals:[],runs:[],assets:[{id:'ref-asset',workspaceId,contentId:'c1',kind:'video',role:'source',status:'available',name:file.name,currentVersionId:'v1',versions:[{id:'v1',...file,createdAt:at}],createdAt:at,updatedAt:at}],publications:[],inspiration:{schemaVersion:1,references:[{id:'ref-local',workspaceId,title:'Referência falada local',notes:'',tags:[],asset:{assetId:'ref-asset',name:file.name},metadataStatus:'not_collected',revision:1,createdAt:at,updatedAt:at},{id:'ref-link',workspaceId,title:'Só um link',notes:'',tags:[],sourceUrl:'https://www.instagram.com/reel/example/',sourceHost:'instagram.com',platform:'instagram',metadataStatus:'not_collected',revision:1,createdAt:at,updatedAt:at}]}}),at);seed.close();
 bridge.jobs.configure(profile,workspaceId,{dataSourceId:'12345678-1234-1234-1234-123456789abc',autoSync:true});
 // A scheduled delivery with a confirmed provider receipt, created through the real execution service.
 const snap=()=>{const row=(()=>{const d=new DatabaseSync(dbPath);try{return d.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile)}finally{d.close()}})();return {revision:row.revision,state:JSON.parse(row.state_json)}};
 const command=(action,extra={})=>{const s=snap(),d=s.state.publications?.[0];return bridge.publications.command(profile,{revision:s.revision,contentId:'c1',id:d?.id,expectedDelivery:d,action,...extra})};
 command('create',{platform:'LinkedIn',draft:{text:'Texto aprovado da entrega',assetIds:[],timeZone:'UTC',plannedAt:new Date(Date.now()+86400000).toISOString()}});command('submit');command('approve');
 const pick=()=>{const s=snap();return {id:s.state.publications[0].id,revision:s.revision,expectedDelivery:s.state.publications[0]}};
 bridge.publishing.prepare(profile,{...pick(),mode:'schedule',provider:'zernio',accountId:'li-fixture'});await bridge.publishing.execute(profile,{...pick(),authorize:true});
 assert.equal(state().publications[0].status,'scheduled');assert.equal(zernio.creates,1);zernio.armed=true;
 // ---------- B07: local mode through the real dialog ----------
 await open('flow');await until(()=>js('Boolean(document.querySelector(".production-flow-page"))'),'flow page');
 await button('Iniciar produção');await click('[aria-label="Ideia da produção"]');await button(topic.title);
 await until(()=>js('document.querySelector(".production-preflight [role=status]")?.textContent.includes("Nenhum bloqueio")'),'preflight notion');
 await js('document.querySelectorAll("input[name=production-script-mode]")[1].click()');
 await until(()=>js('document.body.textContent.includes("sem Notion")'),'local copy');
 await until(()=>js('document.querySelector(".production-preflight [role=status]")?.textContent.includes("Nenhum bloqueio")'),'preflight local');
 await js('Array.from(document.querySelectorAll(".production-panel-body .production-check input[type=checkbox]")).at(-1).click()');
 await button('Aprovar ideia e iniciar produção');await until(()=>js('document.body.textContent.includes("Aguardando aprovação do roteiro")'),'script review');
 assert.equal(run().scriptMode,'local');assert.equal(notion.upserts+notion.reads,0,'local mode never reads or writes Notion');
 await click('.production-script .production-check input');await button('Aprovar roteiro');await until(()=>run().stage==='recording'&&run().recordingReady,'recording');
 assert.equal(run().recordingReady,true);assert.match(await text(),/modo local sem Notion/);assert.equal(notion.upserts+notion.reads,0);
 await shot('local-recording-released');
 const approvedHash=run().scriptApproval.hash;
 // Enable Notion afterwards: same artifact/hash, exactly one card.
 await js('Array.from(document.querySelectorAll("details summary")).find(el=>el.textContent.includes("Ativar o Notion")).click()');
 await js('Array.from(document.querySelectorAll("details .production-check")).find(el=>el.textContent.includes("Autorizo criar/atualizar o card")).querySelector("input").click()');
 await button('Ativar Notion');await until(()=>notion.upserts===1,'notion upsert');
 await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(notion.upserts,1,'one card only');assert.equal(run().scriptApproval.hash,approvedHash,'the same approved hash is reused');
 // ---------- B10: read-only status refresh in Content Studio ----------
 win.destroy();await open('content');
 await until(()=>js('Boolean(document.querySelector(".content-studio-tabs"))'),'studio');
 await until(()=>js("document.body.textContent.includes('Pauta da entrega agendada')"),'topic listed');
 const found=await js(`(()=>{const el=Array.from(document.querySelectorAll('button,a,[role=button],li')).find(e=>e.textContent.includes('Pauta da entrega agendada')&&e.querySelectorAll('button').length<2);if(el){el.click();return true}return false})()`);
 assert(found,'content row not found:\n'+(await text()).slice(0,1500));
 await until(()=>js('Boolean(document.querySelector(".publication-status-refresh"))'),'status refresh panel');
 await until(()=>js('document.querySelector(".publication-status-refresh").textContent.includes("Última consulta")'),'status checked on open');
 assert.equal(zernio.writes,0,'status checks never write');
 zernio.offline=true;await button('Atualizar status agora');await until(()=>js('document.querySelector(".publication-status-notices")?.textContent.includes("não foi possível consultar")'),'offline notice');
 assert.equal(state().publications[0].status,'scheduled','a network failure keeps the scheduled state');
 zernio.offline=false;post={...post,status:'published',platforms:post.platforms.map(t=>({...t,status:'published',platformPostId:'real-1',platformPostUrl:'https://example.com/p/1'}))};
 await button('Atualizar status agora');await until(()=>state().publications[0].status==='published','published receipt');
 await until(()=>js('document.querySelector(".publication-status-notices")?.textContent.includes("publicado")'),'published notice');
 assert.equal(zernio.writes,0,'still no create/update/cancel after polling');assert.equal(zernio.creates,1);
 await js('document.querySelector(".publication-status-refresh")?.scrollIntoView()');await shot('status-refresh');
 // ---------- B09: references ----------
 await button('Referências');await until(()=>js('document.body.textContent.includes("Referência falada local")'),'references');
 assert.match(await text(),/links não são acessados/);
 assert.equal(analysisSends,0,'nothing is analyzed before an explicit authorized action');
 await select('Agente da análise','source');
 assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.startsWith("Analisar gancho")).disabled'),true,'needs authorization');
 await js('document.querySelector(".reference-analysis-start .production-check input").click()');
 await button('Analisar gancho, ritmo e estrutura');
 await until(()=>js('document.body.textContent.includes("Padrões reaproveitáveis")'),'analysis done');
 assert.equal(analysisSends,1);assert.match(await text(),/quadros não enviados/);assert.match(await text(),/Você perde horas editando vídeos/);
 assert(!analysisPrompts[0].includes(out),'no local path is sent to the model');
 await select('Ideia para o briefing','topic');await button('Vincular');await until(()=>js('document.querySelector(".reference-analysis-link")?.textContent.includes("Minha ideia")'),'linked');
 await js('document.querySelector(".reference-analysis").scrollIntoView()');await shot('reference-analysis');
 await js('Array.from(document.querySelectorAll(".reference-analysis-link button")).find(b=>b.textContent==="Desvincular").click()');await until(()=>js('!document.querySelector(".reference-analysis-link")'),'unlinked');
 assert.equal(analysisSends,1,'link/unlink never call the model');assert.deepEqual(external,[],'no external request');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,out,notion,zernio,analysisSends}));win.destroy();await bridge.close();store.close();server.close();app.exit(0);
 }catch(error){console.error(error);console.error(errors,external);if(win&&!win.isDestroyed()){console.log((await text()).slice(0,3000));await shot('failure');win.destroy()}await bridge.close();store.close();server.close();app.exit(1)}
});
