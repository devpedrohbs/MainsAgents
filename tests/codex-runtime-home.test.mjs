import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, statSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCodexRuntimeHome, importLegacyCodexThread, standaloneCodexEnvironment, desktopRuntimeIsolation } from '../codex-runtime-home.mjs';
import { codexSecretCredentialTarget } from '../codex-shared-key.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mains-codex-'));
  const sharedHome = join(root, 'shared'), home = join(root, 'mains');
  mkdirSync(sharedHome);
  const runtime = () => prepareCodexRuntimeHome({ sharedHome, home, shareSecretKey: () => {} });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { sharedHome, home, runtime };
}

test('standalone CLI drops inherited desktop executor settings without changing login or system paths', () => {
 const source={PATH:'tools',APPDATA:'appdata',CODEX_HOME:'shared',CODEX_API_KEY:'test',CODEX_CLI_PATH:'desktop.exe',CODEX_INTERNAL_ORIGINATOR_OVERRIDE:'desktop',CODEX_MCP_NODE_PATH:'locked.exe',CODEX_APP_TOOLS_PIPE_PATH:'foreign-pipe',CODEX_PERMISSION_PROFILE:'foreign',CODEX_THREAD_ID:'foreign-thread'};
 const env=standaloneCodexEnvironment(source);
 assert.deepEqual(env,{PATH:'tools',APPDATA:'appdata',CODEX_HOME:'shared',CODEX_API_KEY:'test'});
 assert.equal(source.CODEX_CLI_PATH,'desktop.exe');
 assert.equal(standaloneCodexEnvironment({CODEX_CLI_PATH:'custom-cli.exe'}).CODEX_CLI_PATH,'custom-cli.exe');
});

test('Windows Codex encrypted-store credential uses the canonical home namespace', () => {
  assert.equal(codexSecretCredentialTarget('\\\\?\\C:\\Users\\pacas\\.codex'), 'secrets|e9a89c38818f7d2d.codex');
});

test('sessions and databases are isolated while login, configuration and MCP credentials share storage', t => {
  const f = fixture(t);
  writeFileSync(join(f.sharedHome, 'auth.json'), 'test-login');
  writeFileSync(join(f.sharedHome, 'config.toml'), 'sqlite_home = "shared-history"');
  mkdirSync(join(f.sharedHome, 'secrets'));
  writeFileSync(join(f.sharedHome, 'secrets', 'mcp_oauth.age'), 'encrypted-test-credential');
  writeFileSync(join(f.sharedHome, 'history.jsonl'), 'unrelated-history');
  writeFileSync(join(f.sharedHome, 'state_5.sqlite'), 'unrelated-database');
  const r = f.runtime();
  try {
    assert.equal(statSync(join(f.home, 'auth.json')).ino, statSync(join(f.sharedHome, 'auth.json')).ino);
    assert.equal(realpathSync(join(f.home, 'secrets')), realpathSync(join(f.sharedHome, 'secrets')));
    assert.equal(r.env.CODEX_HOME, f.home);
    assert.equal(r.env.CODEX_SQLITE_HOME, f.home);
    assert.match(r.args[1], /^sqlite_home=/);
    assert(!existsSync(join(f.home, 'history.jsonl')));
    assert(!existsSync(join(f.home, 'state_5.sqlite')));
    mkdirSync(join(f.home, 'sessions'));
    writeFileSync(join(f.home, 'sessions', 'new-chat.jsonl'), 'mains-only');
    assert(!existsSync(join(f.sharedHome, 'sessions', 'new-chat.jsonl')));
  } finally { r.close(); }
});

