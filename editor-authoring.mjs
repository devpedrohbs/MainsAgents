import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync, readFileSync, statSync} from 'node:fs';
import {extname} from 'node:path';

/**
 * Claude editor authoring: local, bounded tools that let the editor agent read the authorized source,
 * look at real frames and storyboard stills, write a flexible motion/storyboard plan, render short previews and request the
 * final export, all bound to one production run. Every effect is executed by host callbacks that own
 * the production authority (coordinator, media engine, scene schema); this module only enforces the
 * binding, the budget, the order of operations and verifies what the host reports.
 *
 * Nothing here writes outside the host callbacks, publishes, collects or calls a model.
 */
export const EDITOR_SERVER = 'mainsagents_editor';
export const EDITOR_CONTRACT = 'mainsagents.editor-authoring/1';
export const EDITOR_LIMITS = Object.freeze({maxRevisions: 2, maxPreviews: 3, maxFramesPerCall: 8, maxSheetTiles: 16, maxPreviewSeconds: 10, maxCalls: 60, maxVisionBytes: 24_000_000, maxTranscriptChars: 24_000, maxWordsPerCall: 800, maxWordWindowSeconds: 300, maxGuidanceBytes: 48_000, maxImageBytes: 1_500_000, maxPlanBytes: 400_000});
const limitRanges = {maxRevisions: [0, 5], maxPreviews: [0, 8], maxFramesPerCall: [1, 8], maxSheetTiles: [4, 16], maxPreviewSeconds: [1, 15], maxCalls: [5, 120], maxVisionBytes: [1_000_000, 64_000_000]};
/**
 * CLI turns of ONE editor execution. The host counters (maxCalls, revisions, previews, vision) stay the authority; the turn
 * cap only stops a runaway conversation, so it follows the host budget left: callsLeft + slack (the report and validator
 * retries need turns without host calls), clamped. An explicit editorMaxTurns override is accepted in [1, overrideMax].
 * Continuations reopen the SAME host session (fresh CLI session each) at most maxContinuations times per epoch.
 */
export const EDITOR_TURNS = Object.freeze({min: 8, max: 40, slack: 6, overrideMax: 80, maxContinuations: 3});
export function editorTurnBudget(checkpoint, limits = EDITOR_LIMITS) {
 const maxCalls = Number.isInteger(limits?.maxCalls) ? limits.maxCalls : EDITOR_LIMITS.maxCalls, calls = Number.isInteger(checkpoint?.calls) ? checkpoint.calls : 0;
 return Math.min(EDITOR_TURNS.max, Math.max(EDITOR_TURNS.min, maxCalls - calls + EDITOR_TURNS.slack));
}
/** Measured progress markers of a checkpoint (never the model's report). */
export function editorProgress(checkpoint) {
 return {calls: Number.isInteger(checkpoint?.calls) ? checkpoint.calls : 0, revision: Number.isInteger(checkpoint?.revision) ? checkpoint.revision : 0, planHash: checkpoint?.planHash ?? null, sourceObserved: checkpoint?.qa?.sourceObserved === true, inspectedRevision: Number.isInteger(checkpoint?.qa?.inspectedRevision) ? checkpoint.qa.inspectedRevision : 0, coveredScenes: Array.isArray(checkpoint?.qa?.coveredScenes) ? checkpoint.qa.coveredScenes.length : 0, previewsUsed: Number.isInteger(checkpoint?.previewsUsed) ? checkpoint.previewsUsed : 0, finalized: checkpoint?.finalized === true};
}
/**
 * Whether an edit stopped by the CLI turn limit may continue from its host checkpoint, and what is left to do.
 * `previous` = progress when the stopped execution started; `requireProgress` = automatic continuation (a user resume
 * may retry once without new progress). Bounded by maxContinuations per epoch and the host call budget.
 */
