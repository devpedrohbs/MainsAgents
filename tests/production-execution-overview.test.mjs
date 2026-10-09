import test from 'node:test';
import assert from 'node:assert/strict';
import {executionOverview, filterExecutions, executionStateLabel} from '../src/components/production/ExecutionOverviewProjection.ts';
import {startDraftScope} from '../src/features/production/productionDrafts.ts';
import {putStudioField} from '../src/features/content/studioDraftModel.ts';

const at = '2026-10-07T12:00:00.000Z';
const fixture = (id, stage, extra = {}) => ({
  id, workspaceId: 'workspace-a', flowId: 'shared-flow', name: `Production ${id}`, stage, updatedAt: at,
  sourceAgent: {id: 'writer', name: 'Writer'}, editorAgent: {id: 'editor', name: 'Editor'}, publisherAgent: {id: 'publisher', name: 'Publisher'},
  sourceSession: {id: `${id}-source`, agentId: 'writer'}, editorSession: {id: `${id}-editor`, agentId: 'editor'}, publisherSession: {id: `${id}-publisher`, agentId: 'publisher'},
  topic: {title: 'Synthetic topic'},
  events: [], ...extra,
});

test('two productions preserve distinct real states, isolate workspace and do not mutate input', () => {
  const runs = [fixture('one', 'writing', {step: {phase: 'queued'}}), fixture('two', 'video-review'), fixture('private', 'blocked', {workspaceId: 'workspace-b'})];
  const before = JSON.stringify(runs);
  const items = executionOverview(runs, 'workspace-a');
  assert.deepEqual(items.map(item => [item.id, item.state]), [['one', 'active'], ['two', 'waiting']]);
  assert.match(items[0].reason, /aguardando o executor/);
  assert.equal(filterExecutions(items, 'waiting')[0].id, 'two');
  assert.equal(filterExecutions(items, 'blocked').length, 0);
  assert.equal(JSON.stringify(runs), before);
  assert.deepEqual(executionOverview(runs, 'absent'), []);
  assert.ok(items.every(item => !('eta' in item) && !('queuePosition' in item)));
});

test('all explicit states and human decision stages are classified without hiding cancellations', () => {
  for (const [stage, state] of [['writing','active'],['editing','active'],['recording','waiting'],['platforms','waiting'],['schedule','waiting'],['package-review','waiting'],['paused','paused'],['blocked','blocked'],['complete','complete'],['canceled','canceled'],['legacy-stage','unknown']]) {
    assert.equal(executionOverview([fixture('one', stage)], 'workspace-a')[0].state, state);
    assert.ok(executionStateLabel(state, true));
    assert.ok(executionStateLabel(state, false));
  }
});

test('stopped stage and reason use evidence; missing legacy evidence is honest', () => {
  const paused = executionOverview([fixture('one', 'paused', {resumeStage: 'editing', error: 'Saved interruption'})], 'workspace-a', false)[0];
  assert.equal(paused.stageLabel, 'Editing video');
  assert.equal(paused.agentName, 'Editor');
  assert.equal(paused.reason, 'Saved interruption');
  const unknown = executionOverview([fixture('old', 'legacy-stage', {updatedAt: 'invalid'})], 'workspace-a', false)[0];
  assert.equal(unknown.agentName, undefined);
  assert.equal(unknown.chat, undefined);
  assert.equal(unknown.updatedAt, undefined);
  assert.match(unknown.reason, /Unrecognized stage/);
  const legacyPause = executionOverview([fixture('old', 'paused')], 'workspace-a')[0];
  assert.equal(legacyPause.agentName, undefined);
  assert.equal(legacyPause.chat, undefined);
});

test('navigation identifies the exact run and stage chat even when two runs share a flow', () => {
  const runs = [fixture('one', 'writing'), fixture('two', 'video-review')];
  const items = executionOverview(runs, 'workspace-a');
  assert.deepEqual(items[0].chat, {agentId: 'writer', sessionId: 'one-source'});
  assert.deepEqual(items[1].chat, {agentId: 'editor', sessionId: 'two-editor'});
  const target = items[1].detail;
  assert.deepEqual(target, {workspaceId: 'workspace-a', flowId: 'shared-flow', sessionId: 'two-source', runId: 'two'});
  const scope = startDraftScope(target.workspaceId, target.flowId, target.sessionId);
  const drafts = putStudioField({}, scope, 'run', 'one');
  assert.equal(putStudioField(drafts, scope, 'run', target.runId)[scope].fields.run, 'two');
  assert.deepEqual(executionOverview([fixture('p', 'package-review')], 'workspace-a')[0].chat, {agentId:'publisher', sessionId:'p-publisher'});
  assert.equal(executionOverview([fixture('broken', 'editing', {editorSession:{id:'wrong',agentId:'writer'}})], 'workspace-a')[0].chat, undefined);
});

test('automatic stages without executor evidence never fabricate queue or live activity', () => {
  const item = executionOverview([fixture('one', 'writing')], 'workspace-a', false)[0];
  assert.match(item.reason, /activity is not confirmed/);
  const items = executionOverview([fixture('old', 'complete', {updatedAt: '2026-10-06T12:00:00Z'}), fixture('new', 'blocked', {error: 'Missing file'})], 'workspace-a');
  assert.equal(items[0].id, 'new');
  assert.equal(items[0].reason, 'Missing file');
});

test('PT and EN share raw stop evidence including stale cancellation resume stage', () => {
  for (const pt of [true, false]) {
    const canceled = executionOverview([fixture('c', 'canceled', {resumeStage:'writing', events:[{action:'editing',detail:'',at}]})], 'workspace-a', pt)[0];
    assert.equal(canceled.agentName, 'Editor');
    assert.equal(canceled.chat.sessionId, 'c-editor');
    const blocked = executionOverview([fixture('b', 'blocked', {resumeStage:'package-review'})], 'workspace-a', pt)[0];
    assert.equal(blocked.agentName, 'Publisher');
    const legacy = executionOverview([{id:'old', workspaceId:'workspace-a', stage:null, events:[null,{}], error:42, name:42, updatedAt:null},null,{}], 'workspace-a', pt)[0];
    assert.equal(legacy.state, 'unknown');
    assert.equal(legacy.detail, undefined);
    assert.equal(legacy.chat, undefined);
    assert.equal(legacy.updatedAt, undefined);
    assert.equal(typeof legacy.name, 'string');
  }
});
