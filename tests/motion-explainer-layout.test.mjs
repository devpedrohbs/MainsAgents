import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avoidBand, cameraCrop, cameraRect, cameraState, cardBox, countUp, focusAt, focusVisibility, formatStat, layoutState, safeArea, textBand
} from '../remotion-video/layout.ts';
import {compositionMetadata} from '../remotion-video/metadata.ts';

const shapes = {portrait: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080]};
const band = {captionBand: {top: 0.64, bottom: 0.8}};
const overlaps = (box, rect) => box.left < rect.x + rect.w && box.right > rect.x && box.top < rect.y + rect.h && box.bottom > rect.y;
const cue = (id, startFrame, endFrame, layout = 'split', kind = 'explainer') => ({id, kind, layout, startFrame, endFrame, strength: 0.8});

test('9:16, 16:9 e 1:1: caixa do explicativo na área segura, fora da câmera e da faixa da legenda', () => {
  for (const [name, [w, h]] of Object.entries(shapes)) {
    const safe = safeArea(w, h);
    for (const layout of ['split', 'motion-focus']) {
      const box = cardBox(layout, w, h, band), camera = cameraRect(layout, w, h, band);
      assert.ok(box.left >= safe.left - 1e-6 && box.right <= safe.right + 1e-6 && box.top >= safe.top - 1e-6 && box.bottom <= safe.bottom + 1e-6, `${name} ${layout}: área segura`);
      assert.ok(!overlaps(box, camera), `${name} ${layout}: não cobre a câmera`);
      assert.ok(box.bottom <= 0.64 * h - 0.015 * h + 1e-6 || box.top >= 0.8 * h + 0.015 * h - 1e-6, `${name} ${layout}: fora da legenda`);
      assert.ok(box.right - box.left > w * 0.3 && box.bottom - box.top > h * 0.15, `${name} ${layout}: espaço legível (${box.right - box.left}x${box.bottom - box.top})`);
    }
    const free = textBand(w, h, band);
    assert.ok(free.bottom <= 0.64 * h && free.top >= safe.top, `${name}: texto cinético acima da legenda`);
  }
  assert.deepEqual(avoidBand({left: 0, right: 10, top: 0, bottom: 100}, 100), {left: 0, right: 10, top: 0, bottom: 100}, 'sem faixa: intacto');
  assert.deepEqual(cardBox('split', 1920, 1080), cardBox('split', 1920, 1080, undefined), 'compatível com chamadas antigas');
});

test('transições: entra da câmera cheia, troca DIRETO entre layouts encostados e volta suave; mesma fase a 25 e 30 fps', () => {
  for (const fps of [25, 30]) {
    for (const [name, [w, h]] of Object.entries(shapes)) {
      const s = (seconds) => Math.round(seconds * fps);
      const motion = {intensity: 'intense', sfx: [], cues: [cue('a', s(1), s(4), 'split'), cue('b', s(4), s(7), 'motion-focus', 'keyPoint'), cue('c', s(9), s(11), 'split')]};
      const states = Array.from({length: s(12)}, (_, frame) => layoutState(motion, frame, fps, w, h));
      const full = cameraRect('camera-full', w, h), area = (r) => r.w * r.h;
      // Entre a e b (encostados) nunca volta à câmera cheia; amount fica 1.
      for (let frame = s(1.5); frame < s(6); frame++) assert.equal(states[frame].amount, 1, `${name}@${fps}: sem piscar câmera cheia (${frame})`);
      assert.equal(states[s(4)].from, 'split', 'b entra a partir do split');
      assert.deepEqual(states[s(5.5)].rect, cameraRect('motion-focus', w, h));
      // Sem saltos: variação por frame limitada (x/y/w/h relativos ao quadro).
      for (let frame = 1; frame < states.length; frame++) {
        const a = states[frame - 1].rect, b = states[frame].rect;
        const jump = Math.max(Math.abs(a.x - b.x) / w, Math.abs(a.y - b.y) / h, Math.abs(a.w - b.w) / w, Math.abs(a.h - b.h) / h);
        assert.ok(jump < 0.2, `${name}@${fps} frame ${frame}: salto ${jump.toFixed(3)}`);
      }
      // Entre b e c há 2 s: volta à câmera cheia.
      assert.deepEqual(states[s(8)].rect, full);
      assert.ok(area(states[s(9) + 1].rect) < area(full));
    }
  }
  // Mesmo instante em segundos -> mesma fase da transição (tolerância de 1 frame de 25 fps).
  const at = (fps, seconds) => layoutState({intensity: 'balanced', sfx: [], cues: [cue('a', fps, fps * 4)]}, Math.round(seconds * fps), fps, 1920, 1080).rect.w;
  assert.ok(Math.abs(at(25, 1.2) - at(30, 1.2)) / 1920 < 0.08);
});