export function editorContinuation({checkpoint, previous, used = 0, max = EDITOR_TURNS.maxContinuations, limits = EDITOR_LIMITS, requireProgress = true} = {}) {
 const now = editorProgress(checkpoint), before = previous ? {...editorProgress(null), ...previous} : editorProgress(null);
 const callsLeft = Math.max(0, (limits?.maxCalls ?? EDITOR_LIMITS.maxCalls) - now.calls);
 const progress = now.calls > before.calls && (now.revision > before.revision || now.coveredScenes > before.coveredScenes && now.revision === before.revision || now.sourceObserved && !before.sourceObserved || now.inspectedRevision > before.inspectedRevision || now.previewsUsed > before.previewsUsed || now.finalized && !before.finalized || now.revision === before.revision && now.planHash !== before.planHash);
 const scenes = Array.isArray(checkpoint?.scenes) ? checkpoint.scenes.map((scene) => scene.id) : [];
 const covered = new Set(checkpoint?.qa?.coveredScenes ?? []);
 const remaining = {revisionsLeft: Math.max(0, (limits?.maxRevisions ?? EDITOR_LIMITS.maxRevisions) - (checkpoint?.revisionsUsed ?? 0)), previewsLeft: Math.max(0, (limits?.maxPreviews ?? EDITOR_LIMITS.maxPreviews) - now.previewsUsed), callsLeft, uncoveredScenes: scenes.filter((id) => !covered.has(id)).slice(0, 50), previews: (Array.isArray(checkpoint?.previews) ? checkpoint.previews : []).filter((item) => item?.revision === now.revision).map((item) => item.previewId), sourceObserved: now.sourceObserved, previewInspected: now.revision > 0 && now.inspectedRevision === now.revision};
 const base = {progress, now, before, remaining, used, max};
 if (!checkpoint || checkpoint.contract !== EDITOR_CONTRACT) return {...base, continue: false, reason: 'no_checkpoint'};
 if (checkpoint.state === 'cancelled') return {...base, continue: false, reason: 'cancelled'};
 if (now.finalized) return {...base, continue: false, reason: 'finalized'};
 if (used >= max) return {...base, continue: false, reason: 'continuation_cap'};
 if (callsLeft < 3) return {...base, continue: false, reason: 'host_budget'};
 if (requireProgress && !progress) return {...base, continue: false, reason: 'no_progress'};
 return {...base, continue: true, reason: progress ? 'progress' : 'user_resume'};
}
const imageTypes = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
// Plan safety is structural, not a word filter: a storyboard is declarative data that is never executed, so plain text
// such as "localhost", "tokens" or "process.env" in a caption is legitimate. What is refused is any field able to
// execute or reach something (code, markup, handlers, URLs, filesystem paths, IPC/env access) and values that are
// references instead of text. Media is referenced only by registered assetId; A's validator enforces exact keys.
const executableKeys = /^(code|scripts?|html|innerHTML|outerHTML|dangerouslySetInnerHTML|eval|expression|js|javascript|jsx|tsx|function|fn|handler|callback|module|imports?|require|component|command|cmd|exec|shell|env|fetch|request|ipc|channel|url|href|uri|src|srcset|path|filePath|file|dir|cwd|__proto__|constructor|prototype)$/i;
const handlerKey = /^on[A-Z]/;
const unsafeValue = [
 [/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/, 'control or bidi characters'],
 [/[a-z][a-z0-9+.-]*:\/\//i, 'a URL'],
 [/^\s*(javascript|data|blob|vbscript|file):/i, 'a URI'],
 [/(^|[\s"'(])([a-zA-Z]:[\\/]|\\\\[^\\\s]|~[\\/])|(^|\s)\/(Users|home|etc|var|tmp|private|opt|root|mnt|Volumes)\/|\.\.[\\/]/, 'a filesystem path'],
 [/<\s*\/?\s*[a-z!][^>]*>/i, 'markup'],
 [/\$\{|\{\{/, 'a template expression'],
];
/** Returns problems ([] when safe). `secrets` are exact values (e.g. the session token) that must never appear. */
export function planSafetyProblems(plan, {secrets = []} = {}) {
 const problems = [];
 let nodes = 0;
 const walk = (value, path, depth) => {
  if (problems.length >= 12) return;
  if (++nodes > 20_000 || depth > 32) { problems.push(`${path}: plan is too deep or too large`); return; }
  if (typeof value === 'string') {
   if (secrets.some((secret) => secret && value.includes(secret))) problems.push(`${path}: contains a session credential`);
   const hit = unsafeValue.find(([pattern]) => pattern.test(value));
   if (hit) problems.push(`${path}: text cannot contain ${hit[1]}`);
   return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1)); return; }
  if (value && typeof value === 'object') {
   for (const key of Object.keys(value)) {
    if (executableKeys.test(key) || handlerKey.test(key)) { problems.push(`${path}.${key}: field "${key}" can execute or reach resources and is not allowed`); continue; }
    if (secrets.some((secret) => secret && key.includes(secret))) { problems.push(`${path}: contains a session credential`); continue; }
    walk(value[key], `${path}.${key}`, depth + 1);
   }
   return;
  }
  if (value !== null && !['number', 'boolean'].includes(typeof value)) problems.push(`${path}: unsupported value`);
 };
 walk(plan, 'plan', 0);
 return problems;
}
const bindingKeys = ['runId', 'epoch', 'profileId', 'workspaceId', 'agentId', 'contentId', 'authorityHash'];

const object = (properties, required = []) => ({type: 'object', properties, required, additionalProperties: false});
const target = {description: '"source" for the authorized recording (the camera when the content also has a screen recording), "screen" for the screen recording of a camera+screen content (times on the CAMERA timeline; mapped by the offset), {"revision": N} for the edited composition of the current plan revision (times on the edited timeline, rendered with the real motion engine), or {"previewId": "..."} for a preview rendered in this session.', anyOf: [{type: 'string', enum: ['source', 'screen']}, object({revision: {type: 'integer', minimum: 1}}, ['revision']), object({previewId: {type: 'string'}}, ['previewId'])]};
/** MCP tool definitions (JSON Schema draft-07). Names are exposed to Claude as mcp__mainsagents_editor__<name>. */
export const EDITOR_TOOLS = Object.freeze([
 {name: 'get_context', description: 'Read the bound edit: source metadata, local transcript with timestamps, brief, budget left, current plan revision and the plan schema. Read-only.', inputSchema: object({}), annotations: {readOnlyHint: true, openWorldHint: false}},
 {name: 'get_transcript_words', description: 'Read the REAL word timings of the local transcription of the source between start and end (seconds on the SOURCE timeline, before cuts). Returns compact lines "start end word", the transcription origin/quality and explicit truncation (continue with start=nextStart and offset=nextOffset). Use it to place cuts and highlights on spoken words; check cuts with frames/preview. Read-only.', inputSchema: object({start: {type: 'number', minimum: 0}, end: {type: 'number', minimum: 0}, offset: {type: 'integer', minimum: 0, description: 'Only to continue a truncated page: the nextOffset returned with nextStart (words starting exactly at start that were already returned).'}}, ['start', 'end']), annotations: {readOnlyHint: true, openWorldHint: false}},
 {name: 'get_frames', description: 'Return real frames (images) of the source recording or of a preview rendered in this session at the given times in seconds. Read-only.', inputSchema: object({target, times: {type: 'array', items: {type: 'number', minimum: 0}, minItems: 1, maxItems: 8}, maxWidth: {type: 'integer', minimum: 160, maximum: 1280}}, ['times']), annotations: {readOnlyHint: true, openWorldHint: false}},
 {name: 'contact_sheet', description: 'Return one contact-sheet image with evenly spaced frames between start and end (seconds). Read-only.', inputSchema: object({target, start: {type: 'number', minimum: 0}, end: {type: 'number', minimum: 0}, count: {type: 'integer', minimum: 4, maximum: 16}}, ['start', 'end']), annotations: {readOnlyHint: true, openWorldHint: false}},
 {name: 'storyboard_stills', description: 'Return real stills (entry, middle and exit) of scenes of the current plan revision, rendered by the motion engine. Each image is tagged with sceneId and time. Use it to check every scene before finalizing. Read-only.', inputSchema: object({revision: {type: 'integer', minimum: 1}, sceneIds: {type: 'array', items: {type: 'string', maxLength: 120}, minItems: 1, maxItems: 16}}, ['revision']), annotations: {readOnlyHint: true, openWorldHint: false}},
 {name: 'write_plan', description: 'Write the storyboard/motion plan for this edit. The host validates it against the plan schema. baseRevision must be the current revision (0 for the first plan). Revisions after the first are limited. cutDecisions declares, for semantic cuts (retakes, false starts, corrected numbers), what you decided and why; the host checks that every "cut" is really removed by the segments.', inputSchema: object({baseRevision: {type: 'integer', minimum: 0}, plan: {type: 'object'}, note: {type: 'string', maxLength: 500}, cutDecisions: {type: 'array', maxItems: 80, items: object({candidateId: {type: 'string', maxLength: 20}, start: {type: 'number', minimum: 0}, end: {type: 'number', minimum: 0}, decision: {type: 'string', enum: ['cut', 'keep', 'review']}, reason: {type: 'string', minLength: 1, maxLength: 300}}, ['start', 'end', 'decision', 'reason'])}}, ['baseRevision', 'plan']), annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false}},
 {name: 'render_preview', description: 'Render a short local preview of the current plan revision (seconds of the edited timeline). Returns a previewId to inspect with get_frames/contact_sheet. Limited per session.', inputSchema: object({revision: {type: 'integer', minimum: 1}, start: {type: 'number', minimum: 0}, duration: {type: 'number', exclusiveMinimum: 0, maximum: 15}}, ['revision', 'start', 'duration']), annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false}},
 {name: 'finalize', description: 'Request the final local export of a plan revision. Ends authoring: no further plan changes or previews. The host renders once and returns a verified file receipt (or pending; call export_status).', inputSchema: object({revision: {type: 'integer', minimum: 1}, summary: {type: 'string', maxLength: 1000}}, ['revision']), annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false}},
 {name: 'export_status', description: 'Check the final export requested with finalize. Read-only.', inputSchema: object({}), annotations: {readOnlyHint: true, openWorldHint: false}},
]);
/** Final structured report (CLI --json-schema). It is the model's statement; the checkpoint stays the source of truth. */
export const EDITOR_REPORT_SCHEMA = Object.freeze({type: 'object', properties: {status: {type: 'string', enum: ['finalized', 'not-finalized']}, finalRevision: {type: 'integer', minimum: 0}, summary: {type: 'string', maxLength: 1500}, limitations: {type: 'array', items: {type: 'string', maxLength: 200}, maxItems: 10}}, required: ['status', 'finalRevision', 'summary'], additionalProperties: false});
/** Compares the model's report with the host checkpoint; never trusts the report on its own. */
export function reconcileEditorReport(report, checkpoint) {
 const valid = !!report && typeof report === 'object' && ['finalized', 'not-finalized'].includes(report.status) && Number.isInteger(report.finalRevision) && typeof report.summary === 'string';
 if (!valid) return {valid: false, consistent: false};
 const consistent = report.status === 'finalized' ? !!checkpoint?.finalized && checkpoint.final?.revision === report.finalRevision : !checkpoint?.finalized;
 return {valid: true, consistent, report: {status: report.status, finalRevision: report.finalRevision, summary: report.summary.slice(0, 1500), limitations: Array.isArray(report.limitations) ? report.limitations.slice(0, 10).map((item) => String(item).slice(0, 200)) : []}};
}
export const editorToolNames = EDITOR_TOOLS.map((tool) => tool.name);
export const editorToolId = (name) => `mcp__${EDITOR_SERVER}__${name}`;
export const readOnlyEditorTools = EDITOR_TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => editorToolId(tool.name));

export function normalizeEditorLimits(input = {}) {
 const limits = {...EDITOR_LIMITS};
 for (const [key, [min, max]] of Object.entries(limitRanges)) {
  if (input[key] === undefined) continue;
  if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`Editor limit ${key} must be an integer between ${min} and ${max}.`);
  limits[key] = input[key];
 }
 return Object.freeze(limits);
}