test('atomic credential refresh on either side relinks the current credentials; shared logout removes stale login', t => {
  const f = fixture(t);
  writeFileSync(join(f.sharedHome, 'auth.json'), 'old');
  let r = f.runtime();
  try {
    writeFileSync(join(f.home, 'fresh.tmp'), 'refreshed-by-mains');
    renameSync(join(f.home, 'fresh.tmp'), join(f.home, 'auth.json'));
    r.sync();
    assert.equal(readFileSync(join(f.sharedHome, 'auth.json'), 'utf8'), 'refreshed-by-mains');
    writeFileSync(join(f.sharedHome, 'fresh.tmp'), 'refreshed-by-codex');
    renameSync(join(f.sharedHome, 'fresh.tmp'), join(f.sharedHome, 'auth.json'));
    r.sync();
    assert.equal(readFileSync(join(f.home, 'auth.json'), 'utf8'), 'refreshed-by-codex');
    r.close(); r = f.runtime();
    assert.equal(readFileSync(join(f.home, 'auth.json'), 'utf8'), 'refreshed-by-codex');
    rmSync(join(f.sharedHome, 'auth.json')); r.sync();
    assert(!existsSync(join(f.home, 'auth.json')));
  } finally { r.close(); }
});

test('first login and new MCP config are shared without creating any shared chat history', t => {
  const f = fixture(t), r = f.runtime();
  try {
    writeFileSync(join(f.home, 'auth.json'), 'first-login'); r.sync();
    assert.equal(readFileSync(join(f.sharedHome, 'auth.json'), 'utf8'), 'first-login');
    writeFileSync(join(f.sharedHome, 'config.toml'), '[mcp_servers.publora]\nurl="https://mcp.publora.com"');
    r.sync();
    assert.equal(readFileSync(join(f.home, 'config.toml'), 'utf8'), readFileSync(join(f.sharedHome, 'config.toml'), 'utf8'));
  } finally { r.close(); }
});

test('legacy migration copies only a requested transcript, keeps the original and never overwrites local continuation', t => {
  const f = fixture(t), r = f.runtime();
  const id = '00000000-0000-0000-0000-000000000001';
  const name = `rollout-2026-10-01-${id}.jsonl`;
  mkdirSync(join(f.sharedHome, 'sessions', '2026', '10', '01'), { recursive: true });
  const source = join(f.sharedHome, 'sessions', '2026', '10', '01', name);
  writeFileSync(source, 'original');
  writeFileSync(join(f.sharedHome, 'sessions', 'unrelated.jsonl'), 'unrelated');
  try {
    assert.equal(importLegacyCodexThread(r, id), true);
    const target = join(f.home, 'sessions', '2026', '10', '01', name);
    assert.equal(readFileSync(target, 'utf8'), 'original');
    assert(!existsSync(join(f.home, 'sessions', 'unrelated.jsonl')));
    writeFileSync(target, 'continued-in-mains');
    assert.equal(importLegacyCodexThread(r, id), false);
    assert.equal(readFileSync(source, 'utf8'), 'original');
    assert.equal(readFileSync(target, 'utf8'), 'continued-in-mains');
    assert.throws(() => importLegacyCodexThread(r, '../escape'), /Invalid/);
  } finally { r.close(); }
});

test('unsafe shared history paths and independent connection files are refused without overwriting data', t => {
  const f = fixture(t);
  assert.throws(() => prepareCodexRuntimeHome({ home: f.sharedHome, sharedHome: f.sharedHome }), /outside/);
  assert.throws(() => prepareCodexRuntimeHome({ home: join(f.sharedHome, 'child'), sharedHome: f.sharedHome }), /outside/);
  mkdirSync(f.home);
  writeFileSync(join(f.sharedHome, 'auth.json'), 'shared');
  writeFileSync(join(f.home, 'auth.json'), 'independent');
  assert.throws(() => f.runtime(), /preserved/);
  assert.equal(readFileSync(join(f.home, 'auth.json'), 'utf8'), 'independent');
  assert.equal(readFileSync(join(f.sharedHome, 'auth.json'), 'utf8'), 'shared');
});

