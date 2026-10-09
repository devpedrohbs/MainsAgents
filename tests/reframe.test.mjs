import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  DEFAULT_FOCUS, detectFaceTrack, editedToSource, faceDetectorStatus, fixedReframe, manualReframe, normalizeReframe, reframeCropFilter, reframeRenderProps, smoothFaceSamples, sourceToEdited
} from '../editorial-reframe.mjs';
import {normalizeMotion, resolveMotionProps} from '../editorial-motion-plan.mjs';
import {resolveAnimations} from '../editorial-remotion.mjs';

const segments = [{start: 0, end: 4}, {start: 6, end: 10}];

test('tempo gravação <-> editado é inverso nos trechos mantidos e nulo nos cortados', () => {
  assert.equal(sourceToEdited(7, segments), 5);
  assert.equal(editedToSource(5, segments), 7);
  assert.equal(sourceToEdited(5, segments), null);
  for (const t of [0, 1.25, 3.9, 6.5, 9.5]) assert.equal(editedToSource(sourceToEdited(t, segments), segments), t);
});

test('reframe validado: modo/origem coerentes, pontos remapeados após cortes, "at" sempre recalculado', () => {
  const manual = manualReframe([{t: 7, x: 0.3, y: 0.4}, {t: 1, x: 0.6, y: 0.35}, {t: 5, x: 0.9, y: 0.9}]);
  assert.deepEqual(manual.points.map((p) => p.t), [1, 5, 7], 'ordenado');
  const normalized = normalizeReframe({...manual, points: manual.points.map((p) => ({...p, at: 999}))}, segments);
  assert.deepEqual(normalized.points, [{t: 1, x: 0.6, y: 0.35, at: 1}, {t: 7, x: 0.3, y: 0.4, at: 5}], 'ponto em trecho cortado sai; at recalculado');
  assert.deepEqual(normalizeReframe(fixedReframe(), segments), {mode: 'fixed', source: 'default', points: [{t: 0, x: DEFAULT_FOCUS.x, y: DEFAULT_FOCUS.y, at: 0}]});
  assert.throws(() => normalizeReframe({mode: 'manual', source: 'detected', points: [{t: 0, x: 0.5, y: 0.5}]}, segments), /does not match/);
  assert.throws(() => normalizeReframe({mode: 'face', source: 'detected', points: [{t: 0, x: 0.5, y: 0.5}]}, segments), /name its detector/, 'rastreio exige detector e cobertura medida');
  assert.throws(() => normalizeReframe({mode: 'manual', source: 'user', points: [{t: 0, x: 1.4, y: 0.5}]}, segments), /0\.\.1/);
  assert.throws(() => normalizeReframe({mode: 'manual', source: 'user', points: [{t: 0, x: 0.5, y: 0.5, w: 0.2}]}, segments), /both w and h/);
  // Dentro do plano de motion: entra só quando informado; vira frames na composição.
  const plan = normalizeMotion({version: 1, intensity: 'balanced', analysis: {}, cues: [], reframe: manual}, segments);
  assert.equal(plan.reframe.mode, 'manual');
  assert.deepEqual(reframeRenderProps(plan.reframe, {fps: 30, durationSeconds: 8}).points, [{frame: 30, x: 0.6, y: 0.35}, {frame: 150, x: 0.3, y: 0.4}]);
  const props = resolveMotionProps({...plan, cues: [{id: 'p', kind: 'punchIn', layout: 'camera-full', start: 1, end: 2, strength: 0.5, scale: 1.1}]}, {fps: 25, durationSeconds: 8});
  assert.deepEqual(props.reframe.points.map((p) => p.frame), [25, 125]);
});

test('detector facial: indisponível e rotulado; sem detector não há rastreamento', async () => {
  const status = faceDetectorStatus();
  assert.equal(status.available, false);
  assert.match(status.reason, /indisponível/);
  await assert.rejects(() => detectFaceTrack({inputPath: 'x.mp4', sourceWidth: 640, sourceHeight: 360}), /indisponível/);
});

test('suavização da trilha: zona morta ignora tremor, velocidade limitada, retenção sem detecção, cobertura medida', () => {
  const box = (cx, cy, size = 0.2) => ({x: cx - size / 2, y: cy - size / 2, w: size, h: size});
  const jitter = Array.from({length: 20}, (_, i) => ({t: i * 0.25, score: 0.9, box: box(0.5 + (i % 2 ? 0.02 : -0.02), 0.4)}));
  const still = smoothFaceSamples(jitter);
  assert.ok(still.reframe.points.every((p) => Math.abs(p.x - still.reframe.points[0].x) < 1e-9), 'tremor de ±2% não move a câmera');
  const jump = [{t: 0, score: 0.9, box: box(0.3, 0.4)}, ...Array.from({length: 8}, (_, i) => ({t: (i + 1) * 0.25, score: 0.9, box: box(0.8, 0.4)}))];
  const moved = smoothFaceSamples(jump, {maxSpeed: 0.35});
  for (let i = 1; i < moved.reframe.points.length; i++) {
    const a = moved.reframe.points[i - 1], b = moved.reframe.points[i];
    assert.ok(Math.abs(b.x - a.x) <= 0.35 * (b.t - a.t) + 1e-6, 'velocidade máxima respeitada');
  }
  assert.ok(Math.abs(moved.reframe.points.at(-1).x - (0.8 - 0.05)) < 0.02, 'chega perto do rosto (zona morta)');
  const lost = smoothFaceSamples([{t: 0, score: 0.9, box: box(0.6, 0.4)}, {t: 1, score: 0.2, box: box(0.1, 0.1)}, {t: 2, score: 0, box: null}, {t: 3, score: 0, box: null}]);
  assert.equal(lost.coverage, 0.25);
  assert.equal(lost.reframe.points.length, 1, 'sem detecção confiável mantém a última posição, sem inventar movimento');
  const none = smoothFaceSamples([{t: 0, score: 0, box: null}]);
  assert.equal(none.reframe.mode, 'fixed');
  assert.match(none.reason, /Nenhum rosto/);
  assert.equal(normalizeReframe(moved.reframe, [{start: 0, end: 10}]).detector.coverage, 1);
});