export function validateEditorBinding(binding) {
 if (!binding || typeof binding !== 'object') throw new Error('Editor binding is required.');
 for (const key of bindingKeys) if (key === 'epoch' ? !Number.isInteger(binding.epoch) || binding.epoch < 1 : typeof binding[key] !== 'string' || !binding[key] || binding[key].length > 200) throw new Error(`Editor binding needs ${key}.`);
 const source = binding.source;
 if (!source || typeof source.assetId !== 'string' || typeof source.versionId !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '')) throw new Error('Editor binding needs the registered source asset (assetId, versionId, sha256).');
 return Object.freeze({...Object.fromEntries(bindingKeys.map((key) => [key, binding[key]])), source: Object.freeze({assetId: source.assetId, versionId: source.versionId, sha256: source.sha256})});
}

const sameBinding = (a, b) => !!a && !!b && bindingKeys.every((key) => a[key] === b[key]) && a.source?.assetId === b.source?.assetId && a.source?.versionId === b.source?.versionId && a.source?.sha256 === b.source?.sha256;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
export const editorRequestKey = (binding, planHash) => `editor:${binding.runId}:${binding.epoch}:${planHash}`;

export function hashFile(path, signal) {
 return new Promise((resolveHash, reject) => {
  const hash = createHash('sha256'), stream = createReadStream(path);
  const abort = () => stream.destroy(new Error('Editor operation cancelled.'));
  signal?.addEventListener('abort', abort, {once: true});
  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('error', (error) => { signal?.removeEventListener('abort', abort); reject(error); });
  stream.once('end', () => { signal?.removeEventListener('abort', abort); resolveHash(hash.digest('hex')); });
 });
}

/** A receipt is accepted only when the file reported by the host exists with exactly those bytes. */
export async function verifyExportReceipt(receipt, {binding, planHash, requestKey, hash = hashFile, signal} = {}) {
 if (!receipt || typeof receipt !== 'object') throw new Error('The host returned no export receipt.');
 for (const key of ['assetId', 'versionId', 'path']) if (typeof receipt[key] !== 'string' || !receipt[key]) throw new Error(`Export receipt is missing ${key}.`);
 if (!/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '')) throw new Error('Export receipt has no valid sha256.');
 if (receipt.planHash !== planHash) throw new Error('Export receipt belongs to another plan revision.');
 if (requestKey && receipt.requestKey !== requestKey) throw new Error('Export receipt belongs to another request.');
 if (binding && receipt.sha256 === binding.source.sha256) throw new Error('Export has the same bytes as the source recording.');
 let info;
 try { info = statSync(receipt.path); } catch { throw new Error('The exported file does not exist on disk.'); }
 if (!info.isFile() || info.size === 0) throw new Error('The exported file is empty or not a file.');
 if (Number.isFinite(receipt.bytes) && receipt.bytes !== info.size) throw new Error('The exported file size differs from the receipt.');
 const actual = await hash(receipt.path, signal);
 if (actual !== receipt.sha256) throw new Error('The exported file hash differs from the receipt.');
 return Object.freeze({assetId: receipt.assetId, versionId: receipt.versionId, sha256: actual, bytes: info.size, path: receipt.path, planHash, requestKey: receipt.requestKey ?? requestKey, ...(Number.isFinite(receipt.duration) ? {duration: receipt.duration} : {}), verifiedAt: new Date().toISOString()});
}

function imageBlock(item, maxBytes) {
 let data = item.bytes, mimeType = item.mimeType;
 if (!data && typeof item.path === 'string') {
  if (!existsSync(item.path)) throw new Error('A frame reported by the host is missing on disk.');
  if (statSync(item.path).size > maxBytes) throw new Error('A frame image is larger than the allowed size.');
  data = readFileSync(item.path);
  mimeType ??= imageTypes[extname(item.path).toLowerCase()];
 }
 if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) throw new Error('The host returned a frame without image bytes.');
 if (data.length === 0 || data.length > maxBytes) throw new Error('A frame image is empty or larger than the allowed size.');
 if (!Object.values(imageTypes).includes(mimeType)) throw new Error('Frames must be PNG, JPEG or WebP images.');
 return {type: 'image', data: Buffer.from(data).toString('base64'), mimeType};
}

/** Scenes reported by the plan validator (A): ids and edited-timeline ranges, used for QA coverage. */
function sceneList(value) {
 if (!Array.isArray(value)) return [];
 return value.filter((scene) => scene && typeof scene.id === 'string' && scene.id && Number.isFinite(scene.start) && Number.isFinite(scene.end) && scene.end > scene.start).slice(0, 200).map((scene) => ({id: scene.id.slice(0, 120), start: scene.start, end: scene.end}));
}
const text = (value) => ({type: 'text', text: value});
const ok = (summary, structured, extra = []) => ({content: [text(summary), ...extra], structuredContent: structured});
const fail = (code, message) => ({content: [text(message)], structuredContent: {ok: false, code, message}, isError: true});
class Denied extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * Session registry. The bridge exposes `call` through its loopback endpoint; tokens are per attached
 * execution, so a killed or finished Claude process cannot act on the session later.
 */
