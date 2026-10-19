import { createUsageCollector } from './claude-usage.mjs';
import { createClaudeLimitObserver, limitFailure } from './provider-limits.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notionAutomationInstructions } from './notion-automation-policy.mjs';
import { paperDesignInstructions } from './paper-design.mjs';
import { scheduleTool } from './chat-publishing.mjs';
import { publishingInstructions } from './publishing-automation.mjs';
import { permittedMcpAction } from './runtime-tool-policy.mjs';
import { inspectPaperDesktop } from './paper-desktop.mjs';
import { createEditorAuthoring, EDITOR_REPORT_SCHEMA, EDITOR_SERVER, EDITOR_TOOLS, EDITOR_TURNS, editorTurnBudget, readOnlyEditorTools, reconcileEditorReport } from './editor-authoring.mjs';

// Packaged builds unpack this script (build.asarUnpack) so the Claude CLI can start it as a plain process.
const permissionServerScript = join(dirname(fileURLToPath(import.meta.url)), 'claude-permission-mcp.mjs').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
const approvalServer = 'mainsagents';
// Bounded scheduling service (chat-publishing.mjs): its authority is the saved chat request + agent preference, checked by the host.
const publishingServer = 'mainsagents_publishing';
const publishingToolDefinition = { name: scheduleTool.name, description: scheduleTool.description, inputSchema: scheduleTool.inputSchema };

const terminalEvents = new Set(['execution.completed', 'execution.cancelled', 'execution.failed']);
const modelOptions = [
  { id: 'sonnet', name: 'Claude Sonnet' },
  { id: 'opus', name: 'Claude Opus' },
  { id: 'haiku', name: 'Claude Haiku' },
];

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Message exceeds 2 MB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function defaultResolver() {
  if (process.env.CLAUDE_CLI_PATH) {
    const command = resolve(process.env.CLAUDE_CLI_PATH);
    return existsSync(command) ? { command, prefixArgs: [] } : null;
  }
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', timeout: 2500, windowsHide: true });
    const candidates = output.split(/\r?\n/).map((item) => item.trim()).filter((item) => item && existsSync(item));
    const command = process.platform === 'win32' ? candidates.find((item) => extname(item).toLowerCase() === '.exe') ?? candidates[0] : candidates[0];
    return command ? { command, prefixArgs: [] } : null;
  } catch {
    return null;
  }
}

function cliLaunch(resolved, args, options = {}) {
  const command = resolved.command;
  const needsShell = process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(command).toLowerCase());
  if (needsShell && /[\r\n\0&|<>^()%!]/.test(command)) throw new Error('The Claude CLI launcher path contains unsupported shell characters.');
  if (needsShell && args.some((arg) => /[\r\n\0&|<>^()%!]/.test(arg))) throw new Error('The selected local path contains characters unsupported by the Claude CLI launcher.');
  const safeArgs = needsShell ? args.map((arg) => arg.startsWith('--') || /^[\w.,*-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '')}"`) : args;
  return spawn(command, [...(resolved.prefixArgs ?? []), ...safeArgs], {
    windowsHide: true,
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    ...(needsShell ? { shell: true } : {}),
  });
}

function capture(resolved, args, timeoutMs = 12_000) {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    let stderr = '';
    let settled = false;
    const child = cliLaunch(resolved, args);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolvePromise(result);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Claude Code CLI check timed out.')); }, timeoutMs);
    child.stdout?.on('data', (chunk) => { if (output.length < 256_000) output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { if (stderr.length < 32_000) stderr += chunk.toString(); });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(null, { code: code ?? 1, output, stderr }));
  });
}

function toolAllowList(config) {
  const tools = new Set();
  if (config.tools?.includes('web-search')) { tools.add('WebSearch'); tools.add('WebFetch'); }
  if (config.tools?.includes('files')) { tools.add('Read'); tools.add('Glob'); tools.add('Grep'); }
  // Associated skill instructions are provided as bounded text/file context, not executable CLI plugins.
  return [...tools];
}

const editorLabels = { get_context: 'Reading the edit context...', get_transcript_words: 'Reading spoken words...', get_frames: 'Looking at video frames...', contact_sheet: 'Reviewing a contact sheet...', storyboard_stills: 'Checking every scene...', write_plan: 'Writing the edit plan...', render_preview: 'Rendering a local preview...', finalize: 'Requesting the final export...', export_status: 'Checking the final export...' };
const editorPrefix = `mcp__${EDITOR_SERVER}__`;

