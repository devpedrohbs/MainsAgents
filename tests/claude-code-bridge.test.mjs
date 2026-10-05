import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClaudeCodeBridge } from '../claude-code-bridge.mjs';

async function withServer(bridge, run) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    void bridge.handle(request, response, url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('Claude status explains when the CLI is not installed', async () => {
  const bridge = createClaudeCodeBridge({ resolveCli: () => null, platform: 'win32' });
  const response = await bridge.status();
  assert.equal(response.state, 'not-installed');
  assert.equal(response.authMode, 'cli');
  assert.match(response.installCommand, /claude\.ai\/install\.ps1/);
  assert.equal(response.loginCommand, 'claude auth login');
});

test('Claude CLI bridge creates a resumable session and streams CLI output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-claude-test-'));
  const fakeCli = `
const fs=require('node:fs'),assert=require('node:assert/strict');
const args = process.argv.slice(2);
if(args.includes('--print')){
 assert(!args.includes('--bare'));assert(args.includes('--strict-mcp-config'));assert(args.includes('--disable-slash-commands'));
 assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');
 assert.deepEqual(JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config')+1])),{mcpServers:{}});
 assert.equal(JSON.parse(fs.readFileSync(args[args.indexOf('--settings')+1])).disableAllHooks,true);
 assert(!args[args.indexOf('--tools')+1].includes('Bash'));assert(!args[args.indexOf('--tools')+1].includes('Skill'));
}
if (args[0] === 'auth' && args[1] === 'status') {
  process.stdout.write(JSON.stringify({ loggedIn: true }));
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    const id = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1];
    if (!id || !input.includes('MainsAgents agent:')) process.exitCode = 2;
    const answer = args.includes('--resume') ? 'Sessão retomada.' : 'Resposta da CLI: ' + (process.env.CLAUDE_CODE_EFFORT_LEVEL || 'unset');
    const delta = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: answer } } };
    process.stdout.write(JSON.stringify(delta) + '\\n');
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: answer }) + '\\n');
  });
}
`;
  const fakeCliPath=join(root,'fake-claude.cjs');
  writeFileSync(fakeCliPath,fakeCli);
  const bridge = createClaudeCodeBridge({
    cwdRoot: root,
    resolveCli: () => ({ command: process.execPath, prefixArgs: [fakeCliPath] }),
  });
  try {
    await withServer(bridge, async (base) => {
      const status = await fetch(`${base}/api/providers/claude/status`).then((response) => response.json());
      assert.equal(status.state, 'connected');

      const session = await fetch(`${base}/api/providers/claude/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentName: 'TechNews', workspaceId: 'news', instructions: 'Pesquise tendências.' }) }).then((response) => response.json());
      assert.match(session.remoteSessionId, /^[0-9a-f-]{36}$/i);

      const executionResponse = await fetch(`${base}/api/providers/claude/executions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ remoteSessionId: session.remoteSessionId, content: 'Encontre três novidades de IA.', instructions: 'Pesquise tendências.', agentName: 'TechNews', workspaceId: 'news', tools: ['web-search'], firstMessage: true, modelId: 'sonnet', reasoningEffort: 'high' }) });
      assert.equal(executionResponse.status, 200);
      const execution = await executionResponse.json();
      const stream = await fetch(`${base}/api/providers/claude/executions/${execution.executionId}/events`).then((response) => response.text());
      const events = stream.trim().split('\n').map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === 'message.delta' && event.delta === 'Resposta da CLI: high'), stream);
      assert.ok(events.some((event) => event.type === 'message.completed' && event.content === 'Resposta da CLI: high'));
      assert.ok(events.some((event) => event.type === 'execution.completed'));

      const resumed = await fetch(`${base}/api/providers/claude/sessions/${session.remoteSessionId}/resume`, { method: 'POST' }).then((response) => response.json());
      assert.equal(resumed.remoteSessionId, session.remoteSessionId);
      const nextExecution=await fetch(`${base}/api/providers/claude/executions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({remoteSessionId:session.remoteSessionId,content:'Continue a pesquisa.',agentName:'TechNews',workspaceId:'news',tools:['web-search'],firstMessage:false,modelId:'sonnet'})}).then((response)=>response.json());
      const nextStream=await fetch(`${base}/api/providers/claude/executions/${nextExecution.executionId}/events`).then((response)=>response.text());
      assert.ok(nextStream.includes('Sessão retomada.'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
