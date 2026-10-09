// Hidden production preload + SQLite. No personal profiles, CLI calls or external writes.
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createDesktopStateStore } from '../desktop-state-store.mjs';
import {captureReadyPng} from './ui-capture-ready.mjs';

const root = resolve(import.meta.dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'mains-drafts-inbox-'));
app.setPath('userData', join(directory, 'electron')); app.on('window-all-closed', () => {});
const now = new Date().toISOString(), workspaceId = 'my-workspace', profile = 'draft-test';
let store = createDesktopStateStore(join(directory, 'sqlite'), '0.3.32'), window;
const agent = { id: 'editor', name: 'Editor de Conteúdo', workspaceId, role: 'Editor', description: 'Specialist', instructions: 'Follow the request', tools: ['web-search'], skills: ['editorial'], skillsDirectory: directory, status: 'idle', createdAt: now, updatedAt: now };
const session = id => ({ id, agentId: agent.id, title: id, messages: [], createdAt: now, updatedAt: now });
const draftKey = id => JSON.stringify([agent.id, id]);
const draft = { text: 'RASCUNHO_PRESERVADO', skill: 'editorial', context: [{ workspaceId, nodeId: 'note', label: 'Meu briefing' }] };
const original = { agents: [agent], sessions: [session('s1'), session('s2')], 'active-sessions': { editor: 's1' }, workspaces: [{ id: workspaceId, name: 'Test workspace', createdAt: now, updatedAt: now }], 'current-workspace': workspaceId, 'canvas-workspaces': { [workspaceId]: { nodes: [{ id: 'note', type: 'note', position: { x: 20, y: 20 }, data: { label: 'Meu briefing', text: 'Contexto real do Canvas' } }], edges: [], view: { viewport: { x: 0, y: 0, zoom: 1 }, width: 900, height: 640, ready: false } } }, 'chat-drafts': { [draftKey('s1')]: draft, [draftKey('s2')]: { text: 'OUTRA_SESSAO', skill: null, context: [] } }, language: 'pt-BR', 'welcome-dismissed': true, 'focus-mode': false };
store.initialize(profile, original); store.initialize('other-profile', { agents: [], sessions: [] }); store.selectProfile(profile);
ipcMain.on('state:profile', event => { event.returnValue = store.currentProfile(); });
ipcMain.handle('state:getProfile', () => store.currentProfile());
for (const operation of ['hasProfile', 'initialize', 'read', 'write', 'readAll', 'readAllVersioned', 'replaceAll']) ipcMain.handle(`state:${operation}`, (_event, ...args) => store[operation](...args));
ipcMain.on('state:writeSync', (event, ...args) => { try { event.returnValue = { saved: true, ...store.write(...args) }; } catch (error) { event.returnValue = { saved: false, error: error.message }; } });
ipcMain.handle('state:checkpoint', () => store.recoverySnapshot());
ipcMain.handle('account:status', () => ({ configured: true, signedIn: false })); ipcMain.handle('account:google-configured', () => false);
const topic = (id, title, status, workspace = workspaceId) => ({ id, workspaceId: workspace, requestId: id, inputKind: 'text', input: title, category: 'Tech', priority: 'normal', status, title, summary: 'Research summary', whyItMatters: 'A practical explanation', angles: ['Example'], sources: [], factualQuestions: [], researchArtifactId: `r-${id}`, createdAt: now, updatedAt: now });
let editorial = { schemaVersion: 1, topics: [topic('first', 'Primeira pauta', 'review'), topic('target', 'Pauta correta', 'review'), topic('blocked', 'Pesquisa interrompida', 'error'), topic('private', 'OUTRO_WORKSPACE', 'review', 'private')], contents: [], runs: [], artifacts: ['first', 'target', 'private'].map(id => ({ id: `r-${id}`, workspaceId: id === 'private' ? 'private' : workspaceId, topicId: id, type: 'research', version: 2, data: {}, createdAt: now })), approvals: [] };
let revision = 1, jobsFailed = false, sent;
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname; let raw = ''; for await (const chunk of req) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  if (path === '/api/content/state') { if (req.method === 'PUT') { editorial = input.state; revision++; } return json(res, { revision, state: editorial }); }
  if (path === '/api/content/jobs') return jobsFailed ? json(res, { error: 'QUEUE_UNAVAILABLE' }, 503) : json(res, { jobs: [] });
  if (path === '/api/content/connection') return json(res, { dataSourceId: '', autoSync: false });
  if (path === '/api/codex/health') return json(res, { ready: true, status: 'connected', account: { type: 'chatgpt' }, capabilities: { webSearch: true, files: true, imageGeneration: false } });
  if (path === '/api/codex/models') return json(res, { models: [{ id: 'test', displayName: 'Test model', isDefault: true }] });
  if (path === '/api/codex/threads') return json(res, { threadId: 'isolated-thread' });
  if (path === '/api/codex/executions') { sent = input; return json(res, { executionId: 'isolated-run', threadId: input.threadId }); }
  if (path.endsWith('/events')) { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.end(JSON.stringify({ type: 'message.completed', executionId: 'isolated-run', content: 'TEST_REPLY' }) + '\n' + JSON.stringify({ type: 'execution.completed', executionId: 'isolated-run' }) + '\n'); return; }
  if (path.startsWith('/api/')) return json(res, {});
  try { const file = resolve(root, 'dist', path === '/' ? 'app.html' : path.slice(1)); assert(file.startsWith(resolve(root, 'dist') + sep)); res.setHeader('content-type', { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); } catch { res.statusCode = 404; res.end(); }
});
const errors = [], evaluate = code => window.webContents.executeJavaScript(code);
async function until(check) { const end = Date.now() + 12000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Draft/inbox UI assertion timed out'); }
async function open(hash = 'home') {
  window = new BrowserWindow({ show: false, width: 1440, height: 940, webPreferences: { preload: resolve(root, 'desktop-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  window.webContents.on('console-message', event => { if (/Uncaught|Maximum update depth|Cannot update a component|Failed to persist/.test(event.message)) errors.push(event.message); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/app.html#${hash}`); await until(() => evaluate("!!document.querySelector('.agent-nav')"));
}
async function openChat() { await evaluate("document.querySelector('.agent-nav').click()"); await until(() => evaluate("!!document.querySelector('.composer textarea')")); }
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); await open();
    // Home keeps the inbox compact: two rows plus a "View all (N)" toggle; all three pending items must be reachable.
    await until(() => evaluate("document.querySelector('.editorial-inbox .inbox-count')?.textContent === '3'"));
    assert.equal(await evaluate("document.querySelectorAll('.inbox-row').length"), 2);
    assert.equal(await evaluate("document.querySelector('.editorial-inbox .panel-footer-action').getAttribute('aria-expanded')"), 'false');
    await evaluate("document.querySelector('.editorial-inbox .panel-footer-action').click()");
    await until(() => evaluate("document.querySelectorAll('.inbox-row').length === 3"));
    assert.equal(await evaluate("document.querySelector('.editorial-inbox .panel-footer-action').getAttribute('aria-expanded')"), 'true');
    assert.equal(await evaluate("document.querySelector('.inbox-row').textContent.includes('Pesquisa interrompida')"), true);
    assert.equal(await evaluate("document.querySelector('.editorial-inbox').textContent.includes('OUTRO_WORKSPACE')"), false);
    await evaluate("[...document.querySelectorAll('.inbox-row')].find(row => row.textContent.includes('Pauta correta')).click()");
    await until(() => evaluate("!!document.querySelector('.editorial-review input')"));
    assert.equal(await evaluate("document.querySelector('.editorial-review input').value"), 'Pauta correta');
    // Open the current version's review and reject it; Home must stop advertising it.
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Descartar pauta').click()");
    await until(() => editorial.topics.find(item => item.id === 'target').status === 'rejected');
    await evaluate("location.hash = 'home'"); await until(() => evaluate("document.querySelectorAll('.inbox-row').length === 2"));
    jobsFailed = true; await until(() => evaluate("document.querySelector('.editorial-inbox').textContent.includes('QUEUE_UNAVAILABLE')"));
    assert.equal(await evaluate("document.querySelectorAll('.inbox-row').length"), 2); jobsFailed = false;
    await until(() => evaluate("!document.querySelector('.editorial-inbox [role=alert]')"));
    writeFileSync(join(root, '.mainsagents-workspaces/inbox-light.png'), await captureReadyPng(window.webContents));
    window.setSize(760, 900); await evaluate("document.documentElement.dataset.appearance = 'dark'");
    assert.equal(await evaluate("(() => { const panel=document.querySelector('.editorial-inbox'); return panel.scrollWidth <= panel.clientWidth + 1; })()"), true);
    writeFileSync(join(root, '.mainsagents-workspaces/inbox-dark-compact.png'), await captureReadyPng(window.webContents));
    window.setSize(1440, 940); await evaluate("document.documentElement.dataset.appearance = 'light'");
    await openChat(); assert.equal(await evaluate("document.querySelector('.composer textarea').value"), draft.text);
    assert.equal(await evaluate("document.querySelector('.composer-selected-skill').textContent.includes('editorial')"), true);
    assert.equal(await evaluate("document.querySelector('.composer-context').textContent.includes('Contexto real do Canvas')"), true);
    await evaluate(`(() => { const input = document.querySelector('.composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'NOVO_RASCUNHO'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(store.read(profile, 'chat-drafts')[draftKey('s1')].text, 'NOVO_RASCUNHO');
    await evaluate("location.hash = 'canvas'"); await until(() => evaluate("!!document.querySelector('.react-flow')"));
    // A Canvas chat showing the same session must share the same live draft.
    window.destroy(); const withChat = store.read(profile, 'canvas-workspaces');
    withChat[workspaceId].nodes.push({ id:'chat-node',type:'chat',position:{x:400,y:40},data:{label:'Chat',workspaceId,chatAgentId:agent.id,chatSessionId:'s1'} });
    store.write(profile,'canvas-workspaces',withChat); await open('canvas');
    await until(() => evaluate("!!document.querySelector('.canvas-chat-composer textarea')"));
    assert.equal(await evaluate("document.querySelector('.canvas-chat-composer textarea').value"), 'NOVO_RASCUNHO');
    await evaluate("(() => { const input=document.querySelector('.canvas-chat-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'CANVAS_RASCUNHO');input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await openChat(); assert.equal(await evaluate("document.querySelector('.composer textarea').value"), 'CANVAS_RASCUNHO');
    window.destroy(); store.close(); store = createDesktopStateStore(join(directory, 'sqlite'), '0.3.32'); await open(); await openChat();
    assert.equal(await evaluate("document.querySelector('.composer textarea').value"), 'CANVAS_RASCUNHO');
    assert.equal(await evaluate("document.querySelector('.composer-context').textContent.includes('Contexto real do Canvas')"), true);
    window.destroy(); const canvases = store.read(profile, 'canvas-workspaces'); canvases[workspaceId].nodes = []; store.write(profile, 'canvas-workspaces', canvases);
    await open(); await openChat(); assert.equal(await evaluate("document.querySelector('.composer-draft-warning').textContent.includes('Meu briefing')"), true);
    await until(() => evaluate("!document.querySelector('.send-button').disabled")); await evaluate("document.querySelector('.send-button').click()");
    await until(() => !!sent); await until(() => evaluate("document.querySelector('.composer textarea').value === ''"));
    assert.equal(store.read(profile, 'chat-drafts')[draftKey('s1')], undefined);
    assert.equal(store.read(profile, 'chat-drafts')[draftKey('s2')].text, 'OUTRA_SESSAO');
    assert.equal(store.read('other-profile', 'chat-drafts'), undefined); assert.deepEqual(errors, []);
    writeFileSync(join(root, '.mainsagents-workspaces/drafts-inbox-ui-result.json'), JSON.stringify({ passed: true, nativeDraftSurvivesRestart: true, canvasAndMainChatShareDraft: true, skillsAndContextRestored: true, deletedContextWarning: true, otherSessionPreserved: true, profileIsolation: true, inboxWorkspaceIsolation: true, inboxOpensCorrectTopic: true, resolvedReviewRemoved: true, queueFailureVisible: true, compactDarkLayout: true }, null, 2));
    console.log('DRAFTS_INBOX_UI_OK');
  } catch (error) { console.error(error); if (window && !window.isDestroyed()) writeFileSync(join(root, '.mainsagents-workspaces/drafts-inbox-failure.png'), (await window.webContents.capturePage()).toPNG()); process.exitCode = 1; }
  finally { if (window && !window.isDestroyed()) window.destroy(); store.close(); server.closeAllConnections(); server.close(); app.exit(process.exitCode ?? 0); }
});