export function createEditorAuthoring({hash = hashFile, now = () => Date.now()} = {}) {
 const sessions = new Map(), tokens = new Map();

 /** checkpoint: a previous editor.checkpoint of the same run+epoch (persisted by the host) to resume counters, plan hash and final state after a restart. */
 function open({binding, host, limits, grant, checkpoint, plan} = {}) {
  const bound = validateEditorBinding(binding);
  if (!host || typeof host.currentBinding !== 'function' || typeof host.context !== 'function' || typeof host.validatePlan !== 'function') throw new Error('Editor host must provide currentBinding, context and validatePlan.');
  // The production authorization already given for this edit covers its local steps; it must be the same authority.
  if (grant?.scope !== 'edit-local' || grant.authorityHash !== bound.authorityHash) throw new Error('Editing was not authorized for this production revision.');
  if (!sameBinding(host.currentBinding(), bound)) throw new Error('The production changed before the editor started.');
  const id = randomUUID();
  const session = {id, binding: bound, host, limits: normalizeEditorLimits(limits), state: 'open', calls: 0, revision: 0, plan: null, planHash: null, revisionsUsed: 0, previews: new Map(), previewsUsed: 0, visionBytes: 0, final: null, receipt: null, qa: {sourceObserved: false, screenObserved: false, inspectedRevision: 0, coveredScenes: []}, scenes: [], listeners: new Set(), controller: new AbortController(), exportController: new AbortController(), token: null, executionId: null, log: []};
  // The host's saved checkpoint wins over a missing one, so reopening a run never resets its budget.
  const saved = checkpoint ?? host.loadCheckpoint?.(bound) ?? null;
  if (saved) restore(session, saved, plan ?? saved.plan);
  sessions.set(id, session);
  return {sessionId: id};
 }

 /**
  * Preview refs of the current revision listed by a checkpoint (or, for checkpoints written before refs existed, by its
  * own render_preview actions of that revision). They are restored only when the host finds the file AND its bytes match.
  */
 function previewRefs(saved, revision, planHash) {
  if (!revision || !planHash) return [];
  const listed = Array.isArray(saved?.previews) ? saved.previews.filter((item) => item && typeof item.previewId === 'string' && item.revision === revision && item.planHash === planHash && /^[a-f0-9]{64}$/.test(item.sha256 ?? '')).map((item) => ({previewId: item.previewId, sha256: item.sha256, start: Number(item.start) || 0, duration: Number(item.duration) || 0})) : [];
  if (listed.length || Array.isArray(saved?.previews)) return listed.slice(0, 8);
  // Legacy: the action log records previewId (preview-<first 16 hex of sha256>), revision and window, but no full hash.
  return (Array.isArray(saved?.actions) ? saved.actions : []).filter((item) => item?.tool === 'render_preview' && item.revision === revision && /^preview-[a-f0-9]{16}$/.test(item.previewId ?? '')).map((item) => ({previewId: item.previewId, sha256Prefix: item.previewId.slice(8), start: Number(item.start) || 0, duration: Number(item.duration) || 0})).slice(-8);
 }
 /**
  * Completes a restored session before its first execution: previews of the current revision are re-bound through the host
  * (which owns the paths) and kept only after this module re-hashes the file. Unrecoverable refs are reported, never assumed.
  */
 async function prepare(id, {signal: abort} = {}) {
  const session = get(id), refs = session.pendingPreviews ?? [];
  session.pendingPreviews = null;
  const restored = [], missing = [];
  for (const ref of refs) {
   if (session.previews.has(ref.previewId)) continue;
   let found = null;
   try { found = typeof session.host.restorePreview === 'function' ? await session.host.restorePreview({...ref, revision: session.revision, planHash: session.planHash, signal: abort}) : null; } catch { found = null; }
   const sha = found && typeof found.path === 'string' && existsSync(found.path) ? await hash(found.path, abort).catch(() => null) : null;
   const matches = sha && (ref.sha256 ? sha === ref.sha256 : sha.startsWith(ref.sha256Prefix)) && `preview-${sha.slice(0, 16)}` === ref.previewId;
   if (!matches) { missing.push(ref.previewId); continue; }
   session.previews.set(ref.previewId, {previewId: ref.previewId, revision: session.revision, planHash: session.planHash, sha256: sha, start: ref.start, duration: ref.duration});
   restored.push(ref.previewId);
  }
  if (restored.length || missing.length) record(session, {tool: 'restore_previews', restored, missing});
  if (refs.length) emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
  return {restored, missing, checkpoint: checkpointOf(session)};
 }

 // A checkpoint belongs to one run, epoch, authority (e.g. edit director) and source: a new authorization starts a new budget.
 function restore(session, saved, plan) {
  if (saved?.contract !== EDITOR_CONTRACT || saved.runId !== session.binding.runId || saved.epoch !== session.binding.epoch || saved.authorityHash !== session.binding.authorityHash || saved.sourceSha256 !== session.binding.source.sha256) throw new Error('The saved editor checkpoint belongs to another production revision.');
  const count = (value, max) => { if (!Number.isInteger(value) || value < 0 || value > max) throw new Error('The saved editor checkpoint is invalid.'); return value; };
  session.revision = count(saved.revision, 1000); session.revisionsUsed = count(saved.revisionsUsed, session.revision); session.previewsUsed = count(saved.previewsUsed, 1000); session.visionBytes = Number.isInteger(saved.visionBytes) && saved.visionBytes >= 0 ? saved.visionBytes : 0; session.calls = Number.isInteger(saved.calls) && saved.calls >= 0 ? saved.calls : 0;
  session.planHash = session.revision ? String(saved.planHash ?? '') || null : null;
  if (session.revision && !session.planHash) throw new Error('The saved editor checkpoint is invalid.');
  session.plan = plan && typeof plan === 'object' ? plan : null;
  session.qa = {sourceObserved: saved.qa?.sourceObserved === true, screenObserved: saved.qa?.screenObserved === true, inspectedRevision: Number.isInteger(saved.qa?.inspectedRevision) ? saved.qa.inspectedRevision : 0, coveredScenes: Array.isArray(saved.qa?.coveredScenes) ? saved.qa.coveredScenes.filter((id) => typeof id === 'string').slice(0, 400) : []};
  session.scenes = sceneList(saved.scenes);
  // Action history continues across executions (it is the evidence of what was already done).
  session.log = (Array.isArray(saved.actions) ? saved.actions : []).filter((item) => item && typeof item === 'object' && typeof item.tool === 'string').slice(-40).map((item) => ({...item}));
  session.pendingPreviews = previewRefs(saved, session.revision, session.planHash);
  // A final export requested before the restart is never requested again; only its status is read.
  if (saved.final) session.final = {revision: saved.final.revision, planHash: saved.final.planHash, requestKey: saved.final.requestKey, status: saved.final.status === 'succeeded' ? 'succeeded' : 'uncertain', jobId: saved.final.jobId, qa: saved.final.qa, summary: ''};
  if (saved.receipt && session.final?.status === 'succeeded') session.receipt = Object.freeze({...saved.receipt});
  else if (session.final?.status === 'succeeded') session.final.status = 'uncertain';
 }

 const get = (id) => { const session = sessions.get(id); if (!session) throw new Error('Editor session not found.'); return session; };
 const emit = (session, event) => { for (const listener of session.listeners) try { listener(event); } catch {} };
 const checkpointOf = (session) => ({sessionId: session.id, contract: EDITOR_CONTRACT, runId: session.binding.runId, epoch: session.binding.epoch, authorityHash: session.binding.authorityHash, sourceSha256: session.binding.source.sha256, state: session.state, qa: {...session.qa, coveredScenes: [...session.qa.coveredScenes]}, revision: session.revision, planHash: session.planHash, scenes: session.scenes, previews: [...session.previews.values()].filter((item) => item.revision === session.revision && item.planHash === session.planHash).map((item) => ({previewId: item.previewId, revision: item.revision, planHash: item.planHash, sha256: item.sha256, start: item.start, duration: item.duration})), revisionsUsed: session.revisionsUsed, previewsUsed: session.previewsUsed, visionBytes: session.visionBytes, calls: session.calls, finalized: !!session.final, ...(session.final ? {final: {revision: session.final.revision, planHash: session.final.planHash, requestKey: session.final.requestKey, status: session.final.status, ...(session.final.jobId ? {jobId: session.final.jobId} : {}), ...(session.final.qa ? {qa: session.final.qa} : {})}} : {}), ...(session.receipt ? {receipt: session.receipt} : {}), actions: session.log.slice(-40)});
 const budget = (session) => ({revisionsLeft: Math.max(0, session.limits.maxRevisions - session.revisionsUsed), previewsLeft: Math.max(0, session.limits.maxPreviews - session.previewsUsed), callsLeft: Math.max(0, session.limits.maxCalls - session.calls), visionBytesLeft: Math.max(0, session.limits.maxVisionBytes - session.visionBytes)});

 /** Binds a Claude execution to the session; returns the bearer token for the MCP process of that execution. */
 function attach(id, executionId) {
  const session = get(id);
  if (session.state !== 'open') throw new Error('This editor session is closed.');
  if (session.token) throw new Error('This editor session is already attached to a running execution.');
  session.token = randomUUID() + randomUUID(); session.executionId = executionId; tokens.set(session.token, session);
  return session.token;
 }
 function detach(id) { const session = sessions.get(id); if (!session?.token) return; tokens.delete(session.token); session.token = null; session.executionId = null; }
 function sessionForToken(token) {
  if (typeof token !== 'string' || !token) return null;
  for (const [key, session] of tokens) if (key.length === token.length && timingSafeEqual(Buffer.from(key), Buffer.from(token))) return session;
  return null;
 }
 function close(id, reason = 'closed') {
  const session = sessions.get(id); if (!session) return;
  if (session.state === 'open') session.state = reason === 'cancelled' ? 'cancelled' : 'closed';
  // Ending a turn keeps an authorized final export running (the host observes the job); only a cancel stops it.
  session.controller.abort();
  if (reason === 'cancelled') session.exportController.abort();
  detach(id);
  emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
 }

 const live = (session) => {
  if (session.state !== 'open') throw new Denied(session.state, session.state === 'cancelled' ? 'The edit was cancelled. Stop and report what was done.' : 'This editor session is closed.');
  let current;
  try { current = session.host.currentBinding(); } catch { current = null; }
  if (!sameBinding(current, session.binding)) throw new Denied('stale', 'The production changed (new revision, agent, profile or source). This session can no longer act; stop and report.');
 };
 const signal = (session) => session.controller.signal;
 const targetOf = (session, value = 'source') => {
  if (value === 'source') return 'source';
  if (value === 'screen') { if (!session.host.hasScreen) throw new Denied('no_screen', 'This edit has no screen recording; use "source".'); return 'screen'; }
  if (Number.isInteger(value?.revision)) {
   if (value.revision !== session.revision || !session.planHash) throw new Denied('stale_revision', `Only the current revision (${session.revision}) can be inspected.`);
   return {revision: session.revision, planHash: session.planHash};
  }
  const preview = session.previews.get(value?.previewId);
  if (!preview) throw new Denied('unknown_preview', 'Unknown previewId. Use a previewId returned by render_preview in this session.');
  if (preview.revision !== session.revision) throw new Denied('stale_preview', 'This preview belongs to an older plan revision. Render the current revision first.');
  return {previewId: preview.previewId};
 };
 // What Claude actually received as images; finalize depends on it (a review is the model's interpretation, not a measured signal).
 const observed = (session, value = 'source', times = []) => {
  if (value === 'source') { session.qa.sourceObserved = true; return; }
  if (value === 'screen') { if (times.length) session.qa.screenObserved = true; return; }
  if (Number.isInteger(value?.revision)) { cover(session, session.scenes.filter((scene) => times.some((time) => time >= scene.start && time < scene.end)).map((scene) => scene.id)); return; }
  const preview = session.previews.get(value.previewId);
  session.qa.inspectedRevision = preview.revision;
  // Preview times are relative to its window on the edited timeline.
  cover(session, session.scenes.filter((scene) => times.some((time) => preview.start + time >= scene.start && preview.start + time < scene.end)).map((scene) => scene.id));
 };
 const cover = (session, ids) => { for (const id of ids) if (!session.qa.coveredScenes.includes(id)) session.qa.coveredScenes.push(id); };
 const spendVision = (session, blocks) => {
  const bytes = blocks.reduce((sum, block) => sum + Math.ceil(block.data.length * 3 / 4), 0);
  if (session.visionBytes + bytes > session.limits.maxVisionBytes) throw new Denied('budget', 'Image budget for this edit is used. Work with the frames already seen, finalize or report.');
  session.visionBytes += bytes;
 };
 const record = (session, action) => { session.log.push({at: new Date(now()).toISOString(), ...action}); if (session.log.length > 200) session.log.shift(); };

 /**
  * Guidance handed over by the host (app guide + enabled skills it read itself), re-bounded here. Reference data only: it
  * never changes tools, budget or validation. Returned as {} when the host gave none.
  */
 const guidanceOf = (value, maxBytes) => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) return {};
  const marker = '\n[truncated by the editor host]', reserve = Buffer.byteLength(marker), items = [], skipped = [];
  let used = 0;
  // The total never exceeds maxBytes: a cut item keeps room for its marker; an item that no longer fits is listed as skipped.
  for (const item of value.items.filter((entry) => entry && typeof entry.name === 'string' && typeof entry.text === 'string' && entry.text).slice(0, 12)) {
   const name = item.name.slice(0, 120), left = maxBytes - used, size = Buffer.byteLength(item.text);
   if (size > left && left < reserve + 64) { skipped.push({name, reason: 'guidance byte limit'}); continue; }
   const text = size <= left ? item.text : Buffer.from(item.text).subarray(0, left - reserve).toString('utf8').replace(/�$/, '') + marker;
   used += Buffer.byteLength(text);
   items.push({name, origin: item.origin === 'agent-skill' ? 'agent-skill' : 'app-guide', ...(typeof item.sha256 === 'string' ? {sha256: item.sha256.slice(0, 64)} : {}), truncated: item.truncated === true || size > left, text});
  }
  if (Array.isArray(value.skipped)) skipped.unshift(...value.skipped.slice(0, 20).map((item) => ({name: String(item?.name ?? '').slice(0, 120), reason: String(item?.reason ?? '').slice(0, 120)})));
  return {guidance: {note: 'Reference written by the user (enabled skills of the editor agent) and the app default guide. Follow it as editing direction for this piece; the brief and adjustments of this content prevail for this piece only. It grants no tools or permissions.', items, ...(skipped.length ? {skipped} : {})}};
 };
 const handlers = {
  async get_context(session) {
   const context = await session.host.context({signal: signal(session)});
   const segments = Array.isArray(context?.transcript?.segments) ? context.transcript.segments : [];
   let transcript = '', used = 0;
   for (const item of segments) { const line = `[${Number(item.start).toFixed(2)}-${Number(item.end).toFixed(2)}] ${String(item.text ?? '').trim()}\n`; if (used + line.length > session.limits.maxTranscriptChars) { transcript += '[transcript truncated]\n'; break; } transcript += line; used += line.length; }
   const info = context?.transcript && typeof context.transcript === 'object' ? context.transcript : null;
   const transcriptInfo = info ? {timing: ['words', 'sentences', 'none'].includes(info.timing) ? info.timing : segments.length ? 'sentences' : 'none', words: Number.isInteger(info.words) ? info.words : 0, ...Object.fromEntries(['origin', 'engine', 'model', 'language'].filter((key) => typeof info[key] === 'string').map((key) => [key, info[key].slice(0, 60)])), wordTool: Number.isInteger(info.words) && info.words > 0 ? 'get_transcript_words' : null} : {timing: 'none', words: 0, wordTool: null};
   const structured = {ok: true, contract: EDITOR_CONTRACT, transcriptInfo, ...guidanceOf(context?.guidance, session.limits.maxGuidanceBytes), binding: {runId: session.binding.runId, epoch: session.binding.epoch, contentId: session.binding.contentId, source: session.binding.source}, metadata: context?.metadata ?? null, brief: typeof context?.brief === 'string' ? context.brief.slice(0, 8000) : '', transcript: transcript || null, capabilities: context?.capabilities ?? {}, planSchema: context?.planSchema ?? null, ...(context?.retakes && typeof context.retakes === 'object' ? {retakes: {note: String(context.retakes.note ?? '').slice(0, 600), candidates: Array.isArray(context.retakes.candidates) ? context.retakes.candidates.slice(0, 60) : []}} : {}), ...(context?.localAdjust && typeof context.localAdjust === 'object' ? {localAdjust: context.localAdjust} : {}), ...(context?.screenRecording && typeof context.screenRecording === 'object' ? {screenRecording: context.screenRecording} : {}), currentPlan: session.plan ? {revision: session.revision, planHash: session.planHash, plan: session.plan} : context?.currentPlan ?? null, budget: budget(session), limits: session.limits};
   return ok(`Context read. Revision ${session.revision}. Budget: ${JSON.stringify(budget(session))}.`, structured);
  },
  async get_transcript_words(session, args) {
   const start = args.start, end = args.end, offset = args.offset ?? 0, max = session.limits.maxWordWindowSeconds;
   if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Denied('invalid_input', 'Use 0 <= start < end (seconds on the source timeline).');
   if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Denied('invalid_input', 'offset must be a non-negative integer returned as nextOffset by a previous call.');
   if (typeof session.host.transcriptWords !== 'function') throw new Denied('unavailable', 'Word timings are unavailable for this edit. Use the sentence transcript of get_context.');
   const stop = Math.min(end, start + max), result = await session.host.transcriptWords({start, end: stop, signal: signal(session)});
   // Words belong to the window of their START, in the host's stable order. A page is cut at a hard limit; the continuation is
   // (nextStart, nextOffset): nextOffset counts the words starting exactly at nextStart that were already returned, so a group of
   // equal starts larger than a page is paged through instead of repeated, and nothing is skipped (overlaps included).
   const all = Array.isArray(result?.words) ? result.words.map((word, index) => ({word, index})).filter(({word}) => Number.isFinite(word?.start) && Number.isFinite(word?.end) && typeof word.text === 'string' && word.start >= start && word.start < stop).sort((a, b) => a.word.start - b.word.start || a.index - b.index).map(({word}) => word) : [];
   let equal = 0;
   while (equal < all.length && all[equal].start === start) equal++;
   if (offset > equal) throw new Denied('invalid_input', `offset ${offset} is larger than the ${equal} word(s) starting exactly at ${start}s. Use the nextStart/nextOffset pair of the previous call.`);
   const timing = all.length ? 'words' : result?.timing === 'words' ? 'words' : result?.timing === 'sentences' ? 'sentences' : 'none';
   const rest = all.slice(offset), words = rest.slice(0, session.limits.maxWordsPerCall), cut = rest.length > words.length;
   let nextStart = null, nextOffset = 0;
   if (cut) {
    nextStart = rest[words.length].start;
    // Already returned words (this page and the skipped offset) that start exactly at nextStart.
    nextOffset = all.slice(0, offset + words.length).filter((word) => word.start === nextStart).length;
   } else if (stop < end) nextStart = stop;
   const lines = words.map((word) => `${word.start.toFixed(2)} ${word.end.toFixed(2)} ${word.text}`).join('\n');
   const quality = timing === 'words' ? 'Word times come from the local transcription (whisper.cpp tokens): the alignment is approximate/experimental and word ends are partly inferred. Use them as anchors, keep some padding around cuts and check them on frames/preview.' : 'This transcription has no word timings: nothing is estimated here. Use the sentence segments of get_context.';
   const source = Object.fromEntries(['origin', 'engine', 'model', 'language'].filter((key) => typeof result?.[key] === 'string').map((key) => [key, result[key].slice(0, 60)]));
   const truncated = nextStart !== null;
   record(session, {tool: 'get_transcript_words', start, end: stop, offset, count: words.length, truncated});
   const structured = {ok: true, timeline: 'source', window: {start, end: stop}, offset, timing, ...source, quality, count: words.length, truncated, ...(truncated ? {nextStart, nextOffset} : {}), lines};
   const head = `${words.length} word(s) between ${start.toFixed(2)}s and ${stop.toFixed(2)}s of the source (timing: ${timing}).${truncated ? ` Truncated: continue with start ${nextStart} and offset ${nextOffset}.` : ''} ${quality}`;
   return ok(lines ? `${head}\n${lines}` : head, structured);
  },
  async get_frames(session, args) {
   const times = Array.isArray(args.times) ? args.times : [];
   if (!times.length || times.length > session.limits.maxFramesPerCall || times.some((t) => !Number.isFinite(t) || t < 0)) throw new Denied('invalid_input', `Ask for 1 to ${session.limits.maxFramesPerCall} non-negative times.`);
   if (typeof session.host.frames !== 'function') throw new Denied('unavailable', 'Frame extraction is unavailable on this computer.');
   const frames = await session.host.frames({target: targetOf(session, args.target), times, maxWidth: args.maxWidth ?? 640, signal: signal(session)});
   if (!Array.isArray(frames) || !frames.length) throw new Denied('no_frames', 'No frames were extracted at those times.');
   const blocks = frames.slice(0, session.limits.maxFramesPerCall).map((frame) => imageBlock(frame, session.limits.maxImageBytes));
   spendVision(session, blocks);
   observed(session, args.target, frames.slice(0, blocks.length).map((frame) => Number(frame.time)));
   record(session, {tool: 'get_frames', target: args.target ?? 'source', count: blocks.length});
   return ok(`${blocks.length} real frame(s) extracted at ${frames.slice(0, blocks.length).map((f) => `${Number(f.time).toFixed(2)}s`).join(', ')}.`, {ok: true, frames: frames.slice(0, blocks.length).map((f) => ({time: f.time}))}, blocks);
  },
  async contact_sheet(session, args) {
   const count = args.count ?? 12;
   if (!Number.isFinite(args.start) || !Number.isFinite(args.end) || args.end <= args.start || !Number.isInteger(count) || count < 4 || count > session.limits.maxSheetTiles) throw new Denied('invalid_input', `Use end > start and 4 to ${session.limits.maxSheetTiles} tiles.`);
   if (typeof session.host.contactSheet !== 'function') throw new Denied('unavailable', 'Contact sheets are unavailable on this computer.');
   const sheet = await session.host.contactSheet({target: targetOf(session, args.target), start: args.start, end: args.end, count, signal: signal(session)});
   const block = imageBlock(sheet ?? {}, session.limits.maxImageBytes);
   spendVision(session, [block]);
   observed(session, args.target, Array.isArray(sheet.times) ? sheet.times.map(Number) : []);
   record(session, {tool: 'contact_sheet', target: args.target ?? 'source', count});
   return ok(`Contact sheet of ${count} frames between ${args.start}s and ${args.end}s.`, {ok: true, times: Array.isArray(sheet.times) ? sheet.times : []}, [block]);
  },
  async storyboard_stills(session, args) {
   if (args.revision !== session.revision || !session.planHash) throw new Denied('stale_revision', `Only the current revision (${session.revision}) can be inspected.`);
   if (typeof session.host.storyboardStills !== 'function') throw new Denied('unavailable', 'Storyboard stills are unavailable on this computer. Use render_preview and get_frames.');
   const known = new Set(session.scenes.map((scene) => scene.id));
   const sceneIds = Array.isArray(args.sceneIds) ? args.sceneIds.filter((id) => known.has(id)) : session.scenes.map((scene) => scene.id).filter((id) => !session.qa.coveredScenes.includes(id));
   if (Array.isArray(args.sceneIds) && sceneIds.length !== args.sceneIds.length) throw new Denied('invalid_input', 'Unknown sceneId for this revision. Use the scene ids returned by write_plan.');
   const stills = await session.host.storyboardStills({revision: session.revision, planHash: session.planHash, sceneIds: sceneIds.slice(0, 16), maxImages: session.limits.maxSheetTiles, signal: signal(session)});
   live(session);
   if (!Array.isArray(stills) || !stills.length) throw new Denied('no_frames', 'No stills were rendered for this revision.');
   const accepted = stills.slice(0, session.limits.maxSheetTiles).filter((still) => known.size === 0 || known.has(still.sceneId));
   const blocks = accepted.map((still) => imageBlock(still, session.limits.maxImageBytes));
   spendVision(session, blocks);
   cover(session, accepted.map((still) => still.sceneId).filter(Boolean));
   const tags = accepted.map((still) => ({sceneId: still.sceneId ?? null, position: ['in', 'mid', 'out'].includes(still.position) ? still.position : null, time: Number(still.time)}));
   record(session, {tool: 'storyboard_stills', revision: session.revision, count: blocks.length});
   const remaining = session.scenes.filter((scene) => !session.qa.coveredScenes.includes(scene.id)).map((scene) => scene.id);
   return ok(`${blocks.length} still(s) of revision ${session.revision} (${session.planHash.slice(0, 12)}): ${tags.map((tag) => `${tag.sceneId ?? '?'}${tag.position ? `/${tag.position}` : ''}@${tag.time.toFixed(2)}s`).join(', ')}.${remaining.length ? ` Scenes not yet inspected: ${remaining.slice(0, 20).join(', ')}.` : ' Every scene of this revision was inspected.'}`, {ok: true, revision: session.revision, planHash: session.planHash, stills: tags, remainingScenes: remaining, budget: budget(session)}, blocks);
  },
  async write_plan(session, args) {
   if (session.final) throw new Denied('finalized', 'The final export was already requested; the plan can no longer change.');
   if (args.baseRevision !== session.revision) throw new Denied('stale_revision', `baseRevision ${args.baseRevision} is not the current revision ${session.revision}. Read get_context and rebase.`);
   if (!args.plan || typeof args.plan !== 'object' || Array.isArray(args.plan)) throw new Denied('invalid_input', 'plan must be an object.');
   const serialized = JSON.stringify(args.plan);
   if (Buffer.byteLength(serialized) > session.limits.maxPlanBytes) throw new Denied('too_large', 'The plan is too large.');
   // Motion plans are data for the host renderer: never credentials, host endpoints or code hooks.
   const problems = planSafetyProblems(args.plan, {secrets: [session.token]});
   if (problems.length) throw new Denied('unsafe_plan', `Plan refused (nothing applied): ${problems.slice(0, 6).join('; ')}. Plans are declarative data: plain text is fine; code, markup, URLs, file paths and handler fields are not. Reference media by registered assetId.`);
   const isRevision = session.revision > 0;
   if (isRevision && session.revisionsUsed >= session.limits.maxRevisions) throw new Denied('budget', `Revision budget used (${session.limits.maxRevisions}). Finalize the current revision or explain what is still wrong.`);
   if (args.cutDecisions !== undefined && (!Array.isArray(args.cutDecisions) || args.cutDecisions.length > 80)) throw new Denied('invalid_input', 'cutDecisions must be an array of up to 80 decisions.');
   const result = await session.host.validatePlan({plan: args.plan, ...(args.cutDecisions ? {cutDecisions: args.cutDecisions} : {}), baseRevision: session.revision, signal: signal(session)});
   live(session);
   if (!result?.ok) return fail('invalid_plan', `Plan rejected by the host validator (no change applied): ${(Array.isArray(result?.errors) ? result.errors : ['unknown error']).slice(0, 12).map(String).join('; ').slice(0, 2000)}`);
   const planHash = typeof result.planHash === 'string' && result.planHash ? result.planHash : createHash('sha256').update(JSON.stringify(canonical(result.plan ?? args.plan))).digest('hex');
   const revision = session.revision + 1;
   await session.host.savePlan?.({revision, plan: result.plan ?? args.plan, planHash, note: typeof args.note === 'string' ? args.note.slice(0, 500) : '', ...(Array.isArray(result.cutDecisions) ? {cutDecisions: result.cutDecisions} : {}), ...(result.patchProof ? {patchProof: result.patchProof} : {}), signal: signal(session)});
   session.revision = revision; session.plan = result.plan ?? args.plan; session.planHash = planHash; if (isRevision) session.revisionsUsed++;
   // A new revision must be inspected again: coverage belongs to one plan.
   session.scenes = sceneList(result.scenes); session.qa.coveredScenes = [];
   record(session, {tool: 'write_plan', revision, planHash, ...(Array.isArray(result.cutDecisions) && result.cutDecisions.length ? {cutDecisions: result.cutDecisions.length} : {})});
   emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
   const warnings = Array.isArray(result.warnings) ? result.warnings.slice(0, 12).map(String) : [];
   return ok(`Plan saved as revision ${revision} (${planHash.slice(0, 12)}), ${session.scenes.length} scene(s).${warnings.length ? ` Warnings: ${warnings.join('; ')}` : ''}`, {ok: true, revision, planHash, scenes: session.scenes, summary: result.summary ?? '', warnings, budget: budget(session)});
  },
  async render_preview(session, args) {
   if (session.final) throw new Denied('finalized', 'The final export was already requested.');
   if (args.revision !== session.revision || !session.planHash) throw new Denied('stale_revision', `Preview only the current revision (${session.revision}).`);
   if (!Number.isFinite(args.start) || args.start < 0 || !Number.isFinite(args.duration) || args.duration <= 0 || args.duration > session.limits.maxPreviewSeconds) throw new Denied('invalid_input', `Preview between 0 and ${session.limits.maxPreviewSeconds} seconds.`);
   if (session.previewsUsed >= session.limits.maxPreviews) throw new Denied('budget', `Preview budget used (${session.limits.maxPreviews}).`);
   if (typeof session.host.renderPreview !== 'function') throw new Denied('unavailable', 'Preview rendering is unavailable on this computer.');
   session.previewsUsed++;
   const planHash = session.planHash, revision = session.revision;
   const preview = await session.host.renderPreview({revision, planHash, start: args.start, duration: args.duration, signal: signal(session)});
   live(session);
   if (typeof preview?.previewId !== 'string' || typeof preview.path !== 'string' || !/^[a-f0-9]{64}$/.test(preview.sha256 ?? '')) throw new Denied('host_error', 'The preview renderer returned no file.');
   if (!existsSync(preview.path) || await hash(preview.path, signal(session)) !== preview.sha256) throw new Denied('host_error', 'The preview file does not match what the renderer reported.');
   session.previews.set(preview.previewId, {previewId: preview.previewId, revision, planHash, sha256: preview.sha256, start: args.start, duration: Number.isFinite(preview.duration) ? preview.duration : args.duration});
   record(session, {tool: 'render_preview', revision, previewId: preview.previewId, start: args.start, duration: args.duration});
   emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
   return ok(`Preview ${preview.previewId} rendered for revision ${revision} (${args.start}s +${args.duration}s). Inspect it with get_frames or contact_sheet using target {"previewId":"${preview.previewId}"}.`, {ok: true, previewId: preview.previewId, revision, duration: preview.duration ?? args.duration, budget: budget(session)});
  },
  async finalize(session, args) {
   if (session.final) {
    if (args.revision !== session.final.revision) throw new Denied('finalized', `Revision ${session.final.revision} was already sent to export.`);
    return handlers.export_status(session);
   }
   if (args.revision !== session.revision || !session.planHash) throw new Denied('stale_revision', `Finalize the current revision (${session.revision}).`);
   if (typeof session.host.finalExport !== 'function') throw new Denied('unavailable', 'Final export is unavailable on this computer.');
   const limitations = [], canSee = typeof session.host.frames === 'function' || typeof session.host.contactSheet === 'function', canPreview = typeof session.host.renderPreview === 'function' && session.limits.maxPreviews > 0;
   if (!canSee) limitations.push('framesUnavailable');
   else if (!session.qa.sourceObserved) throw new Denied('qa_required', 'Look at real frames of the source (get_frames or contact_sheet) before finalizing.');
   else if (session.host.hasScreen && !session.qa.screenObserved) throw new Denied('qa_required', 'This content has a screen recording: look at real frames of it (get_frames or contact_sheet with target "screen") before finalizing.');
   if (!canPreview) limitations.push('previewUnavailable');
   else if (session.qa.inspectedRevision !== session.revision) {
    if (session.previewsUsed < session.limits.maxPreviews) throw new Denied('qa_required', 'Render a preview of revision ' + session.revision + ' and inspect its frames before finalizing.');
    // The budget is used, but a rendered preview of THIS revision exists: it must be looked at, never assumed inspected.
    const pending = [...session.previews.values()].find((item) => item.revision === session.revision && item.planHash === session.planHash);
    if (pending) throw new Denied('qa_required', `Preview ${pending.previewId} of revision ${session.revision} was rendered but not inspected. Inspect it with get_frames or contact_sheet using target {"previewId":"${pending.previewId}"} before finalizing.`);
    limitations.push('previewBudgetExhausted');
   }
   // Coverage of the whole storyboard, not only one short preview window.
   const uncovered = session.scenes.filter((scene) => !session.qa.coveredScenes.includes(scene.id)).map((scene) => scene.id);
   const canInspectPlan = canSee || typeof session.host.storyboardStills === 'function';
   if (uncovered.length && canInspectPlan) {
    if (budget(session).visionBytesLeft > session.limits.maxImageBytes && session.calls < session.limits.maxCalls - 1) throw new Denied('qa_required', `Inspect every scene of revision ${session.revision} before finalizing (storyboard_stills or frames with target {"revision": ${session.revision}}). Not inspected: ${uncovered.slice(0, 20).join(', ')}.`);
    limitations.push('sceneCoverageIncomplete');
   }
   const requestKey = editorRequestKey(session.binding, session.planHash);
   const qa = {kind: 'model-interpretation', sourceObserved: session.qa.sourceObserved, ...(session.host.hasScreen ? {screenObserved: session.qa.screenObserved} : {}), previewInspected: session.qa.inspectedRevision === session.revision, scenes: session.scenes.length, scenesInspected: session.scenes.length - uncovered.length, ...(uncovered.length ? {uncoveredScenes: uncovered.slice(0, 50)} : {}), limitations};
   session.final = {revision: session.revision, planHash: session.planHash, requestKey, status: 'requested', qa, summary: typeof args.summary === 'string' ? args.summary.slice(0, 1000) : ''};
   record(session, {tool: 'finalize', revision: session.revision, planHash: session.planHash, limitations});
   emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
   let result;
   try { result = await session.host.finalExport({revision: session.final.revision, planHash: session.final.planHash, requestKey, summary: session.final.summary, qa, signal: session.exportController.signal}); }
   catch (error) {
    // Uncertain outcome: never requested again; the host reconciles the job by requestKey.
    session.final.status = session.exportController.signal.aborted ? 'cancelled' : 'uncertain';
    emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
    return fail('export_uncertain', 'The final export did not confirm (' + String(error?.message ?? error).slice(0, 200) + '). Do not finalize again; report that the app is checking the export.');
   }
   return settleExport(session, result);
  },
  async export_status(session) {
   if (!session.final) throw new Denied('not_finalized', 'No final export was requested yet.');
   if (session.receipt) return ok(`Final export verified: ${session.receipt.sha256.slice(0, 12)} (${session.receipt.bytes} bytes).`, {ok: true, status: 'succeeded', receipt: publicReceipt(session.receipt)});
   if (typeof session.host.exportStatus !== 'function') return ok('Final export requested; the host reports the file when it finishes.', {ok: true, status: session.final.status});
   return settleExport(session, await session.host.exportStatus({jobId: session.final.jobId, requestKey: session.final.requestKey, signal: session.exportController.signal}));
  },
 };
 // Claude learns that a verified file exists; the absolute path stays with the host and the UI.
 const publicReceipt = (receipt) => ({assetId: receipt.assetId, versionId: receipt.versionId, sha256: receipt.sha256, bytes: receipt.bytes, ...(receipt.duration ? {duration: receipt.duration} : {})});
 async function settleExport(session, result) {
  if (result?.status === 'pending') { session.final.status = 'pending'; session.final.jobId = typeof result.jobId === 'string' ? result.jobId : session.final.jobId; emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)}); return ok('Final export is rendering locally. Call export_status later; do not finalize again.', {ok: true, status: 'pending'}); }
  if (result?.status !== 'succeeded') { session.final.status = 'failed'; const message = String(result?.message ?? 'The final export failed.').slice(0, 500); emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)}); return fail('export_failed', `${message} No file was produced; report this instead of claiming a result.`); }
  const receipt = await verifyExportReceipt(result.receipt, {binding: session.binding, planHash: session.final.planHash, requestKey: session.final.requestKey, hash, signal: session.exportController.signal});
  session.receipt = receipt; session.final.status = 'succeeded';
  record(session, {tool: 'final', sha256: receipt.sha256});
  emit(session, {type: 'file.completed', receipt});
  emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
  return ok(`Final export verified by the host: ${receipt.bytes} bytes, sha256 ${receipt.sha256.slice(0, 12)}. The app shows the file to the person.`, {ok: true, status: 'succeeded', receipt: publicReceipt(receipt)});
 }

 /** Executes one tool call for the session bound to `token`. Always returns an MCP CallToolResult. */
 async function call(token, name, args = {}) {
  const session = sessionForToken(token);
  if (!session) return fail('unbound', 'This editor tool is not bound to an active MainsAgents edit.');
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
  if (!handler) return fail('unknown_tool', 'Unknown editor tool.');
  try {
   live(session);
   if (session.calls >= session.limits.maxCalls) throw new Denied('budget', 'Tool call budget used for this edit. Finalize or stop and report.');
   if (session.pendingPreviews?.length) await prepare(session.id, {signal: signal(session)});
   session.calls++;
   const result = await handler(session, args && typeof args === 'object' ? args : {});
   // Every applied call is durable progress (QA coverage, vision and call budget included), not only plan writes.
   if (!result?.isError && ['get_context', 'get_transcript_words', 'get_frames', 'contact_sheet', 'storyboard_stills', 'export_status'].includes(name)) emit(session, {type: 'editor.checkpoint', checkpoint: checkpointOf(session)});
   return result;
  } catch (error) {
   if (error instanceof Denied) return fail(error.code, error.message);
   if (session.controller.signal.aborted) return fail('cancelled', 'The edit was cancelled. Stop and report what was done.');
   return fail('host_error', `The local editor could not complete this action: ${String(error?.message ?? error).slice(0, 300)}`);
  }
 }

 return {
  open, prepare, attach, detach, close, call,
  checkpoint: (id) => checkpointOf(get(id)),
  limits: (id) => get(id).limits,
  subscribe(id, listener) { const session = get(id); session.listeners.add(listener); return () => session.listeners.delete(listener); },
  has: (id) => sessions.has(id),
  forget(id) { close(id); sessions.delete(id); },
 };
}

