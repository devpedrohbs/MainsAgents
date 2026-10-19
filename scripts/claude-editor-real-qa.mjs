// REAL QA of the Claude editor: Claude Code CLI (normal claude.ai login) -> MCP "mainsagents_editor" -> editor-authoring
// -> host callbacks on A's real engine (storyboard validation, Remotion stills/excerpt/final render). ONE short synthetic
// clip, ONE cycle, no subagents, bounded turns/tool calls/images. No personal media, no MainsAgents database.
//
//   node scripts/claude-editor-real-qa.mjs                 preflight + fixture + host self-check, NO model call
//   node scripts/claude-editor-real-qa.mjs --run-model     the same, then one real Claude run (uses the logged-in plan)
//   options: --model <alias> (default sonnet) · --keep (keep the temp workdir) · --evidence <dir>
//
// Billing guard: the model is only called with the claude.ai login and first-party provider. An API key, auth token,
// base URL/proxy, Bedrock/Vertex/Foundry or apiKeyHelper makes the script stop BEFORE any model call.
// Declared host differences from the app (C integrates the real pipeline): the clip is synthetic and uncut (one
// segment), the transcript is the synthetic script (not Whisper), media is not registered in a profile database and
// the final file is written to the temp workdir. Rendering, validation and hashing are the real functions.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createClaudeCodeBridge } from '../claude-code-bridge.mjs';
import { createEditorAuthoring, EDITOR_CONTRACT } from '../editor-authoring.mjs';
import { probeVideo, runMediaProcess } from '../editorial-media.mjs';
import { getRemotionCapabilities, renderAnimatedVideo, renderStoryboardStills } from '../editorial-remotion.mjs';
import { remotionAnimations, validatePlan as validateEditPlan } from '../editorial-smart-edit.mjs';
import { segmentsHash, storyboardFactProblems, storyboardJsonSchema } from '../editorial-storyboard.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback; };
const RUN_MODEL = flag('--run-model'), MODEL = option('--model', 'sonnet');
const EVIDENCE = resolve(option('--evidence', join('docs', 'analysis', 'editing-ai-claude-authoring-2026-10-12')));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex');
const log = (...items) => console.log('[editor-qa]', ...items);
const evidence = { contract: EDITOR_CONTRACT, startedAt: new Date().toISOString(), runModel: RUN_MODEL, declaredStubs: ['synthetic uncut clip (one segment)', 'synthetic script used as transcript (no Whisper)', 'no profile database / asset registry (assets are files in the temp workdir, hashed)'], preflight: {}, host: [], tools: [], events: [], checks: {} };

// ---------------------------------------------------------------- 1. preflight (no model)
function findCli() {
  if (process.env.CLAUDE_CLI_PATH) return resolve(process.env.CLAUDE_CLI_PATH);
  const output = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
  const list = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && existsSync(line));
  return (process.platform === 'win32' ? list.find((item) => extname(item).toLowerCase() === '.exe') : undefined) ?? list[0];
}
const cli = findCli();
if (!cli) { console.error('Claude Code CLI not found.'); process.exit(2); }
const version = execFileSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
let auth = {};
try { const raw = execFileSync(cli, ['auth', 'status'], { encoding: 'utf8', windowsHide: true }); auth = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch {}
// Only the method is recorded: never the account, e-mail, organization or any credential.
const billedEnv = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL'].filter((name) => process.env[name]);
let settingsKeys = [];
try { const user = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')); settingsKeys = [...(user.apiKeyHelper ? ['apiKeyHelper'] : []), ...Object.keys(user.env ?? {}).filter((name) => /ANTHROPIC|BEDROCK|VERTEX|FOUNDRY/.test(name))]; } catch {}
evidence.preflight = { cliVersion: version, loggedIn: auth.loggedIn === true, authMethod: auth.authMethod ?? 'unknown', apiProvider: auth.apiProvider ?? 'unknown', billedEnvVariables: billedEnv, billedSettings: settingsKeys };
log('preflight', JSON.stringify(evidence.preflight));
const subscriptionOnly = auth.loggedIn === true && auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty' && !billedEnv.length && !settingsKeys.length;
const remotion = await getRemotionCapabilities();
if (!remotion?.available) { console.error('Remotion engine unavailable:', JSON.stringify(remotion).slice(0, 300)); process.exit(2); }

// ---------------------------------------------------------------- 2. isolated workdir + synthetic clip
const work = join(tmpdir(), `mainsagents-editor-qa-${Date.now()}`);
mkdirSync(work, { recursive: true });
const source = join(work, 'source.mp4');
const ffmpeg = (args) => runMediaProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs: 120_000 });
await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
const probe = await probeVideo(source);
const metadata = { width: probe.width, height: probe.height, fps: probe.fps, durationSeconds: probe.duration, hasAudio: true };
const segments = [{ start: 0, end: Math.round(probe.duration * 1000) / 1000 }];
const transcript = { segments: [{ start: 0.2, end: 2.6, text: 'Três passos para revisar um vídeo antes de publicar.' }, { start: 2.8, end: 5.4, text: 'Corte os silêncios, confira o texto na tela e escute o áudio.' }, { start: 5.6, end: 7.8, text: 'Revise antes de publicar.' }] };
const brief = 'Clip sintético de QA (barras de teste, sem pessoa). Assunto: três passos para revisar um vídeo antes de publicar.';
const transcriptText = transcript.segments.map((item) => item.text).join(' ');
const binding = { runId: `qa-${randomUUID()}`, epoch: 1, profileId: 'qa-isolated', workspaceId: 'qa', agentId: 'qa-claude-editor', contentId: 'qa-synthetic', authorityHash: `qa-${randomUUID()}`, source: { assetId: 'qa-source', versionId: 'v1', sha256: sha256(source) } };
evidence.fixture = { source: { sha256: binding.source.sha256, ...metadata }, segmentsHash: segmentsHash(segments), workdir: work };