const ffmpegOk = spawnSync('ffmpeg', ['-version'], {encoding: 'utf8'}).status === 0;

// Mede a ARQUITETURA de trilha em quadros reais: um MARCADOR branco desenhado pelo FFmpeg e um "detector" que acha
// pixels claros. Isto NÃO é detecção facial; prova só amostragem -> detector injetado -> suavização -> pontos.
test('trilha medida em quadros reais com detector de MARCADOR sintético (não é detecção facial)', {skip: !ffmpegOk, timeout: 60000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reframe-')), file = join(dir, 'marker.mp4');
  try {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'color=c=white:s=80x100:r=25:d=4',
      '-filter_complex', "[0:v][1:v]overlay=x='40+120*t':y=120:shortest=1", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    assert.equal(made.status, 0, String(made.stderr));
    const marker = {name: 'marker-test', version: '1', detect({rgba, width, height}) {
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (rgba[i] > 200 && rgba[i + 1] > 200 && rgba[i + 2] > 200) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      return maxX < 0 ? [] : [{box: {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1}, score: 1}];
    }};
    const result = await detectFaceTrack({inputPath: file, sourceWidth: 640, sourceHeight: 360, detector: marker, fps: 4, width: 320, minScore: 0.5});
    assert.equal(result.samples, 16);
    assert.equal(result.coverage, 1);
    assert.equal(result.reframe.mode, 'face');
    // Centro real do marcador: x = (40 + 120 t + 40) / 640. A trilha suavizada fica a no máximo zona morta + atraso.
    for (const point of result.reframe.points) {
      const truth = (80 + 120 * point.t) / 640;
      assert.ok(Math.abs(point.x - truth) <= 0.05 + 0.02, `t=${point.t}: ${point.x} vs ${truth}`);
      assert.ok(Math.abs(point.y - 170 / 360) < 0.02);
      assert.ok(Math.abs(point.w - 80 / 640) < 0.02 && Math.abs(point.h - 100 / 360) < 0.03);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('foco manual sem cues: plano "off" só com reframe chega às props do render', () => {
  const plan = normalizeMotion({version: 1, intensity: 'off', analysis: {}, cues: [], reframe: manualReframe([{t: 0.5, x: 0.2, y: 0.3}, {t: 5.2, x: 0.8, y: 0.4}])}, [{start: 0, end: 8}]);
  const resolved = resolveAnimations({motion: plan}, {width: 1080, height: 1920, fps: 30, durationSeconds: 8, hasAudio: false});
  assert.deepEqual(resolved.motion.cues, []);
  assert.deepEqual(resolved.motion.reframe.points.map((p) => p.frame), [15, 156]);
});

const brightCenter = (rgba, width, height) => {
  let sx = 0, n = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (rgba[i] > 200 && rgba[i + 1] > 200 && rgba[i + 2] > 200) { sx += x; n++; } }
  return n ? sx / n / width : null;
};

// Conversão 16:9 -> 9:16 medida em quadros reais: o recorte segue a trilha (aqui, marcador sintético). Não é rosto real.
test('recorte 9:16 guiado pelo foco mantém o marcador no quadro (FFmpeg real, quadros medidos)', {skip: !ffmpegOk, timeout: 60000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reframe-crop-')), file = join(dir, 'marker.mp4');
  try {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x202020:s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'color=c=white:s=60x80:r=25:d=4',
      '-filter_complex', "[0:v][1:v]overlay=x='30+130*t':y=140:shortest=1", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
    assert.equal(made.status, 0, String(made.stderr));
    // Trilha da "câmera" = verdade do marcador a cada 0,5 s (como um foco manual bem marcado).
    const reframe = normalizeReframe(manualReframe(Array.from({length: 9}, (_, i) => ({t: i * 0.5, x: (60 + 130 * i * 0.5) / 640, y: 180 / 360}))), [{start: 0, end: 4}]);
    const {filter} = reframeCropFilter(reframe, {sourceWidth: 640, sourceHeight: 360, width: 202, height: 360});
    const center = reframeCropFilter(undefined, {sourceWidth: 640, sourceHeight: 360, width: 202, height: 360}).filter;
    const measure = (vf) => {
      const out = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${vf},fps=4`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], {maxBuffer: 64 * 1024 * 1024});
      assert.equal(out.status, 0, String(out.stderr));
      const size = 202 * 360 * 4, frames = [];
      for (let i = 0; i + size <= out.stdout.length; i += size) frames.push(brightCenter(out.stdout.subarray(i, i + size), 202, 360));
      return frames;
    };
    const guided = measure(filter), fixed = measure(center);
    assert.equal(guided.length, 16);
    // Visível em todos os quadros; centrado quando o recorte não encosta na borda do vídeo (no início/fim ele encosta).
    assert.ok(guided.every((x) => x !== null && x > 0.1 && x < 0.9), `marcador visível em todos os quadros: ${guided.map((x) => x?.toFixed(2))}`);
    assert.ok(guided.slice(1, -1).every((x) => Math.abs(x - 0.5) < 0.05), `centrado no meio: ${guided.map((x) => x?.toFixed(2))}`);
    assert.ok(fixed.filter((x) => x === null).length >= 6, 'recorte central perde o marcador na maior parte do tempo (controle)');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
