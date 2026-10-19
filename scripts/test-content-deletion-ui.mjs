// Local content deletion in the REAL renderer with the REAL desktop preload, IPC, SQLite state store and content bridge.
// Fixture data only (temporary folder): nothing personal is read or deleted. Provider calls are simulated; nothing external.
// Run: npx electron scripts/test-content-deletion-ui.mjs   (renderer from MAINSAGENTS_UI_DIST, default dist)
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,extname,sep,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {createContentWorkflowBridge} from '../content-workflow-bridge.mjs';
import {registerContentDeletionIpc} from '../content-deletion-ipc.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.mainsagents-workspaces/content-deletion-ui',String(Date.now()));mkdirSync(out,{recursive:true});
app.setPath('userData',resolve(out,'electron'));app.on('window-all-closed',()=>{});
const profile='deletion-ui',ws='space',at='2026-10-15T10:00:00.000Z',dbPath=join(out,'workspace-state.sqlite'),raw=join(out,'gravacao-bruta.mp4');writeFileSync(raw,'RAW');
const agent=(id,name,role)=>({id,name,role,instructions:'Fixture',description:'Fixture',skills:[],workspaceId:ws,providerId:'codex',tools:['files'],status:'idle',createdAt:at,updatedAt:at});
const agents=[agent('source','Editor de Conteúdo','Conteúdo'),agent('editor','Editor de Vídeo','Vídeo')];
const msg=(id,content,role='user')=>({id,type:'message',role,content,createdAt:at});
const chat=(id,agentId,title,contentId,messages=[msg(`${id}-1`,`Mensagem de ${title}`)])=>({id,agentId,providerId:'codex',title,...(contentId?{contentId,topicId:`topic-${contentId}`}:{}),messages,createdAt:at,updatedAt:at});
const content=(id,title)=>({id,workspaceId:ws,topicId:`topic-${id}`,title,format:'short-video',platforms:['LinkedIn'],status:'planning',taskId:`task-${id}`,createdAt:at,updatedAt:at});
const run=(id,contentId,roles)=>({id,profileId:profile,workspaceId:ws,contentId,topicId:`topic-${contentId}`,flowId:'flow',name:'Fluxo de conteúdo',stage:'blocked',error:'Parada de teste (fixture).',revision:1,epoch:1,scriptMode:'local',language:'pt-BR',timeZone:'America/Sao_Paulo',events:[],
 sourceAgent:agents[0],editorAgent:agents[1],publisherAgent:agents[0],sourceSession:chat(roles[0],'source','Fluxo de conteúdo',contentId,[msg(`production:${id}:1`,'Roteiro gerado','agent')]),editorSession:chat(roles[1],'editor','Fluxo de conteúdo · edição',contentId,[msg(`production:${id}:2`,'Edição pendente','agent')]),createdAt:at,updatedAt:at});
const flow={id:'flow',workspaceId:ws,name:'Fluxo de conteúdo',nodes:[{id:'content-box',kind:'content-agent',title:'Agente de conteúdo',agentId:'source',position:{x:80,y:140}},{id:'editor-box',kind:'video-agent',title:'Editor de vídeo',agentId:'editor',position:{x:430,y:140}}],edges:[{id:'e1',source:'content-box',target:'editor-box',kind:'sequence'}],createdAt:at,updatedAt:at};
const sessions=[chat('a-source','source','Linkedin','content-a'),chat('a-editor','editor','Linkedin','content-a'),chat('a-run-src','source','Fluxo de conteúdo','content-a',[msg('production:run-a:1','Roteiro gerado','agent')]),chat('a-run-ed','editor','Fluxo de conteúdo · edição','content-a',[msg('production:run-a:2','Edição pendente','agent')]),
 chat('b-source','source','Linkedin','content-b'),chat('b-editor','editor','Linkedin','content-b'),chat('c-run-src','source','Fluxo de conteúdo','content-c',[msg('production:run-c:1','Roteiro gerado','agent')]),chat('c-run-ed','editor','Fluxo de conteúdo · edição','content-c',[msg('production:run-c:2','Edição pendente','agent')]),
 chat('general','source','Linkedin'),chat('loose','source','Ideias soltas')];
