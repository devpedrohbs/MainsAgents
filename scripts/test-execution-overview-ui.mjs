// Electron renderer + isolated state store; every API is simulated. No runtime or coordinator.
import {app, BrowserWindow, ipcMain} from 'electron';
import {createServer} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, join, sep, extname} from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopStateStore} from '../desktop-state-store.mjs';
import {captureReadyPng, waitForCaptureReady} from './ui-capture-ready.mjs';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.mainsagents-workspaces/execution-overview-ui', String(Date.now()));
mkdirSync(out, {recursive:true});
app.setPath('userData', join(out, 'electron'));
app.on('window-all-closed', () => {});
const profile = 'handoff-test', workspaceId = 'execution-space', otherId = 'other-space';
const at = '2026-10-07T12:00:00.000Z';
const agent = (id, name, workspace = workspaceId) => ({id,name,workspaceId:workspace,role:'Synthetic editor',description:'Isolated fixture',instructions:'Fixture only',skills:[],tools:[],providerId:'codex',status:'idle',createdAt:at,updatedAt:at});
const agents = [agent('writer','Fixture Writer'), agent('editor','Fixture Editor'), agent('other-writer','Other Writer',otherId), agent('other-editor','Other Editor',otherId)];
const session = (runId, agentId, role) => ({id:`${runId}-${role}`,agentId,contentId:`content-${runId}`,topicId:`topic-${runId}`,title:`SESSION ${runId} ${role}`,messages:[{id:`production:${runId}:fixture`,type:'message',role:'agent',content:`CHAT_MARKER_${runId}_${role}`,createdAt:at,deliveryState:'completed'}],createdAt:at,updatedAt:at});
const run = (id, stage, workspace = workspaceId) => {
  const source = agents.find(a => a.id === (workspace === workspaceId ? 'writer' : 'other-writer'));
  const editor = agents.find(a => a.id === (workspace === workspaceId ? 'editor' : 'other-editor'));
  return {id,revision:1,workspaceId:workspace,flowId:workspace === workspaceId ? 'shared-flow' : 'other-flow',contentId:`content-${id}`,topicId:`topic-${id}`,name:`PRODUCTION ${id}`,stage,resumeStage:stage === 'blocked' ? 'editing' : undefined,error:stage === 'blocked' ? 'FIXTURE missing local file' : undefined,
    sourceAgent:{id:source.id,name:source.name},editorAgent:{id:editor.id,name:editor.name},sourceSession:session(id,source.id,'source'),editorSession:session(id,editor.id,'editor'),topic:{id:`topic-${id}`,workspaceId:workspace,title:`TOPIC ${id}`,status:'approved',summary:'Synthetic topic',createdAt:at,updatedAt:at},notionDestination:'',timeZone:'UTC',events:[{action:stage === 'blocked' ? 'editing' : stage,detail:`EVENT ${id}`,at}],updatedAt:at};
};
const runs = [run('waiting-one','recording'),run('blocked-two','blocked'),run('foreign-three','recording',otherId)];
const flow = (id, workspace) => ({id,workspaceId:workspace,name:`Fixture ${id}`,nodes:[],edges:[],createdAt:at,updatedAt:at});
const store = createDesktopStateStore(out,'execution-overview-fixture');
store.initialize(profile,{agents,workspaces:[{id:workspaceId,name:'Execution fixture',createdAt:at,updatedAt:at},{id:otherId,name:'Other fixture',createdAt:at,updatedAt:at}],sessions:runs.flatMap(r=>[r.sourceSession,r.editorSession]),'active-sessions':{},'current-workspace':workspaceId,language:'pt-BR',appearance:'light','welcome-dismissed':true,'focus-mode':false,'production-flows':{schemaVersion:1,flows:[flow('shared-flow',workspaceId),flow('other-flow',otherId)],activeByWorkspace:{[workspaceId]:'shared-flow',[otherId]:'other-flow'}}});
ipcMain.handle('test:read',(_event,key)=>store.read(profile,key));
ipcMain.handle('test:write',(_event,key,value)=>store.write(profile,key,value));
ipcMain.handle('test:all',()=>store.readAll(profile));
const requests = [], writes = [], external = [], errors = [], captures = [];
const editorial = {schemaVersion:1,topics:[],contents:[],artifacts:[],approvals:[],runs:[],assets:[],publications:[]};
const json = (response,value,status=200) => {response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
const server = createServer((request,response) => {
  const url = new URL(request.url,'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    requests.push({method:request.method,path:url.pathname,profile:url.searchParams.get('profile')});
    if (request.method !== 'GET') {writes.push({method:request.method,path:url.pathname});return json(response,{error:'Fixture rejects every mutation and AI call'},409);}
    if (url.pathname === '/api/content/productions') {assert.equal(url.searchParams.get('profile'),profile);return json(response,{productions:runs});}
    if (url.pathname === '/api/content/state') return json(response,{revision:1,state:editorial});
    if (url.pathname === '/api/content/jobs') return json(response,{jobs:[]});
    if (url.pathname === '/api/content/work') return json(response,{jobs:[],mediaJobs:[]});
    if (url.pathname === '/api/content/connection') return json(response,{dataSourceId:'',autoSync:false});
    if (url.pathname.endsWith('/health')) return json(response,{ready:true,accountType:'chatgpt'});
    if (url.pathname.endsWith('/models')) return json(response,{models:[]});
    if (url.pathname.endsWith('/images')) return json(response,{events:[]});
    return json(response,{});
  }
  try {
    const file = resolve(root,'dist',url.pathname === '/' ? 'app.html' : url.pathname.slice(1));
    assert(file.startsWith(resolve(root,'dist') + sep));
    response.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch {response.statusCode=404;response.end();}
});
let win;
const js = code => win.webContents.executeJavaScript(code);
async function until(check,label='condition') {const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw Error(`Execution overview timeout: ${label}`);}
async function click(selector) {await until(()=>js(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`),selector);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);}
const ids = () => js(`Array.from(document.querySelectorAll('.execution-list > li')).map(el=>el.dataset.odId)`);
async function expectRows(expected) {await until(async()=>JSON.stringify(await ids())===JSON.stringify(expected.map(id=>`execution-${id}`)),`rows ${expected}`);}
async function filter(name) {await click(`[data-od-id="execution-filter-${name}"]`);}
function noExecution() {assert.deepEqual(writes,[],'Opening/filtering must not send any API mutation or AI call');assert.deepEqual(external,[],'No external network access');}
async function capture(name) {
  await js(`(()=>{const panel=document.querySelector('[data-od-id="execution-overview"]');panel?.scrollIntoView({block:'start'});const view=document.querySelector('.view');if(view)view.scrollTop-=12;})()`);
  writeFileSync(join(out,`${name}.png`),await captureReadyPng(win.webContents));
  captures.push(name);
}
async function open() {
  win = new BrowserWindow({show:false,width:1440,height:1100,webPreferences:{preload:resolve(root,'tests/fixtures/assets-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{
    const url = new URL(details.url);
    if (['http:','https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {external.push(details.url);callback({cancel:true});} else callback({});
  });
  win.webContents.on('console-message',event=>{if(/Uncaught|Maximum update depth|Cannot update a component/.test(event.message))errors.push(event.message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#home`);
  await until(()=>js(`Boolean(document.querySelector('[data-od-id="execution-overview"]'))`),'Home panel');
  await waitForCaptureReady(win.webContents);
}
async function workspace(name) {
  await click('.workspace-switcher');
  await js(`Array.from(document.querySelectorAll('.workspace-option')).find(el=>el.textContent.trim()===${JSON.stringify(name)}).click()`);
}
app.whenReady().then(async()=>{
  try {
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await open();await expectRows(['blocked-two','waiting-one']);noExecution();
    assert(await js(`document.querySelector('[data-od-id="execution-filter-waiting"]').textContent.includes('Aguardando você')`));
    await capture('home-light');
    await filter('waiting');await expectRows(['waiting-one']);
    await click('[data-od-id="execution-waiting-one"] .soft-button');
    await until(()=>js(`document.querySelector('.flow-dialog h2')?.textContent.includes('TOPIC waiting-one')`),'exact waiting dialog');
    assert(await js(`document.querySelector('[aria-label="Produção atual"]').textContent.includes('TOPIC waiting-one')`));
    noExecution();writeFileSync(join(out,'dialog-waiting.png'),await captureReadyPng(win.webContents));captures.push('dialog-waiting');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await until(()=>js(`!document.querySelector('.flow-dialog')`),'Escape closes dialog');
    await click('[data-od-id="execution-waiting-one"] .soft-button');
    await until(()=>js(`document.querySelector('.flow-dialog h2')?.textContent.includes('TOPIC waiting-one')`));
    await click('.flow-dialog header button');
    await click('[data-od-id="execution-waiting-one"] .text-link');
    await until(()=>js(`document.querySelector('.active-session-bar')?.textContent.includes('SESSION waiting-one source')`),'source session');
    assert(await js(`document.querySelector('.chat-layer').textContent.includes('CHAT_MARKER_waiting-one_source')`));
    await click('.chat-toggle');
    await filter('blocked');await expectRows(['blocked-two']);
    await click('[data-od-id="execution-blocked-two"] .soft-button');
    await until(()=>js(`document.querySelector('.flow-dialog h2')?.textContent.includes('TOPIC blocked-two')`),'exact blocked dialog on same flow');
    noExecution();await click('.flow-dialog header button');
    await click('[data-od-id="execution-blocked-two"] .text-link');
    await until(()=>js(`document.querySelector('.active-session-bar')?.textContent.includes('SESSION blocked-two editor')`),'editor session');
    assert(await js(`document.querySelector('.chat-layer').textContent.includes('CHAT_MARKER_blocked-two_editor')`));
    await click('.chat-toggle');noExecution();
    await js('window.mainsAgentsSaveNow()');win.destroy();await open();await expectRows(['blocked-two']);
    assert(await js(`document.querySelector('[data-od-id="execution-filter-blocked"]').getAttribute('aria-pressed')==='true'`));
    assert(await js(`!document.querySelector('.flow-dialog')`));noExecution();
    await workspace('Other fixture');await expectRows(['foreign-three']);assert(await js(`!document.querySelector('.flow-dialog')`));noExecution();
    await workspace('Execution fixture');await expectRows(['blocked-two']);
    await filter('all');await expectRows(['blocked-two','waiting-one']);
    await js('document.documentElement.dataset.appearance="dark"');await capture('home-dark');
    win.setSize(880,1100);await capture('home-dark-880');
    assert(await js(`document.querySelector('.execution-overview').getBoundingClientRect().width<=innerWidth`));
    await js('document.documentElement.dataset.appearance="light"');await capture('home-light-880');
    win.webContents.setZoomFactor(2);await capture('home-light-880-200');
    assert(await js(`Array.from(document.querySelectorAll('.execution-actions button')).every(el=>el.getBoundingClientRect().width>0)`));
    await filter('waiting');await expectRows(['waiting-one']);
    await js(`document.querySelector('[data-od-id="execution-waiting-one"] .text-link').focus()`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});
    await until(()=>js(`document.activeElement.matches('.execution-actions .soft-button')`),'keyboard Shift-Tab');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert(await js(`document.activeElement.matches('.execution-actions .soft-button')`));
    // Offscreen windows lack OS focus. Verify the loaded focus CSS separately; do not
    // claim that a hidden-window screenshot proves native focus-ring visibility.
    assert(await js(`Array.from(document.styleSheets).some(sheet=>Array.from(sheet.cssRules).some(rule=>rule.selectorText?.includes('button:focus-visible')&&rule.style?.outline.includes('solid')))`));
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await until(()=>js(`document.querySelector('.flow-dialog h2')?.textContent.includes('TOPIC waiting-one')`),'keyboard Enter');
    await click('.flow-dialog header button');noExecution();assert.deepEqual(errors,[]);
    await js('window.mainsAgentsSaveNow()');win.destroy();store.write(profile,'language','en-US');await open();await expectRows(['waiting-one']);
    assert(await js(`document.querySelector('[data-od-id="execution-filter-waiting"]').textContent.includes('Waiting for you')`));
    await capture('home-en');noExecution();assert.deepEqual(errors,[]);
    const evidence={result:'EXECUTION_OVERVIEW_UI_OK',out,captures,checks:['workspace isolation','waiting/blocked filters','exact dialog for same-flow runs','source/editor chat sessions','close/reopen persisted filter','workspace navigation','PT/EN','light/dark','880px','200%','keyboard Shift-Tab/Enter/Escape'],focusRingLimit:'Hidden offscreen window has no OS focus; loaded focus-visible CSS checked, native visual focus ring requires visible-window inspection.',requests,writes,external,errors};
    writeFileSync(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({result:evidence.result,out,captures,checks:evidence.checks,mutations:writes.length,externalRequests:external.length,rendererErrors:errors.length,evidence:join(out,'evidence.json')},null,2));win.destroy();store.close();server.close();app.exit(0);
  } catch(error) {
    console.error(error);
    if(win&&!win.isDestroyed()){console.log(await js('document.body.innerText'));try{writeFileSync(join(out,'failure.png'),await captureReadyPng(win.webContents));}catch{}win.destroy();}
    writeFileSync(join(out,'failure.json'),JSON.stringify({error:String(error),requests,writes,external,errors},null,2));
    store.close();server.close();app.exit(1);
  }
});
