import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialInbox } from '../src/features/content/editorialInbox.ts';
import { emptyEditorialState } from '../src/features/content/model.ts';

test('inbox shows only current workspace versions, removes decided reviews, and ignores stale delivery failures', () => {
  const state = emptyEditorialState();
  state.topics = [{ id: 'topic', workspaceId: 'one', title: 'Pesquisa', status: 'review', researchArtifactId: 'r2', updatedAt: '2026-10-02' }, { id: 'foreign', workspaceId: 'two', title: 'Private', status: 'error', updatedAt: '2026-10-03' }];
  state.contents = [{ id: 'content', topicId: 'topic', workspaceId: 'one', title: 'Roteiro', status: 'script-review', scriptOptionsArtifactId: 's2', approvedScriptArtifactId: 'approved2', updatedAt: '2026-10-02' }];
  state.artifacts = [{ id: 'r1', topicId: 'topic', workspaceId: 'one', version: 1 }, { id: 'r2', topicId: 'topic', workspaceId: 'one', version: 2 }, { id: 's2', contentId: 'content', workspaceId: 'one', version: 2 }];
  const jobs = [{ id: 'old', contentId: 'content', artifactId: 'approved1', status: 'failed', updatedAt: '2026-10-03' }, { id: 'new', contentId: 'content', artifactId: 'approved2', status: 'failed', error: 'Connection unavailable', updatedAt: '2026-10-02' }];
  let inbox = editorialInbox(state, jobs, 'one');
  assert.deepEqual(inbox.map(item => item.kind), ['notion-error', 'research-review', 'script-review']);
  assert.equal(inbox[1].artifactVersion, 2); assert.ok(!inbox.some(item => item.id.includes('old')));
  const obsolete = inbox[1].id;
  state.artifacts.push({ id: 'r3', topicId: 'topic', workspaceId: 'one', version: 3 }); state.topics[0].researchArtifactId = 'r3';
  assert.ok(!editorialInbox(state, jobs, 'one').some(item => item.id === obsolete));
  state.topics[0].status = 'approved'; state.contents[0].status = 'script-approved'; jobs[1].status = 'succeeded';
  assert.deepEqual(editorialInbox(state, jobs, 'one'), []);
  state.contents[0].productionStage = 'video-review'; assert.equal(editorialInbox(state, jobs, 'one')[0].kind, 'video-review');
  state.contents[0].productionStage = 'archived'; assert.deepEqual(editorialInbox(state, jobs, 'one'), []);
});