// ---------------------------------------------------------------- 3. host callbacks on the real engine
const plans = new Map(), previews = new Map(), exports = new Map();
let counter = 0;
const outDir = (name) => { const dir = join(work, `${name}-${++counter}`); return dir; };
const hostLog = (entry) => { evidence.host.push({ at: new Date().toISOString(), ...entry }); };
const frameOf = (seconds) => Math.max(0, Math.min(Math.round(metadata.durationSeconds * metadata.fps) - 1, Math.round(seconds * metadata.fps)));
const ffmpegFrame = async (file, seconds, maxWidth) => { const path = join(work, `frame-${++counter}.png`); await ffmpeg(['-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', `scale=${Math.min(maxWidth, 960)}:-2`, path]); return path; };
const planGuide = {
  format: 'Storyboard declarativo do motor MainsAgents (dados, nunca código). Tempos de cena em segundos do vídeo editado; tempos de camada relativos à cena.',
  segmentsHash: segmentsHash(segments),
  rules: ['números só se ditos na fala ou no briefing', 'source "speech" + quote literal quando o texto vem da fala'],
  // Full draft-07 schema from A's engine (shape guide; the validator remains the authority).
  jsonSchema: storyboardJsonSchema(),
  example: { version: 1, title: 'Revise antes de publicar', timeline: { basis: 'output', segmentsHash: segmentsHash(segments) }, style: { treatment: 'creator' }, scenes: [{ id: 'abertura', name: 'Abertura', start: 0, end: 2.7, camera: { layout: 'full' }, layers: [{ id: 'titulo', type: 'text', text: 'Revise antes de publicar', role: 'headline', mode: 'words', slot: 'center', start: 0.2, end: 2.5, enter: 'rise', source: 'speech', quote: 'Revise antes de publicar' }] }, { id: 'passos', name: 'Passos', start: 2.7, end: 8, camera: { layout: 'split-right' }, transitionIn: { kind: 'fade', seconds: 0.4 }, layers: [{ id: 'lista', type: 'steps', items: ['Corte os silêncios', 'Confira o texto', 'Escute o áudio'], slot: 'panel', start: 0.2, end: 5.1, source: 'speech', quote: 'Corte os silêncios' }] }] },
};
const host = {
  currentBinding: () => binding,
  loadCheckpoint: () => null,
  context: async () => ({ metadata, transcript, brief, capabilities: { frames: true, preview: true, stills: true, finalExport: true }, planSchema: planGuide }),
  validatePlan: async ({ plan }) => {
    let validated;
    try { validated = validateEditPlan({ segments, format: 'original', storyboard: plan }, metadata.durationSeconds).plan; }
    catch (error) { hostLog({ callback: 'validatePlan', ok: false }); return { ok: false, errors: [String(error.message).slice(0, 400)] }; }
    const facts = storyboardFactProblems(validated.storyboard, { transcriptText, briefText: brief });
    if (facts.length) { hostLog({ callback: 'validatePlan', ok: false, facts: facts.length }); return { ok: false, errors: facts.slice(0, 8).map((item) => typeof item === 'string' ? item : JSON.stringify(item).slice(0, 200)) }; }
    const planHash = sha256Of(Buffer.from(JSON.stringify(validated)));
    plans.set(planHash, { plan: validated, animations: remotionAnimations(validated, { source: { width: metadata.width, height: metadata.height } }) });
    hostLog({ callback: 'validatePlan', ok: true, planHash, scenes: validated.storyboard.scenes.length });
    return { ok: true, plan: validated.storyboard, planHash, summary: `${validated.storyboard.scenes.length} cena(s)`, warnings: [], scenes: validated.storyboard.scenes.map((scene) => ({ id: scene.id, start: scene.start, end: scene.end })) };
  },
  savePlan: async ({ revision, planHash }) => { hostLog({ callback: 'savePlan', revision, planHash }); },
  frames: async ({ target, times, maxWidth, signal }) => {
    if (target === 'source' || target.previewId) {
      const file = target === 'source' ? source : previews.get(target.previewId).path;
      const frames = [];
      for (const time of times) { const path = await ffmpegFrame(file, time, maxWidth); frames.push({ time, path, mimeType: 'image/png' }); }
      hostLog({ callback: 'frames', target: target === 'source' ? 'source' : 'preview', count: frames.length, sha256: frames.map((frame) => sha256(frame.path).slice(0, 16)) });
      return frames;
    }
    const { animations } = plans.get(target.planHash);
    const result = await renderStoryboardStills({ inputPath: source, outDir: outDir('plan-frames'), metadata, animations, frames: times.map(frameOf), scale: 0.5, tags: { revision: target.revision, planHash: target.planHash.slice(0, 16) }, signal });
    hostLog({ callback: 'frames', target: 'plan', engine: 'remotion.renderStill', count: result.stills.length, sha256: result.stills.map((still) => sha256(still.path).slice(0, 16)) });
    return result.stills.map((still, index) => ({ time: times[index], path: still.path, mimeType: 'image/png' }));
  },
  contactSheet: async ({ target, start, end, count, signal }) => {
    const times = Array.from({ length: count }, (_, i) => start + ((i + 0.5) * (end - start)) / count);
    if (target === 'source' || target.previewId) {
      const file = target === 'source' ? source : previews.get(target.previewId).path, path = join(work, `sheet-${++counter}.png`);
      await ffmpeg(['-ss', String(start), '-t', String(end - start), '-i', file, '-vf', `fps=${count / (end - start)},scale=240:-2,tile=4x${Math.ceil(count / 4)}`, '-frames:v', '1', path]);
      hostLog({ callback: 'contactSheet', target: target === 'source' ? 'source' : 'preview', sha256: sha256(path).slice(0, 16) });
      return { path, mimeType: 'image/png', times };
    }
    const result = await renderStoryboardStills({ inputPath: source, outDir: outDir('plan-sheet'), metadata, animations: plans.get(target.planHash).animations, frames: times.map(frameOf), scale: 0.4, tileLimit: 16, signal });
    hostLog({ callback: 'contactSheet', target: 'plan', engine: 'remotion.renderStill', sha256: sha256(result.contactSheet).slice(0, 16) });
    return { path: result.contactSheet, mimeType: 'image/jpeg', times };
  },
  storyboardStills: async ({ revision, planHash, sceneIds, maxImages, signal }) => {
    const result = await renderStoryboardStills({ inputPath: source, outDir: outDir('stills'), metadata, animations: plans.get(planHash).animations, perScene: 3, scale: 0.4, tags: { revision, planHash: planHash.slice(0, 16) }, signal });
    const position = { entrada: 'in', meio: 'mid', saida: 'out' };
    const picked = result.stills.filter((still) => sceneIds.includes(still.sceneId)).slice(0, maxImages);
    hostLog({ callback: 'storyboardStills', engine: 'remotion.renderStill', qaOk: result.storyboard?.qa?.ok ?? null, count: picked.length, sha256: picked.map((still) => sha256(still.path).slice(0, 16)) });
    return picked.map((still) => ({ sceneId: still.sceneId, position: position[still.moment] ?? 'mid', time: still.seconds, path: still.path, mimeType: 'image/png' }));
  },
  renderPreview: async ({ revision, planHash, start, duration, signal }) => {
    const first = frameOf(start), last = Math.max(first, frameOf(start + duration) - 1), path = join(work, `preview-${revision}-${++counter}.mp4`);
    await renderAnimatedVideo({ inputPath: source, outputPath: path, metadata, animations: plans.get(planHash).animations, frameRange: [first, last], signal });
    const previewId = `preview-${revision}-${counter}`, digest = sha256(path);
    previews.set(previewId, { path, sha256: digest });
    hostLog({ callback: 'renderPreview', engine: 'remotion.renderMedia', frameRange: [first, last], sha256: digest });
    return { previewId, path, sha256: digest, duration };
  },
  finalExport: async ({ planHash, requestKey, signal }) => {
    if (exports.has(requestKey)) return exports.get(requestKey); // idempotent: never renders twice
    const path = join(work, 'final.mp4');
    const rendered = await renderAnimatedVideo({ inputPath: source, outputPath: path, metadata, animations: plans.get(planHash).animations, signal });
    const result = { status: 'succeeded', receipt: { assetId: 'qa-final', versionId: randomUUID(), sha256: sha256(path), bytes: statSync(path).size, path, planHash, requestKey, duration: rendered.durationSeconds } };
    exports.set(requestKey, result);
    hostLog({ callback: 'finalExport', engine: 'remotion.renderMedia', sha256: result.receipt.sha256, bytes: result.receipt.bytes });
    return result;
  },
  exportStatus: async ({ requestKey }) => exports.get(requestKey) ?? { status: 'pending' },
};

