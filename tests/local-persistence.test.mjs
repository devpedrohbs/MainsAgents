import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersistentState } from '../src/data/PersistentState.ts';
import { createDesktopStateStore } from '../desktop-state-store.mjs';

test('a failed commit remains visibly unsaved, manual retry saves it, and close verification refuses persistent failures',async()=>{
  let fail=true,stored=[];
  const state=new PersistentState({readAll:async()=>({agents:[]}),writeSync:(_key,value)=>{if(fail)throw new Error('Disk locked');stored=value}},()=>{});
  await state.restore();state.get('agents',[]);state.set('agents',[{id:'video'},{id:'linkedin'}]);
  assert.equal(state.getSaveStatus().phase,'error');assert.equal(state.getSaveStatus().pending,1);
  await assert.rejects(state.saveNow(),/Disk locked/);
  assert.equal(state.getSaveStatus().phase,'error');assert.deepEqual(stored,[]);
  fail=false;await state.saveNow();
  assert.equal(state.getSaveStatus().phase,'saved');assert.equal(state.getSaveStatus().pending,0);
  assert.deepEqual(stored,[{id:'video'},{id:'linkedin'}]);
});

test('agent edits and linked session history commit before UI notifications, including immediate exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mains-realtime-'));
  let db = createDesktopStateStore(directory, 'old');
  const initial = { agents: [{ id: 'content' }], sessions: [{ id: 'source', agentId: 'content', messages: [{ content: 'Keep history' }], agentConnection: { enabled: true, targetAgentId: 'video', targetSessionId: 'target' } }] };
  db.initialize('account', initial); db.selectProfile('account');
  const store = { readAll: async () => db.readAll('account'), write: async () => assert.fail('Native save must not be delayed'), writeSync: (key, value) => db.write('account', key, value) };
  const state = new PersistentState(store, (_key, error) => { throw error; });
  await state.restore();
  state.get('agents', []); state.get('sessions', []);
  state.subscribe('agents', () => assert.equal(db.read('account', 'agents').length, 3));
  state.set('agents', current => [...current, { id: 'video', instructions: 'Edit only', skills: ['video-editing'] }, { id: 'linkedin' }]);
  state.set('sessions', current => [...current, { id: 'target', agentId: 'video', codexThreadId: 'real-thread', messages: [{ content: 'Saved specialist response' }] }]);
  // No flush, timer, React effect or graceful application shutdown is required.
  db.close(); db = createDesktopStateStore(directory, 'new');
  assert.equal(db.currentProfile(), 'account');
  assert.equal(db.read('account', 'agents').length, 3);
  assert.deepEqual(db.read('account', 'sessions'), state.snapshot().sessions);
  assert.equal(db.read('account', 'agents')[1].instructions, 'Edit only');
  db.close();
});

test('shared consumers cannot overwrite restored values with defaults, and consecutive edits see the latest state', async () => {
  const writes = [], data = { agents: [{ id: 'original' }], 'default-codex-model': 'selected-model' };
  const state = new PersistentState({ readAll: async () => data, writeSync: (key, value) => writes.push({ key, value }) }, assert.fail);
  await state.restore();
  assert.equal(state.get('default-codex-model', ''), 'selected-model');
  state.saveDefault('default-codex-model');
  assert.equal(writes.length, 0);
  let notifications = 0;
  state.subscribe('default-codex-model', () => notifications++);
  state.subscribe('default-codex-model', () => notifications++);
  state.set('default-codex-model', 'new-model');
  assert.equal(state.get('default-codex-model', 'stale-default'), 'new-model');
  state.saveDefault('default-codex-model');
  assert.equal(writes.length, 1); assert.equal(notifications, 2);
  state.get('agents', []);
  state.set('agents', current => [...current, { id: 'second' }]);
  state.set('agents', current => [...current, { id: 'third' }]);
  assert.deepEqual(writes.at(-1).value.map(a => a.id), ['original', 'second', 'third']);
});

test('failed restore keeps the workspace closed and never writes empty defaults; retry restores the original agents', async () => {
  let fail = true, writes = 0;
  const state = new PersistentState({ readAll: async () => { if (fail) throw new Error('Disk unavailable'); return { agents: [{ id: 'existing' }] }; }, writeSync: () => writes++ }, assert.fail);
  await assert.rejects(state.restore(), /Disk unavailable/);
  assert.throws(() => state.get('agents', []), /must be restored/);
  assert.throws(() => state.set('agents', []), /not been restored/);
  assert.equal(writes, 0);
  fail = false; await state.restore();
  assert.equal(state.get('agents', [])[0].id, 'existing');
});

test('slow browser writes remain ordered, and failed saves remain available in a recovery snapshot', async () => {
  const saved = [], failures = [];
  const state = new PersistentState({ readAll: async () => ({ value: 0 }), write: async (key, value) => { if (value === 1) await new Promise(resolve => setTimeout(resolve, 15)); if (value === 2) throw new Error('Disk full'); saved.push(value); } }, (key, error) => failures.push({ key, error: error.message }));
  await state.restore(); state.get('value', 0);
  state.set('value', 1); state.set('value', 2); state.set('value', 3);
  await state.flush();
  assert.deepEqual(saved, [1, 3]); assert.equal(failures[0].error, 'Disk full'); assert.equal(state.snapshot().value, 3);
  const failed = new PersistentState({ readAll: async () => ({ agents: [] }), writeSync: () => { throw new Error('Disk full'); } }, () => {});
  await failed.restore(); failed.get('agents', []); failed.set('agents', [{ id: 'unsaved-agent' }]);
  assert.equal(failed.snapshot().agents[0].id, 'unsaved-agent');
});
