// Isolated production preload + real SQLite. No user data, credentials or AI calls.
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {captureReadyPng} from './ui-capture-ready.mjs';
const root = resolve(import.meta.dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'mains-native-ui-'));
const runtimeRoot=process.env.MAINSAGENTS_TEST_ASAR?resolve(process.env.MAINSAGENTS_TEST_ASAR):root;
const targetVersion=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version,previousVersion=targetVersion.replace(/\d+$/,value=>String(Math.max(0,Number(value)-1)));
const {createDesktopStateStore}=await import(pathToFileURL(resolve(runtimeRoot,'desktop-state-store.mjs')).href);
if(process.env.MAINSAGENTS_TEST_ASAR)assert.equal(JSON.parse(readFileSync(resolve(runtimeRoot,'package.json'),'utf8')).version,JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version);
app.setPath('userData', join(directory, 'electron'));
app.on('window-all-closed', () => {});
let store = createDesktopStateStore(join(directory, 'sqlite'), previousVersion), window;
const now = new Date().toISOString(), workspaceId = 'my-workspace';
const base = { role: 'Specialist', description: 'Saved specialist', instructions: 'Preserve original instructions', tools: ['files'], workspaceId, status: 'idle', createdAt: now, updatedAt: now };
const agents = [{ ...base, id: 'content', name: 'Editor de Conteúdo' }, { ...base, id: 'video', name: 'Editor de Vídeo', skills: ['video-editing'] }, { ...base, id: 'linkedin', name: 'Linkedin Agent', skills: ['linkedin-marketing'] }];
const sessions = [{ id: 'source', agentId: 'content', title: 'Saved discussion', messages: [{ id: 'msg1', type: 'message', role: 'user', content: 'Saved message', createdAt: now }], agentConnection: { enabled: true, targetAgentId: 'video', targetSessionId: 'target' }, createdAt: now, updatedAt: now }, { id: 'target', agentId: 'video', title: 'Specialist session', codexThreadId: 'retained-thread', messages: [], createdAt: now, updatedAt: now }];
const canvas = { [workspaceId]: { nodes: [{ id: 'note1', type: 'note', position: { x: 10, y: 20 }, data: { label: 'Saved note', text: 'Keep this note' } }, { id: 'note2', type: 'note', position: { x: 400, y: 20 }, data: { label: 'Another note', text: 'Keep the link' } }], edges: [{ id: 'edge1', source: 'note1', target: 'note2' }], viewport: { x: 0, y: 0, zoom: 1 } } };
const original = { agents, sessions, 'active-sessions': { content: 'source', video: 'target' }, workspaces: [{ id: workspaceId, name: 'Saved workspace', createdAt: now, updatedAt: now }], 'current-workspace': workspaceId, 'canvas-workspaces': canvas, tasks: [{ id: 'task1', title: 'Saved task', agentId: 'content', workspaceId, status: 'review', metadata: {}, createdAt: now }], language: 'pt-BR', 'welcome-dismissed': true, 'focus-mode': false };
store.initialize('account', original); store.initialize('default', { agents: [], sessions: [] }); store.selectProfile('account');
// Simulate an unavailable/stale synchronous profile snapshot. Async native lookup
// must still select the saved account without consulting browser localStorage.
ipcMain.on('state:profile', event => { event.returnValue = undefined; });
ipcMain.handle('state:getProfile', () => store.currentProfile());
for (const operation of ['hasProfile', 'initialize', 'read', 'write', 'readAll', 'readAllVersioned', 'replaceAll']) ipcMain.handle(`state:${operation}`, (_event, ...args) => store[operation](...args));
ipcMain.handle('state:checkpoint',()=>store.recoverySnapshot());
ipcMain.on('state:writeSync', (event, ...args) => {
  try { event.returnValue = { saved: true, ...store.write(...args) }; }
  catch (error) { event.returnValue = { saved: false, error: error.message }; }
});
ipcMain.handle('account:status', () => ({ configured: true, signedIn: false }));
ipcMain.handle('account:google-configured', () => false);
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(path.endsWith('/health') ? { ready: false } : path.endsWith('/models') ? { models: [] } : path.endsWith('/state') ? { revision: 0, state: { schemaVersion: 1, topics: [], contents: [], runs: [], artifacts: [], approvals: [] } } : {})); return;
  }
  try {
    const file = resolve(runtimeRoot, 'dist', path === '/' ? 'app.html' : path.slice(1));
    assert(file.startsWith(resolve(runtimeRoot, 'dist') + '\\'));
    response.setHeader('content-type', { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  } catch { response.statusCode = 404; response.end(); }
});
const errors = [];
async function open(expectedCount) {
  window = new BrowserWindow({ show: false, width: 1440, height: 940, webPreferences: { preload: resolve(runtimeRoot, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (/Uncaught|Maximum update depth|Cannot update a component|Failed to persist|Could not open saved/.test(event.message)) errors.push(event.message); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#agents`);
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await window.webContents.executeJavaScript(`document.querySelectorAll('.agent-nav').length === ${expectedCount} && !!document.querySelector('.agents-page')`)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Agents were not restored in the UI');
}
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await open(3);
    const visible = await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.agent-nav')).map(element => element.title)");
    assert.deepEqual(visible, agents.map(agent => agent.name));
    assert.equal(await window.webContents.executeJavaScript("localStorage.getItem('mainsagents-profile')"), 'account');
    // Stale browser profile must not replace native account selection on reload.
    await window.webContents.executeJavaScript("localStorage.setItem('mainsagents-profile', 'wrong-browser-profile')");
    window.destroy(); await open(3);
    await window.webContents.executeJavaScript("document.querySelector('[data-od-id=create-agent]').click()");
    await new Promise(resolve => setTimeout(resolve, 100));
    await window.webContents.executeJavaScript(`(() => {
      const set = (element, value) => { const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); };
      const inputs = document.querySelectorAll('.agent-drawer input[required]');
      set(inputs[0], 'New specialist'); set(inputs[1], 'Persistence tester');
      set(document.querySelector('.agent-drawer .instructions-input'), 'Keep the newest instructions');
    })()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    await window.webContents.executeJavaScript("document.querySelector('.agent-drawer form').requestSubmit()");
    // Exit immediately after the actual Save event, without waiting for an effect.
    window.destroy();
    assert.equal(store.read('account', 'agents').length, 4);
    assert.equal(store.read('account', 'agents').at(-1).instructions, 'Keep the newest instructions');
    store.close(); store = createDesktopStateStore(join(directory, 'sqlite'), targetVersion);
    await open(4);
    assert.deepEqual(store.read('account', 'agents').slice(0, 3), agents);
    assert.deepEqual(store.read('account', 'sessions'), sessions);
    assert.deepEqual(store.read('account', 'tasks'), original.tasks);
    assert.deepEqual(store.read('account', 'canvas-workspaces'), canvas);
    assert.equal(await window.webContents.executeJavaScript("!!document.querySelector('.agent-nav[title=\"Editor de Vídeo\"]') && !!document.querySelector('.agent-nav[title=\"Linkedin Agent\"]')"), true);
    writeFileSync(resolve(root, '.mainsagents-workspaces/native-persistence-ui.png'), await captureReadyPng(window.webContents));
    // Explicit profile changes remain isolated, and reopening the account keeps data.
    window.destroy(); store.selectProfile('default'); await open(0);
    assert.equal(store.read('default', 'agents').length, 0);
    window.destroy(); store.selectProfile('account'); await open(4);
    assert.deepEqual(errors, []);
    writeFileSync(resolve(root, '.mainsagents-workspaces/native-persistence-ui-result.json'), JSON.stringify({ passed: true, immediateSaveSurvivesExit: true, threeOriginalAgentsPreserved: true, sessionConnectionsPreserved: true, tasksPreserved: true, canvasPreserved: true, profileIsolation: true, staleBrowserProfileIgnored: true }, null, 2));
    console.log(process.env.MAINSAGENTS_TEST_ASAR?'PACKAGED_NATIVE_PERSISTENCE_UI_OK':'NATIVE_PERSISTENCE_UI_OK');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window?.destroy(); store.close(); server.closeAllConnections(); server.close(); app.exit(process.exitCode ?? 0); }
}).catch(error => { console.error(error); app.exit(1); });
