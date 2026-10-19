import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  cameraRect, contrastRatio, fitText, numbersIn, panelBox, qaFrames, resolveStoryboardProps, safeArea, segmentsHash, slotBox, storyboardFactProblems,
  storyboardJsonSchema, storyboardManifest, storyboardQa, textColorToken, validateStoryboard, TREATMENTS
} from '../editorial-storyboard.mjs';
import {needsAnimation, remotionAnimations, validatePlan} from '../editorial-smart-edit.mjs';
import {resolveAnimations} from '../editorial-remotion.mjs';

const segments = [{start: 0, end: 4}, {start: 5, end: 12}];
const hash = segmentsHash(segments);
const sha = 'a'.repeat(64);
const base = (scenes, extra = {}) => ({version: 1, timeline: {basis: 'output', segmentsHash: hash}, style: {treatment: 'creator'}, scenes, ...extra});
const textLayer = (id, extra = {}) => ({id, type: 'text', text: 'Corte os silêncios', role: 'title', slot: 'top', start: 0, end: 2, source: 'speech', ...extra});
const scene = (id, start, end, layers = [textLayer(`${id}-t`)], extra = {}) => ({id, start, end, layers, ...extra});

test('validação: forma expressiva aceita, campos/URLs/código rejeitados e tempos amarrados aos cortes', () => {
  const sb = validateStoryboard(base([scene('a', 0, 5, [textLayer('t', {mode: 'chars', keyframes: {scale: [{t: 0, v: 0.8}, {t: 0.4, v: 1, ease: {bezier: [0.16, 1, 0.3, 1]}}]}, mask: {kind: 'circle', seconds: 0.4}})], {camera: {layout: 'split-top', zoom: [{t: 0, v: 1}, {t: 2, v: 1.2, ease: 'snappy'}]}, transitionIn: {kind: 'iris', seconds: 0.4}})]), {outputDuration: 11, segments});
  assert.equal(sb.scenes[0].camera.layout, 'split-top');
  assert.equal(sb.scenes[0].layers[0].keyframes.scale[1].ease.bezier[0], 0.16);
  // Cortes mudaram => storyboard desatualizado (nunca desalinha calado).
  assert.throws(() => validateStoryboard(base([scene('a', 0, 5)]), {outputDuration: 11, segments: [{start: 0, end: 4}, {start: 5.5, end: 12}]}), /desatualizado/);
  assert.throws(() => validateStoryboard(base([scene('a', 0, 5)], {timeline: {basis: 'output'}}), {outputDuration: 11, segments}), /segmentsHash/);
  for (const bad of [
    textLayer('x', {text: 'veja https://example.com'}), textLayer('x', {text: '<script>alert(1)</script>'}), textLayer('x', {onClick: 'alert(1)'}),
    textLayer('x', {style: {color: 'red'}}), textLayer('x', {end: 9}), {id: 'img', type: 'image', assetId: '../etc/passwd', source: 'user'},
    {id: 'img', type: 'image', assetId: 'naoDeclarado', source: 'user'}, textLayer('x', {keyframes: {opacity: [{t: 1, v: 1}, {t: 0.5, v: 0}]}}), textLayer('x', {keyframes: {x: [{t: 0, v: 5}]}})
  ]) assert.throws(() => validateStoryboard(base([scene('a', 0, 5, [bad])]), {outputDuration: 11}), undefined, JSON.stringify(bad));
  assert.throws(() => validateStoryboard(base([scene('a', 0, 5), scene('b', 4, 8)]), {outputDuration: 11}), /sobreposição/);
  assert.throws(() => validateStoryboard(base([scene('a', 0, 5)], {sfx: [{kind: 'pop', at: 1}, {kind: 'pop', at: 1.5}]}), {outputDuration: 11}), /pelo menos/);
  assert.throws(() => validateStoryboard(base([scene('a', 0, 5)], {sfx: [{kind: 'pop', at: 1, gainDb: -3}]}), {outputDuration: 11}), /número entre/);
  // Normalizado é idempotente (o adaptador revalida o que o plano já validou).
  assert.deepEqual(validateStoryboard(sb, {outputDuration: 11, segments}), sb);
});

