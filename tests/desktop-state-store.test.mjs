import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopStateStore } from '../desktop-state-store.mjs';
import { DatabaseSync } from 'node:sqlite';

test('a stale renderer cannot overwrite a newer agent list; recovery snapshot and agent revisions preserve it', () => {
  const directory=mkdtempSync(join(tmpdir(),'mains-stale-'));
  const store=createDesktopStateStore(directory,'new');
  store.initialize('account',{agents:[{id:'content'}],sessions:[{id:'history'}]});store.selectProfile('account');
  const stale=store.readAllVersioned('account');
  const next=[{id:'content'},{id:'video'},{id:'linkedin'}];
  store.write('account','agents',next,stale.revisions.agents);
  assert.throws(()=>store.write('account','agents',stale.values.agents,stale.revisions.agents),/Newer saved data/);
  assert.deepEqual(store.read('account','agents'),next);
  const snapshot=JSON.parse(readFileSync(store.recoverySnapshot(),'utf8'));
  assert.deepEqual(JSON.parse(snapshot.rows.find(r=>r.key==='agents').value),next);
  assert.deepEqual(JSON.parse(snapshot.rows.find(r=>r.key==='sessions').value),[{id:'history'}]);
  store.close();
  const db=new DatabaseSync(join(directory,'workspace-state.sqlite'),{readOnly:true});
  assert.deepEqual(JSON.parse(db.prepare('SELECT value FROM agent_revisions WHERE profile=? ORDER BY id DESC LIMIT 1').get('account').value),[{id:'content'}]);db.close();
});

test('Desktop state preserves complete workspace history through an application upgrade', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mains-state-upgrade-'));
  let store = createDesktopStateStore(directory, '0.3.15');
  const data = {
    agents: [{ id: 'agent', workspaceId: 'content' }, { id: 'specialist', workspaceId: 'content', instructions: 'Keep my role', skills: ['editing'] }],
    sessions: [
      { id: 'session', agentId: 'agent', agentConnection: { enabled: true, targetAgentId: 'specialist', targetSessionId: 'specialist-session' }, messages: [{ content: 'Saved message' }] },
      { id: 'specialist-session', agentId: 'specialist', codexThreadId: 'persisted-specialist-thread', messages: [{ content: 'Specialist history' }] },
    ],
    tasks: [{ id: 'task', agentId: 'agent' }],
    workspaces: [{ id: 'content' }],
    'canvas-workspaces': { content: { nodes: [{ id: 'note' }], edges: [{ id: 'edge' }] } },
  };
  store.initialize('default', data);
  assert.equal(store.currentProfile(), 'default');
  store.close();
  store = createDesktopStateStore(directory, '0.3.16');
  assert.equal(store.currentProfile(), 'default');
  assert.deepEqual(store.readAll('default'), data);
  store.initialize('default', { agents: [] });
  assert.deepEqual(store.read('default', 'agents'), data.agents);
  const backup = readdirSync(join(directory, 'backups'))[0];
  const snapshot = JSON.parse(readFileSync(join(directory, 'backups', backup), 'utf8'));
  assert.equal(snapshot.rows.length, Object.keys(data).length);
  store.close();
});

test('Desktop writes survive reopening, and separate profiles do not overwrite each other', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mains-state-profiles-'));
  let store = createDesktopStateStore(directory, '1');
  assert.throws(() => store.write('default', 'agents', []), /not been restored/);
  store.initialize('default', { agents: [{ id: 'default-agent' }] });
  store.initialize('account', { agents: [{ id: 'account-agent' }] });
  store.selectProfile('account');
  store.write('default', 'sessions', [{ id: 'session' }]);
  assert.throws(() => store.replaceAll('default', { agents: [], ['x'.repeat(300)]: true }), /Invalid storage key/);
  assert.deepEqual(store.read('default', 'agents'), [{ id: 'default-agent' }]);
  store.close();
  store = createDesktopStateStore(directory, '1');
  assert.equal(store.currentProfile(), 'account');
  assert.deepEqual(store.read('default', 'sessions'), [{ id: 'session' }]);
  assert.deepEqual(store.read('account', 'agents'), [{ id: 'account-agent' }]);
  store.close();
});
