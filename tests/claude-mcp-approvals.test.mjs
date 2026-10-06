import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createClaudeCodeBridge } from '../claude-code-bridge.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => child.emit('close', 1);
  return child;
}

/** Talks to the real permission MCP server exactly as Claude Code would (stdio JSON-RPC). */
async function askGate(server, toolName, input) {
  const child = spawn(process.execPath, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = new Map(); let buffer = '';
  child.stdout.on('data', (chunk) => { buffer += chunk; for (let i; (i = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); const message = JSON.parse(line); replies.get(message.id)?.(message); } });
  const call = (id, method, params) => new Promise((resolve) => { replies.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  try {
    await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const tools = await call(2, 'tools/list', {});
    assert.equal(tools.result.tools[0].name, 'approve');
    const result = await call(3, 'tools/call', { name: 'approve', arguments: { tool_name: toolName, input, tool_use_id: 'toolu_1' } });
    return JSON.parse(result.result.content[0].text);
  } finally { child.kill(); }
}

test('Claude MCP calls go through the MainsAgents approval gate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-claude-mcp-'));
  const registered = []; let launched;
  const binding = { profileId: 'p', sessionId: 's', agentId: 'a', agentName: 'Agent', workspaceId: 'w', hash: 'h', agent: { providerId: 'claude' } };
  const approvals = {
    claudeBinding: () => binding,
    actions: {
      register: (call, bound, reply) => { registered.push({ call, bound }); reply({ action: call.tool === 'notion-search' ? 'accept' : 'decline', content: null }); return 'action-1'; },
      settle: () => {}, interrupt: () => {},
    },
  };
  const bridge = createClaudeCodeBridge({ cwdRoot: root, resolveCli: () => ({ command: 'claude', prefixArgs: [] }), getApprovals: () => approvals, spawnImpl: (_resolved, args) => { launched = { args, child: fakeChild() }; return launched.child; } });
  try {
    await bridge.runtime.send('8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', 'Find the idea card', { name: 'Agent', tools: [], runtimeFirstMessage: true });
    const { args } = launched;
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
    assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'mcp__mainsagents__approve');
    assert(!args.includes('--strict-mcp-config'), 'Claude keeps the person\'s own MCP servers and claude.ai connectors');
    assert(!args.includes('mcp__*') || args[args.indexOf('mcp__*') - 1] !== '--disallowedTools');
    const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    assert.deepEqual(settings.permissions.ask, ['mcp__*'], 'user allow-rules can never skip the gate');
    const gate = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.mainsagents;
    assert.deepEqual(await askGate(gate, 'mcp__claude_ai_Notion__notion-search', { query: 'ideia' }), { behavior: 'allow', updatedInput: { query: 'ideia' } });
    assert.equal((await askGate(gate, 'mcp__zernio__posts_create', { text: 'x' })).behavior, 'deny');
    assert.equal((await askGate(gate, 'Bash', { command: 'rm -rf /' })).behavior, 'deny', 'built-in tools are never widened by the gate');
    assert.equal(registered.length, 2);
    assert.deepEqual([registered[0].call.server, registered[0].call.tool], ['claude_ai_Notion', 'notion-search']);
    assert.equal(registered[0].bound, binding);
    launched.child.emit('close', 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
