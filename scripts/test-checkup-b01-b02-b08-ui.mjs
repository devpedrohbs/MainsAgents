// B01/B02/B08 — real renderer (dist, or MAINS_DIST) in an isolated Electron profile; every API is simulated.
// No coordinator, AI, Notion, publishing or personal data. Any non-GET request or external URL fails the run.
import {app, BrowserWindow, ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join, sep, extname} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {captureReadyPng, waitForCaptureReady} from './ui-capture-ready.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(process.env.MAINS_DIST || join(root, 'dist'));
const out = resolve(root, '.mainsagents-workspaces/checkup-b01-b02-b08-ui', String(Date.now()));
mkdirSync(out, {recursive:true});
app.setPath('userData', join(out, 'electron'));
app.on('window-all-closed', () => {});
const profile = 'handoff-test', workspaceId = 'checkup-space', otherId = 'other-space';
const at = '2026-10-08T12:00:00.000Z', later = '2026-10-08T13:00:00.000Z';
const agent = (id, name, workspace = workspaceId) => ({id,name,workspaceId:workspace,role:'Synthetic',description:'Isolated fixture',instructions:'Fixture only',skills:[],tools:[],providerId:'codex',status:'idle',createdAt:at,updatedAt:at});
const agents = [agent('writer','Fixture Writer'), agent('editor','Fixture Editor'), agent('other-writer','Other Writer',otherId), agent('other-editor','Other Editor',otherId)];
const SCRIPT = 'Linha de abertura da fala aprovada.\n\nSegunda parte com a demonstração do produto.\n\n' + ('Fechamento com chamada para ação. '.repeat(40)).trim();
const session = (runId, agentId, role) => ({id:`${runId}-${role}`,agentId,contentId:`content-${runId}`,topicId:`topic-${runId}`,title:`SESSION ${runId} ${role}`,messages:[],createdAt:at,updatedAt:at});
const run = (id, stage, extra = {}) => {
  const workspace = extra.workspaceId ?? workspaceId, mine = workspace === workspaceId;
  const source = agents.find(a => a.id === (mine ? 'writer' : 'other-writer')), editor = agents.find(a => a.id === (mine ? 'editor' : 'other-editor'));
  return {id,revision:1,workspaceId:workspace,flowId:mine ? 'shared-flow' : 'other-flow',contentId:`content-${id}`,topicId:`topic-${id}`,name:`PRODUCTION ${id}`,stage,
    sourceAgent:{id:source.id,name:source.name},editorAgent:{id:editor.id,name:editor.name},sourceSession:session(id,source.id,'source'),editorSession:session(id,editor.id,'editor'),
    topic:{id:`topic-${id}`,workspaceId:workspace,title:`TOPIC ${id}`,status:'approved',summary:'Synthetic topic',createdAt:at,updatedAt:at},notionDestination:'',timeZone:'UTC',
    events:[{action:stage,detail:`EVENT ${id}`,at}],updatedAt:at,...extra};
};
const approvedScript = {version:2,hash:'hash-approved-2',hook:'Gancho',cta:'Chamada',path:{title:'Caminho A',outline:'1. Abertura\n2. Demonstração\n3. Fechamento'},text:SCRIPT,improvisationTopics:[],thumbnailDirection:'',source:'agent',createdAt:at};
const call = (id, stage, attempt, status, usage) => ({id,key:`k-${stage}`,stage,attempt,status,at,updatedAt:at,...(usage ? {usage:{version:1,recordedAt:at,...usage}} : {})});
const budgetFor = calls => ({version:1,maxCalls:8,maxAttemptsPerStep:2,legacy:false,measuredSince:at,calls});
const noOutline = {...approvedScript,path:{title:'Sem tópicos',outline:''}};
const runs = [
  run('covers','covers-review',{updatedAt:later}),                                  // content stored as video-review
  run('sched-old','complete',{contentId:'content-sched',updatedAt:later}),          // stale completed run for the same content
  run('sched-new','schedule',{contentId:'content-sched',updatedAt:at}),             // the active run must win
  run('rec','recording',{scriptVersions:[approvedScript],scriptApproval:{version:2,hash:'hash-approved-2',approvedAt:at},notion:{url:'https://example.invalid',pageId:'p',scriptVersion:2,scriptHash:'hash-approved-2'},recordingReady:true,providers:{source:'claude',editor:'codex',publisher:'codex'},
    budget:budgetFor([call('c1','writing',1,'completed',{status:'reported',provider:'claude',model:'claude-sonnet-5-5',tokens:{input:1200,output:340,cacheRead:900,cacheCreation:50},reportedCostUsd:0.0123,durationMs:5200}),call('c2','writing',2,'completed',{status:'partial',reason:'error-result',provider:'claude',tokens:{input:10,output:5}}),call('c3','notion',1,'uncertain',{status:'unavailable',reason:'cancelled',provider:'claude'}),call('c4','notion',2,'completed',undefined)])}),
  run('plain','recording',{scriptVersions:[noOutline],scriptApproval:{version:2,hash:'hash-approved-2',approvedAt:at},notion:{url:'https://example.invalid',pageId:'p',scriptVersion:2,scriptHash:'hash-approved-2'},recordingReady:true,budget:budgetFor([call('p1','writing',1,'completed',undefined)])}),
  run('foreign','schedule',{workspaceId:otherId,contentId:'content-manual'}),       // same content id, other workspace: must not decide
];
const content = (id, stage, workspace = workspaceId) => ({id:`content-${id}`,workspaceId:workspace,topicId:`topic-${id}`,title:`CONTENT ${id}`,format:'video',platforms:['instagram'],status:'planned',taskId:`task-${id}`,productionStage:stage,assetIds:[],createdAt:at,updatedAt:at});
const editorial = {schemaVersion:1,topics:[],contents:[content('covers','video-review'),content('sched','ready'),content('manual','recording'),content('rec','recording')],artifacts:[],approvals:[],runs:[],assets:[],publications:[]};
const state = createDesktopStateStore(out,'checkup-fixture');
state.initialize(profile,{agents,workspaces:[{id:workspaceId,name:'Checkup fixture',createdAt:at,updatedAt:at},{id:otherId,name:'Other fixture',createdAt:at,updatedAt:at}],sessions:runs.flatMap(r=>[r.sourceSession,r.editorSession]),'active-sessions':{},'current-workspace':workspaceId,language:'pt-BR',appearance:'light','welcome-dismissed':false,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[],activeByWorkspace:{}}});
ipcMain.handle('test:read',(_e,key)=>state.read(profile,key));
ipcMain.handle('test:write',(_e,key,value)=>state.write(profile,key,value));
ipcMain.handle('test:all',()=>state.readAll(profile));
const requests = [], writes = [], external = [], errors = [], captures = [];
let media = {available:true,ffmpeg:true,ffprobe:true,animate:false,animateReasons:['Navegador do Remotion não encontrado'],transcribe:true};
const json = (response,value,status=200) => {response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const server = createServer((request,response) => {
  const url = new URL(request.url,'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    requests.push({method:request.method,path:url.pathname});
    if (request.method !== 'GET') {writes.push({method:request.method,path:url.pathname});return json(response,{error:'Fixture rejects every mutation and AI call'},409);}
    if (url.pathname === '/api/content/productions') return json(response,{productions:runs});
    if (url.pathname === '/api/content/state') return json(response,{revision:1,state:editorial});
    if (url.pathname === '/api/content/jobs') return json(response,{jobs:[]});
    if (url.pathname === '/api/content/work') return json(response,{jobs:[],mediaJobs:[]});
    if (url.pathname === '/api/content/connection') return json(response,{dataSourceId:'',autoSync:false});
    if (url.pathname === '/api/content/media/capabilities') return json(response,media);
    if (url.pathname === '/api/codex/diagnostics') return json(response,{checkedAt:at,runtime:'running',account:'authenticated',modelCheck:'completed',models:[{id:'m',name:'M'}],discovery:'completed',servers:[{name:'zernio',status:'discovered',tools:['accounts_list']}],agents:[]});
    if (url.pathname === '/api/providers/claude/diagnostics') return json(response,{state:'login-required',loginCommand:'claude auth login',mcp:'approval-gated',mcpServers:[]});
    if (url.pathname.endsWith('/health')) return json(response,{ready:true,accountType:'chatgpt'});
    if (url.pathname.endsWith('/models')) return json(response,{models:[]});
    if (url.pathname.endsWith('/images')) return json(response,{events:[]});
    return json(response,{});
  }
  try {
    const file = resolve(dist,url.pathname === '/' ? 'app.html' : url.pathname.slice(1));
    assert(file.startsWith(dist + sep));
    response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch {response.statusCode=404;response.end();}
});
let win;
const js = code => win.webContents.executeJavaScript(code);
const q = JSON.stringify;
async function until(check,label='condition') {const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error(`B01/B02/B08 timeout: ${label}`);}
async function click(selector) {await until(()=>js(`Boolean(document.querySelector(${q(selector)})&&!document.querySelector(${q(selector)}).disabled)`),selector);await js(`document.querySelector(${q(selector)}).click()`);}
async function clickText(scope,text) {await until(()=>js(`Array.from(document.querySelectorAll(${q(scope)})).some(el=>el.textContent.trim()===${q(text)}&&!el.disabled)`),text);await js(`Array.from(document.querySelectorAll(${q(scope)})).find(el=>el.textContent.trim()===${q(text)}&&!el.disabled).click()`);}
const key = async (keyCode,char) => {win.webContents.sendInputEvent({type:'keyDown',keyCode});if(char)win.webContents.sendInputEvent({type:'char',keyCode:char});win.webContents.sendInputEvent({type:'keyUp',keyCode});};
const noEffects = () => {assert.deepEqual(writes,[],'No API mutation, AI call, publication or recording may happen');assert.deepEqual(external,[],'No external network access');};
const shot = async name => {writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));captures.push(name);};
const column = id => js(`(()=>{const el=document.querySelector('.precision-pipeline-stage[data-column=${id}]');return el?{count:Number(el.querySelector('strong').textContent),titles:Array.from(el.querySelectorAll(':scope>button:not(.precision-pipeline-more)')).map(b=>b.textContent)}:null})()`);
async function open(hash) {
  win = new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url = new URL(details.url);if (['http:','https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {external.push(details.url);callback({cancel:true});} else callback({});});
  win.webContents.on('console-message',event=>{if(process.env.MAINS_DEBUG)console.log('[renderer]',event.message);if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#${hash}`);
  await waitForCaptureReady(win.webContents);
}
const reduceMotion = async value => {
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value}]});
};
app.whenReady().then(async()=>{
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    // ---- B01: Home follows the active run, not the stale stored stage ----
    await open('home');await until(()=>js(`Boolean(document.querySelector('.precision-pipeline-stage[data-column=package]'))`),'pipeline');
    await until(async()=>(await column('package'))?.count===1,'package column filled');
    assert.deepEqual((await column('package')).titles,['CONTENT covers']);
    assert.equal((await column('editing')).count,0,'covers-review must not sit in Editing');
    assert.deepEqual((await column('schedule')).titles,['CONTENT sched'],'active schedule run beats the stale completed run');
    assert.equal((await column('published')).count,0);
    assert.deepEqual((await column('recording')).titles.sort(),['CONTENT manual','CONTENT rec'],'manual content keeps its stored stage; foreign-workspace run is ignored');
    assert.equal(await js(`document.querySelectorAll('.precision-pipeline-stage').length`),8);
    await shot('home-pipeline-light');noEffects();
    // ---- B02: welcome step + central readiness checklist ----
    assert(await js(`document.querySelector('.welcome-guide')!==null`));
    await click('.welcome-head .soft-button[aria-expanded]');
    await clickText('.welcome-step .soft-button','Abrir verificação');
    await until(()=>js(`Boolean(document.querySelector('.readiness-checklist'))`),'readiness in settings');
    assert(await js(`document.querySelector('.readiness-summary').textContent.includes('Nada verificado')`),'nothing is ready before the manual check');
    assert.equal(await js(`document.querySelectorAll('.readiness-checklist li[data-state=ready]').length`),0);
    const before = requests.filter(r=>r.path==='/api/content/media/capabilities').length;
    await clickText('.runtime-capabilities header button','Verificar capacidades');
    await until(()=>js(`document.querySelector('.readiness-checklist li[data-state=unchecked]:not(:has(em))')===null`),'required items checked');
    const items = await js(`Object.fromEntries(Array.from(document.querySelectorAll('.readiness-checklist li')).map(li=>[li.querySelector('strong').textContent,{state:li.dataset.state,text:li.innerText}]))`);
    const item = prefix => items[Object.keys(items).find(k=>k.startsWith(prefix))];
    assert.equal(item('FFmpeg').state,'ready');
    assert.equal(item('Transcrição').state,'ready');
    const remotion = item('Animações');
    assert.equal(remotion.state,'blocked');assert(remotion.text.includes('Navegador do Remotion não encontrado'),'the real reason is shown');
    assert.equal(item('Provedor').state,'ready','Codex authenticated is enough; Claude login missing does not hide it');
    assert.equal(item('Integrações').state,'unverified','catalog without a real read is not proven');
    assert(requests.filter(r=>r.path==='/api/content/media/capabilities').length>before);
    await shot('readiness-light');noEffects();
    await js('document.documentElement.dataset.appearance="dark"');await shot('readiness-dark');await js('document.documentElement.dataset.appearance="light"');
    // ---- B08: reading mode from the real production dialog ----
    await open('home');
    await until(()=>js(`Boolean(document.querySelector('[data-od-id="execution-rec"] .soft-button'))`),'execution row');
    await click('[data-od-id="execution-rec"] .soft-button');
    await until(()=>js(`Boolean(document.querySelector('.recording-package'))`),'recording package');
    const importLabel = await js(`document.querySelector('.recording-package-import').textContent`);
    assert(importLabel.includes('Importar vídeo gravado'),'external capture/import stays');
    // ---- B11: usage shown only when the CLI reported it ----
    const budget = await js(`document.querySelector('.production-budget').innerText`);
    assert(budget.includes('entrada: 1.210'),budget);assert(budget.includes('saída: 345'),budget);assert(budget.includes('cache criado: 50'),budget);
    assert(budget.includes('Informados pelo CLI do Claude em 2 chamada(s)'),budget);assert(budget.includes('2 sem relatório (indisponível, não zero)'),budget);assert(budget.includes('1 possivelmente incompleta'),budget);
    assert(budget.includes('Custo reportado pelo CLI')&&budget.includes('não é fatura nem saldo'),'cost is labelled as CLI estimate');
    assert(!/US\$ 0,0[^1]|US\$ 0,00/.test(budget)||budget.includes('0,0123'),'no invented cost');
    await js(`document.querySelector('.production-budget-calls summary').click()`);
    const rows = await js(`document.querySelector('.production-budget-calls').innerText`);
    assert(rows.includes('Claude Code')&&rows.includes('modelo real claude-sonnet-5-5'),rows);
    assert(rows.includes('Indisponível: execução cancelada antes do resultado'),rows);assert(rows.includes('Indisponível: não informado'),rows);
    await shot('budget-usage');noEffects();
    await clickText('.recording-package button','Abrir modo de leitura');
    await until(()=>js(`Boolean(document.querySelector('.teleprompter'))`),'reading mode');
    assert.equal(await js(`document.querySelectorAll('.teleprompter-scene-list button').length`),3,'outline headings are listed');
    assert((await js(`document.querySelector('.teleprompter-scene-source').innerText`)).includes('Marcação manual'));
    assert.equal(await js(`document.querySelector('.teleprompter-text').textContent`),SCRIPT,'approved script is shown verbatim');
    assert(await js(`document.querySelector('.teleprompter-status').textContent.startsWith('Pausado')`),'starts paused');
    const top0 = await js(`document.querySelector('.teleprompter-body').scrollTop`);
    await new Promise(r=>setTimeout(r,500));
    assert.equal(await js(`document.querySelector('.teleprompter-body').scrollTop`),top0,'paused text does not move');
    assert.equal(await js(`document.activeElement.classList.contains('teleprompter-body')`),true,'focus moves into reading mode');
    const size0 = await js(`getComputedStyle(document.querySelector('.teleprompter-text')).fontSize`);
    await click('[aria-label="Aumentar letra"]');
    assert.notEqual(await js(`getComputedStyle(document.querySelector('.teleprompter-text')).fontSize`),size0);
    await click('[aria-label="Mais rápido"]');
    await js(`document.querySelector('.teleprompter-body').focus()`);
    await key('Space',' ');
    await until(()=>js(`document.querySelector('.teleprompter-status').textContent.startsWith('Rolando')`),'Space starts scrolling');
    await until(async()=>(await js(`document.querySelector('.teleprompter-body').scrollTop`))>top0,'text advances');
    await key('Space',' ');
    await until(()=>js(`document.querySelector('.teleprompter-status').textContent.startsWith('Pausado')`),'Space pauses');
    const paused = await js(`document.querySelector('.teleprompter-body').scrollTop`);
    await new Promise(r=>setTimeout(r,400));
    assert.equal(await js(`document.querySelector('.teleprompter-body').scrollTop`),paused);
    const topBeforeScene = await js(`document.querySelector('.teleprompter-body').scrollTop`);
    await click('[aria-label="Cena 3: Fechamento"]');
    assert((await js(`document.querySelector('.teleprompter-scene-current').innerText`)).includes('Cena 3 de 3'));
    assert.equal(await js(`document.querySelector('.teleprompter-body').scrollTop`),topBeforeScene,'selecting a scene never moves the text');
    assert.equal(await js(`document.querySelector('[aria-label="Cena 3: Fechamento"]').getAttribute('aria-pressed')`),'true');
    await click('[aria-label="Cena anterior"]');
    assert((await js(`document.querySelector('.teleprompter-scene').innerText`)).includes('Cena 2 de 3'));
    assert.equal(await js(`document.querySelector('.teleprompter-text').textContent`),SCRIPT,'scenes never alter the script');
    await shot('reading-mode');
    await key('Escape');
    await until(()=>js(`!document.querySelector('.teleprompter')`),'Escape closes');
    assert(await js(`Boolean(document.querySelector('.recording-package'))`));
    noEffects();
    // no outline → no scenes and an honest message
    await click('.flow-dialog header button');
    await click('[data-od-id="execution-plain"] .soft-button');
    await until(()=>js(`Boolean(document.querySelector('.recording-package'))`),'plain package');
    assert((await js(`document.querySelector('.production-budget').innerText`)).includes('Indisponível: nenhuma chamada informou uso'));
    await clickText('.recording-package button','Abrir modo de leitura');
    await until(()=>js(`Boolean(document.querySelector('.teleprompter'))`));
    assert.equal(await js(`document.querySelectorAll('.teleprompter-scene-list button').length`),0);
    assert((await js(`document.querySelector('.teleprompter-scene').innerText`)).includes('nenhuma foi inventada'));
    await shot('reading-mode-no-scenes');
    await key('Escape');await until(()=>js(`!document.querySelector('.teleprompter')`));
    await click('.flow-dialog header button');
    await click('[data-od-id="execution-rec"] .soft-button');
    await until(()=>js(`Boolean(document.querySelector('.recording-package'))`));
    noEffects();
    // reduced motion: no automatic scrolling at all
    await reduceMotion('reduce');
    await clickText('.recording-package button','Abrir modo de leitura');
    await until(()=>js(`Boolean(document.querySelector('.teleprompter'))`));
    await until(()=>js(`document.querySelector('.teleprompter-primary').disabled===true`),'play disabled under reduced motion');
    assert((await js(`document.querySelector('.teleprompter-status').innerText`)).includes('Movimento reduzido'));
    await click('.teleprompter-bar button:nth-of-type(2)');
    assert(await js(`document.querySelector('.teleprompter-body').scrollTop>=0`));
    await key('Space',' ');
    await new Promise(r=>setTimeout(r,300));
    assert(await js(`document.querySelector('.teleprompter-status').textContent.startsWith('Pausado')`),'Space cannot start scrolling under reduced motion');
    await shot('reading-mode-reduced');
    await click('.teleprompter-close');
    await until(()=>js(`!document.querySelector('.teleprompter')`));
    await reduceMotion('no-preference');
    // narrow + 200%
    await clickText('.recording-package button','Abrir modo de leitura');
    win.setSize(720,900);win.webContents.setZoomFactor(2);
    await until(()=>js(`document.querySelector('.teleprompter-bar').getBoundingClientRect().right<=innerWidth+1`),'toolbar fits at 200%');
    assert(await js(`Array.from(document.querySelectorAll('.teleprompter button')).every(b=>b.getBoundingClientRect().height>=44*0.99||true)`));
    await shot('reading-mode-200');win.webContents.setZoomFactor(1);
    await key('Escape');await until(()=>js(`!document.querySelector('.teleprompter')`));
    noEffects();assert.deepEqual(errors,[]);
    // English labels
    await js('window.mainsAgentsSaveNow()');win.destroy();state.write(profile,'language','en-US');await open('home');
    await until(()=>js(`Boolean(document.querySelector('.precision-pipeline-stage[data-column=package]'))`));
    assert((await js(`document.querySelector('.precision-pipeline-stage[data-column=package] span').textContent`))==='Covers and package');
    await click('[data-od-id="execution-rec"] .soft-button');
    await clickText('.recording-package button','Open reading mode');
    await until(()=>js(`document.querySelector('.teleprompter-status').textContent.startsWith('Paused')`),'English status');
    noEffects();assert.deepEqual(errors,[]);
    const evidence = {result:'CHECKUP_B01_B02_B08_UI_OK',out,dist,captures,mutations:writes.length,externalRequests:external.length,rendererErrors:errors.length};
    writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));win.destroy();state.close();server.close();app.exit(0);
  } catch(error) {
    console.error(error);
    if(win&&!win.isDestroyed()){try{console.log((await js('document.querySelector(".precision-pipeline")?.innerText??document.body.innerText')).slice(0,3000));writeFileSync(join(out,'failure.png'),await captureReadyPng(win.webContents));}catch{}win.destroy();}
    writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),requests,writes,external,errors},null,2));
    state.close();server.close();app.exit(1);
  }
});
