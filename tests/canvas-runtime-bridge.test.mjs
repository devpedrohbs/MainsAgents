import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCanvasRuntimeBridge } from '../canvas-runtime-bridge.mjs';

async function withServer(bridge, run) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    void bridge.handle(request, response, url).then((handled) => {
      if (!handled && !response.writableEnded) response.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: (value) => { child.script = value; } };
  child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
  return child;
}

test('Canvas terminal runs only a submitted command and streams its output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-canvas-test-'));
  const children = [];
  const calls = [];
  const bridge = createCanvasRuntimeBridge({
    cwdRoot: root,
    platform: 'win32',
    env: {},
    spawnImpl: (executable, args, options) => { const child = fakeChild(); children.push(child); calls.push({ executable, args, options }); return child; },
  });
  try {
    await withServer(bridge, async (base) => {
      const response = await fetch(`${base}/api/canvas/executions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'Write-Output "hello"', workspaceId: 'Tech News' }) });
      assert.equal(response.status, 201);
      const execution = await response.json();
      assert.equal(execution.shell, 'powershell.exe');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].executable, 'powershell.exe');
      assert.deepEqual(calls[0].args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']);
      assert.equal(children[0].script, 'Write-Output "hello"\n');
      assert.equal(calls[0].options.cwd, join(root, 'tech-news'));

      children[0].stdout.emit('data', 'hello\r\n');
      children[0].emit('close', 0, null);
      const stream = await fetch(`${base}/api/canvas/executions/${execution.id}/events`).then((item) => item.text());
      assert.match(stream, /"type":"output","stream":"stdout","text":"hello\\r\\n"/);
      assert.match(stream, /"type":"finished","code":0/);
      const events = stream.trim().split(/\r?\n\r?\n/).map((entry) => JSON.parse(entry.replace(/^data: /, '')));
      assert.deepEqual(events.map((event) => event.sequence), [0, 1, 2]);
      const resumed = await fetch(`${base}/api/canvas/executions/${execution.id}/events`).then((item) => item.text());
      assert.equal(resumed, stream, 'replayed events keep stable identities so the UI can avoid duplicate output');
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Canvas terminal rejects an empty command and can cancel a running execution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-canvas-cancel-test-'));
  const children = [];
  const bridge = createCanvasRuntimeBridge({ cwdRoot: root, platform: 'win32', env: {}, spawnImpl: () => { const child = fakeChild(); children.push(child); return child; } });
  try {
    await withServer(bridge, async (base) => {
      const invalid = await fetch(`${base}/api/canvas/executions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: '  ' }) });
      assert.equal(invalid.status, 400);
      assert.equal(children.length, 0);

      const started = await fetch(`${base}/api/canvas/executions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'Start-Process notepad' }) }).then((item) => item.json());
      const cancelled = await fetch(`${base}/api/canvas/executions/${started.id}/cancel`, { method: 'POST' }).then((item) => item.json());
      assert.equal(cancelled.cancelled, true);
      const stream = await fetch(`${base}/api/canvas/executions/${started.id}/events`).then((item) => item.text());
      assert.match(stream, /"type":"cancelled"/);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
