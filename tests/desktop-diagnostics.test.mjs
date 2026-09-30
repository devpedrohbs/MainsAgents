import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { guardTerminalPipe } from '../desktop-diagnostics.mjs';

test('closed launcher pipes are contained while unrelated errors remain visible', () => {
  const stream = new EventEmitter();
  const records = [];
  const dispose = guardTerminalPipe(stream, 'stderr', (entry) => records.push(entry));
  const failure = (code) => Object.assign(new Error(code), { code });
  assert.throws(() => stream.emit('error', failure('ERR_STREAM_DESTROYED')));
  stream.emit('error', failure('EPIPE'));
  stream.emit('error', failure('EPIPE'));
  stream.emit('error', failure('ERR_STREAM_DESTROYED'));
  assert.equal(records.length, 1);
  assert.match(records[0], /EPIPE/);
  assert.throws(() => stream.emit('error', failure('EACCES')), /EACCES/);
  dispose();
  assert.equal(stream.listenerCount('error'), 0);
});

test('real warnings survive closed stdout and stderr after a detached launch', { timeout: 10000 }, async () => {
  const moduleUrl = new URL('../desktop-diagnostics.mjs', import.meta.url).href;
  const code = `
    await import(${JSON.stringify(moduleUrl)});
    process.send('ready');
    process.once('message', () => {
      process.emitWarning('Canvas browser warning');
      console.error('browser warning'.repeat(8000));
      console.log('browser diagnostic'.repeat(8000));
      setTimeout(() => { process.send('survived'); process.disconnect(); }, 150);
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const messages = [];
  child.on('message', (message) => {
    messages.push(message);
    if (message === 'ready') {
      child.stdout.destroy();
      child.stderr.destroy();
      child.send('terminal closed');
    }
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 0);
  assert.ok(messages.includes('survived'));
});
