// Real renderer, desktop preload, IPC, SQLite and Radar routes; deterministic source responses, no external requests.
// Build: node node_modules/vite/bin/vite.js build --outDir .mainsagents-workspaces/radar-ui-dist
// Run: node_modules/.bin/electron scripts/test-radar-ui.mjs
// Hosts that block Chromium child processes may need --no-sandbox --in-process-gpu for this isolated fixture harness.
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createDesktopStateStore } from '../desktop-state-store.mjs';
import { createContentWorkflowBridge } from '../content-workflow-bridge.mjs';
import { captureReadyPng } from './ui-capture-ready.mjs';

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const root = resolve(import.meta.dirname, '..');
const out = join(root, '.mainsagents-workspaces/radar-ui', String(Date.now()));
mkdirSync(out, { recursive: true });
app.setPath('userData', join(out, 'electron'));
app.on('window-all-closed', () => {});
const profile = 'radar-ui', workspaceId = 'radar-space', scope = { profile, workspaceId };
const channelId = 'UCabcdefghijklmnopqrstuv';
let clock = Date.parse('2026-10-25T12:00:00Z'), bump = 0, gate, release;
let agents = [], synthesisGate, releaseSynthesis, providerWait = null, synthesisCalls = 0, synthesisMode = 'ready';
const fixtureRuntime = {
  createSession: async () => 'radar-fixture-session',
  send: async () => { synthesisCalls++; return { executionId: 'radar-fixture-execution' }; },
  cancel: async () => {},
  async *events() {
    if (synthesisGate) await synthesisGate;
    if (synthesisMode === 'blocked') { yield { type: 'execution.failed', code: 'login_required', message: 'Login expirado no teste.' }; return; }
    if (synthesisMode === 'failed') { yield { type: 'execution.failed', message: 'Falha de teste na síntese.' }; return; }
    const item = bridge.radar.snapshot(scope, { kind: 'news' }).items.find(item => item.title === 'Hacker News fixture');
    yield { type: 'message.completed', content: JSON.stringify({ recommendations: [{ itemId: item.id, observation: 'A notícia atingiu 150 pontos.', hypothesis: { text: 'O tema pode ter despertado interesse.', alternatives: ['Distribuição na página inicial.'] }, idea: 'Explicar a mudança em um tutorial próprio.', limitations: ['Não há dados de alcance.'] }] }) };
    yield { type: 'execution.completed' };
  },
};
const secureStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`fixture:${value}`), decryptString: value => value.toString().slice(8) };
const store = createDesktopStateStore(out, 'radar-ui');
store.initialize(profile, { agents: [], workspaces: [{ id: workspaceId, name: 'Radar test', createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() }], sessions: [], tasks: [], 'current-workspace': workspaceId, language: 'pt-BR', 'welcome-dismissed': true, 'focus-mode': false });
store.selectProfile(profile);
const bridge = createContentWorkflowBridge({ dbPath: join(out, 'editorial.sqlite'), secureStorage, getCurrentProfile: () => profile, getAgents: () => agents, getSessions: () => [], getRuntime: () => null,
  radarOptions: { autoTick: false, clock: () => clock, synthesis: { getRuntime: () => fixtureRuntime, providerWaits: { get: () => providerWait } }, fetch: async url => {
    if (gate) await gate;
    if (url.includes('feeds/videos.xml')) return new Response(`<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Canal fixture</title><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>Vídeo sem contador</title><author><name>Canal fixture</name></author><published>2026-10-20T12:00:00Z</published></entry><entry><yt:videoId>abcdefghijl</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>Vídeo observado</title><author><name>Canal fixture</name></author><published>2026-10-10T12:00:00Z</published><media:statistics views="${100 + bump}"/></entry></feed>`);
    if (url === 'https://example.com/rss') return new Response('<rss><channel><item><title>Notícia fixture</title><link>https://example.com/story</link><pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>');
    if (url.includes('topstories.json')) return Response.json([123]);
    if (url.includes('/item/123.json')) return Response.json({ id: 123, type: 'story', title: 'Hacker News fixture', url: 'https://example.com/hn', by: 'fixture', score: 150, descendants: 8, time: clock / 1000 });
    throw Error(`Unexpected fixture request: ${new URL(url).hostname}`);
  } },
});
let win, unavailable = false, conflict = true, failPromotion = false, synthesizeConflict = null, synthesisOverride = null;
const trusted = event => { assert.equal(event.sender, win.webContents); assert.equal(event.senderFrame, event.sender.mainFrame); };
ipcMain.handle('state:getProfile', event => { trusted(event); return profile; });
ipcMain.on('state:writeSync', (event, owner, key, value, revision) => { try { trusted(event); assert.equal(owner, profile); event.returnValue = { saved: true, ...store.write(owner, key, value, revision) }; } catch (error) { event.returnValue = { saved: false, error: error.message }; } });
for (const action of ['hasProfile', 'initialize', 'read', 'write', 'readAll', 'readAllVersioned', 'replaceAll']) ipcMain.handle(`state:${action}`, (event, ...args) => { trusted(event); return store[action](...args); });
ipcMain.handle('state:checkpoint', () => store.recoverySnapshot());
ipcMain.handle('account:status', () => ({ configured: false, signedIn: false }));
ipcMain.handle('account:google-configured', () => false);
for (const action of ['status', 'save', 'remove']) ipcMain.handle(`radar:key:${action}`, (event, owner, key) => { trusted(event); assert.equal(owner, profile); return bridge.radar.credentials[action](owner, key); });
const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/content/radar')) {
    assert.equal(url.searchParams.get('profile'), profile);
    assert.equal(url.searchParams.get('workspaceId'), workspaceId);
    if (unavailable) return json(res, { error: 'Not available' }, 404);
    if (url.pathname.endsWith('/synthesize') && synthesizeConflict) return json(res, { error: 'Conflito fixture', code: synthesizeConflict }, 409);
    if (url.pathname.endsWith('/promote') && failPromotion) { failPromotion = false; return json(res, { error: 'Falha temporária no vínculo', code: 'fixture_network' }, 503); }
    if (url.pathname === '/api/content/radar' && synthesisOverride) return json(res, { ...bridge.radar.snapshot(scope, { kind: url.searchParams.get('kind') || undefined }), synthesis: synthesisOverride });
    if (url.pathname.endsWith('/collect') && conflict) { conflict = false; bridge.radar.collect(scope, { reason: 'manual' }); }
  }
  if (await bridge.handle(req, res, url)) return;
  if (url.pathname.startsWith('/api/')) return json(res, url.pathname.endsWith('/health') ? { ready: false, status: 'disconnected' } : {});
  try {
    const dist = resolve(root, process.env.MAINSAGENTS_UI_DIST || '.mainsagents-workspaces/radar-ui-dist');
    const file = resolve(dist, url.pathname === '/' ? 'app.html' : url.pathname.slice(1));
    assert(file.startsWith(dist + sep));
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
const js = code => win.webContents.executeJavaScript(code);
const text = selector => js(`document.querySelector(${JSON.stringify(selector)})?.textContent || ''`);
async function until(check, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 60)); } throw Error(`Radar UI timed out: ${label}`); }
const errors = [];
const click = (selector, label) => js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(label)}));if(!el||el.disabled)throw Error('Missing/disabled '+${JSON.stringify(label)});el.click();return true})()`);
const set = (selector, value) => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return true})()`);
async function source(kind, value) { await set('.radar-add-source select', kind); await set('.radar-add-source input', value); await click('.radar-add-source button', 'Adicionar fonte'); }
async function shot(name) { writeFileSync(join(out, `${name}.png`), await captureReadyPng(win.webContents)); }
async function open() {
  win?.destroy();
  win = new BrowserWindow({ show: false, width: 1440, height: 1050, webPreferences: { preload: join(root, 'desktop-preload.cjs'), sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (/Uncaught|Maximum update depth|Cannot update a component/.test(event.message)) errors.push(event.message); });
  await win.loadURL(`http://127.0.0.1:${server.address().port}/app.html#radar`);
  await until(() => js('Boolean(document.querySelector(".radar-settings, .radar-empty"))'), 'Radar ready');
}
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await open();
    assert.match(await text('.radar-synthesis-settings'), /É preciso ter um agente Claude ou Codex salvo neste workspace/);
    await click('.radar-synthesis button', 'Gerar síntese agora');
    await until(async () => (await text('.radar-synthesis')).includes('Escolha e salve um agente'), '409 no_agent explanation');
    assert.equal(await js('document.querySelector(\'[data-od-id="nav-radar"]\')?.getAttribute("aria-current")'), 'page');
    await source('youtube-channel', channelId);
    await source('youtube-search', 'automação');
    await source('news-rss', 'https://example.com/rss');
    await source('hackernews', '100');
    await set('.radar-settings input[type=time]', '08:30');
    await click('.radar-settings button', 'Salvar configuração');
    await until(() => Promise.resolve(bridge.radar.snapshot(scope).config.sources.length === 4), 'sources persisted');
    await until(async () => (await text('.radar-settings')).includes('Configuração salva.'), 'save complete');
    await js('document.querySelector(".radar-settings").open=true');
    await set('.radar-key input', `AIza${'a'.repeat(35)}`);
    await click('.radar-key button', 'Salvar chave');
    await until(() => Promise.resolve(bridge.radar.credentials.status(profile).configured), 'key saved through preload');
    await until(() => js('!document.querySelectorAll(".radar-key button")[1].disabled'), 'remove key enabled');
    assert.equal(await js('document.querySelector(".radar-key input").value'), '');
    assert(!(await text('.radar-page')).includes('AIza'));
    await click('.radar-key button', 'Remover chave');
    await until(() => Promise.resolve(!bridge.radar.credentials.status(profile).configured), 'key removed');
    gate = new Promise(resolve => { release = resolve; });
    await click('.radar-head button', 'Coletar agora'); // backend returns 409 already_running
    await until(() => js('document.querySelector(".radar-head button")?.disabled && document.querySelector(".radar-head button").textContent.includes("Coletando")'), '409 rejoins active collection');
    release(); gate = null;
    await until(() => js('document.querySelectorAll(".radar-items>li").length===2'), 'poll receives collected items');
    assert.match(await text('.radar-items'), /base insuficiente/);
    assert.match(await text('.radar-source-list'), /chave gratuita da YouTube API/);
    await js('document.querySelector(".radar-settings").open=false');
    await shot('01-youtube-dark');
    clock = Date.parse('2026-10-28T12:00:00Z'); bump = 300;
    await click('.radar-head button', 'Coletar agora');
    await until(async () => !(await js('document.querySelector(".radar-head button").disabled')) && bridge.radar.snapshot(scope).runs.length === 2, 'second run done');
    await click('.radar-item-open', 'Vídeo sem contador');
    await until(() => js('document.querySelectorAll(".radar-history tbody tr").length===2'), 'snapshot series');
    assert.match(await text('.radar-history tbody'), /indisponível/);
    assert.match(await text('.radar-history'), /26\/10\/2026/);
    assert.match(await text('.radar-history'), /27\/10\/2026/);
    await shot('02-history-gaps');
    await click('.radar-history button', 'Voltar à lista');
    await click('.radar-tabs button', 'Notícias');
    await until(() => js('document.querySelectorAll(".radar-items>li").length===2 && document.querySelector(".radar-items").textContent.includes("Notícia fixture")'), 'news tab');
    await js('document.querySelector(".radar-section-head .radar-check input").click()');
    await until(() => js('document.querySelectorAll(".radar-items>li").length===1 && document.querySelector(".radar-items").textContent.includes("Hacker News fixture")'), 'highlight server filter');
    await js('document.documentElement.dataset.appearance="light";true');
    await shot('03-news-highlight-light');
    agents = [{ id: 'radar-agent', name: 'Analista Radar', workspaceId, providerId: 'codex', status: 'idle', role: 'Analista', description: '', instructions: '', tools: [] }];
    store.write(profile, 'agents', agents);
    await open();
    await js('document.querySelector(".radar-settings").open=true');
    await set('.radar-synthesis-settings select', 'radar-agent');
    await js('document.querySelector(".radar-synthesis-settings input[type=checkbox]").click()');
    await click('.radar-settings button', 'Salvar configuração');
    await until(() => Promise.resolve(bridge.radar.snapshot(scope).config.synthesis.enabled), 'synthesis config saved');
    await until(async () => (await text('.radar-settings')).includes('Configuração salva.'), 'synthesis save complete');
    assert.equal(bridge.radar.snapshot(scope).config.synthesis.agentId, 'radar-agent');
    for (const [code, message] of [['nothing_to_synthesize', 'Colete itens primeiro'], ['waiting_limit', 'liberação do uso da assinatura']]) {
      synthesizeConflict = code;
      await click('.radar-synthesis button', 'Gerar síntese agora');
      await until(async () => (await text('.radar-synthesis')).includes(message), `409 ${code}`);
    }
    synthesizeConflict = null;
    providerWait = { resetsAt: '2026-10-29T12:00:00Z' };
    await click('.radar-synthesis button', 'Gerar síntese agora');
    await until(async () => (await text('.radar-synthesis .radar-status')).includes('Aguardando limite'), 'waiting_limit state');
    assert.match(await text('.radar-synthesis'), /Aguardando até/);
    assert.equal(synthesisCalls, 0, 'waiting does not send an AI turn');
    providerWait = null;
    synthesisGate = new Promise(resolve => { releaseSynthesis = resolve; });
    await bridge.radar.synthesize(scope); // the renderer has not seen the running snapshot yet
    await click('.radar-synthesis button', 'Gerar síntese agora');
    await until(async () => (await text('.radar-synthesis')).includes('Já existe uma síntese em andamento'), '409 already_running');
    assert.equal(await js('document.querySelector(".radar-synthesis button").disabled'), true);
    releaseSynthesis(); synthesisGate = null;
    await until(async () => (await text('.radar-synthesis .radar-status')).includes('Pronta'), 'synthesis polled without a running collection');
    assert.equal(synthesisCalls, 1);
    assert.match(await text('.radar-recommendation-evidence'), /150/);
    assert.match(await text('.radar-recommendation-evidence'), /Coletado em/);
    assert.match(await text('.radar-recommendation-reading'), /Explicações alternativas/);
    assert.match(await text('.radar-recommendation-reading'), /Explicar a mudança em um tutorial próprio/);
    assert.match(await text('.radar-synthesis'), /A IA não assistiu aos vídeos/);
    // Recommendation belongs to the news tab, while this page still shows YouTube items.
    const recommendationId = bridge.radar.snapshot(scope).synthesis.recommendations[0].itemId;
    assert(!(await text('.radar-items')).includes('Hacker News fixture'));
    failPromotion = true;
    await click('.radar-recommendations button', 'Virar pauta');
    await until(async () => (await text('.radar-page')).includes('Não foi possível concluir o vínculo'), 'registration failure after editorial creation');
    await open(); // persisted receipt must prevent a second topic after remount
    await until(() => js('Boolean(document.querySelector(".radar-recommendations button:not(:disabled)"))'), 'promotion ready after reopen');
    await click('.radar-recommendations button', 'Virar pauta');
    await until(async () => (await text('.radar-recommendations')).includes('Pauta criada'), 'retry records original topic');
    await click('.radar-recommendations button', 'Salvar na biblioteca');
    await until(async () => (await text('.radar-recommendations')).includes('Salvo na biblioteca'), 'reference saved');
    const editorial = await (await fetch(`http://127.0.0.1:${server.address().port}/api/content/state?profile=${profile}`)).json();
    assert.equal(editorial.state.topics.length, 1);
    const reference = editorial.state.inspiration.references[0];
    assert.equal(reference.metadataStatus, 'not_collected');
    assert.deepEqual(reference.tags, ['radar', 'web']);
    assert.match(reference.notes, /Pontos: 150/);
    assert.match(reference.notes, /2026-10-28/);
    assert.match(reference.notes, /Ideia de pauta/);
    assert.equal(bridge.radar.history(scope, recommendationId).item.promoted.length, 2);
    await click('.radar-tabs button', 'Notícias');
    await until(async () => (await text('.radar-items')).includes('Pauta criada') && (await text('.radar-items')).includes('Salvo na biblioteca'), 'list and synthesis share promotion badges');
    await js('document.querySelector(".radar-settings").open=false');
    await shot('06-synthesis-ready-promoted');
    win.setSize(900, 1050);
    await js('document.documentElement.dataset.appearance="light";true');
    await shot('07-synthesis-light-narrow');
    assert.equal(await js('document.querySelector(".radar-synthesis").scrollWidth <= document.querySelector(".radar-synthesis").clientWidth'), true, 'synthesis fits the narrow layout');
    for (const [mode, label] of [['blocked', 'Bloqueada'], ['failed', 'Falhou']]) {
      synthesisMode = mode;
      await click('.radar-synthesis button', 'Gerar síntese agora');
      await until(async () => (await text('.radar-synthesis .radar-status')).includes(label), `${mode} synthesis state`);
    }
    synthesisOverride = { ...bridge.radar.snapshot(scope).synthesis, status: 'interrupted', message: 'O app fechou durante a síntese.' };
    await open();
    await until(async () => (await text('.radar-synthesis')).includes('Interrompida'), 'interrupted synthesis state');
    assert.match(await text('.radar-synthesis'), /O app fechou durante/);
    synthesisOverride = null;
    store.write(profile, 'language', 'en-US');
    await open();
    await until(async () => (await text('.radar-head')).includes('Collect now'), 'English UI');
    await until(() => js('document.querySelectorAll(".radar-items>li").length===2'), 'English items');
    assert.match(await text('.radar-items'), /insufficient baseline/);
    win.setSize(900, 1050);
    await shot('04-english-narrow');
    unavailable = true;
    await open();
    await until(async () => (await text('.radar-empty')).includes('Radar unavailable'), '404 unavailable');
    await shot('05-unavailable');
    assert.deepEqual(errors, []);
    console.log(`Radar UI passed (real backend + source/AI fixtures; interrupted snapshot fixture): ${out}`);
  } catch (error) { console.error(error); process.exitCode = 1; try { await shot('failure'); } catch {} }
  finally { release?.(); releaseSynthesis?.(); win?.destroy(); await bridge.close(); await new Promise(resolve => server.close(resolve)); store.close(); app.exit(process.exitCode || 0); }
});