// ---------------------------------------------------------------- 4. host self-check (no model)
{
  const authoring = createEditorAuthoring();
  const { sessionId } = authoring.open({ binding, host, grant: { scope: 'edit-local', authorityHash: binding.authorityHash } });
  const token = authoring.attach(sessionId, 'selfcheck');
  const frames = await authoring.call(token, 'get_frames', { times: [1, 6] });
  const written = await authoring.call(token, 'write_plan', { baseRevision: 0, plan: planGuide.example });
  const stills = written.isError ? null : await authoring.call(token, 'storyboard_stills', { revision: 1 });
  evidence.checks.hostSelfCheck = { framesImages: frames.content.filter((block) => block.type === 'image').length, examplePlanAccepted: !written.isError, examplePlanError: written.isError ? written.content[0].text.slice(0, 300) : null, stillsImages: stills?.content.filter((block) => block.type === 'image').length ?? 0, remainingScenes: stills?.structuredContent?.remainingScenes ?? null };
  authoring.forget(sessionId);
  plans.clear(); previews.clear(); evidence.host = [];
  log('host self-check', JSON.stringify(evidence.checks.hostSelfCheck));
  if (!evidence.checks.hostSelfCheck.examplePlanAccepted || !evidence.checks.hostSelfCheck.stillsImages) { finish(1, 'host self-check failed'); }
}

