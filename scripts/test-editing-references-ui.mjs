// Editing references (Round 8) in the REAL renderer with the REAL desktop preload, state store and content bridge
// (editing-reference runtime + store). Fixture data only (temporary folder), a 4 s video generated with ffmpeg, the motion
// engine pointed at an empty folder (not prepared) and agents without a vision runtime: no paid inference, no network.
// One analysis with observations is seeded in the fixture DB to exercise review/approval; everything else goes through the UI.
// Run: npx electron scripts/test-editing-references-ui.mjs   (renderer from MAINSAGENTS_UI_DIST, default dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/editing-references-ui',String(Date.now()));mkdirSync(out,{recursive:true});
process.env.MAINSAGENTS_HYPERFRAMES_HOME=join(out,'engine-not-prepared');
app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='refs-ui',ws='space',at='2026-10-28T10:00:00.000Z',dbPath=join(out,'workspace-state.sqlite'),video=join(out,'fixture-diagram.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=duration=4:size=640x360:rate=30','-pix_fmt','yuv420p','-c:v','libx264','-y',video]);
const agents=[{id:'editor',name:'Editor de vídeo',role:'Edição',instructions:'Fixture',description:'Fixture',skills:[],workspaceId:ws,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at}];
let store=createDesktopStateStore(out,'ui-test');
store.initialize(profile,{agents,workspaces:[{id:ws,name:'Conteúdo',createdAt:at,updatedAt:at}],sessions:[],tasks:[],'current-workspace':ws,language:'pt-BR','welcome-dismissed':true,'focus-mode':false});
store.selectProfile(profile);
const bridge=createContentWorkflowBridge({dbPath,getCurrentProfile:()=>store.currentProfile(),getAgents:p=>store.read(p,'agents'),getFlows:p=>store.read(p,'production-flows'),getSessions:p=>store.read(p,'sessions'),getRuntime:()=>null,getChatRuntime:()=>null});
const seed=new DatabaseSync(dbPath);seed.exec('PRAGMA busy_timeout=5000');
seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[],contents:[{id:'content-cache',workspaceId:ws,topicId:'topic-cache',title:'Como funciona um cache',format:'short-video',platforms:['YouTube'],status:'planning',createdAt:at,updatedAt:at}],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);
seed.close();
let win;const trusted=event=>event.sender===win?.webContents;
ipcMain.handle('state:getProfile',event=>{assert(trusted(event));return store.currentProfile();});
ipcMain.on('state:profile',event=>{event.returnValue=trusted(event)?store.currentProfile():undefined;});
ipcMain.on('state:writeSync',(event,p,key,value,revision)=>{try{assert(trusted(event));if(p!==store.currentProfile())throw Error('profile');event.returnValue={saved:true,...store.write(p,key,value,revision)};}catch(error){event.returnValue={saved:false,error:error.message};}});
ipcMain.handle('state:checkpoint',()=>store.recoverySnapshot());
for(const operation of ['hasProfile','initialize','read','write','readAll','readAllVersioned','replaceAll'])ipcMain.handle(`state:${operation}`,(event,...args)=>{assert(trusted(event));return store[operation](...args);});
ipcMain.handle('account:status',()=>({configured:false,signedIn:false}));ipcMain.handle('account:google-configured',()=>false);
// Same contract as desktop-main, with the fixture file standing in for the native picker.
ipcMain.handle('editing-references:import',(event,input)=>{assert(trusted(event));const {profile:p,workspaceId,folderId=null,referenceId,expectedRevision}=input;return bridge.editingReferences.importVideos({profile:p,workspaceId},[video],{folderId,referenceId,expectedRevision});});
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){if(path.endsWith('/health'))return json(response,{ready:false,status:'disconnected'});return json(response,{});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));}catch{response.statusCode=404;response.end();}
});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error(`Editing references UI timed out: ${label}`);}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));}
const helpers=`window.__set=(el,v)=>{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,v);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));};
window.__find=(sel,re)=>{const el=[...document.querySelectorAll(sel)].find(e=>new RegExp(re).test((e.getAttribute('aria-label')||'')+' '+e.textContent));if(!el)throw Error('missing '+sel+' '+re);return el;};
window.__field=(scope,re)=>{const label=[...document.querySelectorAll(scope+' label')].find(l=>new RegExp(re).test(l.textContent));if(!label)throw Error('missing field '+re);return label.querySelector('input,textarea,select');};
window.__click=(sel,re)=>{const el=window.__find(sel,re);if(el.disabled)throw Error('disabled '+re);el.click();return true;};true`;
// Waits for the control to exist and be enabled (a previous command may still be returning), then clicks it.
const click=async(sel,re)=>{await until(()=>js(`(()=>{try{return !window.__find(${JSON.stringify(sel)},${JSON.stringify(re)}).disabled}catch{return false}})()`),`enabled ${re}`,10000);return js(`window.__click(${JSON.stringify(sel)},${JSON.stringify(re)})`);};
const set=(sel,value)=>js(`window.__set(document.querySelector(${JSON.stringify(sel)}),${JSON.stringify(value)})`);
const field=(scope,re,value)=>js(`window.__set(window.__field(${JSON.stringify(scope)},${JSON.stringify(re)}),${JSON.stringify(value)})`);
const text=sel=>js(`document.querySelector(${JSON.stringify(sel)})?.textContent??''`);
const has=(sel,re)=>js(`[...document.querySelectorAll(${JSON.stringify(sel)})].some(e=>new RegExp(${JSON.stringify(re)}).test((e.getAttribute('aria-label')||'')+' '+e.textContent))`);
const scope={profile,workspaceId:ws};
const snapshot=()=>bridge.editingReferences.snapshot(scope);
async function open(hash='references',width=1440,height=1000){
 win?.destroy();
 win=new BrowserWindow({show:false,width,height,webPreferences:{preload:resolve(root,'desktop-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component|Failed to persist|Warning: /.test(event.message))errors.push(event.message);});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#${hash}`);
 await until(()=>js('Boolean(document.querySelector(".er-page"))'),'references page');
 await js(helpers);
}
const setAppearance=mode=>js(`document.documentElement.dataset.appearance=${JSON.stringify(mode)};document.documentElement.style.colorScheme=${JSON.stringify(mode)};true`);

app.whenReady().then(async()=>{try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await open();
 // 1. Real navigation + honest empty state.
 assert.equal(await js('document.querySelector(\'[data-od-id="nav-references"]\')?.getAttribute("aria-current")'),'page','sidebar item active');
 await until(()=>has('.er-empty h2','Ensine seu estilo'),'empty state');
 await shot('01-empty-1440-dark');
 // 2. Link placeholder: stores only the address, opens an honest "link only" study.
 await click('.er-empty button','Adicionar meu primeiro vídeo');
 await until(()=>js('Boolean(document.querySelector(".er-add"))'),'add panel');
 await click('.er-add .er-segmented button','Só um link');
 await set('.er-add input[type=url]','https://example.com/pipeline-de-dados');
 await field('.er-add','^Título','Diagrama animado — pipeline de dados (link)');
 await until(async()=>!(await js('document.querySelector(".er-add footer .primary-button").disabled')),'link save enabled');
 await click('.er-add footer button','Salvar e abrir');
 await until(()=>js('Boolean(document.querySelector(".er-link-only"))'),'link-only study');
 assert.equal((await snapshot()).references.length,1,'link persisted through the API');
 await click('.er-study-head .icon-button','Voltar');
 // 3. Managed video through the desktop bridge (host picker replaced by the fixture file).
 await until(()=>js('Boolean(document.querySelector(".er-add-button"))'),'library header');
 await click('.er-add-button','Adicionar referência');
 await field('.er-add','^Título','Diagrama animado — pipeline de dados');
 await set('.er-add textarea','Revelar um passo por vez, sincronizado com a fala.');
 await click('.er-add footer button','Escolher vídeo e salvar');
 await until(()=>js('Boolean(document.querySelector(".er-player video"))'),'player opened');
 await until(()=>js('document.querySelector(".er-player video").readyState>=1'),'video metadata from the managed copy');
 const duration=await js('document.querySelector(".er-player video").duration');assert.ok(duration>3.9&&duration<4.1,`duration ${duration}`);
 let refs=(await snapshot()).references;const videoRef=refs.find(r=>r.currentVersionId);assert.ok(videoRef,'video reference has a managed version');
 assert.equal(videoRef.title,'Diagrama animado — pipeline de dados','title applied after import');
 assert.match(videoRef.notes,/um passo por vez/);
 // Frame stepping (button + keyboard) and in/out marks.
 await click('.er-transport button','Próximo quadro');
 await until(async()=>/00:00\.03/.test(await text('.er-time b')),'one frame forward');
 await js('document.querySelector(".er-player").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
 await until(async()=>/00:00\.07/.test(await text('.er-time b')),'keyboard frame step');
 await js('document.querySelector(".er-player").dispatchEvent(new KeyboardEvent("keydown",{key:"i",bubbles:true}))');
 await set('.er-timeline input[type=range]','2');
 await click('.er-transport button','Marcar fim');
 await until(()=>has('.er-segments-head .er-pill','00:00\.07–00:02\.00'),'selection shown');
 await set('.er-mark-form input','A caixa cresce e desacelera');
 await click('.er-mark-form button','Quero aproveitar');
 await until(()=>has('.er-marker-list li.wanted','A caixa cresce'),'wanted marker listed');
 refs=(await snapshot()).references;assert.deepEqual(refs.find(r=>r.id===videoRef.id).markers.map(m=>[m.kind,m.text]),[['wanted','A caixa cresce e desacelera']],'marker saved with revision');
 // Analysis without a vision-capable agent: the screen explains instead of simulating.
 assert.equal(await has('.er-callout.warn','Nenhum agente com visão'),true,'honest no-vision state');
 assert.equal(await js('[...document.querySelectorAll(".er-analyze .primary-button")].length'),0,'no analyze button without a visual agent');
 await shot('02-study-no-agent-1440-dark');
 // 4. Seed one completed sampled analysis (fixture) and review it through the UI.
 const db=new DatabaseSync(dbPath);db.exec('PRAGMA busy_timeout=5000');
 const row=db.prepare('SELECT revision,data_json FROM editing_reference_libraries WHERE profile_id=? AND workspace_id=?').get(profile,ws);const data=JSON.parse(row.data_json);
 const ref=(await snapshot()).references.find(r=>r.id===videoRef.id);
 const obs=(id,text,start,end)=>({id,start,end,text,adaptation:`Adaptar: ${text}`,frameIds:[],limitations:['Curva exata não determinada; duração estimada pela contagem de quadros.']});
 data.analyses.push({id:'analysis-fixture',referenceId:ref.id,versionId:ref.currentVersionId,referenceRevision:ref.revision,providerId:'codex',agentId:'editor',status:'completed',mode:'motion',start:0,end:4,frames:[],coverage:{kind:'sampled',requested:[0,4],examined:[0.5,1,1.5,2,2.5],pending:[3.5]},
  observations:[obs('obs-1','A caixa cresce rápido e desacelera antes de parar.',0.3,0.9),obs('obs-2','Cada caixa aparece quando a narração cita a etapa.',1,2),obs('obs-3','Fundo azul-escuro com acentos verde-água.',0,4)],limitations:['Análise por amostragem.'],createdAt:at,updatedAt:at});
 db.prepare('UPDATE editing_reference_libraries SET revision=?,data_json=? WHERE profile_id=? AND workspace_id=?').run(row.revision+1,JSON.stringify(data),profile,ws);db.close();
 await js('location.hash="#usage"');await new Promise(r=>setTimeout(r,300));await js('location.hash="#references"');
 await until(()=>has('.er-pending b','3 aprendizados'),'pending review banner');
 await click('.er-pending button','Continuar revisão');
 await until(()=>js('Boolean(document.querySelector(".er-observation"))'),'observations listed');
 assert.equal(await js('document.querySelectorAll(".er-coverage-tick").length'),6,'coverage shows only examined + pending moments');
 assert.match(await text('.er-legend'),/5 quadros examinados.*1 pendentes.*Não examinado/);
 await click('.er-observation.open button','Revisar e aprovar');
 await set('.er-approve textarea','Na explicação de um processo, revelar um passo por vez, sincronizado com a fala.');
 await click('.er-approve button','Aprovar para meu estilo');
 await until(()=>has('.er-observation .er-obs-state.approved','Aprovada'),'approved');
 await click('.er-observation-head','Cada caixa aparece');
 await until(()=>js('[...document.querySelectorAll(".er-observation.open")].some(e=>/Cada caixa/.test(e.textContent))'),'obs 2 open');
 await js(`[...document.querySelectorAll(".er-observation.open")].find(e=>/Cada caixa/.test(e.textContent)).querySelector(".soft-button").click()`);
 await until(()=>has('.er-obs-state.keep','Só nesta referência'),'kept on reference');
 await click('.er-observation-head','Fundo azul');
 await js(`[...document.querySelectorAll(".er-observation.open")].find(e=>/Fundo azul/.test(e.textContent)).querySelector(".text-link").click()`);
 await until(()=>has('.er-obs-state.discard','Descartada'),'discarded');
 let snap=await snapshot();
 assert.deepEqual(snap.guidelines.map(g=>[g.text,g.source?.observationId]),[['Na explicação de um processo, revelar um passo por vez, sincronizado com a fala.','obs-1']]);
 assert.deepEqual(snap.analyses[0].observations.map(o=>o.decision??null).slice(1),['keep','discard']);
 await shot('03-study-reviewed-1440-dark');
 await setAppearance('light');await shot('04-study-reviewed-1440-light');await setAppearance('dark');
 // 5. Folders, sub-folders, move, filter, search, delete with undo.
 await click('.er-study-head .icon-button','Voltar');
 await until(()=>js('Boolean(document.querySelector(".er-folders"))'),'folder tree');
 await click('.er-folders-head button','Nova pasta');
 await set('.er-new-folder input','Motion');await click('.er-new-folder button','Criar');
 await until(()=>has('.er-folder','Motion'),'folder created');
 await click('.er-folder-tools button','Nova subpasta em Motion');
 await set('.er-new-folder input','Diagramas');await click('.er-new-folder button','Criar');
 await until(()=>has('.er-folder','Diagramas'),'sub-folder created');
 snap=await snapshot();const motion=snap.folders.find(f=>f.name==='Motion'),diagrams=snap.folders.find(f=>f.name==='Diagramas');assert.equal(diagrams.parentId,motion.id,'sub-folder parent');
 await js(`window.__set([...document.querySelectorAll(".er-card")].find(c=>/pipeline de dados$/.test(c.querySelector("b").textContent)).querySelector(".er-card-move select"),${JSON.stringify(diagrams.id)})`);
 await until(async()=>(await snapshot()).references.find(r=>r.id===videoRef.id).folderId===diagrams.id,'moved into sub-folder');
 await click('.er-folder','^\\s*Motion');
 await until(async()=>(await js('document.querySelectorAll(".er-card").length'))===1,'parent folder shows sub-folder content');
 await click('.er-folder','Sem pasta');
 await until(()=>has('.er-card b','\\(link\\)'),'no-folder filter');
 await click('.er-folder','Todas as referências');
 await set('.er-search input','pipeline de dados (link');
 await until(async()=>(await js('document.querySelectorAll(".er-card").length'))===1,'search');
 await set('.er-search input','');
 await click('.er-folder-tools button','Excluir a pasta Motion');
 await until(()=>js('Boolean(document.querySelector(".er-toast"))'),'undo toast');
 assert.match(await text('.er-toast'),/Sem pasta/);
 await until(async()=>!(await snapshot()).folders.some(f=>f.name==='Motion'),'folder deleted');
 await click('.er-toast button','Desfazer');
 await until(async()=>{const s=await snapshot();const m=s.folders.find(f=>f.name==='Motion');const d=s.folders.find(f=>f.name==='Diagramas');return m&&d&&d.parentId===m.id&&s.references.find(r=>r.id===videoRef.id).folderId===d.id;},'folder restored with its references');
 await shot('05-library-1440-dark');
 // 6. Meu estilo: approved guidance, manual guidance, pause, edit with history.
 await click('.er-views button','Meu estilo');
 await until(()=>has('.er-guideline p','um passo por vez'),'approved guideline listed');
 await set('#er-manual-guideline','Cortes secos nas trocas de assunto.');await click('.er-manual button','Adicionar');
 await until(()=>has('.er-guideline p','Cortes secos'),'manual guideline');
 await js(`[...document.querySelectorAll(".er-guideline")].find(e=>/Cortes secos/.test(e.textContent)).querySelector('input[role=switch]').click()`);
 await until(async()=>(await snapshot()).guidelines.find(g=>/Cortes secos/.test(g.text))?.enabled===false,'guideline paused');
 await js(`[...document.querySelectorAll(".er-guideline")].find(e=>/um passo por vez/.test(e.textContent)).querySelector('.er-guideline-meta .text-link:last-of-type').click()`);
 await until(()=>js('Boolean(document.querySelector(".er-guideline form textarea"))'),'edit form');
 await set('.er-guideline form textarea','Na explicação de um processo, revelar um passo por vez com a fala.');
 await click('.er-guideline form button','Salvar nova versão');
 await until(async()=>(await snapshot()).guidelines.find(g=>g.source?.observationId==='obs-1')?.history.length>=2,'versioned edit');
 await shot('06-style-1440-dark');
 // 7. Kit de motion: engine not prepared is explained; a study is created but cannot render until the engine is ready.
 await click('.er-views button','Kit de motion');
 await until(()=>js('Boolean(document.querySelector(".er-engine"))'),'engine status');
 const engineState=(await snapshot()).engine.status;
 if(engineState==='not-configured')assert.match(await text('.er-engine'),/não preparado.*Preparar motor/s);
 await click('.er-section-head button','Novo estudo');
 await field('.er-study-form','Nome do estudo','Diagrama de passos · entrada curta');
 await field('.er-study-form','Título na tela','Como funciona um cache');
 await set('.er-study-form textarea','Pedido\nCache\nResposta');
 await click('.er-study-form button','Criar estudo');
 await until(()=>has('.er-study-card b','entrada curta'),'study created');
 snap=await snapshot();assert.equal(snap.studies.length,1);assert.equal(snap.studies[0].spec.text,'Pedido\nCache\nResposta');
 if(engineState!=='ready')assert.equal(await js('[...document.querySelectorAll(".er-study-card button")].find(b=>/Gerar prévia/.test(b.textContent)).disabled'),true,'render waits for the engine');
 await shot('07-kit-1440-dark');
 // 8. Studio project knowledge: attach and read what the agent receives.
 const attach=await js(`fetch('/api/content/editing-references?profile=${profile}&workspaceId=${ws}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'project.attach',contentId:'content-cache',referenceIds:[${JSON.stringify(videoRef.id)}],expectedRevision:0})}).then(r=>r.status)`);
 assert.equal(attach,200,'project.attach accepted');
 const project=(await snapshot()).projects?.find(p=>p.contentId==='content-cache');
 assert.deepEqual(project?.referenceIds,[videoRef.id],'attached selection is readable from the snapshot');
 const manifest=await js(`fetch('/api/content/editing-references/context?profile=${profile}&workspaceId=${ws}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({referenceIds:[${JSON.stringify(videoRef.id)}]})}).then(r=>r.json())`);
 assert.match(manifest.text,/um passo por vez com a fala/,'manifest carries the approved (edited) guidance');
 assert.doesNotMatch(manifest.text,/Cortes secos/,'paused guidance stays out');
 // 9. Widths 880 and 360, light, then English.
 for(const [w,h] of [[880,900],[360,780]]){await open('references',w,h);await click('.er-views button','Referências');await until(()=>js('Boolean(document.querySelector(".er-card"))'),`library at ${w}`);
  assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth+1'),true,`no horizontal scroll at ${w}`);await shot(`08-library-${w}-dark`);await setAppearance('light');await shot(`09-library-${w}-light`);}
 store.write(profile,'language','en-US');await open('references',1440,1000);
 await until(()=>has('.er-head h1','Editing references'),'English');
 await until(()=>js('Boolean(document.querySelector(".er-card"))'),'English library');
 assert.equal(await has('.er-views button','My style'),true);
 await shot('10-library-1440-en');
 // Keyboard: the section switcher and cards are reachable buttons.
 assert.equal(await js('[...document.querySelectorAll(".er-views button,.er-card-open")].every(b=>b.tabIndex>=0)'),true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,out,engine:engineState}));
 await bridge.close?.();server.close();app.exit(0);
}catch(error){console.error(error);try{await shot('failure');}catch{}console.error(JSON.stringify({ok:false,out,errors}));app.exit(1);}
});