let store=createDesktopStateStore(out,'ui-test');
store.initialize(profile,{agents,workspaces:[{id:ws,name:'Conteúdo',createdAt:at,updatedAt:at}],sessions,'current-workspace':ws,'active-sessions':{source:'a-source',editor:'a-editor'},language:'pt-BR','welcome-dismissed':true,'focus-mode':false,
 'production-flows':{schemaVersion:1,flows:[flow],activeByWorkspace:{[ws]:'flow'}},'content-scopes':{schemaVersion:1,selected:{[ws]:'content:content-a'},active:{[JSON.stringify([ws,'source','content:content-a'])]:'a-source'}},
 'chat-drafts':{[JSON.stringify(['source','a-source'])]:{text:'RASCUNHO_A',skill:null},[JSON.stringify(['source','b-source'])]:{text:'RASCUNHO_B',skill:null}}});
store.selectProfile(profile);
const bridgeOptions={dbPath,getCurrentProfile:()=>store.currentProfile(),getAgents:p=>store.read(p,'agents'),getFlows:p=>store.read(p,'production-flows'),getSessions:p=>store.read(p,'sessions'),getRuntime:()=>null};
let bridge=createContentWorkflowBridge(bridgeOptions);
const seed=new DatabaseSync(dbPath);seed.exec('PRAGMA busy_timeout=5000');
seed.prepare('INSERT INTO editorial_state VALUES(?,?,?,?)').run(profile,1,JSON.stringify({schemaVersion:1,topics:[{id:'topic-content-a',workspaceId:ws,contentId:'content-a',title:'Linkedin',requestId:'r',inputKind:'text',input:'x',priority:'normal',status:'approved',createdAt:at,updatedAt:at}],
 contents:[content('content-a','Linkedin'),content('content-b','Linkedin'),content('content-c','Legenda avulsa')],artifacts:[],approvals:[],runs:[],assets:[],publications:[]}),at);