if (!RUN_MODEL) { finish(0, 'dry run: no model call (pass --run-model for the real Claude cycle)'); }
if (!subscriptionOnly) { finish(3, 'model NOT called: the CLI is not on the claude.ai login with the first-party provider, or a billed key/proxy is configured'); }

// ---------------------------------------------------------------- 5. one real Claude cycle
const authoring = createEditorAuthoring();
const realCall = authoring.call, realAttach = authoring.attach;
let issuedToken = null;
authoring.attach = (id, executionId) => (issuedToken = realAttach(id, executionId));
authoring.call = async (token, name, args) => {
  const started = Date.now(), result = await realCall(token, name, args);
  const images = (result.content ?? []).filter((block) => block.type === 'image');
  evidence.tools.push({ name, ms: Date.now() - started, isError: result.isError === true, code: result.structuredContent?.code ?? null, args: name === 'write_plan' ? { baseRevision: args?.baseRevision, scenes: Array.isArray(args?.plan?.scenes) ? args.plan.scenes.length : null } : args, images: images.map((block) => ({ mimeType: block.mimeType, bytes: Buffer.from(block.data, 'base64').length, sha256: sha256Of(Buffer.from(block.data, 'base64')).slice(0, 16) })), text: String(result.content?.[0]?.text ?? '').slice(0, 240) });
  return result;
};
const bridge = createClaudeCodeBridge({ cwdRoot: join(work, 'claude'), editorAuthoring: authoring });
const { sessionId } = bridge.runtime.openEditorSession({ binding, host, grant: { scope: 'edit-local', authorityHash: binding.authorityHash }, limits: { maxRevisions: 1, maxPreviews: 1, maxCalls: 24, maxVisionBytes: 8_000_000, maxPreviewSeconds: 4 } });
const prompt = `Você é o editor de vídeo. Edite este clip sintético de QA (8 s, barras de teste, sem pessoa) com um storyboard de motion curto e legível.
Siga o fluxo das ferramentas: get_context; veja 2 frames da fonte; write_plan no formato de planSchema (comece do example e adapte); storyboard_stills da revisão; render_preview de no máximo 3 s e veja 1-2 frames dele; corrija só se algo estiver claramente errado; finalize.
Seja breve nas respostas. Não descreva imagens que não recebeu.`;
const started = Date.now();
const { executionId } = await bridge.runtime.send(randomUUID(), prompt, { name: 'QA Claude Editor', workspaceId: 'qa', tools: [], modelId: MODEL, runtimeFirstMessage: true, editorSessionId: sessionId, editorMaxTurns: 12 });
const timer = setTimeout(() => { evidence.checks.timedOut = true; void bridge.runtime.cancel(null, executionId); }, 15 * 60_000);
for await (const event of bridge.runtime.events(executionId)) {
  const keep = { type: event.type };
  if (event.type === 'tool.started') Object.assign(keep, { tool: event.tool });
  if (event.type === 'tool.finished') Object.assign(keep, { tool: event.tool, summary: event.summary?.slice(0, 160) });
  if (event.type === 'file.completed') Object.assign(keep, { receipt: { ...event.receipt, path: event.receipt.path } });
  if (event.type === 'editor.report') Object.assign(keep, { valid: event.valid, consistent: event.consistent, report: event.report });
  if (event.type === 'usage.reported') Object.assign(keep, { usage: event.usage });
  if (event.type === 'execution.failed') Object.assign(keep, { code: event.code, message: event.message });
  if (event.type === 'message.completed') Object.assign(keep, { content: event.content.slice(0, 1500) });
  if (event.type !== 'message.delta') evidence.events.push(keep);
}
clearTimeout(timer);
evidence.durationSeconds = Math.round((Date.now() - started) / 1000);