test('plano: storyboard substitui os 3 overlays fixos, exige hash dos cortes e chega igual ao adaptador Remotion', () => {
  const storyboard = base([scene('a', 0, 5), scene('b', 5, 11, [{id: 'c', type: 'counter', value: 90, unit: '%', slot: 'panel', start: 0.2, end: 3, source: 'speech'}], {camera: {layout: 'split-top'}})], {sfx: [{kind: 'whoosh', at: 5, gainDb: -22}]});
  const {plan} = validatePlan({segments, format: 'portrait', storyboard}, 12);
  assert.ok(needsAnimation(plan));
  assert.throws(() => validatePlan({segments, storyboard, animations: [{id: 't', kind: 'title', text: 'Oi', start: 0, duration: 1}]}, 12), /replaces/);
  const spec = remotionAnimations(plan);
  assert.ok(spec.protect.captionBand && spec.storyboard);
  const props = resolveAnimations(spec, {width: 1080, height: 1920, fps: 30, durationSeconds: 11, hasAudio: true});
  assert.equal(props.storyboard.scenes.length, 2);
  assert.deepEqual(props.motion.sfx, [{kind: 'whoosh', at: 5, gainDb: -22}], 'SFX do storyboard vão pelo mix local existente');
  assert.equal(props.storyboard.scenes[1].cameraFrom, 'full');
  // Asset sem arquivo autorizado é recusado no adaptador.
  const withImage = base([scene('a', 0, 5, [{id: 'i', type: 'image', assetId: 'print', slot: 'panel', start: 0, end: 3, source: 'design'}], {camera: {layout: 'hidden'}})], {assets: [{id: 'print', kind: 'image', sha256: sha}]});
  assert.throws(() => resolveAnimations({storyboard: withImage}, {width: 1080, height: 1920, fps: 30, durationSeconds: 11, hasAudio: true}, {assetIds: []}), /asset sem arquivo/);
});

test('fatos: números só da fala/briefing, citação literal, "user" só com texto do host e "design" sem números', () => {
  assert.deepEqual(numbersIn('mil reais viram R$ 1.127; noventa por cento; mil cento e vinte e sete. 1,5x').sort((a, b) => a - b), [1.5, 90, 1000, 1127]);
  const sb = validateStoryboard(base([scene('a', 0, 10, [
    textLayer('fala', {text: 'Economize 90% do tempo', quote: 'economiza 90% do tempo'}),
    {id: 'num', type: 'counter', value: 1127, unit: 'R$', slot: 'bottom', start: 2.5, end: 5, source: 'brief'},
    {id: 'rot', type: 'chapter', index: 3, text: 'O método', slot: 'top-left', start: 5, end: 7, source: 'design'},
    textLayer('usr', {text: 'Planilha do usuário', source: 'user', start: 7, end: 9})
  ])]), {outputDuration: 11});
  const sources = {transcriptText: 'você economiza 90% do tempo de revisão', briefText: 'mil reais viram mil cento e vinte e sete', userTexts: ['Planilha do usuário']};
  assert.deepEqual(storyboardFactProblems(sb, sources), []);
  assert.ok(storyboardFactProblems(sb, {...sources, briefText: 'mil reais viram mil cento e vinte'}).some((item) => /1127/.test(item.reason)));
  assert.ok(storyboardFactProblems(sb, {...sources, transcriptText: 'você economiza 80% do tempo'}).some((item) => item.id === 'a/fala'));
  assert.ok(storyboardFactProblems(sb, {...sources, userTexts: []}).some((item) => item.id === 'a/usr'), 'modelo não se declara usuário');
  const design = validateStoryboard(base([scene('a', 0, 5, [textLayer('d', {text: 'Ganhe 3x mais', source: 'design'})])]), {outputDuration: 11});
  assert.ok(storyboardFactProblems(design, sources).length);
});

test('geometria: área segura, faixa da legenda, pip no alto e painel complementar em 9:16 e 16:9', () => {
  const band = {captionBand: {top: 0.66, bottom: 0.9}};
  for (const [w, h] of [[1080, 1920], [1920, 1080]]) {
    const safe = safeArea(w, h);
    for (const layout of ['full', 'split-left', 'split-right', 'split-top', 'pip', 'hidden']) {
      const cam = cameraRect(layout, w, h, band), panel = panelBox(layout, w, h, band);
      assert.ok(cam.x >= 0 && cam.y >= 0 && cam.x + cam.w <= w + 1e-6 && cam.y + cam.h <= h + 1e-6, `${w}x${h} ${layout}`);
      assert.ok(panel.top >= safe.top - 1e-6 && panel.bottom <= band.captionBand.top * h, `${w}x${h} ${layout} painel acima da legenda`);
      if (layout === 'pip') assert.ok(cam.y + cam.h < band.captionBand.top * h, 'pip nunca sob a legenda');
      for (const slot of ['top', 'center', 'bottom', 'panel', 'panel-top', 'panel-bottom']) {
        const box = slotBox({slot}, layout, w, h, band);
        assert.ok(box.bottom <= band.captionBand.top * h + 1e-6 && box.top >= safe.top - 1e-6 && box.right > box.left, `${slot}`);
      }
    }
  }
  const fit = fitText('Uma frase bem longa que precisa encolher para caber na caixa estreita', 'headline', 'xl', {left: 0, right: 300, top: 0, bottom: 200}, 1080, 1920, 'creator');
  assert.ok(fit.size < 1080 / 100 * 9.2 * 1.45 && fit.lines.length >= 2);
});

