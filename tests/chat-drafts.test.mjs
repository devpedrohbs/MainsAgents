import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentState } from '../src/data/PersistentState.ts';
import { createDesktopStateStore } from '../desktop-state-store.mjs';
import { chatDraftKey, putChatDraft } from '../src/features/chat/chatDraftModel.ts';
import { composeImport, parseBackup, safeData } from '../src/data/backupFormat.ts';

test('drafts commit before exit, reopen with skill and context, and stay isolated by profile and session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mains-draft-'));
  let db = createDesktopStateStore(directory, '0.3.32');
  db.initialize('one', {}); db.initialize('two', {});
  const store = { readAll: async () => db.readAll('one'), writeSync: (key, value) => db.write('one', key, value) };
  const state = new PersistentState(store, () => {});
  await state.restore(); state.get('chat-drafts', {});
  const draft = { text: 'Texto ainda não enviado', skill: 'editorial', context: [{ workspaceId: 'w', nodeId: 'note', label: 'Briefing' }] };
  state.set('chat-drafts', current => putChatDraft(current, 'agent', 's1', draft));
  state.set('chat-drafts', current => putChatDraft(current, 'agent', 's2', { text: 'Outra conversa', skill: null }));
  state.set('chat-drafts', current => putChatDraft(current, 'other', 's1', { text: 'Outro agente', skill: null }));
  db.close(); db = createDesktopStateStore(directory, '0.3.32');
  const reopened = new PersistentState(store, () => {}); await reopened.restore();
  assert.deepEqual(reopened.get('chat-drafts', {})[chatDraftKey('agent', 's1')], draft);
  assert.equal(db.read('two', 'chat-drafts'), undefined);
  reopened.set('chat-drafts', current => putChatDraft(current, 'agent', 's1', { text: '', skill: null }));
  const remaining = db.read('one', 'chat-drafts');
  assert.equal(Object.keys(remaining).length, 2);
  assert.equal(remaining[chatDraftKey('agent', 's2')].text, 'Outra conversa');
  assert.notEqual(chatDraftKey('agent:s', '1'), chatDraftKey('agent', 's:1'));
  db.close();
});

test('backup carries drafts, validates references, and merges without replacing local edits', () => {
  const key = chatDraftKey('agent', 's1'), other = chatDraftKey('agent', 's2');
  const local = { text: 'Local', skill: null, context: [] };
  const remote = { text: 'Remote', skill: 'editorial', context: [{ workspaceId: 'w', nodeId: 'note', label: 'Brief' }] };
  const file = data => parseBackup(JSON.stringify({ format: 'mainsagents-backup', version: 1, exportedAt: '', data }));
  const backup = file(safeData({ 'chat-drafts': { [key]: remote, [other]: remote }, 'api-key': 'must-not-export' }));
  assert.equal(backup.data['api-key'], undefined);
  const merged = composeImport({ 'chat-drafts': { [key]: local } }, backup, 'merge');
  assert.deepEqual(merged['chat-drafts'][key], local); assert.deepEqual(merged['chat-drafts'][other], remote);
  assert.deepEqual(composeImport({}, backup, 'replace')['chat-drafts'][key], remote);
  assert.throws(() => file({ 'chat-drafts': { [key]: { ...remote, context: [{ nodeId: 'note' }] } } }), /Invalid chat drafts/);
  assert.throws(() => file({ 'chat-drafts': { wrong: remote } }), /Invalid chat drafts/);
});
