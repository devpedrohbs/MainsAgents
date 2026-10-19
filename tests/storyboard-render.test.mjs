import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RemotionError, probeVideo, renderAnimatedVideo, renderStoryboardStills, resolveBrowser, resolveRemotionBundle} from '../editorial-remotion.mjs';
import {hasFfmpeg, makeSyntheticVideo, run} from '../scripts/test-remotion-video.mjs';

const ready = resolveRemotionBundle().ready && resolveBrowser().status === 'ready';
const metadata = {width: 320, height: 180, fps: 15, durationSeconds: 6, hasAudio: true};

const storyboard = (assetSha) => ({version: 1, timeline: {basis: 'output'}, style: {treatment: 'technical'}, assets: [{id: 'print', kind: 'image', sha256: assetSha, role: 'screenshot'}], scenes: [
  {id: 'a', start: 0, end: 3, camera: {layout: 'split-left', zoom: [{t: 0, v: 1}, {t: 2, v: 1.2}]}, background: {kind: 'grid'}, layers: [
    {id: 'p', type: 'process', nodes: ['Corta', 'Revisa', 'Publica'], slot: 'panel', start: 0.1, end: 2.9, source: 'design'}]},
  {id: 'b', start: 3, end: 6, camera: {layout: 'hidden'}, transitionIn: {kind: 'iris', seconds: 0.4}, layers: [
    {id: 'img', type: 'image', assetId: 'print', frame: 'browser', slot: 'panel', start: 0, end: 3, source: 'design'}]}
], sfx: [{kind: 'whoosh', at: 3, gainDb: -22}]});

test('render REAL: stills da mesma composição, trecho de teste com áudio da janela, hash do asset e QA bloqueante', {skip: !ready && 'bundle/navegador ausente'}, async (t) => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg ausente');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'storyboard-render-'));
  try {
    const input = path.join(dir, 'cut.mp4'), png = path.join(dir, 'print.png');
    await makeSyntheticVideo(input);
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2e7d32:s=240x140', '-frames:v', '1', png]);
    const sha = createHash('sha256').update(await readFile(png)).digest('hex');
    const animations = {storyboard: storyboard(sha)};
    const assetFiles = {print: {path: png, sha256: sha}};
    const stills = await renderStoryboardStills({inputPath: input, outDir: path.join(dir, 'stills'), metadata, animations, assetFiles, scale: 1, tags: {revision: 3, planHash: 'abc'}});
    assert.equal(new Set(stills.stills.map((item) => item.sceneId)).size, 2, 'todas as cenas');
    assert.ok(stills.contactSheets.length === 1 && existsSync(stills.contactSheet));
    assert.equal(stills.stills[0].tags.revision, 3);
    assert.equal(stills.storyboard.manifest.source.sha256, createHash('sha256').update(await readFile(input)).digest('hex'));
    assert.match(stills.storyboard.manifest.compositionSha256, /^[a-f0-9]{64}$/);
    // Cena "hidden" com print: o frame tem o verde do asset (o print foi realmente renderizado).
    const raw = await run('ffmpeg', ['-v', 'error', '-i', stills.stills.find((item) => item.sceneId === 'b' && item.moment === 'meio').path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {binary: true});
    let green = 0; for (let i = 0; i < raw.length; i += 3) if (raw[i + 1] > 100 && raw[i] < 80 && raw[i + 2] < 80) green++;
    assert.ok(green > 500, `pixels do asset: ${green}`);
    // Trecho de teste: só os frames pedidos, com o áudio da mesma janela e SFX mixado.
    const excerpt = await renderAnimatedVideo({inputPath: input, outputPath: path.join(dir, 'excerpt.mp4'), metadata, animations, assetFiles, frameRange: [30, 59]});
    assert.ok(Math.abs(excerpt.durationSeconds - 2) < 0.2 && excerpt.hasAudio && excerpt.audio.mode === 'mixed-sfx');
    assert.deepEqual(excerpt.excerpt.frameRange, [30, 59]);
    assert.ok(excerpt.storyboard.qa.ok && excerpt.storyboard.manifest.counts.transitions === 1);
    const probe = await probeVideo(path.join(dir, 'excerpt.mp4'));
    assert.equal(probe.width, 320);
    // Asset trocado depois do registro: hash não confere, nada é renderizado.
    await assert.rejects(renderStoryboardStills({inputPath: input, outDir: path.join(dir, 'x'), metadata, animations, assetFiles: {print: {path: png, sha256: 'b'.repeat(64)}}}), (error) => error instanceof RemotionError && error.code === 'asset_hash_mismatch');
    // QA reprovada bloqueia o export (texto sobreposto), com o relatório nos detalhes.
    const bad = {storyboard: {...storyboard(sha), scenes: [{id: 'a', start: 0, end: 6, layers: [
      {id: 't1', type: 'text', text: 'Primeiro texto', slot: 'center', start: 0, end: 5, source: 'design'}, {id: 't2', type: 'text', text: 'Segundo texto', slot: 'center', start: 0, end: 5, source: 'design'}]}]}};
    await assert.rejects(renderAnimatedVideo({inputPath: input, outputPath: path.join(dir, 'bad.mp4'), metadata, animations: bad, assetFiles}), (error) => error.code === 'qa_failed' && error.details.qa.errors.some((item) => item.code === 'textOverlap'));
    assert.equal(existsSync(path.join(dir, 'bad.mp4')), false);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
