import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

class AppServerClient {
  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    const windowsCli = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const command = process.platform === 'win32' ? (process.versions.electron ? 'node' : process.execPath) : 'codex';
    const args = process.platform === 'win32' ? [windowsCli, 'app-server', '--stdio'] : ['app-server', '--stdio'];
    this.process = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    createInterface({ input: this.process.stdout }).on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (chunk) => process.stderr.write(`[codex] ${chunk}`));
    this.process.on('exit', (code) => {
      const error = new Error(`Codex app-server stopped with exit code ${code ?? 'unknown'}`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      for (const listener of this.listeners) listener({ method: 'bridge/error', params: { message: error.message } });
    });
    this.ready = this.initialize();
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'mainsagents', title: 'MainsAgents', version: '0.1.0' } });
    this.notify('initialized', {});
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message ?? 'Codex request failed')) : pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method, params) { this.process.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.process.kill(); }
}

const executions = new Map();
const pendingEvents = new Map();

function recordFor(executionId, threadId = '') {
  let record = executions.get(executionId);
  if (!record) {
    const events = pendingEvents.get(executionId) ?? [];
    record = { executionId, threadId, events, listeners: new Set(), done: events.some((event) => ['execution.completed','execution.cancelled','execution.failed'].includes(event.type)) };
    pendingEvents.delete(executionId);
    executions.set(executionId, record);
  }
  if (threadId) record.threadId = threadId;
  return record;
}

function publish(executionId, event) {
  if (!executionId) return;
  const record = executions.get(executionId);
  if (!record) { pendingEvents.set(executionId, [...(pendingEvents.get(executionId) ?? []), event]); return; }
  const terminal = ['execution.completed','execution.cancelled','execution.failed'].includes(event.type);
  if (record.done && terminal) return;
  record.events.push(event);
  for (const listener of record.listeners) listener(event);
  if (terminal) record.done = true;
}

function itemLabel(item) {
  if (item.type === 'webSearch') return { kind: 'search', label: item.query ? `Searching: ${item.query}` : 'Searching web...' };
  if (item.type === 'commandExecution') return { kind: 'tool', label: 'Using terminal...' };
  if (item.type === 'mcpToolCall') return { kind: 'tool', label: `Using ${item.server} · ${item.tool}...` };
  if (item.type === 'dynamicToolCall') return { kind: 'tool', label: `Using ${item.tool}...` };
  if (item.type === 'imageView') return { kind: 'tool', label: 'Reading image...' };
  if (item.type === 'fileChange') return { kind: 'tool', label: 'Preparing file changes...' };
  if (item.type === 'reasoning') return { kind: 'thinking', label: 'Thinking...' };
  return null;
}

