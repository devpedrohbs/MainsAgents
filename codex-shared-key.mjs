import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { toNamespacedPath, join } from 'node:path';

export function codexSecretCredentialTarget(canonicalHome) {
  const hash = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 16);
  return `secrets|${hash}.codex`;
}

export function shareCodexSecretKey(sharedHome, home) {
  if (process.platform !== 'win32') return;
  const secrets = join(sharedHome, 'secrets');
  if (!existsSync(secrets) || !readdirSync(secrets).some(name => name.endsWith('.age'))) return;
  const script = readFileSync(new URL('./resources/codex-share-key.ps1', import.meta.url), 'utf8');
  const env = {
    ...process.env,
    MAINSAGENTS_SOURCE_CREDENTIAL: codexSecretCredentialTarget(toNamespacedPath(realpathSync.native(sharedHome))),
    MAINSAGENTS_DESTINATION_CREDENTIAL: codexSecretCredentialTarget(toNamespacedPath(realpathSync.native(home))),
  };
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // Avoid forwarding command output that could contain credential details.
    throw new Error('Could not share the Codex MCP encryption key through Windows Credential Manager. Connections were preserved; history was not shared.');
  }
}
