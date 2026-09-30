import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const terminalEventTypes = new Set(['finished', 'failed', 'cancelled']);

function slug(value) {
  return String(value ?? 'default')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'default';
}

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON request.'); }
}

export function createCanvasRuntimeBridge({
  cwdRoot = join(homedir(), 'Documents', 'MainsAgents Workspace', 'Canvas'),
  spawnImpl = spawn,
  platform = process.platform,
  env = process.env,
  timeoutMs = 5 * 60_000,
  maxOutputChars = 80_000,
  maxExecutions = 24,
} = {}) {
  const executions = new Map();

  function publish(record, event) {
    event.sequence = record.events.length;
    record.events.push(event);
    if (event.type === 'output') {
      record.outputChars += event.text.length;
      if (record.outputChars > maxOutputChars) {
        const overflow = record.outputChars - maxOutputChars;
        event.text = `${event.text.slice(Math.min(overflow, event.text.length))}`;
        record.outputChars = maxOutputChars;
      }
    }
    for (const listener of record.listeners) listener(event);
    if (terminalEventTypes.has(event.type)) record.done = true;
  }

  function prune() {
    if (executions.size < maxExecutions) return;
    for (const [id, record] of executions) {
      if (record.done) executions.delete(id);
      if (executions.size < maxExecutions) return;
    }
  }

  function start(command, workspaceId) {
    prune();
    if (executions.size >= maxExecutions) throw new Error('Too many terminal commands are still running. Cancel or finish one and try again.');

    const cwd = join(cwdRoot, slug(workspaceId));
    mkdirSync(cwd, { recursive: true });
    const id = randomUUID();
    const isWindows = platform === 'win32';
    const executable = isWindows ? (env.MAINSAGENTS_TERMINAL_SHELL || 'powershell.exe') : (env.SHELL || '/bin/sh');
    const args = isWindows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'] : ['-s'];
    const record = { id, cwd, events: [], listeners: new Set(), done: false, outputChars: 0, child: null, timer: null };
    executions.set(id, record);

    try {
      record.child = spawnImpl(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      executions.delete(id);
      throw new Error(`Could not start the local terminal: ${error instanceof Error ? error.message : String(error)}`);
    }

    publish(record, { type: 'started', cwd });
    const capture = (stream) => (chunk) => publish(record, { type: 'output', stream, text: String(chunk) });
    record.child.stdout?.on('data', capture('stdout'));
    record.child.stderr?.on('data', capture('stderr'));
    record.child.once('error', (error) => {
      clearTimeout(record.timer);
      publish(record, { type: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
    record.child.once('close', (code, signal) => {
      clearTimeout(record.timer);
      if (record.done) return;
      publish(record, { type: 'finished', code, signal });
    });
    record.timer = setTimeout(() => {
      if (record.done) return;
      record.child.kill();
      publish(record, { type: 'failed', message: 'Command stopped after five minutes.' });
    }, timeoutMs);
    record.timer.unref?.();
    record.child.stdin?.end(`${command}\n`);
    return { id, cwd, shell: executable };
  }

  function stream(record, response) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    });
    response.flushHeaders?.();
    const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    record.events.forEach(send);
    if (record.done) { response.end(); return; }
    const listener = (event) => {
      send(event);
      if (terminalEventTypes.has(event.type)) response.end();
    };
    record.listeners.add(listener);
    response.on('close', () => record.listeners.delete(listener));
  }

  async function handle(request, response, url = new URL(request.url ?? '/', 'http://127.0.0.1')) {
    if (url.pathname === '/api/canvas/executions' && request.method === 'POST') {
      let input;
      try { input = await readJson(request); }
      catch (error) { json(response, 400, { error: error.message }); return true; }
      const command = typeof input.command === 'string' ? input.command.trim() : '';
      if (!command) { json(response, 400, { error: 'Enter a command before running it.' }); return true; }
      if (command.length > 8_000) { json(response, 413, { error: 'Commands must be under 8,000 characters.' }); return true; }
      try { json(response, 201, start(command, input.workspaceId)); }
      catch (error) { json(response, 503, { error: error instanceof Error ? error.message : String(error) }); }
      return true;
    }

    const match = url.pathname.match(/^\/api\/canvas\/executions\/([0-9a-f-]+)(?:\/(events|cancel))?$/i);
    if (!match) return false;
    const [, id, action] = match;
    const record = executions.get(id);
    if (!record) { json(response, 404, { error: 'This terminal run is no longer available.' }); return true; }
    if (action === 'events' && request.method === 'GET') { stream(record, response); return true; }
    if (action === 'cancel' && request.method === 'POST') {
      if (!record.done) {
        record.child?.kill();
        publish(record, { type: 'cancelled' });
      }
      json(response, 200, { cancelled: true });
      return true;
    }
    json(response, 405, { error: 'Method not allowed.' });
    return true;
  }

  return { handle };
}
