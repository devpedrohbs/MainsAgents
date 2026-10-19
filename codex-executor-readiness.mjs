import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, isAbsolute } from 'node:path';

const runtimeValidation = /^\[[^\]]+\] runtime read\/execute validation failed: validate runtime read\/execute access on (.+?): .*\(os error (\d+)\)\r?$/gm;

/** Explains the Windows sandbox setup failure the CLI recorded. These files hold no credentials. */
export function sandboxSetupDiagnosis(home) {
  const directory = join(home, '.sandbox'), file = join(directory, 'setup_error.json');
  if (!existsSync(file)) return null; // The CLI removes it after a successful setup refresh.
  let error;
  try { error = JSON.parse(readFileSync(file, 'utf8')); } catch { error = { code: 'unreadable_setup_error', message: 'setup_error.json could not be parsed' }; }
  const code = String(error?.code ?? 'unknown'), message = String(error?.message ?? '');
  const log = readdirSync(directory).filter(name => /^sandbox\.\d{4}-\d{2}-\d{2}\.log$/.test(name)).sort().at(-1);
  const text = log ? readFileSync(join(directory, log), 'utf8').slice(-262144) : '';
  const match = [...text.matchAll(runtimeValidation)].at(-1);
  const path = match?.[1], osError = match ? Number(match[2]) : undefined;
  const summary = osError === 32
    ? `Windows sandbox setup failed (${code}): ${path} is in use by another process (os error 32), so its ACL could not be validated.`
    : path ? `Windows sandbox setup failed (${code}): runtime validation of ${path} failed (os error ${osError}).`
      : `Windows sandbox setup failed (${code}): ${message}`;
  return { code, message, ...(path ? { path, osError } : {}), summary };
}

/**
 * Runs one sandboxed read through command/exec under the session's own sandbox policy (its write roots are part of
 * the Windows sandbox setup refresh). Starts no thread and no model inference.
 * state: 'ready' | 'failed' (the CLI rejected or the command failed) | 'slow' (no answer yet: the first sandboxed
 * command after a CLI start can re-provision sandbox users or grant write-root ACLs, measured at 15-80 s).
 * Only 'failed' is evidence that commands cannot run.
 */
export async function probeCodexExecutor(client, { home, cwd, file, sandboxPolicy = { type: 'readOnly' }, platform = process.platform, timeoutMs = 180000 }) {
  const env = file ? { MAINSAGENTS_PROBE_FILE: file } : {};
  const command = platform === 'win32'
    ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', file ? '[Console]::Out.Write((Get-Content -Raw -LiteralPath $env:MAINSAGENTS_PROBE_FILE).Length)' : "[Console]::Out.Write('ok')"]
    : ['sh', '-c', file ? 'wc -c < "$MAINSAGENTS_PROBE_FILE"' : 'printf ok'];
  const checkedAt = new Date().toISOString();
  try {
    const result = await client.request('command/exec', { command, cwd, env, sandboxPolicy, timeoutMs: 25000 }, timeoutMs);
    if (result.exitCode === 0) return { ready: true, state: 'ready', checkedAt };
    return { ready: false, state: 'failed', checkedAt, error: `Sandboxed probe exited with code ${result.exitCode}: ${String(result.stderr ?? '').trim().slice(0, 400)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out$/.test(message)) return { ready: false, state: 'slow', checkedAt, error: `The sandboxed probe did not answer within ${Math.round(timeoutMs / 1000)} s.` };
    const diagnosis = home ? sandboxSetupDiagnosis(home) : null;
    return { ready: false, state: 'failed', checkedAt, error: message, ...(diagnosis ? { diagnosis } : {}) };
  }
}

/** Resolves only host-configured skill Markdown files: a .md file, or SKILL.md in a skill folder. */
export function skillMarkdownFile(name, path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) return null;
  if (statSync(path).isFile()) return extname(path).toLowerCase() === '.md' ? path : null;
  for (const candidate of [join(path, 'SKILL.md'), join(path, name, 'SKILL.md'), join(path, `${name}.md`)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Host-side skill reading for when the sandboxed shell cannot start; never a shell or kernel. */
export function hostSkillContext(skills, { skillFiles = {}, skillsDirectory } = {}, { maxBytes = 32768, maxTotal = 98304 } = {}) {
  const sections = [], missing = [];
  let total = 0;
  for (const name of skills) {
    const file = skillMarkdownFile(name, skillFiles[name] ?? skillsDirectory);
    if (!file) { missing.push(name); continue; }
    const content = readFileSync(file, 'utf8');
    const budget = Math.min(maxBytes, maxTotal - total);
    if (budget <= 0) { missing.push(name); continue; }
    const text = content.length > budget ? `${content.slice(0, budget)}\n[Truncated by MainsAgents: ${content.length - budget} more characters in ${file}]` : content;
    total += text.length;
    sections.push(`--- Skill ${name} (${file}) ---\n${text}`);
  }
  return { text: sections.join('\n\n'), missing };
}

export function executorUnavailableInstructions(readiness, skills) {
  const reason = readiness.diagnosis?.summary ?? readiness.error;
  return `\n\nMainsAgents local executor check failed before this session: ${reason}\nShell commands (exec_command) are expected to fail until this is fixed. Do not substitute node_repl or another kernel, and do not claim any file, cut or export was produced. ${skills.text ? 'The host attached the associated skill files below, so treat them as already read.\n\n' + skills.text : 'No associated skill file could be attached.'}${skills.missing.length ? `\nUnavailable skill files: ${skills.missing.join(', ')}.` : ''}\nReport this executor error to the user for any local file or video operation.`;
}

/**
 * Classifies a Codex app-server thread error. Only 'thread-missing' means the thread is proven absent;
 * 'thread-not-loaded' must be resumed first and 'invalid-thread-id' is a caller error, never an expiry.
 */
export function classifyThreadError(error) {
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? '');
  // Wording verified against the real CLI 0.162.1 (see docs/analysis/runtime-local-recovery-2026-10-10.md).
  // The second form is the bridge's own check (importLegacyCodexThread) before the CLI is asked.
  if (/^invalid (?:codex )?(?:thread|session|conversation) id(?:entifier)?\b/i.test(message)) return 'invalid-thread-id';
  if (/^thread not loaded\b/i.test(message)) return 'thread-not-loaded';
  // Same evidence as codex-session-errors.mjs (backend) and sessionRecovery.ts (UI), so all layers agree.
  if (/^(?:no rollout found for thread id|no persisted rollout|thread not found|no conversation found with (?:session|thread) id)\b|\bnot materialized yet\b/i.test(message)) return 'thread-missing';
  return null;
}

/** HTTP status for each thread error class: only a proven absence is 410. */
export const threadErrorStatus = Object.freeze({ 'thread-missing': 410, 'thread-not-loaded': 409, 'invalid-thread-id': 400 });