/** Protocol appended to editor executions; the production prompt (coordinator) carries the brief itself. */
function editorProtocol(limits, reviewer) {
  return `
MainsAgents editor tools (local, already authorized for this edit only):
- Start with get_context: it carries the editing guidance (app guide + the editor agent's enabled skills, read by the app) as reference data. Use get_transcript_words for real word timings (source timeline) when placing cuts and highlights.
- Look at real frames (get_frames / contact_sheet) before deciding motion or cuts; never describe frames you did not receive.
- After each plan revision, inspect every scene (storyboard_stills, or frames with target {"revision": N}); a short preview alone does not cover the whole video.
- Write the plan with write_plan (baseRevision = current revision) and fix the validator errors it returns.
- get_context.retakes lists semantic-cut EVIDENCE (restarts, false starts, "errei, vou falar de novo", corrected numbers) with real words and approximate times. You decide by meaning which take stays; keep intentional repetition and expressive pauses; declare each decision in write_plan.cutDecisions (cut|keep|review + reason). When unsure, keep it and mark review.
- get_context.localAdjust (when present) is a localized visual adjustment of a delivered edit: change only scenes inside its window; cuts, audio and everything outside stay identical (the host refuses any other difference).
- Render a short preview (render_preview), inspect its frames${reviewer ? ' (you may ask the frame-reviewer agent for a second look)' : ''} and revise only when needed: at most ${limits.maxRevisions} revision(s) and ${limits.maxPreviews} preview(s).
- Finish with finalize on the revision you approve. Only the app reports the exported file: never state a file path or claim an export the tool did not confirm.
- There is no shell, file writing or publishing here; do not ask for them.`;
}

function editorSummary(block) {
  const content = Array.isArray(block.content) ? block.content : [{ type: 'text', text: block.content }];
  const text = content.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  return text ? `${block.is_error ? 'Refused: ' : ''}${text}`.slice(0, 300) : undefined;
}

function safeLabel(tool) {
  if (tool.startsWith(editorPrefix) && editorLabels[tool.slice(editorPrefix.length)]) return editorLabels[tool.slice(editorPrefix.length)];
  if (tool === 'Agent' || tool === 'Task') return 'Asking the frame reviewer...';
  if (tool === 'WebSearch') return 'Searching web...';
  if (tool === 'WebFetch') return 'Reading a web page...';
  if (tool === 'Read') return 'Reading a file...';
  if (tool === 'Skill') return 'Using an installed skill...';
  if (tool === 'Glob' || tool === 'Grep') return 'Searching workspace files...';
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return `Using ${mcp[1]}: ${mcp[2]}...`;
  return 'Using a tool...';
}

function makeUserPrompt(input, config) {
  const instructions = input.firstMessage ? String(input.instructions ?? config.instructions ?? '').trim() : '';
  const agentName = String(input.agentName ?? config.agentName ?? 'MainsAgents agent').slice(0, 120);
  const role = String(input.role ?? config.role ?? '').slice(0, 180);
  const context = Array.isArray(input.context) ? input.context.slice(0, 30).map((item) => {
    const label = String(item.label ?? 'Canvas item').slice(0, 200);
    const text = String(item.content ?? '').slice(0, 12_000);
    return `[${String(item.kind ?? 'note').slice(0, 40)}] ${label}${text ? `\n${text}` : ''}`;
  }).join('\n\n') : '';
  // Editor runs cannot read the skills directory; the host passes any needed skill text as context.
  const skills=!config.editorLimits&&Array.isArray(config.skills)&&config.skills.length?`\nEnabled agent skills: ${config.skills.join(', ')}. Use only these skills from ${config.skillsDirectory ?? 'the configured skills directory'}.`:'';
  return [
    `MainsAgents agent: ${agentName}${role ? ` — ${role}` : ''}`,
    instructions ? `\nAgent instructions:\n${instructions}` : '',
    skills,
    context ? `\nSelected workspace context:\n${context}` : '',
    `\nUser message:\n${String(input.content ?? '').trim()}`,
    notionAutomationInstructions(config),
    paperDesignInstructions(config),
    config.publishingTool ? publishingInstructions({ providerId: 'claude', publishingAutomation: config.publishingAutomation }) : '',
    config.editorLimits ? editorProtocol(config.editorLimits, !!config.editorReviewerModel) : '',
  ].join('\n');
}

