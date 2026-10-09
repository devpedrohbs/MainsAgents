import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraRect, cameraState, cardBox, layoutAmount, punchAmount, safeArea, shapeOf} from '../remotion-video/layout.ts';

const shapes = {portrait: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080]};
const inside = (box, safe) => box.left >= safe.left - 1e-6 && box.right <= safe.right + 1e-6 && box.top >= safe.top - 1e-6 && box.bottom <= safe.bottom + 1e-6;
const overlaps = (box, rect) => box.left < rect.x + rect.w && box.right > rect.x && box.top < rect.y + rect.h && box.bottom > rect.y;

test('proporções: 9:16, 16:9 e 1:1 têm área segura e geometria própria', () => {
  assert.equal(shapeOf(...shapes.portrait), 'portrait');
  assert.equal(shapeOf(...shapes.landscape), 'landscape');
  assert.equal(shapeOf(...shapes.square), 'square');
  // Vertical reserva 20% da base para a interface das redes.
  assert.equal(safeArea(...shapes.portrait).bottom, 1920 * 0.8);
  for (const [name, [w, h]] of Object.entries(shapes)) {
    const safe = safeArea(w, h);
    for (const layout of ['split', 'motion-focus']) {
      const box = cardBox(layout, w, h), camera = cameraRect(layout, w, h);
      assert.ok(inside(box, safe), `${name} ${layout} texto na área segura`);
      assert.ok(box.right - box.left > w * 0.3 && box.bottom - box.top > h * 0.2, `${name} ${layout} espaço legível`);
      assert.ok(!overlaps(box, camera), `${name} ${layout} texto não cobre a câmera`);
      assert.ok(camera.x >= 0 && camera.y >= 0 && camera.x + camera.w <= w + 1e-6 && camera.y + camera.h <= h + 1e-6);
    }
    const pip = cameraRect('motion-focus', w, h);
    assert.ok(Math.abs(pip.w / pip.h - w / h) < 1e-6, `${name} janela da câmera mantém a proporção`);
  }
  assert.deepEqual(cameraRect('split', 1920, 1080), {x: 0, y: 0, w: 960, h: 1080});
  assert.deepEqual(cameraRect('split', 1080, 1920), {x: 0, y: 0, w: 1080, h: 960});
});

const cue = (kind, startFrame, endFrame, extra = {}) => ({id: kind, kind, layout: kind === 'keyPoint' ? 'split' : 'camera-full', startFrame, endFrame, strength: 0.8, ...extra});

test('cartão entra e volta à câmera suavemente; punch-in ataca rápido e solta; tudo determinístico por frame', () => {
  const fps = 30, key = cue('keyPoint', 30, 150);
  const values = Array.from({length: 160}, (_, frame) => layoutAmount(key, frame, fps));
  assert.equal(values[29], 0);
  assert.equal(values[30], 0);
  assert.equal(values[150], 0);
  assert.equal(values[90], 1);
  for (let frame = 31; frame < 30 + Math.round(0.4 * fps); frame++) assert.ok(values[frame] >= values[frame - 1]);
  for (let frame = 151 - Math.round(0.5 * fps); frame < 150; frame++) assert.ok(values[frame] <= values[frame - 1] + 1e-9, 'retorno monotônico');
  assert.ok(Math.max(...values.slice(30, 150).map((value, i, list) => i ? Math.abs(value - list[i - 1]) : 0)) < 0.25, 'sem saltos bruscos');
  const punch = cue('punchIn', 60, 90, {scale: 1.12});
  assert.equal(punchAmount(punch, 60 + Math.round(0.12 * fps), fps), 1);
  assert.equal(punchAmount(punch, 59, fps), 0);
  const state = cameraState({intensity: 'balanced', cues: [punch], sfx: []}, 70, fps, 1920, 1080);
  assert.ok(Math.abs(state.zoom - 1.12) < 1e-9);
  assert.deepEqual(cameraState({intensity: 'balanced', cues: [punch], sfx: []}, 70, fps, 1920, 1080), state);
  const mid = cameraState({intensity: 'balanced', cues: [key], sfx: []}, 90, fps, 1920, 1080);
  assert.deepEqual(mid.rect, {x: 0, y: 0, w: 960, h: 1080});
  assert.equal(mid.layout, 'split');
  // Mesmo tempo em segundos -> mesma fase da animação em 24 e 60 fps.
  const at24 = layoutAmount(cue('keyPoint', 24, 120), 24 + 6, 24), at60 = layoutAmount(cue('keyPoint', 60, 300), 60 + 15, 60);
  assert.ok(Math.abs(at24 - at60) < 0.08);
});
