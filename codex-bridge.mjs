import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';

export function codexLaunch({platform=process.platform,cliPath=process.env.CODEX_CLI_PATH,nodePath=process.execPath,appData=process.env.APPDATA??''}={}) {
  const cli=cliPath??(platform==='win32'?join(appData,'npm','node_modules','@openai','codex','bin','codex.js'):'codex');
  const javascript=/\.(?:mjs|cjs|js)$/i.test(cli);
  return {command:javascript?nodePath:cli,args:[...(javascript?[cli]:[]),'app-server','--stdio'],cli,javascript};
}

class AppServerClient {
  constructor(cwd) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed=false;
    const {command,args,cli,javascript}=codexLaunch();
    if(process.platform==='win32'&&!existsSync(cli))throw new Error('Codex CLI not found. Install @openai/codex or set CODEX_CLI_PATH.');
    const env=process.versions.electron&&javascript?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:process.env;
    this.process=spawn(command,args,{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,env});
    createInterface({ input: this.process.stdout }).on('line', (line) => this.handleLine(line));
    this.process.stderr.on('data', (chunk) => process.stderr.write(`[codex] ${chunk}`));
    this.process.on('exit', (code) => {
      this.closed=true;
      const error = new Error(`Codex app-server stopped with exit code ${code ?? 'unknown'}`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      for (const listener of this.listeners) listener({ method: 'bridge/error', params: { message: error.message } });
    });
    this.process.on('error',(error)=>{this.closed=true;for(const pending of this.pending.values())pending.reject(error);this.pending.clear()});
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
    if(this.closed)return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex ${method} timed out`))},30000);
      this.pending.set(id, { resolve:(value)=>{clearTimeout(timer);resolve(value)}, reject:(error)=>{clearTimeout(timer);reject(error)} });
      this.process.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method, params) { this.process.stdin.write(`${JSON.stringify({ method, params })}\n`); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { this.process.kill(); }
}

const executions = new Map();
const pendingEvents = new Map();
const activeThreadWriters = new Map();
const activeWriterMessage = 'This session already has a Codex response in progress. Wait for it to finish before sending another message.';

async function waitForExternalWriter(client, threadId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stored = await client.request('thread/read', { threadId, includeTurns: false });
    if (stored.thread?.status?.type !== 'active') return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

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
  if (terminal) {
    record.done = true;
    if (record.threadId && activeThreadWriters.get(record.threadId) === executionId) activeThreadWriters.delete(record.threadId);
  }
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
  const token=randomBytes(32).toString('hex');
  const client = new AppServerClient(cwd);
  connectNotifications(client);
  try{await client.ready}catch(error){client.close();throw error}
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const supplied=String(request.headers['x-mainsagents-bridge-token']??'');
    if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(response,403,{error:'Local bridge access denied'});
    try {
      if (request.method === 'GET' && url.pathname === '/api/codex/health') {
        const result = await client.request('account/read', { refreshToken: false });
        const ready = Boolean(result.account) || result.requiresOpenaiAuth === false;
        return json(response, ready ? 200 : 401, { ready, status: ready ? 'connected' : 'login-required', accountType: result.account?.type ?? null });
      }
      if (request.method === 'GET' && url.pathname === '/api/codex/usage') {
        const result = await client.request('account/rateLimits/read', {});
        return json(response, 200, { rateLimits: result.rateLimits ?? null, rateLimitsByLimitId: result.rateLimitsByLimitId ?? null, fetchedAt: new Date().toISOString() });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/login') {
        const result = await client.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' });
        return json(response, 200, { authUrl: result.authUrl, loginId: result.loginId });
      }
      if (request.method === 'GET' && url.pathname === '/api/codex/models') {
        const result = await client.request('model/list', { limit: 100, includeHidden: false });
        return json(response, 200, { models: (result.data ?? []).map((item) => ({ id: item.model ?? item.id, name: item.displayName ?? item.model ?? item.id, isDefault: Boolean(item.isDefault) })) });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/sessions') {
        const input = await body(request);
        const config = input.config ?? {};
        const skillsContext = config.skillsDirectory && Array.isArray(config.skills) && config.skills.length
          ? `\n\nThis agent may use only these associated skills from ${config.skillsDirectory}: ${config.skills.join(', ')}. Read the relevant skill Markdown file before using a selected skill (a standalone .md or SKILL.md). Do not use other skills from that directory.`
          : '';
        const params = { cwd, ...(config.modelId||process.env.MAINSAGENTS_CODEX_MODEL?{model:config.modelId||process.env.MAINSAGENTS_CODEX_MODEL}:{}), approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: `You are ${config.agentName ?? 'a MainsAgents specialist'}. ${config.instructions ?? ''}${skillsContext}`.trim(), serviceName: 'mainsagents' };
        if (input.threadId) {
          if (activeThreadWriters.has(input.threadId)) return json(response, 409, { error: activeWriterMessage });
          const stored = await client.request('thread/read', { threadId: input.threadId, includeTurns: false });
          if (stored.thread?.status?.type === 'active') return json(response, 409, { error: activeWriterMessage });
        }
        const result = input.threadId ? await client.request('thread/resume', { threadId: input.threadId }) : await client.request('thread/start', params);
        return json(response, 200, { threadId: result.thread.id });
      }
      if (request.method === 'POST' && url.pathname === '/api/codex/executions') {
        const input = await body(request);
        const threadId = input.threadId;
        if (!threadId) return json(response, 400, { error: 'A Codex thread is required to send a message.' });
        if (activeThreadWriters.has(threadId)) return json(response, 409, { error: activeWriterMessage });
        const context = (input.context ?? []).map((item) => `[${item.kind}] ${item.label}${item.content ? `\n${item.content}` : ''}`).join('\n\n');
        const text = context ? `${input.content}\n\nWorkspace context:\n${context}` : input.content;
        const lockToken = `pending-${randomBytes(12).toString('hex')}`;
        activeThreadWriters.set(threadId, lockToken);
        try {
          const stored = await client.request('thread/read', { threadId, includeTurns: false });
          if (stored.thread?.status?.type === 'active') {
            const becameIdle = await waitForExternalWriter(client, threadId);
            if (!becameIdle) {
              activeThreadWriters.delete(threadId);
              return json(response, 409, { error: 'Another Codex window is still finishing a response in this session. Wait for it to finish, then send again.' });
            }
          }
          const turnConfig = { threadId, input: [{ type: 'text', text }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' }, ...(typeof input.modelId === 'string' && input.modelId ? { model: input.modelId } : {}), ...(['low','medium','high','xhigh'].includes(input.reasoningEffort) ? { effort: input.reasoningEffort } : {}) };
          let result;
          try {
            result = await client.request('turn/start', turnConfig);
          } catch (error) {
            if (!/already has an active writer/i.test(error instanceof Error ? error.message : String(error))) throw error;
            const becameIdle = await waitForExternalWriter(client, threadId);
            if (!becameIdle) throw new Error('Another Codex window is still finishing a response in this session. Wait for it to finish, then send again.');
            result = await client.request('turn/start', turnConfig);
          }
          const executionId = result.turn.id;
          const record = recordFor(executionId, threadId);
          activeThreadWriters.set(threadId, executionId);
          if (record.done && activeThreadWriters.get(threadId) === executionId) activeThreadWriters.delete(threadId);
          return json(response, 200, { executionId, threadId });
        } catch (error) {
          if (activeThreadWriters.get(threadId) === lockToken) activeThreadWriters.delete(threadId);
          if (/already has an active writer/i.test(error instanceof Error ? error.message : String(error))) return json(response, 409, { error: activeWriterMessage });
          throw error;
        }
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
      const message = error instanceof Error ? error.message : String(error);
      const writerConflict = /already has an active writer|another Codex window is still finishing/i.test(message);
      json(response, writerConflict ? 409 : 500, { error: /another Codex window is still finishing/i.test(message) ? message : writerConflict ? activeWriterMessage : message });
    }
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve()})});
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`[MainsAgents] Codex bridge ready on http://127.0.0.1:${activePort}`);
  return { port: activePort, token, isAlive:()=>!client.closed, close: async () => { await new Promise((resolve) => server.close(resolve)); client.close(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\','/')}`).href) startCodexBridge().catch((error) => { console.error(error); process.exitCode = 1; });
