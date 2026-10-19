// Infrastructure probe for the Claude editor tools, WITHOUT any model inference.
// It builds the exact CLI arguments the bridge uses for an editor execution, starts the installed Claude Code
// CLI with them in stream-json input mode and only sends control requests (initialize, mcp_status): no user
// message is sent, so no model turn runs and no usage is consumed. It checks that the CLI accepts the flags,
// loads only the MainsAgents editor MCP server and lists every editor tool.
// Usage: node scripts/claude-editor-mcp-probe.mjs   (CLAUDE_CLI_PATH overrides the CLI location)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { createClaudeCodeBridge } from '../claude-code-bridge.mjs';
import { editorToolNames, EDITOR_SERVER } from '../editor-authoring.mjs';

function findCli() {
  if (process.env.CLAUDE_CLI_PATH) return resolve(process.env.CLAUDE_CLI_PATH);
  const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
  const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && existsSync(line));
  return (process.platform === 'win32' ? candidates.find((item) => extname(item).toLowerCase() === '.exe') : undefined) ?? candidates[0];
}

const cli = findCli();
if (!cli) { console.error('Claude Code CLI not found.'); process.exit(2); }
const version = execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
const root = mkdtempSync(join(tmpdir(), 'mainsagents-editor-probe-'));
let captured;
const holder = new EventEmitter(); holder.stdout = new PassThrough(); holder.stderr = new PassThrough(); holder.stdin = new PassThrough(); holder.kill = () => holder.emit('close', 1);
const bridge = createClaudeCodeBridge({ cwdRoot: root, resolveCli: () => ({ command: cli, prefixArgs: [] }), spawnImpl: (_resolved, args, options) => { captured = { args, options }; return holder; } });
const sha = createHash('sha256').update('probe').digest('hex');
const binding = { runId: 'probe', epoch: 1, profileId: 'probe', workspaceId: 'probe', agentId: 'probe', contentId: 'probe', authorityHash: 'probe', source: { assetId: 'probe', versionId: 'probe', sha256: sha } };
const host = { currentBinding: () => binding, context: async () => ({}), validatePlan: async () => ({ ok: false, errors: ['probe'] }) };
const { sessionId } = bridge.runtime.openEditorSession({ binding, host, grant: { scope: 'edit-local', authorityHash: 'probe' } });
await bridge.runtime.send('8a7c3b52-6a4f-4b8e-9d1c-2f3e4a5b6c7d', 'probe (never sent to a model)', { name: 'Probe', workspaceId: 'probe', tools: [], runtimeFirstMessage: true, editorSessionId: sessionId });

// Same flags, but control-protocol input and no persisted session.
const args = [...captured.args];
args[args.indexOf('--input-format') + 1] = 'stream-json';
const sessionFlag = args.indexOf('--session-id'); args.splice(sessionFlag, 2, '--no-session-persistence');
const child = spawn(cli, args, { cwd: captured.options.cwd, env: captured.options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const responses = new Map(); let buffer = '', stderr = '';
child.stdout.on('data', (chunk) => { buffer += chunk; for (let i; (i = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { const message = JSON.parse(line); if (message.type === 'control_response') responses.get(message.response?.request_id)?.(message.response); if (message.type === 'assistant' || message.type === 'result') throw new Error('Unexpected model output during an inference-free probe.'); } catch (error) { if (/Unexpected model/.test(error.message)) throw error; } } });
child.stderr.on('data', (chunk) => { stderr += chunk; });
const control = (id, subtype) => new Promise((resolveResponse, reject) => { const timer = setTimeout(() => reject(new Error(`No ${subtype} response. ${stderr.slice(0, 500)}`)), 30_000); responses.set(id, (response) => { clearTimeout(timer); resolveResponse(response); }); child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } })}\n`); });
let exitCode = 0;
const EXPECTED_TOOLS = 9;
// tools/list straight from the MCP server process the CLI was configured with (same env), no model: the served schema of
// get_transcript_words must carry the optional integer offset used to continue truncated pages.
async function servedTranscriptOffset() {
  const config = JSON.parse(readFileSync(captured.args[captured.args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers[EDITOR_SERVER];
  const server = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  try {
    const reply = await new Promise((resolveReply, reject) => { let text = ''; const timer = setTimeout(() => reject(new Error('MCP tools/list timeout')), 15_000); server.stdout.on('data', (chunk) => { text += chunk; const line = text.split('\n').find((item) => item.includes('"id":2')); if (line) { clearTimeout(timer); resolveReply(JSON.parse(line)); } }); server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } })}
${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}
`); });
    const tool = reply.result.tools.find((item) => item.name === 'get_transcript_words');
    return tool?.inputSchema?.properties?.offset?.type === 'integer' && tool.inputSchema.required.join() === 'start,end';
  } finally { server.kill(); }
}
try {
  const init = await control('init', 'initialize');
  if (init.subtype !== 'success') throw new Error(`initialize failed: ${JSON.stringify(init).slice(0, 300)}`);
  const status = await control('status', 'mcp_status');
  const servers = status.response?.mcpServers ?? [];
  const editor = servers.find((server) => server.name === EDITOR_SERVER);
  const tools = (editor?.tools ?? []).map((tool) => tool.name).sort();
  const checks = {
    cliVersion: version,
    flagsAccepted: true,
    onlyEditorServer: servers.length === 1 && !!editor,
    editorConnected: editor?.status === 'connected',
    allToolsListed: JSON.stringify(tools) === JSON.stringify([...editorToolNames].sort()),
    toolCount: tools.length,
    transcriptWordsOffset: await servedTranscriptOffset(),
    permissionMode: captured.args[captured.args.indexOf('--permission-mode') + 1],
    restricted: captured.args.includes('--restricted'),
    strictMcpConfig: captured.args.includes('--strict-mcp-config'),
    allowedTools: (() => { const rest = captured.args.slice(captured.args.indexOf('--allowedTools') + 1); const end = rest.findIndex((arg) => arg.startsWith('--')); return end < 0 ? rest : rest.slice(0, end); })(),
    builtInTools: captured.args[captured.args.indexOf('--tools') + 1] || '(none)',
    structuredReport: captured.args.includes('--json-schema'),
    modelTurns: 0,
  };
  console.log(JSON.stringify(checks, null, 2));
  if (!checks.onlyEditorServer || !checks.editorConnected || !checks.allToolsListed || checks.toolCount !== EXPECTED_TOOLS || !checks.transcriptWordsOffset) exitCode = 1;
} catch (error) {
  console.error(error.message); exitCode = 1;
} finally {
  child.stdin.end(); child.kill();
  holder.emit('close', 0);
  bridge.runtime.closeEditorSession(sessionId, 'closed');
  setTimeout(() => { rmSync(root, { recursive: true, force: true }); process.exit(exitCode); }, 500);
}
