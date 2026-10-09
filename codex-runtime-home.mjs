import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, statSync, realpathSync, linkSync, symlinkSync, unlinkSync, copyFileSync, constants } from 'node:fs';
import { shareCodexSecretKey } from './codex-shared-key.mjs';

const connectionFiles = ['config.toml', 'auth.json', '.credentials.json'];
const connectionDirectories = ['secrets', 'mcp-oauth-locks', 'skills', 'rules', 'plugins'];
/** A standalone CLI must not inherit another Codex app's execution transports. */
export function standaloneCodexEnvironment(source = process.env) {
  const env = {...source};
  const fromDesktop = Boolean(source.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || source.CODEX_APP_TOOLS_PIPE_PATH);
  for (const key of Object.keys(env)) {
    if (key.startsWith('CODEX_') && !['CODEX_HOME', 'CODEX_API_KEY'].includes(key)
      && !(key === 'CODEX_CLI_PATH' && !fromDesktop)) delete env[key];
  }
  return env;
}
const fingerprint = file => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
const sameFile = (left, right) => {
  if (!existsSync(left) || !existsSync(right)) return false;
  const a = statSync(left), b = statSync(right);
  return a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;
};

/** Share connection resources only. Never link sessions, history or SQLite databases. */
export function prepareCodexRuntimeHome({ home, sharedHome = process.env.CODEX_HOME || join(homedir(), '.codex'), onError = () => {}, shareSecretKey = shareCodexSecretKey }) {
  home = resolve(home); sharedHome = resolve(sharedHome);
  const childPath = relative(sharedHome, home);
  if (home === sharedHome || (!isAbsolute(childPath) && childPath !== '..' && !childPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))) {
    throw new Error('MainsAgents Codex history must be outside the shared Codex directory.');
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(sharedHome, { recursive: true, mode: 0o700 });
  const marker = join(home, 'mainsagents-connections.json');
  const saved = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : { sharedHome, files: {} };
  if (resolve(saved.sharedHome) !== sharedHome) throw new Error('The shared Codex connection directory changed. Keep the existing runtime safe before changing it.');
  const files = new Map(Object.entries(saved.files));
  const persist = () => {
    const content = JSON.stringify({ sharedHome, files: Object.fromEntries(files) });
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== content) writeFileSync(marker, content, { mode: 0o600 });
  };
  const names = () => [...new Set([...connectionFiles, ...readdirSync(sharedHome).filter(name => name.endsWith('.config.toml')), ...files.keys()])];
  function relink(name) {
    const source = join(sharedHome, name), target = join(home, name);
    if (existsSync(target)) unlinkSync(target); // Only explicit managed connection files.
    if (existsSync(source)) linkSync(source, target);
  }
  function sync() {
    for (const name of names()) {
      // A manifest must never authorize traversal or management of arbitrary files.
      if (!connectionFiles.includes(name) && !/^[\w.-]+\.config\.toml$/.test(name)) throw new Error('Invalid managed Codex connection file.');
      const source = join(sharedHome, name), target = join(home, name);
      if (!files.has(name)) {
        if (!existsSync(source)) {
          if (existsSync(target)) throw new Error(`An independent ${name} already exists in the MainsAgents runtime. It was preserved.`);
          files.set(name, null);
          continue;
        }
        if (existsSync(target) && !sameFile(source, target)) throw new Error(`An independent ${name} already exists in the MainsAgents runtime. It was preserved.`);
        if (!existsSync(target)) linkSync(source, target);
        files.set(name, fingerprint(source));
        continue;
      }
      const previous = files.get(name), sourceHash = fingerprint(source), targetHash = fingerprint(target);
      if (!sameFile(source, target)) {
        if (sourceHash === previous && targetHash !== null && targetHash !== previous) {
          // A CLI may replace auth.json atomically on refresh. Keep the refreshed login
          // available to both apps without maintaining a second refresh-token copy.
          if (existsSync(source)) unlinkSync(source);
          linkSync(target, source);
        } else {
          // A changed/removed shared connection wins over a stale local copy.
          if (sourceHash !== previous && targetHash !== null && targetHash !== previous && sourceHash !== targetHash) onError(new Error(`Concurrent changes to ${name}; the shared Codex connection was kept.`));
          relink(name);
        }
      }
      files.set(name, fingerprint(source));
    }
    persist();
  }
  sync();
  for (const name of connectionDirectories) {
    const source = join(sharedHome, name), target = join(home, name);
    mkdirSync(source, { recursive: true, mode: 0o700 });
    if (existsSync(target)) {
      if (realpathSync(target) !== realpathSync(source)) throw new Error(`Independent Codex ${name} directory preserved; cannot share it automatically.`);
    } else symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  shareSecretKey(sharedHome, home);
  const timer = setInterval(() => { try { sync(); } catch (error) { onError(error); } }, 1000);
  timer.unref();
  return {
    home, sharedHome, sync,
    env: { ...standaloneCodexEnvironment(), CODEX_HOME: home, CODEX_SQLITE_HOME: home },
    // CLI overrides also prevent a shared sqlite_home config from leaking history.
    args: ['-c', `sqlite_home=${JSON.stringify(home)}`],
    close() { clearInterval(timer); sync(); },
  };
}

function findRollout(directory, threadId) {
  if (!existsSync(directory)) return undefined;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isFile() && item.name.endsWith(`-${threadId}.jsonl`)) return file;
    if (item.isDirectory() && !lstatSync(file).isSymbolicLink()) {
      const found = findRollout(file, threadId);
      if (found) return found;
    }
  }
}

/** Import only the old conversation requested by MainsAgents. Originals stay intact. */
export function importLegacyCodexThread({ home, sharedHome }, threadId) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(threadId)) throw new Error('Invalid Codex thread identifier.');
  if (findRollout(join(home, 'sessions'), threadId) || findRollout(join(home, 'archived_sessions'), threadId)) return false;
  const source = findRollout(join(sharedHome, 'sessions'), threadId) ?? findRollout(join(sharedHome, 'archived_sessions'), threadId);
  if (!source) return false; // The runtime returns its normal missing-thread error.
  const target = join(home, 'sessions', relative(sharedHome, source).replace(/^archived_sessions[\\/]|^sessions[\\/]/, ''));
  mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  return true;
}