const putRun=value=>seed.prepare('INSERT INTO production_runs VALUES(?,?,?,?,?,?,?)').run(value.id,profile,ws,value.contentId,1,JSON.stringify(value),at);
putRun(run('run-a','content-a',['a-run-src','a-run-ed']));putRun(run('run-c','content-c',['c-run-src','c-run-ed']));
seed.prepare('INSERT INTO content_srt_documents VALUES(?,?,?,?,?)').run(profile,'srt-c','content-c',JSON.stringify({id:'srt-c',contentId:'content-c',workspaceId:ws,title:'Legenda',versions:[],source:{kind:'text'}}),at);
const rawStat=statSync(raw).mtimeMs;
// A backup file exported BEFORE any deletion (same format as Settings → Export backup).
const preDeletion=store.workspaceSnapshot(profile),backupFile=JSON.stringify({format:'mainsagents-backup',version:1,exportedAt:at,data:preDeletion.values,editorial:preDeletion.editorial.state,execution:preDeletion.execution,recovery:false,fileManifest:[]});
// The same IPC the installed app registers (desktop-main.mjs): state store + content deletion, sender-bound.
let win;const trusted=event=>event.sender===win?.webContents;
ipcMain.handle('state:getProfile',event=>{assert(trusted(event));return store.currentProfile();});
ipcMain.on('state:profile',event=>{event.returnValue=trusted(event)?store.currentProfile():undefined;});
ipcMain.on('state:writeSync',(event,p,key,value,revision)=>{try{assert(trusted(event));if(p!==store.currentProfile())throw Error('profile');event.returnValue={saved:true,...store.write(p,key,value,revision)};}catch(error){event.returnValue={saved:false,error:error.message};}});
ipcMain.handle('state:checkpoint',()=>store.recoverySnapshot());
for(const operation of ['hasProfile','initialize','read','write','readAll','readAllVersioned','replaceAll'])ipcMain.handle(`state:${operation}`,(event,...args)=>{assert(trusted(event));return store[operation](...args);});
registerContentDeletionIpc({ipcMain,isTrustedSender:trusted,getStore:()=>store,getDeletion:()=>bridge.deletion});
// Backup restore exactly as desktop-main.mjs registers it (recovery snapshot first, then the transactional restore).
ipcMain.handle('account:status',()=>({configured:false,signedIn:false}));ipcMain.handle('account:google-configured',()=>false);
ipcMain.handle('backup:snapshot',event=>{assert(trusted(event));return store.workspaceSnapshot(store.currentProfile());});
ipcMain.handle('backup:files',(event,paths)=>{assert(trusted(event));return paths.map(path=>({path,available:true}));});
ipcMain.handle('backup:restore',(event,values,editorial,expected,execution)=>{assert(trusted(event));store.recoverySnapshot();return store.restoreWorkspace(store.currentProfile(),values,editorial,expected,execution);});
const json=(response,value)=>{response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const server=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/codex/')){if(path.endsWith('/health'))return json(response,{ready:true,status:'connected',accountType:'chatgpt'});if(path.endsWith('/models'))return json(response,{models:[]});if(path.endsWith('/usage'))return json(response,{rateLimits:null});return json(response,{events:[]});}
 if(await bridge.handle(request,response,url))return;if(path.startsWith('/api/'))return json(response,{});
 try{const dist=resolve(root,process.env.MAINSAGENTS_UI_DIST??'dist'),file=resolve(dist,path==='/'?'app.html':path.slice(1));assert(file.startsWith(dist+sep));response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');response.end(readFileSync(file));}catch{response.statusCode=404;response.end();}});
const errors=[],js=code=>win.webContents.executeJavaScript(code);
async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error(`Content deletion UI timed out: ${label}`);}
async function shot(name){writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));}
const key=async(keyCode,extra={})=>{win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode,...extra});if(keyCode==='Return')win.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});win.webContents.sendInputEvent({type:'keyUp',keyCode,...extra});await new Promise(r=>setTimeout(r,80));};
const active=()=>js('(document.activeElement?.getAttribute("aria-label")||document.activeElement?.textContent||"").trim()');
const ids=()=>store.read(profile,'sessions').map(s=>s.id).sort();
const dialogText=()=>js('document.querySelector(".flow-dialog")?.textContent??""');
async function open(width=1440,height=1000){
 win=new BrowserWindow({show:false,width,height,webPreferences:{preload:resolve(root,'desktop-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component|Failed to persist/.test(event.message))errors.push(event.message);});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html`);
 await until(()=>js(`Boolean(document.querySelector('.agent-nav[title="Editor de Conteúdo"]'))`),'app ready');
 await js(`document.querySelector('.agent-nav[title="Editor de Conteúdo"]').click()`);
 await until(()=>js('Boolean(document.querySelector(".content-scope-picker"))'),'chat panel');
}
async function openDeleteFromScopeBar(){
 await until(()=>js('Boolean(document.querySelector(".content-scope-row .content-actions button"))'),'actions menu');
 await js('document.querySelector(".content-scope-row .content-actions button").focus()');await key('Return');
 await until(()=>js('document.activeElement?.getAttribute("role")==="menuitem"'),'menu item focused');
 await key('Return');await until(()=>js('Boolean(document.querySelector(".content-deletion footer .danger-button:not(:disabled)"))'),'dialog ready');
}
app.whenReady().then(()=>server.listen(0,'127.0.0.1',async()=>{
 try{
  await open();
  await until(()=>js(`document.querySelector('.content-scope-picker .select-menu-value')?.textContent==='Linkedin'`),'content A selected');
  await shot('01-scope-bar-light');
  // Keyboard only: open the "…" menu, then the dialog; focus starts on Cancel; Escape cancels without deleting anything.
  const before=JSON.stringify(store.readAll(profile));
  await openDeleteFromScopeBar();
  assert.equal(await active(),'Cancelar','initial focus on Cancel, never on the destructive button');
  const text=await dialogText();
  assert.match(text,/Excluir “Linkedin”\?/);assert.match(text,/4 conversas/);assert.match(text,/Editor de Conteúdo · 2 conversas/);assert.match(text,/Editor de Vídeo · 2 conversas/);assert.match(text,/1 produção/);
  assert.match(text,/arquivos no disco/);assert.match(text,/Nada é cancelado no provedor/);
  await shot('02-dialog-light');
  await key('Escape');await until(()=>js('!document.querySelector(".flow-dialog")'),'closed by Escape');
  assert.equal(JSON.stringify(store.readAll(profile)),before,'cancel changes nothing');
  // Confirm: one final confirmation deletes content A and its 4 chats, nothing else.
  await openDeleteFromScopeBar();
  await js('document.querySelector(".content-deletion footer .danger-button").click()');
  await until(()=>js('!document.querySelector(".flow-dialog")'),'dialog closed after delete');
  assert.deepEqual(ids(),['b-editor','b-source','c-run-ed','c-run-src','general','loose']);
  assert.equal(bridge.production.list(profile).some(r=>r.contentId==='content-a'),false);
  assert.equal(await js(`document.querySelector('.content-scope-picker .select-menu-value')?.textContent`),'Geral');
  await until(()=>js('document.activeElement?.closest(".content-scope-picker")!==null'),'focus on the content picker');
  assert.equal(Object.values(store.read(profile,'chat-drafts')).map(d=>d.text).join(),'RASCUNHO_B');
  // Several production/native polls later nothing reappeared, in storage or on screen.
  await new Promise(r=>setTimeout(r,3500));
  assert.deepEqual(ids(),['b-editor','b-source','c-run-ed','c-run-src','general','loose']);
  await js(`document.querySelector('.content-scope-picker .select-menu-trigger').click()`);await until(()=>js('document.querySelectorAll("[role=listbox] .select-menu-option").length>0'),'picker list');
  const options=await js(`Array.from(document.querySelectorAll('[role=listbox] .select-menu-option-copy b')).map(el=>el.textContent)`);await key('Escape');
  assert.equal(options.filter(title=>title==='Linkedin').length,1,`only content B (same title) remains: ${options}`);assert.equal(options.includes('Legenda avulsa'),true);
  await shot('03-after-delete-light');
  // Sessions page: a production chat points to deleting the whole content; an ordinary chat deletes after a real confirmation.
  await js('location.hash="sessions"');await until(()=>js('Boolean(document.querySelector(".content-space-grid"))'),'sessions page');
  await js(`Array.from(document.querySelectorAll('.content-space-box')).find(el=>el.textContent.includes('Legenda avulsa')).click()`);
  await until(()=>js(`Array.from(document.querySelectorAll('.conversation-open b')).some(el=>el.textContent==='Fluxo de conteúdo')`),'C chats listed');
  await js(`(()=>{const row=Array.from(document.querySelectorAll('.conversation-open')).find(el=>el.querySelector('b').textContent==='Fluxo de conteúdo').closest('article');row.querySelector('button[aria-label^="Excluir"],button[title^="Excluir"],button[aria-label^="Delete"]')?.click();})()`);
  await until(()=>js(`document.body.textContent.includes('Conduz a produção deste conteúdo')`),'role guidance');
  await shot('04-role-chat-guidance');
  await js(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Excluir conteúdo inteiro…').click()`);
  await until(()=>js('Boolean(document.querySelector(".content-deletion footer .danger-button:not(:disabled)"))'),'C dialog');
  assert.match(await dialogText(),/Excluir “Legenda avulsa”\?/);assert.match(await dialogText(),/1 documento SRT/);
  await js('document.querySelector(".content-deletion footer .danger-button").click()');
  await until(()=>js('!document.querySelector(".flow-dialog")'),'C deleted');
  assert.deepEqual(ids(),['b-editor','b-source','general','loose']);
  assert.equal(new DatabaseSync(dbPath).prepare("SELECT COUNT(*) n FROM content_srt_documents WHERE content_id='content-c'").get().n,0);
  await until(()=>js(`document.activeElement?.classList.contains('content-space-box')`),'focus on General box');
  await until(()=>js(`document.querySelector('.content-deletion-status')?.textContent.includes('Legenda avulsa')`),'announced');
  // Ordinary General chat.
  await js(`Array.from(document.querySelectorAll('.content-space-box')).find(el=>el.classList.contains('kind-general')).click()`);
  await until(()=>js(`Array.from(document.querySelectorAll('.conversation-open b')).some(el=>el.textContent==='Ideias soltas')`),'general listed');
  await js(`(()=>{const row=Array.from(document.querySelectorAll('.conversation-open')).find(el=>el.querySelector('b').textContent==='Ideias soltas').closest('article');Array.from(row.querySelectorAll('button')).find(b=>/Excluir|Delete/.test(b.getAttribute('aria-label')??b.title??'')).click();})()`);
  await until(()=>js(`document.body.textContent.includes('Excluir histórico?')`),'confirm row');
  await js(`(()=>{const row=Array.from(document.querySelectorAll('.conversation-open')).find(el=>el.querySelector('b').textContent==='Ideias soltas').closest('article');Array.from(row.querySelectorAll('.danger-button')).find(b=>b.textContent.trim()==='Excluir').click();})()`);
  await until(()=>!ids().includes('loose'),'loose deleted');await new Promise(r=>setTimeout(r,1500));assert.equal(ids().includes('loose'),false);
  // Dark theme + narrow window + keyboard on the remaining content B (opened and canceled, never deleted).
  win.setSize(420,860);await js(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Escuro')?.click()`);await until(()=>js('document.documentElement.dataset.appearance==="dark"'),'dark theme');
  await js(`Array.from(document.querySelectorAll('.content-space-cell')).find(el=>el.textContent.includes('Linkedin')&&el.querySelector('.content-actions')).querySelector('.content-actions button').click()`);
  await until(()=>js('document.activeElement?.getAttribute("role")==="menuitem"'),'B menu');await key('Return');
  await until(()=>js('Boolean(document.querySelector(".content-deletion footer .danger-button:not(:disabled)"))'),'B dialog');
  assert.match(await dialogText(),/2 conversas/);
  const overflow=await js('document.documentElement.scrollWidth>innerWidth+1||document.querySelector(".flow-dialog").scrollWidth>document.querySelector(".flow-dialog").clientWidth+1');assert.equal(overflow,false,'no horizontal overflow at 420px');
  await shot('05-dialog-dark-narrow');
  await key('Tab');await key('Tab');await key('Tab');assert.ok((await js('Boolean(document.activeElement?.closest(".flow-dialog"))')),'focus stays inside the dialog');
  await key('Escape');await until(()=>js('!document.querySelector(".flow-dialog")'),'B canceled');assert.ok(ids().includes('b-source'));
  // Restart: services and storage reopen from disk; deleted contents and chats stay gone.
  win.destroy();await bridge.close();store.close();store=createDesktopStateStore(out,'ui-test-2');bridge=createContentWorkflowBridge(bridgeOptions);
  await open();await new Promise(r=>setTimeout(r,2500));
  assert.deepEqual(ids(),['b-editor','b-source','general']);
  assert.equal(bridge.production.list(profile).length,0);
  assert.equal(readFileSync(raw,'utf8'),'RAW');assert.equal(statSync(raw).mtimeMs,rawStat,'raw file untouched');
  await shot('06-after-restart');
  // Settings → import the pre-deletion backup (replace): it restores, says what stayed deleted, and nothing comes back.
  const feedbackText=()=>js(`Array.from(document.querySelectorAll('.settings-feedback[role=status]')).map(el=>el.textContent).join(' ')`);
  await js('location.hash="settings"');await until(()=>js(`Boolean(Array.from(document.querySelectorAll('.settings-nav button')).find(el=>el.textContent.includes('Dados e backup')))`),'settings page');
  await js(`Array.from(document.querySelectorAll('.settings-nav button')).find(el=>el.textContent.includes('Dados e backup')).click()`);
  await until(()=>js(`Boolean(document.querySelector('input[type=file][accept*="json"]'))`),'backup input');
  await js(`(()=>{const input=document.querySelector('input[type=file][accept*="json"]'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(backupFile)}],'backup.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(async()=>(await feedbackText()).length>0||js(`Boolean(Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Substituir dados locais'&&!el.disabled))`),'backup selected');
  assert.equal(await feedbackText(),'','the backup parses');
  await js(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Substituir dados locais').click()`);
  await until(async()=>/continuam excluídos|Error|rro/.test(await feedbackText()),'restore explained');
  const feedback=await feedbackText();
  assert.match(feedback,/2 conteúdo\(s\) e 7 conversa\(s\) que você excluiu neste computador continuam excluídos/,feedback);
  await shot('07-restore-explained');
  await until(()=>js('Boolean(document.querySelector(".agent-nav"))&&!document.querySelector(".settings-feedback")'),'reloaded after restore');
  await new Promise(r=>setTimeout(r,2000));
  assert.deepEqual(ids(),['b-editor','b-source','general'],'deleted chats (of the contents and the single chat) stay deleted');
  const check=new DatabaseSync(dbPath);
  assert.deepEqual(JSON.parse(check.prepare('SELECT state_json FROM editorial_state WHERE profile_id=?').get(profile).state_json).contents.map(c=>c.id),['content-b']);
  assert.equal(bridge.production.list(profile).length,0);
  assert.deepEqual(check.prepare('SELECT content_id,status FROM content_tombstones ORDER BY content_id').all().map(row=>`${row.content_id}:${row.status}`),['content-a:deleted','content-c:deleted'],'tombstones survive the restore');
  check.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,out}));
  await bridge.close();server.close();app.exit(0);
 }catch(error){console.error(error);try{await shot('failure');}catch{}console.error(JSON.stringify({ok:false,out,errors}));app.exit(1);}
}));