export function createClaudeCodeBridge({
  resolveCli = defaultResolver,
  cwdRoot = join(homedir(), 'Documents', 'MainsAgents Workspace', 'Claude'),
  spawnImpl = cliLaunch,
  platform = process.platform,
  getApprovals,
  bindingWaitMs = 5000,
  editorAuthoring = createEditorAuthoring(),
  inspectPaper = inspectPaperDesktop,
} = {}) {
  const executions = new Map();
  // Local permission gate: Claude's --permission-prompt-tool reaches this loopback server with a per-execution token.
  const gateTokens = new Map();
  let gate;
  const gateUrl = () => {
    if (gate) return gate.ready;
    const server = createServer((request, response) => void (async () => {
      const header = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
      // Editor tools: the token identifies one attached execution; the authoring module checks binding, budget and order.
      if (request.method === 'POST' && request.url === '/editor') {
        let body; try { body = await readBody(request); } catch { return json(response, 400, { content: [{ type: 'text', text: 'Invalid editor request.' }], isError: true }); }
        return json(response, 200, await editorAuthoring.call(header, String(body.name ?? ''), body.arguments));
      }
      const record = [...gateTokens.entries()].find(([token]) => token.length === header.length && timingSafeEqual(Buffer.from(token), Buffer.from(header)))?.[1];
      if (request.method === 'POST' && request.url === '/publishing' && record) {
        let body; try { body = await readBody(request); } catch { return json(response, 400, { content: [{ type: 'text', text: 'Invalid scheduling request.' }], isError: true }); }
        return json(response, 200, await publishingCall(record, body));
      }
      if (request.method !== 'POST' || request.url !== '/permission' || !record) return json(response, 403, { behavior: 'deny', message: 'Unknown MainsAgents execution.' });
      let body; try { body = await readBody(request); } catch { return json(response, 400, { behavior: 'deny', message: 'Invalid permission request.' }); }
      json(response, 200, await decidePermission(record, body));
    })().catch(() => json(response, 500, { behavior: 'deny', message: 'MainsAgents could not confirm this tool call.' })));
    server.unref?.();
    gate = { server, ready: new Promise((resolveUrl, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveUrl(`http://127.0.0.1:${server.address().port}/permission`)); }) };
    return gate.ready;
  };
  async function prepareGate(record) {
    record.approvals = new Map();
    if (record.config.editorSessionId) {
      // Editor executions load only the editor server, so no MCP approval gate is needed.
      const url = await gateUrl();
      record.editorUrl = url.replace(/\/permission$/, '/editor');
      record.editorToken = editorAuthoring.attach(record.config.editorSessionId, record.id);
      return;
    }
    if (!getApprovals) return;
    try { record.gateUrl = await gateUrl(); record.gateToken = randomUUID() + randomUUID(); gateTokens.set(record.gateToken, record); }
    catch { record.gateUrl = undefined; }
  }
  async function publishingCall(record, body) {
    const approvals = getApprovals?.(), binding = approvals?.claudeBinding(record.remoteSessionId);
    const failure = text => ({ content: [{ type: 'text', text }], isError: true });
    if (!approvals?.chatPublishing || !binding) return failure('Scheduling is unavailable in this chat. Nothing was scheduled.');
    if (String(body.name ?? '') !== scheduleTool.name) return failure('Unsupported scheduling tool.');
    try {
      const result = await approvals.chatPublishing.call(binding, body.arguments && typeof body.arguments === 'object' ? body.arguments : {}, { executionId: record.id, callId: randomUUID() });
      return { content: [{ type: 'text', text: String(result.content ?? '').slice(0, 64000) }], isError: result.success !== true };
    } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
  }
  /** A successful Paper export call: the host records its actual result (paths, size, sha256) as session receipts. */
  function capturePaperExport(record, approvalId, block) {
    const approvals = getApprovals?.();
    if (!approvals?.paperAssets || block.is_error) return;
    const binding = approvals.claudeBinding(record.remoteSessionId);
    const action = binding && approvals.actions.list(binding.profileId, binding.sessionId).find((item) => item.id === approvalId);
    if (!action || action.server !== 'paper' || action.tool !== 'export' || action.status !== 'succeeded') return;
    approvals.paperAssets.captureExport({ binding, callId: `${record.remoteSessionId}:${block.tool_use_id}`, arguments: action.arguments, result: { content: block.content } })
      .catch((error) => console.error(`[MainsAgents] Paper export receipt not recorded: ${error.message}`));
  }
  async function decidePermission(record, body) {
    const toolName = String(body.toolName ?? '');
    const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
    // Built-in tools outside the agent's allow-list were already excluded with --tools; never widen them here.
    if (!mcp || mcp[1] === approvalServer) return { behavior: 'deny', message: 'This tool is not enabled for this MainsAgents agent.' };
    // The scheduling service checks the saved request/preference itself; no second per-call approval.
    if (mcp[1] === publishingServer && mcp[2] === scheduleTool.name && getApprovals?.()?.chatPublishing) return { behavior: 'allow' };
    const approvals = getApprovals?.();
    if (!approvals) return { behavior: 'deny', message: 'MainsAgents approvals are unavailable. The tool call was not run.' };
    const resolveBinding = () => approvals.claudeBinding(record.remoteSessionId);
    let binding = resolveBinding();
    for (const deadline = Date.now() + bindingWaitMs; !binding && Date.now() < deadline && !record.done;) { await new Promise((wait) => setTimeout(wait, 250)); binding = resolveBinding(); }
    if (!binding) return { behavior: 'deny', message: 'Save the agent and session before using MCP tools.' };
    const input = body.input && typeof body.input === 'object' ? body.input : {};
    return new Promise((resolveDecision) => {
      const id = approvals.actions.register({ requestId: String(body.toolUseId ?? randomUUID()), threadId: record.remoteSessionId, executionId: record.id, server: mcp[1], tool: mcp[2], arguments: input }, binding, (reply) => {
        resolveDecision(reply.action === 'accept' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Not approved in MainsAgents. Do not retry the same call; explain what you needed instead.' });
      }, resolveBinding);
      if (id && body.toolUseId) record.approvals.set(String(body.toolUseId), id);
    });
  }
  const activeSessions = new Map();
  const publish = (record, event) => {
    if (record.done) return;
    record.events.push(event);
    for (const listener of record.listeners) listener(event);
    if (terminalEvents.has(event.type)) record.done = true;
  };
  const status = async () => {
    const resolved = resolveCli();
    const installCommand = platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
    if (!resolved) return { providerId: 'claude', state: 'not-installed', authMode: 'cli', billingDescription: 'Uses the account authenticated by Claude Code CLI.', installCommand, loginCommand: 'claude auth login', message: 'Claude Code CLI not found.' };
    try {
      const result = await capture(resolved, ['auth', 'status']);
      let auth = {};
      try { auth = JSON.parse(result.output); } catch { const start=result.output.indexOf('{'),end=result.output.lastIndexOf('}');if(start>=0&&end>start){try{auth=JSON.parse(result.output.slice(start,end+1))}catch{}} }
      const explicitLogin = typeof auth.loggedIn === 'boolean' ? auth.loggedIn : typeof auth.isLoggedIn === 'boolean' ? auth.isLoggedIn : undefined;
      const loggedIn = explicitLogin ?? result.code === 0;
      return { providerId: 'claude', state: loggedIn ? 'connected' : 'login-required', authMode: 'cli', billingDescription: 'Uses your Claude Code CLI account and its billing terms.', loginCommand: 'claude auth login', message: loggedIn ? '' : 'Sign in to Claude Code CLI.' };
    } catch {
      return { providerId: 'claude', state: 'error', authMode: 'cli', billingDescription: 'Uses the account authenticated by Claude Code CLI.', loginCommand: 'claude auth login', message: 'Could not check Claude Code CLI authentication.' };
    }
  };
  const workspaceFor = (workspaceId) => {
    const segment = String(workspaceId ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'default';
    const directory = join(cwdRoot, segment);
    mkdirSync(directory, { recursive: true });
    return directory;
  };
  const send = (record, input) => {
    const resolved = resolveCli();
    if (!resolved) throw new Error('Claude Code CLI is not installed. Install it and restart MainsAgents.');
    const editor = record.editorToken ? { sessionId: record.config.editorSessionId, limits: editorAuthoring.limits(record.config.editorSessionId) } : null;
    const reviewerModel = editor && typeof record.config.editorReviewerModel === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(record.config.editorReviewerModel) ? record.config.editorReviewerModel : undefined;
    // Paper settings come only from the saved agent bound to this session, read on every turn; request copies are ignored.
    const boundAgent = !editor && getApprovals?.()?.claudeBinding(record.remoteSessionId)?.agent;
    const config = { ...record.config, ...input, paperDesign: boundAgent ? boundAgent.paperDesign : undefined, publishingAutomation: boundAgent ? boundAgent.publishingAutomation : undefined, publishingTool: Boolean(boundAgent && getApprovals?.()?.chatPublishing && permittedMcpAction(boundAgent, 'schedule')), ...(editor ? { editorLimits: editor.limits, editorReviewerModel: reviewerModel, paperDesign:undefined } : { editorLimits: undefined, editorReviewerModel: undefined }) };
    const directory=workspaceFor(config.workspaceId);
    // Keep subscription authentication; --bare can bypass CLI OAuth credentials.
    let settings={};try{settings=JSON.parse(readFileSync(join(homedir(),'.claude','settings.json'),'utf8'));}catch{}
    const suffix = editor ? `-${record.id}` : '';
    const settingsPath=join(directory,`mainsagents-runtime-settings${suffix}.json`),mcpPath=join(directory,`mainsagents-runtime-mcp${suffix}.json`);
    // Editor runs have no ask rule: only the bound editor server is loaded and it is pre-allowed below.
    writeFileSync(settingsPath,JSON.stringify({disableAllHooks:true,...(editor?{}:{permissions:{ask:['mcp__*']}}),enabledPlugins:Object.fromEntries(Object.keys(settings.enabledPlugins??{}).map(name=>[name,false]))}));
    const mcpServers = editor
      ? { [EDITOR_SERVER]: { type: 'stdio', command: process.execPath, args: [permissionServerScript], env: { ELECTRON_RUN_AS_NODE: '1', MAINSAGENTS_MCP_ROLE: 'editor', MAINSAGENTS_EDITOR_URL: record.editorUrl, MAINSAGENTS_EDITOR_TOKEN: record.editorToken, MAINSAGENTS_EDITOR_TOOLS: JSON.stringify(EDITOR_TOOLS) } } }
      : record.gateUrl && getApprovals ? { [approvalServer]: { type: 'stdio', command: process.execPath, args: [permissionServerScript], env: { ELECTRON_RUN_AS_NODE: '1', MAINSAGENTS_PERMISSION_URL: record.gateUrl, MAINSAGENTS_PERMISSION_TOKEN: record.gateToken } } } : {};
    if (!editor && config.publishingTool && mcpServers[approvalServer]) mcpServers[publishingServer] = { type: 'stdio', command: process.execPath, args: [permissionServerScript], env: { ELECTRON_RUN_AS_NODE: '1', MAINSAGENTS_MCP_ROLE: 'publishing', MAINSAGENTS_PUBLISHING_URL: record.gateUrl.replace(/\/permission$/, '/publishing'), MAINSAGENTS_PUBLISHING_TOKEN: record.gateToken, MAINSAGENTS_PUBLISHING_TOOLS: JSON.stringify([publishingToolDefinition]) } };
    writeFileSync(mcpPath,JSON.stringify({mcpServers}),{mode:0o600});
    if (editor) record.cleanupFiles = [settingsPath, mcpPath];
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--input-format', 'text', '--settings',settingsPath,'--setting-sources','user',...(mcpServers[approvalServer]?[]:['--strict-mcp-config']),'--mcp-config',mcpPath,'--disable-slash-commands'];
    // Editor runs have no built-in tools at all (no web, file or shell access); the bound editor server is their only surface.
    const tools = editor ? [] : toolAllowList(config);
    const allowed = [...tools];
    if (editor) {
      // The production authorization covers this edit's local tools: pre-allowed, never prompted; everything else is denied.
      // --restricted also ignores user/project settings files and confines anything file-related to the workdir.
      // Bounded agent loop: the host counters stay the authority; this only stops a runaway conversation. The cap follows
      // the host call budget LEFT in this session (a continuation gets what remains, never a fresh unlimited loop).
      const maxTurns = Number.isInteger(record.config.editorMaxTurns) && record.config.editorMaxTurns >= 1 && record.config.editorMaxTurns <= EDITOR_TURNS.overrideMax ? record.config.editorMaxTurns : editorTurnBudget(editorAuthoring.checkpoint(editor.sessionId), editor.limits);
      record.editorMaxTurns = maxTurns; record.editorCallsAtStart = editorAuthoring.checkpoint(editor.sessionId)?.calls ?? 0;
      args.push('--restricted', '--permission-mode', 'dontAsk', '--max-turns', String(maxTurns));
      allowed.push(`${editorPrefix}*`);
      if (reviewerModel) {
        // Optional second role: a frame reviewer on its own model, limited to the read-only editor tools.
        // Passed as a file: the Windows .cmd launcher cannot carry JSON arguments safely.
        const agentsPath = join(directory, `mainsagents-runtime-agents${suffix}.json`);
        writeFileSync(agentsPath, JSON.stringify({ 'frame-reviewer': { description: 'Reviews rendered frames and contact sheets of this edit and reports concrete visual problems.', prompt: 'You review frames of a video edit. Use only the editor read tools to look at real frames of the source or of a preview. Report concrete problems such as legibility, safe areas, timing against speech and framing, with times. You cannot change the plan.', tools: readOnlyEditorTools, model: reviewerModel } }), { mode: 0o600 });
        record.cleanupFiles.push(agentsPath);
        tools.push('Agent'); allowed.push('Agent');
        args.push('--agents', agentsPath);
      }
    }
    // MCP tools are never pre-allowed: each call goes to the MainsAgents gate (agent permissions + per-call approval).
    else if (mcpServers[approvalServer]) args.push('--permission-mode', 'default', '--permission-prompt-tool', `mcp__${approvalServer}__approve`);
    else args.push('--permission-mode', 'dontAsk', '--disallowedTools', 'mcp__*');
    // Final structured report, validated by the CLI; JSON cannot pass through the Windows .cmd launcher, so it is then skipped.
    record.editorReport = editor && !['.cmd', '.bat'].includes(extname(resolved.command).toLowerCase());
    if (record.editorReport) args.push('--json-schema', JSON.stringify(EDITOR_REPORT_SCHEMA));
    args.push('--tools', tools.join(','));
    if (allowed.length) args.push('--allowedTools', ...allowed);
    if (input.modelId) {
      if (typeof input.modelId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(input.modelId)) throw new Error('Choose a valid Claude model.');
      args.push('--model', input.modelId);
    }
    args.push(record.firstMessage ? '--session-id' : '--resume', record.remoteSessionId);
    const skillsDirectory = typeof config.skillsDirectory === 'string' && config.skillsDirectory.trim() ? resolve(config.skillsDirectory.trim()) : '';
    if (!editor && (config.skills?.length ?? 0) > 0 && skillsDirectory && existsSync(skillsDirectory) && statSync(skillsDirectory).isDirectory()) args.push('--add-dir', skillsDirectory);
    const effort = ['low', 'medium', 'high', 'xhigh'].includes(input.reasoningEffort) ? input.reasoningEffort : undefined;
    const child = spawnImpl(resolved, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(effort ? { CLAUDE_CODE_EFFORT_LEVEL: effort } : {}), ...(editor ? { ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1', CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '1' } : {}) } });
    record.child = child;
    record.stderr = '';
    // Checkpoints and the verified file receipt reach the consumer on this execution's stream.
    if (editor) record.unsubscribeEditor = editorAuthoring.subscribe(editor.sessionId, (event) => publish(record, { ...event, executionId: record.id }));
    let lineBuffer = '';
    let accumulated = '';
    let streamedText = false;
    let toolIndex = 0;
    const openTools = new Map();
    const usageCollector = createUsageCollector();
    // Usage limits are read ONLY from structured stream events (rate_limit_event / assistant.error / result fields), never prose.
    const limitObserver = createClaudeLimitObserver();
    // One report per execution, published before the terminal event so the consumer sees it while still listening.
    const publishUsage = () => { const usage = usageCollector.finish({ cancelled: record.cancelled === true }); if (usage) publish(record, { type: 'usage.reported', executionId: record.id, usage }); };
    const finishTools = () => {
      for (const [callId, tool] of openTools) publish(record, { type: 'tool.finished', executionId: record.id, tool, callId });
      openTools.clear();
    };
    const handleLine = (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      usageCollector.observe(message);
      limitObserver.observe(message);
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const tool = String(event.content_block.name ?? 'tool');
          const callId = String(event.content_block.id ?? `tool-${++toolIndex}`);
          openTools.set(callId, tool);
          publish(record, { type: 'tool.started', executionId: record.id, tool, callId, label: safeLabel(tool) });
        } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
          streamedText = true;
          accumulated += event.delta.text;
          publish(record, { type: 'message.delta', executionId: record.id, delta: event.delta.text });
        } else if (event?.type === 'content_block_stop') {
          // Tool completion is emitted from its matching tool_result message when available.
        }
        return;
      }
      if (message.type === 'user' && Array.isArray(message.message?.content)) {
        for (const block of message.message.content) {
          const approvalId = block?.type === 'tool_result' ? record.approvals?.get(block.tool_use_id) : undefined;
          if (approvalId) { record.approvals.delete(block.tool_use_id); getApprovals?.()?.actions.settle(approvalId, !block.is_error, block.is_error ? 'The MCP tool reported an error.' : null); capturePaperExport(record, approvalId, block); }
          if (block?.type === 'tool_result' && openTools.has(block.tool_use_id)) {
            const tool = openTools.get(block.tool_use_id);
            openTools.delete(block.tool_use_id);
            // Editor results are written by the host and describe the action actually applied.
            const summary = tool.startsWith(editorPrefix) ? editorSummary(block) : undefined;
            publish(record, { type: 'tool.finished', executionId: record.id, tool, callId: block.tool_use_id, ...(summary ? { summary } : {}) });
          }
        }
      }
      if (message.type === 'assistant' && !streamedText && Array.isArray(message.message?.content)) {
        for (const block of message.message.content) if (block?.type === 'text' && typeof block.text === 'string') accumulated += block.text;
      }
      if (message.type === 'result') {
        record.resultReceived=true;
        finishTools();
        if (message.is_error) record.resultError = true;
        if (typeof message.subtype === 'string') record.resultSubtype = message.subtype;
        if (Number.isSafeInteger(message.num_turns) && message.num_turns >= 0) record.numTurns = message.num_turns;
        if (editor && record.editorReport) {
          const checked = reconcileEditorReport(message.structured_output, editorAuthoring.checkpoint(editor.sessionId));
          publish(record, { type: 'editor.report', executionId: record.id, ...checked });
        }
        if (!streamedText && typeof message.result === 'string') accumulated = message.result;
      }
    };
    child.stdout?.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8');
      // Editor tool results carry real frame images, echoed by the CLI inside one stream line.
      if (lineBuffer.length > (editor ? 48_000_000 : 2_000_000)) { child.kill(); record.resultError = true; return; }
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    child.stderr?.on('data', (chunk) => { if (record.stderr.length < 32_000) record.stderr += chunk.toString('utf8'); });
    child.stdin?.on('error', () => {});
    child.stdin?.end(makeUserPrompt(input, config));
    child.once('error', () => {
      if (editor) { editorAuthoring.detach(editor.sessionId); record.unsubscribeEditor?.(); }
      finishTools();
      publishUsage();
      publish(record, { type: 'execution.failed', executionId: record.id, code: 'cli_launch_failed', message: 'Could not start Claude Code CLI.', retryable: true });
    });
    child.once('close', (code) => {
      if (lineBuffer.trim()) handleLine(lineBuffer);
      finishTools();
      record.child = undefined;
      // The finished process can no longer act on the edit before anyone observes the terminal event (a continuation attaches next).
      if (editor) editorAuthoring.detach(editor.sessionId);
      publishUsage();
      if (record.cancelled) publish(record, { type: 'execution.cancelled', executionId: record.id });
      else if (code === 0 && !record.resultError && record.resultReceived) {
        if (accumulated) publish(record, { type: 'message.completed', executionId: record.id, content: accumulated });
        publish(record, { type: 'execution.completed', executionId: record.id });
      } else {
        const needsLogin = /not logged in|not authenticated|authentication required|please log in|login required/i.test(record.stderr);
        if (editor && record.resultSubtype === 'error_max_turns') {
          // Not retryable as the same turn: the host may CONTINUE from the checkpoint (same session budget, nothing redone).
          let checkpoint = null; try { checkpoint = editorAuthoring.checkpoint(editor.sessionId); } catch {}
          const diagnostics = { numTurns: record.numTurns ?? null, maxTurns: record.editorMaxTurns, callsAtStart: record.editorCallsAtStart ?? 0, calls: checkpoint?.calls ?? null, callsLeft: checkpoint ? Math.max(0, editor.limits.maxCalls - checkpoint.calls) : null, revision: checkpoint?.revision ?? null, finalized: checkpoint?.finalized === true };
          publish(record, { type: 'execution.failed', executionId: record.id, code: 'editor_turn_limit', message: 'The editor reached its turn limit. The checkpoint keeps what was done; nothing beyond it was applied.', retryable: false, checkpointed: !!checkpoint, diagnostics });
        }
        else {
          const classified = limitFailure(limitObserver.classify({ succeeded: false }), 'Claude Code');
          if (classified) publish(record, { type: 'execution.failed', executionId: record.id, ...classified });
          else publish(record, { type: 'execution.failed', executionId: record.id, code: needsLogin ? 'login_required' : 'claude_cli_error', message: needsLogin ? 'Claude Code CLI needs sign-in. Run `claude auth login` in a terminal, then check Settings again.' : 'Claude Code CLI could not complete this response. Check its connection and authentication, then retry.', retryable: true });
        }
      }
      if (activeSessions.get(record.remoteSessionId) === record.id) activeSessions.delete(record.remoteSessionId);
      if (record.gateToken) gateTokens.delete(record.gateToken);
      if (editor) {
        // A finished or killed process can no longer act on the edit. The host decides whether the edit itself is
        // cancelled (closeEditorSession(id,'cancelled')): an app shutdown must not abort an authorized final export.
        editorAuthoring.detach(editor.sessionId);
        record.unsubscribeEditor?.();
        for (const file of record.cleanupFiles ?? []) try { rmSync(file, { force: true }); } catch {}
      }
      getApprovals?.()?.actions.interrupt(record.id);
    });
    publish(record, { type: 'execution.started', executionId: record.id, threadId: record.remoteSessionId });
  };

  async function handle(request, response, url) {
    const match = url.pathname.match(/^\/api\/providers\/claude(?:\/(.*))?$/);
    if (!match) return false;
    const route = match[1] ?? '';
    try {
      if (request.method === 'GET' && route === 'status') return json(response, 200, await status());
      if (request.method === 'GET' && route === 'models') return json(response, 200, { models: modelOptions });
      if (request.method === 'GET' && route === 'paper') return json(response, 200, await inspectPaper());
      if (request.method === 'POST' && route === 'sessions') {
        const input = await readBody(request);
        const id = randomUUID();
        return json(response, 200, { remoteSessionId: id, session: { ...input, id } });
      }
      const resume = route.match(/^sessions\/([^/]+)\/resume$/);
      if (request.method === 'POST' && resume) {
        if (!isUuid(resume[1])) return json(response, 400, { error: 'Invalid Claude session ID.' });
        return json(response, 200, { remoteSessionId: resume[1] });
      }
      if (request.method === 'POST' && route === 'executions') {
        const input = await readBody(request);
        // Editor sessions are opened in-process by the production host only, never through HTTP.
        delete input.editorSessionId; delete input.editorReviewerModel;
        if (!isUuid(input.remoteSessionId) || typeof input.content !== 'string' || !input.content.trim()) return json(response, 400, { error: 'Choose a Claude session and enter a message.' });
        if (activeSessions.has(input.remoteSessionId)) return json(response, 409, { error: 'This Claude session is already responding. Wait for it to finish before sending another message.' });
        const id = randomUUID();
        const record = { id, remoteSessionId: input.remoteSessionId, config: input, events: [], listeners: new Set(), done: false, firstMessage: input.firstMessage === true };
        executions.set(id, record);
        activeSessions.set(input.remoteSessionId, id);
        try { await prepareGate(record); send(record, input); }
        catch (error) { activeSessions.delete(input.remoteSessionId); executions.delete(id); throw error; }
        return json(response, 200, { executionId: id, remoteSessionId: input.remoteSessionId });
      }
      const eventMatch = route.match(/^executions\/([^/]+)\/events$/);
      if (request.method === 'GET' && eventMatch) {
        const record = executions.get(eventMatch[1]);
        if (!record) return json(response, 404, { error: 'Claude execution not found.' });
        response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const write = (event) => response.write(`${JSON.stringify(event)}\n`);
        record.events.forEach(write);
        if (record.done) return response.end();
        const finish = (event) => { if (terminalEvents.has(event.type)) { record.listeners.delete(write); record.listeners.delete(finish); response.end(); } };
        record.listeners.add(write);
        record.listeners.add(finish);
        request.on('close', () => { record.listeners.delete(write); record.listeners.delete(finish); });
        return;
      }
      const cancelMatch = route.match(/^executions\/([^/]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        const record = executions.get(cancelMatch[1]);
        if (!record) return json(response, 404, { error: 'Claude execution not found.' });
        record.cancelled = true;
        record.child?.kill();
        return json(response, 200, { cancelled: true });
      }
      return json(response, 404, { error: 'Claude CLI route not found.' });
    } catch (error) {
      return json(response, 500, { error: error instanceof Error ? error.message : 'Claude Code CLI request failed.' });
    }
  }
  const runtime={
    providerId:'claude',
    connect:async(session)=>session.remoteSessionId??randomUUID(),
    readThread:async()=>{throw new Error('Claude CLI reconciliation is unavailable. Review the saved result before explicitly confirming another send.');},
    send:async(remoteSessionId,content,agent)=>{
      if(activeSessions.has(remoteSessionId))throw new Error('This Claude session is already responding.');
      const executionId=randomUUID(),firstMessage=agent.runtimeFirstMessage===true,record={id:executionId,remoteSessionId,config:agent,events:[],listeners:new Set(),done:false,firstMessage};executions.set(executionId,record);activeSessions.set(remoteSessionId,executionId);
      try{await prepareGate(record);send(record,{...agent,remoteSessionId,content,firstMessage,agentName:agent.name});}catch(error){activeSessions.delete(remoteSessionId);executions.delete(executionId);if(record.editorToken)editorAuthoring.detach(agent.editorSessionId);throw error;}return {executionId};
    },
    // Editor authoring (contract mainsagents.editor-authoring/1): the host binds one production edit; see editor-authoring.mjs.
    editorTools:true,
    openEditorSession:(options)=>editorAuthoring.open(options),
    editorCheckpoint:(sessionId)=>editorAuthoring.checkpoint(sessionId),
    prepareEditorSession:(sessionId,options)=>editorAuthoring.prepare(sessionId,options),
    closeEditorSession:(sessionId,reason)=>editorAuthoring.close(sessionId,reason==='cancelled'?'cancelled':'closed'),
    forgetEditorSession:(sessionId)=>editorAuthoring.forget(sessionId),
    events:async function*(id,signal){const record=executions.get(id);if(!record)throw new Error('Claude execution unavailable.');let index=0;while(true){while(index<record.events.length)yield record.events[index++];if(record.done)return;if(signal?.aborted)throw new Error('Execution cancelled.');await new Promise(resolve=>{let timer;const wake=()=>{clearTimeout(timer);record.listeners.delete(wake);signal?.removeEventListener('abort',wake);resolve();};record.listeners.add(wake);signal?.addEventListener('abort',wake,{once:true});timer=setTimeout(wake,1000);});}},
    cancel:async(_threadId,id)=>{const record=executions.get(id);if(record){record.cancelled=true;record.child?.kill();}},
  };
  // `claude mcp list` runs Claude's own health check (no model inference) and includes claude.ai connectors.
  async function mcpServers() {
    const resolved = resolveCli();
    if (!resolved) return [];
    const result = await capture(resolved, ['mcp', 'list'], 30_000).catch(() => null);
    const servers = [];
    for (const raw of String(result?.output ?? '').split(/\r?\n/)) {
      const match = /^(.+?):\s+(.+?)\s+-\s+(.+)$/.exec(raw.trim());
      // Plugins are disabled for MainsAgents runs, so their servers never load there.
      if (!match || match[1].startsWith('plugin:')) continue;
      const state = match[3];
      servers.push({ name: match[1], status: /needs auth/i.test(state) ? 'login-required' : /connected/i.test(state) && !/fail|✗/i.test(state) ? 'connected' : 'unavailable' });
    }
    return servers;
  }
  return { handle, status, runtime, diagnostics: async () => {
    const base = await status();
    const servers = base.state === 'connected' && getApprovals ? await mcpServers() : [];
    return { ...base, models: modelOptions, modelsVerified: false, mcp: getApprovals ? 'approval-gated' : 'disabled', mcpServers: servers, externalWrites: getApprovals ? 'approval-gated' : 'blocked', hooks: 'disabled', modelCheck: 'provider-aliases', editorTools: 'production-bound' };
  } };
}