function connectNotifications(client) {
  return client.subscribe((message) => {
    const params = message.params ?? {};
    const turnId = params.turnId ?? params.turn?.id;
    if (message.method === 'turn/started') publish(turnId, { type: 'execution.started', executionId: turnId, threadId: params.threadId ?? '' });
    if (message.method === 'item/agentMessage/delta') publish(turnId, { type: 'message.delta', executionId: turnId, delta: params.delta ?? '' });
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = params.item ?? {};
      if (message.method === 'item/completed' && item.type === 'agentMessage') publish(turnId, { type: 'message.completed', executionId: turnId, content: item.text ?? '' });
      const detail = itemLabel(item);
      if (detail?.kind === 'search') publish(turnId, { type: 'search', executionId: turnId, label: detail.label, status: message.method === 'item/started' ? 'started' : 'finished' });
      if (detail?.kind === 'thinking') publish(turnId, { type: 'activity', executionId: turnId, label: detail.label, status: message.method === 'item/started' ? 'started' : 'finished' });
      if (detail?.kind === 'tool') publish(turnId, { type: message.method === 'item/started' ? 'tool.started' : 'tool.finished', executionId: turnId, tool: item.type, callId: item.id ?? '', ...(message.method === 'item/started' ? { label: detail.label } : {}) });
    }
    if (message.method === 'turn/completed') {
      const status = params.turn?.status;
      if (status === 'completed') publish(turnId, { type: 'execution.completed', executionId: turnId });
      else if (status === 'interrupted') publish(turnId, { type: 'execution.cancelled', executionId: turnId });
      else publish(turnId, { type: 'execution.failed', executionId: turnId, code: 'turn_failed', message: params.turn?.error?.message ?? 'Codex execution failed', retryable: true });
    }
    if (message.method === 'error') publish(turnId, { type: 'execution.failed', executionId: turnId, code: 'runtime_error', message: params.error?.message ?? 'Codex runtime error', retryable: true });
    if (message.method === 'bridge/error') for (const record of executions.values()) if (!record.done) publish(record.executionId, { type: 'execution.failed', executionId: record.executionId, code: 'bridge_error', message: params.message, retryable: true });
  });
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export async function startCodexBridge({ port = 8787, cwd = process.cwd() } = {}) {
  const client = new AppServerClient(cwd);
  connectNotifications(client);
  await client.ready;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/codex/health') return json(response, 200, { ready: true });
      if (request.method === 'POST' && url.pathname === '/api/codex/sessions') {
        const input = await body(request);
        const config = input.config ?? {};
        const skillsContext = config.skillsDirectory
          ? `\n\nThis agent has skills available in: ${config.skillsDirectory}. Installed skills: ${(config.skills ?? []).join(', ') || 'scan the directory for SKILL.md files'}. Read and follow the relevant SKILL.md before using a skill.`
          : '';
        const params = { cwd, model: process.env.MAINSAGENTS_CODEX_MODEL ?? 'gpt-5.6-terra', approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: `You are ${config.agentName ?? 'a MainsAgents specialist'}. ${config.instructions ?? ''}${skillsContext}`.trim(), serviceName: 'mainsagents' };
        const result = input.threadId ? await client.request('thread/resume', { threadId: input.threadId, ...params }) : await client.request('thread/start', params);
        return json(response, 200, { threadId: result.thread.id });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/executions') {
        const input = await body(request);
        const context = (input.context ?? []).map((item) => `[${item.kind}] ${item.label}${item.content ? `\n${item.content}` : ''}`).join('\n\n');
        const text = context ? `${input.content}\n\nWorkspace context:\n${context}` : input.content;
        const result = await client.request('turn/start', { threadId: input.threadId, input: [{ type: 'text', text }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
        const executionId = result.turn.id;
        recordFor(executionId, input.threadId);
        return json(response, 200, { executionId, threadId: input.threadId });
      }
      const eventMatch = url.pathname.match(/^\/api\/codex\/executions\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventMatch) {
        const record = recordFor(decodeURIComponent(eventMatch[1]));
        response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const write = (event) => response.write(`${JSON.stringify(event)}\n`);
        record.events.forEach(write);
        if (record.done) return response.end();
        record.listeners.add(write);
        request.on('close', () => record.listeners.delete(write));
        const finish = (event) => { if (event.type.startsWith('execution.') && !['execution.started'].includes(event.type)) { record.listeners.delete(finish); response.end(); } };
        record.listeners.add(finish);
        return;
      }
      const cancelMatch = url.pathname.match(/^\/api\/codex\/executions\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        const executionId = decodeURIComponent(cancelMatch[1]);
        const record = executions.get(executionId);
        if (!record?.threadId) return json(response, 404, { error: 'Execution not found' });
        await client.request('turn/interrupt', { threadId: record.threadId, turnId: executionId });
        return json(response, 200, {});
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve()})});
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`[MainsAgents] Codex bridge ready on http://127.0.0.1:${activePort}`);
  return { port: activePort, close: async () => { await new Promise((resolve) => server.close(resolve)); client.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href) startCodexBridge().catch((error) => { console.error(error); process.exitCode = 1; });