test('QA: reprova sobreposição, contraste baixo, texto sobre o rosto e partes descartadas; regra de cor igual ao render', () => {
  const opts = {width: 1080, height: 1920, fps: 30};
  const ok = resolveStoryboardProps(base([scene('a', 0, 5, [textLayer('t', {slot: 'bottom', style: {background: 'scrim'}})])]), {fps: 30, durationSeconds: 11, protect: {captionBand: {top: 0.66, bottom: 0.9}}});
  assert.equal(storyboardQa(ok, opts).ok, true);
  const overlap = resolveStoryboardProps(base([scene('a', 0, 5, [textLayer('t1', {slot: 'center'}), textLayer('t2', {slot: 'center'})])]), {fps: 30, durationSeconds: 11});
  assert.ok(storyboardQa(overlap, opts).errors.some((item) => item.code === 'textOverlap'));
  const low = resolveStoryboardProps(base([scene('a', 0, 5, [textLayer('t', {style: {background: 'accent', color: 'text'}})], {camera: {layout: 'hidden'}})]), {fps: 30, durationSeconds: 11});
  assert.ok(storyboardQa(low, opts).errors.some((item) => item.code === 'lowContrast'), 'branco sobre amarelo');
  assert.equal(textColorToken({style: {background: 'accent'}}), 'ink');
  assert.ok(contrastRatio(TREATMENTS.creator.palette.ink, TREATMENTS.creator.palette.accent) > 7);
  const face = resolveStoryboardProps(base([scene('a', 0, 5, [textLayer('t', {slot: undefined, box: {x: 0.3, y: 0.3, w: 0.4, h: 0.15}})])]), {fps: 30, durationSeconds: 11});
  assert.ok(storyboardQa(face, opts).warnings.some((item) => item.code === 'coversFocus'));
  const band = resolveStoryboardProps(base([scene('a', 0, 5, [textLayer('t', {slot: undefined, box: {x: 0.1, y: 0.7, w: 0.8, h: 0.08}})])]), {fps: 30, durationSeconds: 11, protect: {captionBand: {top: 0.66, bottom: 0.9}}});
  assert.ok(storyboardQa(band, opts).errors.some((item) => item.code === 'captionBandOverlap'));
  const dropped = {...ok, dropped: [{id: 'a/x', reason: 'teste'}]};
  assert.ok(storyboardQa(dropped, opts).errors.some((item) => item.code === 'droppedLayer'), 'parte pedida não aplicada reprova');
  const cut = storyboardQa(resolveStoryboardProps(base([scene('a', 0, 5), scene('b', 5, 10, undefined, {transitionIn: {kind: 'fade', seconds: 0.8}})]), {fps: 30, durationSeconds: 11}), {...opts, cutsAt: [5.3]});
  assert.ok(cut.warnings.some((item) => item.code === 'transitionAcrossCut'));
});

test('stills de QA cobrem entrada/meio/saída de TODAS as cenas; manifesto lista efeitos aplicados e fontes', () => {
  const props = resolveStoryboardProps(base([scene('a', 0, 5), scene('b', 5, 11, [textLayer('k', {mode: 'typewriter', enter: 'typewriter', mask: {kind: 'wipeLeft'}, keyframes: {y: [{t: 0, v: 0.02}, {t: 0.3, v: 0}]}})])]), {fps: 30, durationSeconds: 11});
  const frames = qaFrames(props);
  assert.deepEqual([...new Set(frames.map((item) => item.sceneId))], ['a', 'b']);
  assert.ok(frames.every((item) => item.frame >= 0 && item.frame < 330));
  const manifest = storyboardManifest(props, {fps: 30, qa: storyboardQa(props, {width: 1080, height: 1920, fps: 30})});
  const layer = manifest.scenes[1].layers[0];
  assert.ok(layer.effects.includes('mask:wipeLeft') && layer.effects.includes('kinetic:typewriter') && layer.effects.some((item) => item.startsWith('keyframes:y')));
  assert.equal(layer.source, 'speech');
  assert.equal(manifest.counts.scenes, 2);
});

test('JSON Schema draft-07 descreve o storyboard e as demos autoradas validam', () => {
  const schema = storyboardJsonSchema();
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.properties.scenes.items.properties.layers.items.oneOf.length, 13);
  for (const name of ['edicao-creator-9x16', 'juros-editorial-16x9', 'juros-technical-9x16']) {
    const demo = JSON.parse(readFileSync(new URL(`../docs/analysis/editing-ai-motion-engine-2026-10-12/storyboards/${name}.json`, import.meta.url), 'utf8'));
    const sb = validateStoryboard(demo.storyboard, {outputDuration: 26});
    assert.ok(sb.scenes.length >= 5, name);
  }
});