const desktopConfig = String.raw`model = "gpt"
notify = [ "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\abc\\bin\\codex-computer-use.exe", "turn-ended" ]

[mcp_servers.node_repl]
command = 'C:\Users\me\AppData\Local\OpenAI\Codex\runtimes\cua_node\abc\bin\node_repl.exe'

[mcp_servers.node_repl.env]
NODE_REPL_NODE_PATH = 'C:\Users\me\AppData\Local\OpenAI\Codex\runtimes\cua_node\abc\bin\node.exe'

[mcp_servers.publora]
url = "https://mcp.publora.com"

[mcp_servers.local_tool]
command = "C:\\Tools\\my-mcp.exe"
`;
const localAppData = 'C:\\Users\\me\\AppData\\Local';

test('standalone runtime isolates Codex Desktop internals without touching user MCP servers or the sandbox policy', t => {
  const root = mkdtempSync(join(tmpdir(), 'mains-codex-iso-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = desktopRuntimeIsolation({ home: root, configText: desktopConfig, source: { LOCALAPPDATA: localAppData }, platform: 'win32' });
  assert.deepEqual(result.desktopServers, ['node_repl']);
  // Commands and user stdio MCP servers keep the user's real LOCALAPPDATA.
  assert.deepEqual(result.args, ['-c', 'mcp_servers.node_repl.enabled=false', '-c', 'notify=[]', '-c', `shell_environment_policy.set.LOCALAPPDATA=${JSON.stringify(localAppData)}`, '-c', `mcp_servers.local_tool.env.LOCALAPPDATA=${JSON.stringify(localAppData)}`]);
  const ownEnv = desktopRuntimeIsolation({ home: root, configText: '[mcp_servers.local_tool]\ncommand = "tool"\n[mcp_servers.local_tool.env]\nLOCALAPPDATA = "D:\\\\custom"', source: { LOCALAPPDATA: localAppData }, platform: 'win32' });
  assert(!ownEnv.args.some(arg => arg.startsWith('mcp_servers.local_tool.env')));
  // Only the CLI process sees the private directory, so sandbox setup cannot ACL-validate a locked Desktop node_repl.exe.
  assert.equal(result.env.LOCALAPPDATA, join(root, 'desktop-isolation'));
  assert(existsSync(result.env.LOCALAPPDATA));
  assert(!result.args.some(arg => /sandbox_mode|danger|writable_roots|network_access|publora|local_tool\.enabled/.test(arg)));
});

test('isolation is inert for user-only configuration and outside Windows', t => {
  const root = mkdtempSync(join(tmpdir(), 'mains-codex-iso-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const userOnly = desktopRuntimeIsolation({ home: root, configText: '[mcp_servers.local_tool]\ncommand = "C:\\Tools\\my-mcp.exe"\nnotify = ["my-notifier.exe"]', source: { LOCALAPPDATA: localAppData }, platform: 'win32' });
  assert.deepEqual(userOnly.desktopServers, []);
  assert(!userOnly.args.includes('notify=[]'));
  const mac = desktopRuntimeIsolation({ home: root, configText: '[mcp_servers.node_repl]\ncommand = "/Applications/Codex.app/Contents/Resources/node_repl"', source: {}, platform: 'darwin' });
  assert.deepEqual(mac, { env: {}, args: ['-c', 'mcp_servers.node_repl.enabled=false'], desktopServers: ['node_repl'] });
});

test('prepared runtime launches the CLI with Desktop isolation from the shared configuration', t => {
  const f = fixture(t);
  writeFileSync(join(f.sharedHome, 'config.toml'), desktopConfig);
  const r = f.runtime();
  try {
    assert.match(r.args[1], /^sqlite_home=/);
    assert(r.args.includes('mcp_servers.node_repl.enabled=false'));
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) assert.equal(r.env.LOCALAPPDATA, join(f.home, 'desktop-isolation'));
    assert.equal(readFileSync(join(f.sharedHome, 'config.toml'), 'utf8'), desktopConfig);
  } finally { r.close(); }
});
