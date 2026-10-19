import test from 'node:test';
import assert from 'node:assert/strict';
import {easingFn, keyframeValue, layerEnvelope, sceneTransition, storyboardCamera} from '../remotion-video/storyboard-anim.ts';
import {resolveStoryboardProps, segmentsHash} from '../editorial-storyboard.mjs';

const defaults = {enter: 'pop', exit: 'fade', ease: 'inOut'};
const size = {width: 1080, height: 1920, unit: 10.8};

test('keyframes: valores nos keyframes exatos, easing por trecho e clamp nas bordas', () => {
  const list = [{t: 0, f: 0, v: 1}, {t: 1, f: 30, v: 1.2, ease: 'linear'}, {t: 2, f: 60, v: 1.2}];
  assert.equal(keyframeValue(list, -5, 0), 1);
  assert.equal(keyframeValue(list, 0, 0), 1);
  assert.equal(keyframeValue(list, 30, 0), 1.2);
  assert.ok(Math.abs(keyframeValue(list, 15, 0, 'linear') - 1.1) < 1e-9);
  assert.equal(keyframeValue(list, 999, 0), 1.2);
  assert.equal(keyframeValue(undefined, 10, 0.5), 0.5);
  const bez = easingFn({bezier: [0.16, 1, 0.3, 1]});
  assert.equal(bez(0), 0);
  assert.ok(Math.abs(bez(1) - 1) < 1e-9);
});

test('envelope por frame é determinístico, entra, sustenta e sai; máscara vira clip-path (nunca mask-image)', () => {
  const layer = {id: 't', type: 'text', fromFrame: 0, toFrame: 60, enter: {preset: 'rise', frames: 10}, exit: {preset: 'fade', frames: 10}, mask: {kind: 'circle', frames: 12}, keyframes: {rotate: [{t: 0, f: 0, v: -4}, {t: 0.5, f: 15, v: 0}]}};
  const a = layerEnvelope(layer, 5, defaults, size), b = layerEnvelope(layer, 5, defaults, size);
  assert.deepEqual(a, b);
  assert.ok(a.dy > 0 && a.opacity < 1 && /^circle\(/.test(a.clipPath));
  const mid = layerEnvelope(layer, 30, defaults, size);
  assert.equal(mid.opacity, 1);
  assert.equal(mid.dy, 0);
  assert.equal(mid.rotate, 0);
  assert.equal(mid.clipPath, undefined);
  assert.ok(layerEnvelope(layer, 59, defaults, size).opacity < 0.2);
  for (let f = 0; f < 60; f++) { const e = layerEnvelope(layer, f, defaults, size); assert.ok(Number.isFinite(e.opacity) && e.opacity >= 0 && e.opacity <= 1); }
});

test('transições de cena terminam exatamente no fim da transição', () => {
  for (const kind of ['fade', 'slide', 'push', 'wipe', 'iris', 'zoom']) {
    const scene = {transitionIn: {kind, frames: 12, direction: 'left', seconds: 0.4}};
    const start = sceneTransition(scene, 0, {width: 1080, height: 1920}), end = sceneTransition(scene, 12, {width: 1080, height: 1920});
    assert.notDeepEqual(start, end, kind);
    assert.deepEqual(end, {opacity: 1, dx: 0, dy: 0, scale: 1, clipPath: undefined}, kind);
  }
});

test('câmera: entra no layout da cena, passa direto entre cenas coladas, volta à tela cheia e esconde em "hidden"', () => {
  const segments = [{start: 0, end: 12}];
  const sb = {version: 1, timeline: {basis: 'output', segmentsHash: segmentsHash(segments)}, style: {treatment: 'technical'}, scenes: [
    {id: 'a', start: 1, end: 4, camera: {layout: 'split-top', zoom: [{t: 0, v: 1}, {t: 2, v: 1.2}]}, layers: []},
    {id: 'b', start: 4, end: 7, camera: {layout: 'pip'}, layers: []},
    {id: 'c', start: 8, end: 11, camera: {layout: 'hidden'}, layers: []}
  ]};
  const props = resolveStoryboardProps(sb, {fps: 30, durationSeconds: 12});
  const at = (f) => storyboardCamera(props.scenes, f, 30, 1080, 1920);
  assert.deepEqual(at(0).rect, {x: 0, y: 0, w: 1080, h: 1920});
  assert.ok(at(45).rect.h < 1920 && Math.abs(at(105).zoom - 1.2) < 1e-6);
  assert.equal(props.scenes[1].cameraFrom, 'split-top', 'cena colada parte do layout anterior');
  assert.ok(at(120).plate === 1, 'placa não pisca entre cenas coladas');
  assert.deepEqual(at(209.9 | 0).rect.w < 1080, true);
  assert.ok(at(300).opacity < 0.05, 'hidden esconde a câmera');
  assert.deepEqual(at(340).rect, {x: 0, y: 0, w: 1080, h: 1920});
});
