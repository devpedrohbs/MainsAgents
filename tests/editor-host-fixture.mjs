// Test fixture (not a test file): a real editor host backed by FFmpeg on a generated recording.
// Frames, contact sheets, previews and the final export are real files with real hashes.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export async function ffmpegAvailable() { try { await run('ffmpeg', ['-version'], { windowsHide: true }); return true; } catch { return false; } }

export async function createEditorHostFixture(root, { finalMode = 'succeeded' } = {}) {
  const source = join(root, 'source.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const binding = { runId: 'run-1', epoch: 1, profileId: 'profile-1', workspaceId: 'ws-1', agentId: 'editor-claude', contentId: 'content-1', authorityHash: 'authority-1', source: { assetId: 'asset-src', versionId: 'v1', sha256: sha256(source) } };
  const state = { current: binding, previews: new Map(), saved: [], calls: { finalExport: 0, exportStatus: 0, renderPreview: 0, frames: 0 }, signals: {}, finalFile: null };
  let counter = 0;
  const fileOf = (target) => target === 'source' || Number.isInteger(target.revision) ? source : state.previews.get(target.previewId);
  const encodeFinal = async (planHash, requestKey) => {
    const path = join(root, `final-${planHash.slice(0, 8)}.mp4`);
    await ffmpeg(['-i', source, '-vf', 'hue=s=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', path]);
    state.finalFile = path;
    return { assetId: 'asset-final', versionId: 'v-final', sha256: sha256(path), bytes: statSync(path).size, path, planHash, requestKey, duration: 3 };
  };
  const host = {
    currentBinding: () => state.current,
    context: async () => ({ metadata: { duration: 3, width: 320, height: 180, fps: 15, hasAudio: true }, transcript: { segments: [{ start: 0, end: 1.4, text: 'Olá, hoje vamos editar.' }, { start: 1.5, end: 2.9, text: 'Três dicas rápidas.' }], timing: 'words', words: 3, origin: 'local-whisper', engine: 'whisper.cpp' }, brief: 'Vídeo curto de teste.', capabilities: { frames: true, preview: true, finalExport: true }, planSchema: { type: 'object', required: ['scenes'] } }),
    // Real word timings as the host keeps them (source timeline, start-based windows).
    transcriptWords: ({ start, end }) => ({ timing: 'words', origin: 'local-whisper', engine: 'whisper.cpp', words: [{ start: 0.1, end: 0.4, text: 'Olá' }, { start: 1.5, end: 1.8, text: 'Três' }, { start: 1.85, end: 2.2, text: 'dicas' }].filter((word) => word.start >= start && word.start < end) }),
    frames: async ({ target, times, maxWidth }) => {
      state.calls.frames++;
      const input = fileOf(target);
      return Promise.all(times.map(async (time, index) => {
        const path = join(root, `frame-${++counter}-${index}.png`);
        await ffmpeg(['-ss', String(time), '-i', input, '-frames:v', '1', '-vf', `scale=${Math.min(maxWidth, 320)}:-2`, path]);
        return { time, path };
      }));
    },
    contactSheet: async ({ target, start, end, count }) => {
      const path = join(root, `sheet-${++counter}.png`), columns = 4, rows = Math.ceil(count / columns);
      await ffmpeg(['-ss', String(start), '-t', String(end - start), '-i', fileOf(target), '-vf', `fps=${count / (end - start)},scale=80:-2,tile=${columns}x${rows}`, '-frames:v', '1', path]);
      return { path, mimeType: 'image/png', times: Array.from({ length: count }, (_, i) => start + (i * (end - start)) / count) };
    },
    validatePlan: async ({ plan }) => Array.isArray(plan.scenes) && plan.scenes.length ? { ok: true, plan, planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), summary: `${plan.scenes.length} scene(s)`, warnings: [], scenes: plan.scenes.map((scene, index) => ({ id: scene.id ?? `scene-${index + 1}`, start: scene.start, end: scene.end })) } : { ok: false, errors: ['scenes: at least one scene is required'] },
    // Stand-in for the motion engine's per-scene stills (entry/middle/exit); a real host renders the composition.
    storyboardStills: async ({ planHash, sceneIds }) => {
      const plan = state.saved.find((entry) => entry.planHash === planHash).plan;
      const scenes = plan.scenes.map((scene, index) => ({ ...scene, id: scene.id ?? `scene-${index + 1}` })).filter((scene) => sceneIds.includes(scene.id));
      const stills = scenes.flatMap((scene) => [['in', scene.start + 0.05], ['mid', (scene.start + scene.end) / 2], ['out', scene.end - 0.1]].map(([position, time]) => ({ sceneId: scene.id, position, time })));
      return Promise.all(stills.map(async (still) => { const path = join(root, `still-${++counter}.png`); await ffmpeg(['-ss', String(still.time), '-i', source, '-frames:v', '1', '-vf', 'negate,scale=160:-2', path]); return { ...still, path }; }));
    },
    savePlan: async (entry) => { state.saved.push(entry); },
    renderPreview: async ({ revision, start, duration, signal }) => {
      state.calls.renderPreview++; state.signals.preview = signal;
      const previewId = `preview-${revision}-${++counter}`, path = join(root, `${previewId}.mp4`);
      await ffmpeg(['-ss', String(start), '-t', String(duration), '-i', source, '-vf', 'negate', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', path]);
      state.previews.set(previewId, path);
      return { previewId, path, sha256: sha256(path), duration };
    },
    finalExport: async ({ planHash, requestKey, signal }) => {
      state.calls.finalExport++; state.signals.export = signal;
      if (finalMode === 'pending') { state.pending = { planHash, requestKey }; return { status: 'pending', jobId: 'job-1' }; }
      if (finalMode === 'wrong-hash') { const receipt = await encodeFinal(planHash, requestKey); return { status: 'succeeded', receipt: { ...receipt, sha256: 'f'.repeat(64) } }; }
      if (finalMode === 'source-bytes') return { status: 'succeeded', receipt: { assetId: 'asset-final', versionId: 'v', sha256: binding.source.sha256, bytes: statSync(source).size, path: source, planHash, requestKey } };
      if (finalMode === 'throws') throw new Error('connection lost');
      return { status: 'succeeded', receipt: await encodeFinal(planHash, requestKey) };
    },
    exportStatus: async () => {
      state.calls.exportStatus++;
      if (!state.pending) return { status: 'pending', jobId: 'job-1' };
      return { status: 'succeeded', receipt: await encodeFinal(state.pending.planHash, state.pending.requestKey) };
    },
  };
  return { source, binding, host, state, grant: { scope: 'edit-local', authorityHash: binding.authorityHash } };
}
