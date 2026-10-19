import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEditorAuthoring, EDITOR_TOOLS, normalizeEditorLimits, planSafetyProblems, reconcileEditorReport, verifyExportReceipt } from '../editor-authoring.mjs';
import { createEditorHostFixture, ffmpegAvailable, sha256 } from './editor-host-fixture.mjs';

const skip = !(await ffmpegAvailable()) && 'FFmpeg is required for real frames';
const PNG = '89504e470d0a1a0a';

async function withEditor(options, run) {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-editor-'));
  try {
    const fixture = await createEditorHostFixture(root, options);
    const authoring = createEditorAuthoring();
    const events = [];
    const open = (extra = {}) => {
      const { sessionId } = authoring.open({ binding: fixture.binding, host: fixture.host, grant: fixture.grant, ...extra });
      authoring.subscribe(sessionId, (event) => events.push(event));
      const token = authoring.attach(sessionId, 'exec-1');
      return { sessionId, call: (name, args) => authoring.call(token, name, args), token };
    };
    await run({ fixture, authoring, events, open, root });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const plan = (title) => ({ scenes: [{ start: 0, end: 3, layers: [{ kind: 'kineticText', text: title }] }] });

test('editor tools expose draft-07 schemas with read-only hints', () => {
  assert.deepEqual(EDITOR_TOOLS.map((tool) => tool.name), ['get_context', 'get_transcript_words', 'get_frames', 'contact_sheet', 'storyboard_stills', 'write_plan', 'render_preview', 'finalize', 'export_status']);
  for (const tool of EDITOR_TOOLS) assert.equal(tool.inputSchema.type, 'object');
  assert.equal(normalizeEditorLimits().maxRevisions, 2);
  assert.throws(() => normalizeEditorLimits({ maxRevisions: 9 }), /between 0 and 5/);
});

test('a full authoring loop sees real frames, revises within budget and gets a verified receipt', { skip }, async () => {
  await withEditor({}, async ({ fixture, events, open }) => {
    const { call } = open();
    const context = await call('get_context', {});
    assert.equal(context.isError, undefined);
    assert.match(context.structuredContent.transcript, /Três dicas/);
    assert.equal(context.structuredContent.budget.revisionsLeft, 2);

    const frames = await call('get_frames', { times: [0.5, 2] });
    assert.equal(frames.content.filter((block) => block.type === 'image').length, 2);
    for (const block of frames.content.filter((item) => item.type === 'image')) {
      assert.equal(block.mimeType, 'image/png');
      assert.equal(Buffer.from(block.data, 'base64').subarray(0, 8).toString('hex'), PNG, 'a real PNG reaches Claude');
    }

    assert.equal((await call('write_plan', { baseRevision: 0, plan: {} })).structuredContent.code, 'invalid_plan', 'validator errors come back without applying anything');
    for (const [field, value] of [['code', 'fetch(1)'], ['src', 'asset'], ['onEnter', 'x'], ['text', 'veja http://127.0.0.1:5173/editor'], ['text', 'file:///C:/Users/secret.txt'], ['text', '<img src=x onerror=alert(1)>'], ['text', 'C:\\Users\\me\\token.txt']])
      assert.equal((await call('write_plan', { baseRevision: 0, plan: { scenes: [{ start: 0, end: 3, [field]: value }] } })).structuredContent.code, 'unsafe_plan', `${field}=${value}`);
    assert.equal((await call('write_plan', { baseRevision: 0, plan: plan('Olá') })).structuredContent.revision, 1);
    assert.equal((await call('write_plan', { baseRevision: 0, plan: plan('stale') })).structuredContent.code, 'stale_revision');
    assert.equal((await call('finalize', { revision: 1 })).structuredContent.code, 'qa_required', 'no final without a preview of this revision');

    const preview = await call('render_preview', { revision: 1, start: 0, duration: 1 });
    const previewId = preview.structuredContent.previewId;
    assert.equal(fixture.state.calls.renderPreview, 1);
    assert.equal((await call('finalize', { revision: 1 })).structuredContent.code, 'qa_required', 'rendering alone is not inspecting');
    const sheet = await call('contact_sheet', { target: { previewId }, start: 0, end: 1, count: 4 });
    assert.equal(Buffer.from(sheet.content[1].data, 'base64').subarray(0, 8).toString('hex'), PNG);

    // Two corrections beyond the first plan, then the budget stops further rewrites.
    assert.equal((await call('write_plan', { baseRevision: 1, plan: plan('Correção 1') })).structuredContent.revision, 2);
    assert.equal((await call('get_frames', { target: { previewId }, times: [0.2] })).structuredContent.code, 'stale_preview', 'an old preview cannot validate a new revision');
    const threeScenes = { scenes: [{ id: 'hook', start: 0, end: 1 }, { id: 'tips', start: 1, end: 2 }, { id: 'cta', start: 2, end: 3 }] };
    const written = await call('write_plan', { baseRevision: 2, plan: threeScenes });
    assert.equal(written.structuredContent.revision, 3);
    assert.deepEqual(written.structuredContent.scenes.map((scene) => scene.id), ['hook', 'tips', 'cta']);
    assert.equal((await call('write_plan', { baseRevision: 3, plan: plan('Correção 3') })).structuredContent.code, 'budget');

    // A short preview covers only its window: here the middle scene.
    const second = await call('render_preview', { revision: 3, start: 1, duration: 1 });
    await call('get_frames', { target: { previewId: second.structuredContent.previewId }, times: [0.5] });
    const partial = await call('finalize', { revision: 3 });
    assert.equal(partial.structuredContent.code, 'qa_required');
    assert.match(partial.content[0].text, /Not inspected: hook, cta/);
    // Real stills of every remaining scene of this revision, tagged with sceneId.
    const stills = await call('storyboard_stills', { revision: 3 });
    assert.equal(stills.content.filter((block) => block.type === 'image').length, 6);
    assert.deepEqual([...new Set(stills.structuredContent.stills.map((still) => still.sceneId))], ['hook', 'cta']);
    assert.deepEqual(stills.structuredContent.remainingScenes, []);
    assert.equal((await call('storyboard_stills', { revision: 2 })).structuredContent.code, 'stale_revision');
    assert.equal((await call('storyboard_stills', { revision: 3, sceneIds: ['ghost'] })).structuredContent.code, 'invalid_input');
    assert(!events.some((event) => event.type === 'file.completed'));
    const final = await call('finalize', { revision: 3, summary: 'Texto animado e corte limpo.' });
    assert.equal(final.isError, undefined, final.content[0].text);
    assert.equal(final.structuredContent.receipt.sha256, sha256(fixture.state.finalFile));
    assert.equal(final.structuredContent.receipt.path, undefined, 'the absolute path stays with the host');
    const completed = events.filter((event) => event.type === 'file.completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].receipt.path, fixture.state.finalFile);
    assert.equal(completed[0].receipt.sha256, sha256(fixture.state.finalFile));

    // After finalize: no rewrites, no previews, and a repeated finalize never renders again.
    assert.equal((await call('write_plan', { baseRevision: 3, plan: plan('late') })).structuredContent.code, 'finalized');
    assert.equal((await call('render_preview', { revision: 3, start: 0, duration: 1 })).structuredContent.code, 'finalized');
    assert.equal((await call('finalize', { revision: 3 })).structuredContent.status, 'succeeded');
    assert.equal(fixture.state.calls.finalExport, 1);
    assert.deepEqual(fixture.state.saved.map((entry) => entry.revision), [1, 2, 3], 'each accepted plan is checkpointed by the host');
    const checkpoint = events.filter((event) => event.type === 'editor.checkpoint').at(-1).checkpoint;
    assert.deepEqual([checkpoint.revision, checkpoint.revisionsUsed, checkpoint.previewsUsed, checkpoint.final.status], [3, 2, 2, 'succeeded']);
    assert.deepEqual(checkpoint.final.qa, { kind: 'model-interpretation', sourceObserved: true, previewInspected: true, scenes: 3, scenesInspected: 3, limitations: [] });
  });
});

test('finalize requires the source to be observed when frames are available', { skip }, async () => {
  await withEditor({}, async ({ open }) => {
    const { call } = open();
    await call('write_plan', { baseRevision: 0, plan: plan('x') });
    const preview = await call('render_preview', { revision: 1, start: 0, duration: 1 });
    await call('get_frames', { target: { previewId: preview.structuredContent.previewId }, times: [0.1] });
    assert.equal((await call('finalize', { revision: 1 })).structuredContent.code, 'qa_required');
  });
});

test('without vision or preview the final carries explicit limitations instead of a faked review', { skip }, async () => {
  await withEditor({}, async ({ fixture, authoring, events }) => {
    const host = { ...fixture.host, frames: undefined, contactSheet: undefined, renderPreview: undefined, storyboardStills: undefined };
    const { sessionId } = authoring.open({ binding: fixture.binding, host, grant: fixture.grant });
    authoring.subscribe(sessionId, (event) => events.push(event));
    const token = authoring.attach(sessionId, 'exec');
    assert.equal((await authoring.call(token, 'get_frames', { times: [1] })).structuredContent.code, 'unavailable');
    await authoring.call(token, 'write_plan', { baseRevision: 0, plan: plan('x') });
    const final = await authoring.call(token, 'finalize', { revision: 1 });
    assert.equal(final.structuredContent.status, 'succeeded');
    assert.deepEqual(authoring.checkpoint(sessionId).final.qa.limitations, ['framesUnavailable', 'previewUnavailable']);
  });
});

test('wrong binding, stale production, late and cancelled calls are refused', { skip }, async () => {
  await withEditor({}, async ({ fixture, authoring, open }) => {
    assert.throws(() => authoring.open({ binding: fixture.binding, host: fixture.host, grant: { scope: 'edit-local', authorityHash: 'other' } }), /not authorized/);
    assert.throws(() => authoring.open({ binding: { ...fixture.binding, source: { ...fixture.binding.source, sha256: 'nope' } }, host: fixture.host, grant: fixture.grant }), /registered source/);
    assert.throws(() => authoring.open({ binding: { ...fixture.binding, epoch: 2 }, host: fixture.host, grant: fixture.grant }), /changed before/);
    assert.equal((await authoring.call('forged-token', 'get_context', {})).structuredContent.code, 'unbound');

    const { sessionId, call, token } = open();
    assert.equal((await call('get_context', {})).isError, undefined);
    assert.throws(() => authoring.attach(sessionId, 'exec-2'), /already attached/);
    fixture.state.current = { ...fixture.binding, epoch: 2 };
    assert.equal((await call('get_frames', { times: [1] })).structuredContent.code, 'stale', 'a new production epoch invalidates the session');
    fixture.state.current = fixture.binding;

    authoring.detach(sessionId);
    assert.equal((await authoring.call(token, 'get_context', {})).structuredContent.code, 'unbound', 'a finished process cannot act later');
    const again = authoring.call(authoring.attach(sessionId, 'exec-3'), 'get_context', {});
    assert.equal((await again).isError, undefined);
    authoring.close(sessionId, 'cancelled');
    assert.equal(authoring.checkpoint(sessionId).state, 'cancelled');
    assert.throws(() => authoring.attach(sessionId, 'exec-4'), /closed/);
  });
});

test('pending exports never complete a file until the host verifies it', { skip }, async () => {
  await withEditor({ finalMode: 'pending' }, async ({ fixture, events, open, authoring }) => {
    const { sessionId, call } = open();
    await call('get_frames', { times: [1] });
    await call('write_plan', { baseRevision: 0, plan: plan('x') });
    const preview = await call('render_preview', { revision: 1, start: 0, duration: 1 });
    await call('get_frames', { target: { previewId: preview.structuredContent.previewId }, times: [0.5] });
    assert.equal((await call('finalize', { revision: 1 })).structuredContent.status, 'pending');
    assert(!events.some((event) => event.type === 'file.completed'), 'pending is not a delivered file');
    // Ending the turn keeps the authorized export alive; only a cancel aborts it.
    authoring.close(sessionId, 'closed');
    assert.equal(fixture.state.signals.export.aborted, false);
    const token = authoring.open({ binding: fixture.binding, host: fixture.host, grant: fixture.grant, checkpoint: authoring.checkpoint(sessionId) });
    const resumed = authoring.attach(token.sessionId, 'exec-2');
    authoring.subscribe(token.sessionId, (event) => events.push(event));
    assert.equal((await authoring.call(resumed, 'finalize', { revision: 1 })).structuredContent.status, 'succeeded', 'after a restart the status is read, not requested again');
    assert.equal(fixture.state.calls.finalExport, 1);
    assert.equal(events.filter((event) => event.type === 'file.completed').length, 1);
  });
});

test('receipts with a wrong hash or the source bytes are rejected', { skip }, async () => {
  for (const finalMode of ['wrong-hash', 'source-bytes', 'throws']) {
    await withEditor({ finalMode }, async ({ events, open, fixture }) => {
      const { call } = open({ limits: { maxPreviews: 0 } });
      await call('get_frames', { times: [1] });
      await call('write_plan', { baseRevision: 0, plan: plan('x') });
      assert.equal((await call('finalize', { revision: 1 })).structuredContent.code, 'qa_required', 'source frames do not inspect the edited scenes');
      await call('storyboard_stills', { revision: 1 });
      const result = await call('finalize', { revision: 1 });
      assert.equal(result.isError, true, finalMode);
      assert(!events.some((event) => event.type === 'file.completed'), finalMode);
      if (finalMode === 'throws') {
        assert.equal(result.structuredContent.code, 'export_uncertain');
        await call('finalize', { revision: 1 });
        assert.equal(fixture.state.calls.finalExport, 1, 'an uncertain export is never requested twice');
      }
    });
  }
});

test('cancel aborts in-flight host work and the export', { skip }, async () => {
  await withEditor({ finalMode: 'pending' }, async ({ fixture, open, authoring }) => {
    const { sessionId, call } = open();
    await call('get_frames', { times: [1] });
    await call('write_plan', { baseRevision: 0, plan: plan('x') });
    const preview = await call('render_preview', { revision: 1, start: 0, duration: 1 });
    await call('get_frames', { target: { previewId: preview.structuredContent.previewId }, times: [0.5] });
    await call('finalize', { revision: 1 });
    authoring.close(sessionId, 'cancelled');
    assert.equal(fixture.state.signals.export.aborted, true);
    assert.equal(fixture.state.signals.preview.aborted, true);
  });
});

test('plan safety is structural: educational text passes, executable fields and references do not', async () => {
  const { safeStoryText } = await import('../editorial-storyboard.mjs');
  const legit = ['Rode o servidor em localhost:3000', 'Nunca cole tokens no chat', 'Leia process.env.API_KEY só no servidor', '127.0.0.1 é o seu próprio computador', 'Bearer token expira em 1h', 'Use require("fs") apenas no Node', 'MAINSAGENTS_EDITOR_TOKEN é segredo'];
  for (const value of legit) {
    assert.deepEqual(planSafetyProblems({ scenes: [{ id: 's1', layers: [{ type: 'text', text: value, role: 'body' }] }] }), [], value);
    assert.equal(safeStoryText(value, 120), true, `A's text filter agrees: ${value}`);
  }
  const denied = [
    [{ layers: [{ type: 'text', text: 'ok', html: '<b>x</b>' }] }, /field "html"/],
    [{ layers: [{ type: 'image', src: 'C:/Users/me/photo.png' }] }, /field "src"/],
    [{ layers: [{ type: 'text', text: 'ok', onFrame: 'tick()' }] }, /field "onFrame"/],
    [{ layers: [{ type: 'video', url: 'https://cdn.example.com/a.mp4' }] }, /field "url"/],
    [{ layers: [{ type: 'text', text: 'https://evil.example/x' }] }, /URL/],
    [{ layers: [{ type: 'text', text: '../../secrets.json' }] }, /filesystem path/],
    [{ layers: [{ type: 'text', text: '/Users/me/.claude/credentials' }] }, /filesystem path/],
    [{ layers: [{ type: 'text', text: '<script>alert(1)</script>' }] }, /markup/],
    [{ layers: [{ type: 'text', text: 'oi ${process.env.X}' }] }, /template/],
    [{ layers: [{ type: 'text', text: 'abc\u202Edef' }] }, /bidi/],
    [{ layers: [{ type: 'text', text: 'data:text/html;base64,AAAA' }] }, /URI/],
    [JSON.parse('{"__proto__":{"polluted":true}}'), /__proto__/],
  ];
  for (const [plan, pattern] of denied) assert.match(planSafetyProblems(plan).join('\n'), pattern, JSON.stringify(plan));
  assert.match(planSafetyProblems({ text: 'x-SECRET-TOKEN-y' }, { secrets: ['SECRET-TOKEN'] }).join(), /session credential/);
  // Real storyboards authored for A's engine (all layer types in use) pass the structural gate unchanged.
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../docs/analysis/editing-ai-motion-engine-2026-10-12/storyboards/', import.meta.url);
  const authored = readdirSync(dir).filter((name) => name.endsWith('.json'));
  assert(authored.length >= 3);
  for (const name of authored) assert.deepEqual(planSafetyProblems(JSON.parse(readFileSync(new URL(name, dir), 'utf8')).storyboard), [], name);
});

test('image budget and host-saved checkpoints cannot be bypassed by reopening', { skip }, async () => {
  await withEditor({}, async ({ fixture, authoring, open }) => {
    const { sessionId, call } = open({ limits: { maxVisionBytes: 1_000_000 } });
    await call('write_plan', { baseRevision: 0, plan: plan('a') });
    await call('write_plan', { baseRevision: 1, plan: plan('b') });
    const many = { times: [0, 0.5, 1, 1.5, 2, 2.5, 2.9, 0.2], maxWidth: 1280 };
    let denied;
    for (let i = 0; i < 60 && !denied; i++) { const result = await call('get_frames', many); if (result.isError) denied = result; }
    assert.equal(denied?.structuredContent.code, 'budget', 'images stop at the configured byte budget');
    const saved = authoring.checkpoint(sessionId);
    authoring.close(sessionId, 'closed');
    // The host returns its persisted checkpoint even when the caller forgets to pass it.
    const host = { ...fixture.host, loadCheckpoint: (binding) => binding.runId === saved.runId ? saved : null };
    const reopened = authoring.open({ binding: fixture.binding, host, grant: fixture.grant, limits: { maxVisionBytes: 1_000_000 } });
    const restored = authoring.checkpoint(reopened.sessionId);
    assert.deepEqual([restored.revision, restored.revisionsUsed, restored.visionBytes], [2, 1, saved.visionBytes]);
    const token = authoring.attach(reopened.sessionId, 'exec-2');
    assert.equal((await authoring.call(token, 'get_frames', many)).structuredContent.code, 'budget');
    assert.throws(() => authoring.open({ binding: fixture.binding, host, grant: fixture.grant, checkpoint: { ...saved, epoch: 9 } }), /another production revision/);
    // A new authorization (e.g. another edit director in the same epoch) never inherits the previous budget.
    assert.equal(saved.authorityHash, fixture.binding.authorityHash);
    assert.throws(() => authoring.open({ binding: fixture.binding, host, grant: fixture.grant, checkpoint: { ...saved, authorityHash: 'f'.repeat(64) } }), /another production revision/);
  });
});

test('receipt verification hashes the real file and the report is reconciled with the checkpoint', { skip }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'mainsagents-receipt-'));
  try {
    const fixture = await createEditorHostFixture(root);
    const path = fixture.source, hash = sha256(path);
    const receipt = { assetId: 'a', versionId: 'v', sha256: hash, path, planHash: 'p', requestKey: 'k' };
    assert.equal((await verifyExportReceipt(receipt, { planHash: 'p', requestKey: 'k' })).sha256, hash);
    await assert.rejects(verifyExportReceipt({ ...receipt, path: join(root, 'missing.mp4') }, { planHash: 'p' }), /does not exist/);
    await assert.rejects(verifyExportReceipt(receipt, { planHash: 'other' }), /another plan/);
    await assert.rejects(verifyExportReceipt({ ...receipt, bytes: 1 }, { planHash: 'p' }), /size differs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  const checkpoint = { finalized: true, final: { revision: 2 } };
  assert.deepEqual(reconcileEditorReport({ status: 'finalized', finalRevision: 2, summary: 'ok' }, checkpoint).consistent, true);
  assert.equal(reconcileEditorReport({ status: 'finalized', finalRevision: 3, summary: 'ok' }, checkpoint).consistent, false);
  assert.equal(reconcileEditorReport({ status: 'finalized', finalRevision: 1, summary: 'claims a file' }, { finalized: false }).consistent, false, 'a claimed export without a checkpoint is not trusted');
  assert.equal(reconcileEditorReport(undefined, checkpoint).valid, false);
});