// ---------------------------------------------------------------- 6. verification and counterpoints (no model)
const checkpoint = bridge.runtime.editorCheckpoint(sessionId);
evidence.checkpoint = checkpoint;
const completed = evidence.events.find((event) => event.type === 'file.completed');
if (completed) {
  const file = completed.receipt.path, final = await probeVideo(file);
  const mid = join(work, 'final-mid.png');
  await ffmpeg(['-ss', String(final.duration / 2), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', mid]);
  // Full decode = playback check (fails on a broken stream).
  await runMediaProcess('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeoutMs: 120_000 });
  evidence.checks.final = { sha256Matches: sha256(file) === completed.receipt.sha256, differsFromSource: completed.receipt.sha256 !== binding.source.sha256, width: final.width, height: final.height, duration: final.duration, decodes: true, midFrameSha256: sha256(mid).slice(0, 16) };
  mkdirSync(EVIDENCE, { recursive: true });
  copyFileSync(mid, join(EVIDENCE, 'qa-final-mid.png'));
}
const sheetCall = [...evidence.tools].reverse().find((tool) => tool.name === 'storyboard_stills' && tool.images.length);
evidence.checks.imagesReceivedByClaude = evidence.tools.reduce((sum, tool) => sum + tool.images.length, 0);
evidence.checks.lateCallAfterTurn = (await authoring.call(issuedToken, 'write_plan', { baseRevision: checkpoint.revision, plan: { scenes: [] } })).structuredContent?.code;
evidence.checks.forgedToken = (await authoring.call('forged', 'get_context', {})).structuredContent?.code;
{
  const other = authoring.open({ binding, host, grant: { scope: 'edit-local', authorityHash: binding.authorityHash } });
  authoring.close(other.sessionId, 'cancelled');
  try { authoring.attach(other.sessionId, 'after-cancel'); evidence.checks.attachAfterCancel = 'allowed'; } catch { evidence.checks.attachAfterCancel = 'refused'; }
  try { authoring.open({ binding: { ...binding, epoch: 2 }, host, grant: { scope: 'edit-local', authorityHash: binding.authorityHash } }); evidence.checks.staleEpoch = 'allowed'; } catch { evidence.checks.staleEpoch = 'refused'; }
}
evidence.checks.storyboardStillsSeen = !!sheetCall;
finish(completed && evidence.checks.final?.sha256Matches ? 0 : 1, completed ? 'real cycle finished with a verified receipt' : 'real cycle finished WITHOUT a verified file');

function finish(code, message) {
  evidence.result = message; evidence.finishedAt = new Date().toISOString();
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    const name = RUN_MODEL ? 'qa-real-run.json' : 'qa-dry-run.json';
    writeFileSync(join(EVIDENCE, name), JSON.stringify(evidence, (key, value) => typeof value === 'string' ? value.split(work).join('<workdir>') : value, 2));
    log(message, '->', join(EVIDENCE, name));
  } catch (error) { console.error('could not write evidence', error.message); }
  if (!flag('--keep')) rmSync(work, { recursive: true, force: true });
  process.exit(code);
}