test('foco: interpola suave entre pontos e o rosto medido nunca é cortado (split, foco, punch-in) em 9:16/16:9/1:1', () => {
  const reframe = {mode: 'manual', source: 'user', points: [{frame: 0, x: 0.2, y: 0.3}, {frame: 30, x: 0.8, y: 0.5}]};
  const xs = Array.from({length: 31}, (_, f) => focusAt(reframe, f).x);
  assert.equal(xs[0], 0.2); assert.equal(xs[30], 0.8);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1], 'monotônico');
  assert.ok(xs[1] - xs[0] < xs[15] - xs[14], 'começa e termina devagar');
  assert.deepEqual(focusAt(undefined, 10), {frame: 10, x: 0.5, y: 0.38}, 'sem trilha: foco padrão');
  for (const [name, [w, h]] of Object.entries(shapes)) {
    for (const face of [{x: 0.12, y: 0.2, w: 0.14, h: 0.22}, {x: 0.88, y: 0.75, w: 0.14, h: 0.22}, {x: 0.5, y: 0.4, w: 0.3, h: 0.45}]) {
      // O rosto precisa caber na janela da câmera para que "não cortar" seja possível; com caixa grande demais o
      // recorte devolve a fração visível real (medida) em vez de prometer.
      for (const layout of ['camera-full', 'split', 'motion-focus']) {
        for (const zoom of [1, 1.16, 1.3]) {
          const rect = cameraRect(layout, w, h), crop = cameraCrop(rect, zoom, w, h, face);
          const fits = face.w * w * Math.max(rect.w / w, rect.h / h) <= rect.w * 0.84 + 1e-6 && face.h * h * Math.max(rect.w / w, rect.h / h) <= rect.h * 0.84 + 1e-6;
          if (fits) assert.equal(focusVisibility(rect, crop, face), 1, `${name} ${layout} zoom ${zoom} rosto ${JSON.stringify(face)}`);
          assert.ok(crop.zoom <= zoom && crop.zoom >= 1, 'zoom limitado pelo rosto, nunca abaixo do cover');
          assert.ok(crop.left <= 0 && crop.top <= 0 && crop.left + crop.vw >= rect.w - 1e-6 && crop.top + crop.vh >= rect.h - 1e-6, 'sem barras pretas');
        }
      }
    }
  }
  // Rosto grande: punch-in de 1,3 é reduzido para o rosto continuar inteiro.
  const big = {x: 0.5, y: 0.45, w: 0.75, h: 0.75}, rect = cameraRect('camera-full', 1920, 1080);
  const limited = cameraCrop(rect, 1.3, 1920, 1080, big);
  assert.ok(limited.zoom < 1.3 && limited.zoom > 1);
  assert.equal(focusVisibility(rect, limited, big), 1);
  const state = cameraState({intensity: 'balanced', sfx: [], cues: [], reframe}, 15, 30, 1920, 1080);
  assert.ok(Math.abs(state.focus.x - 0.5) < 1e-9, 'cameraState usa a trilha do plano');
});

test('números exibidos: valor final exato e unidade dita; prévia usa a mesma metadata do render', () => {
  assert.equal(formatStat(30, '%'), '30%');
  assert.equal(formatStat(2.5, 'x'), '2,5x');
  assert.equal(formatStat(50, 'R$'), 'R$ 50');
  assert.equal(formatStat(12, 'mil'), '12 mil');
  for (const fps of [25, 30]) {
    assert.equal(countUp(37.5, Math.round(0.7 * fps), fps), 37.5, 'chega exatamente ao valor dito');
    assert.equal(countUp(37.5, 0, fps), 0);
    for (let f = 1; f <= Math.round(0.7 * fps); f++) assert.ok(countUp(37.5, f, fps) >= countUp(37.5, f - 1, fps) && countUp(37.5, f, fps) <= 37.5, 'nunca passa do valor dito');
  }
  const props = {src: 'video.mp4', width: 1080, height: 1920, fps: 25, durationSeconds: 12.34, theme: 'dark', accent: '#2f6bff'};
  assert.deepEqual(compositionMetadata(props), {width: 1080, height: 1920, fps: 25, durationInFrames: 309});
});
