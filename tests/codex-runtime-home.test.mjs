import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, statSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCodexRuntimeHome, importLegacyCodexThread } from '../codex-runtime-home.mjs';
import { codexSecretCredentialTarget } from '../codex-shared-key.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mains-codex-'));
  const sharedHome = join(root, 'shared'), home = join(root, 'mains');
  mkdirSync(sharedHome);
  const runtime = () => prepareCodexRuntimeHome({ sharedHome, home, shareSecretKey: () => {} });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { sharedHome, home, runtime };
}

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
