// Matemática por frame do storyboard autorado (sem JSX): keyframes com easing, envelopes de entrada/saída, máscaras
// (clip-path, nunca mask-image), transições de cena e câmera entre layouts. Mesmas funções na prévia (Player) e no
// render; testadas em Node (tests/storyboard-anim.test.mjs). Nada usa tempo de relógio, CSS animation ou aleatoriedade.
import {Easing, interpolate} from 'remotion';
import {cameraRect} from '../editorial-storyboard.mjs';
import type {CameraLayout, EasingSpec, KeyframeAt, ProtectBand, ResolvedLayer, ResolvedScene} from '../editorial-storyboard.mjs';

export const clampOpts = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export type Rect = {x: number; y: number; w: number; h: number};

/** Curvas nomeadas → funções do Remotion. 'snappy' tem leve overshoot (pop de criador); 'spring' não quica. */
export const easingFn = (spec: EasingSpec | undefined, fallback: EasingSpec = 'inOut'): ((t: number) => number) => {
  const value = spec ?? fallback;
  if (typeof value === 'object') return Easing.bezier(value.bezier[0], value.bezier[1], value.bezier[2], value.bezier[3]);
  switch (value) {
    case 'linear': return Easing.linear;
    case 'in': return Easing.bezier(0.55, 0, 1, 0.45);
    case 'out': return Easing.bezier(0.16, 1, 0.3, 1);
    case 'spring': return Easing.spring({damping: 200});
    case 'snappy': return Easing.spring({damping: 11, stiffness: 170, mass: 0.6});
    default: return Easing.bezier(0.65, 0, 0.35, 1);
  }
};

/** Valor de uma trilha de keyframes no frame local; easing do keyframe i vale para o trecho i→i+1. */
export const keyframeValue = (list: KeyframeAt[] | undefined, frame: number, fallback: number, ease: EasingSpec = 'inOut') => {
  if (!list || !list.length) return fallback;
  if (frame <= list[0].f) return list[0].v;
  const last = list[list.length - 1];
  if (frame >= last.f) return last.v;
  let i = 1;
  while (list[i].f < frame) i++;
  const a = list[i - 1], b = list[i];
  if (b.f === a.f) return b.v;
  return interpolate(frame, [a.f, b.f], [a.v, b.v], {...clampOpts, easing: easingFn(a.ease, ease)});
};

export type Envelope = {opacity: number; dx: number; dy: number; scale: number; rotate: number; blur: number; clipPath?: string; progress: number; exit: number};

const insetFor = (kind: string, m: number) => {
  const p = `${((1 - m) * 100).toFixed(3)}%`;
  switch (kind) {
    case 'wipeRight': return `inset(0 0 0 ${p})`;
    case 'wipeUp': return `inset(${p} 0 0 0)`;
    case 'wipeDown': return `inset(0 0 ${p} 0)`;
    case 'circle': return `circle(${(m * 75).toFixed(3)}% at 50% 50%)`;
    case 'diagonal': { const a = m * 200; return `polygon(0 0, ${a.toFixed(3)}% 0, ${(a - 100).toFixed(3)}% 100%, 0 100%)`; }
    default: return `inset(0 ${p} 0 0)`;
  }
};

/**
 * Envelope de uma camada no frame LOCAL (0 = início da camada): entrada, saída, keyframes e máscara de revelação.
 * `unit` = 1% do menor lado; deslocamentos de keyframe x/y são frações do quadro.
 */
export const layerEnvelope = (layer: ResolvedLayer, frame: number, defaults: {enter: string; exit: string; ease: EasingSpec}, size: {width: number; height: number; unit: number}): Envelope => {
  const length = layer.toFrame - layer.fromFrame, unit = size.unit;
  const enterPreset = layer.enter?.preset ?? defaults.enter, exitPreset = layer.exit?.preset ?? defaults.exit;
  const enterFrames = Math.min(layer.enter?.frames ?? Math.max(1, Math.round(length * 0.18)), Math.max(1, Math.floor(length / 2)));
  const exitFrames = Math.min(layer.exit?.frames ?? Math.max(1, Math.round(length * 0.12)), Math.max(1, Math.floor(length / 3)));
  const p = enterPreset === 'none' ? 1 : interpolate(frame, [0, enterFrames], [0, 1], {...clampOpts, easing: easingFn(layer.enter?.ease, enterPreset === 'pop' ? 'snappy' : defaults.ease)});
  const q = exitPreset === 'none' ? 0 : interpolate(frame, [length - exitFrames, length], [0, 1], {...clampOpts, easing: easingFn(layer.exit?.ease, 'inOut')});
  const e: Envelope = {opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, progress: p, exit: q};
  switch (enterPreset) {
    case 'fade': e.opacity = p; break;
    case 'rise': e.opacity = Math.min(1, p * 1.6); e.dy = (1 - p) * unit * 6; break;
    case 'drop': e.opacity = Math.min(1, p * 1.6); e.dy = -(1 - p) * unit * 6; break;
    case 'slideLeft': e.opacity = Math.min(1, p * 2); e.dx = (1 - p) * unit * 14; break;
    case 'slideRight': e.opacity = Math.min(1, p * 2); e.dx = -(1 - p) * unit * 14; break;
    case 'pop': e.opacity = Math.min(1, p * 3); e.scale = 0.55 + 0.45 * p; break;
    case 'wipe': if (p < 1) e.clipPath = insetFor('wipeLeft', p); break;
    case 'blur': e.opacity = p; e.blur = (1 - p) * unit * 1.2; break;
    default: break; // none, typewriter e draw: a primitiva usa `progress`
  }
  switch (exitPreset) {
    case 'fade': e.opacity *= 1 - q; break;
    case 'sink': e.opacity *= 1 - q; e.dy += q * unit * 4; break;
    case 'slideLeft': e.opacity *= 1 - q; e.dx -= q * unit * 14; break;
    case 'slideRight': e.opacity *= 1 - q; e.dx += q * unit * 14; break;
    case 'shrink': e.opacity *= 1 - q; e.scale *= 1 - 0.3 * q; break;
    case 'wipe': if (q > 0) e.clipPath = `inset(0 0 0 ${(q * 100).toFixed(3)}%)`; break;
    default: break;
  }
  const k = layer.keyframes;
  if (k) {
    e.opacity *= keyframeValue(k.opacity, frame, 1, defaults.ease);
    e.dx += keyframeValue(k.x, frame, 0, defaults.ease) * size.width;
    e.dy += keyframeValue(k.y, frame, 0, defaults.ease) * size.height;
    e.scale *= keyframeValue(k.scale, frame, 1, defaults.ease);
    e.rotate += keyframeValue(k.rotate, frame, 0, defaults.ease);
  }
  if (layer.mask) {
    const m = interpolate(frame, [0, layer.mask.frames], [0, 1], {...clampOpts, easing: easingFn(layer.mask.ease, 'out')});
    if (m < 1 && !(exitPreset === 'wipe' && q > 0)) e.clipPath = insetFor(layer.mask.kind, m);
  }
  return e;
};

/** Transição de ENTRADA da cena (placa de gráficos), no frame local da cena. */
export const sceneTransition = (scene: ResolvedScene, frame: number, size: {width: number; height: number}) => {
  const tr = scene.transitionIn;
  const none = {opacity: 1, dx: 0, dy: 0, scale: 1, clipPath: undefined as string | undefined};
  if (!tr || tr.kind === 'cut' || tr.frames <= 0 || frame >= tr.frames) return none;
  const p = interpolate(frame, [0, tr.frames], [0, 1], {...clampOpts, easing: easingFn(tr.ease, tr.kind === 'push' ? 'snappy' : 'inOut')});
  const sign = tr.direction === 'left' || tr.direction === 'up' ? 1 : -1, horizontal = tr.direction === 'left' || tr.direction === 'right';
  switch (tr.kind) {
    case 'fade': return {...none, opacity: p};
    case 'slide': return {...none, opacity: Math.min(1, p * 2), dx: horizontal ? sign * (1 - p) * size.width * 0.35 : 0, dy: horizontal ? 0 : sign * (1 - p) * size.height * 0.35};
    case 'push': return {...none, dx: horizontal ? sign * (1 - p) * size.width : 0, dy: horizontal ? 0 : sign * (1 - p) * size.height};
    case 'wipe': return {...none, clipPath: insetFor(tr.direction === 'left' ? 'wipeRight' : tr.direction === 'right' ? 'wipeLeft' : tr.direction === 'up' ? 'wipeUp' : 'wipeDown', p)};
    case 'iris': return {...none, clipPath: insetFor('circle', p)};
    case 'zoom': return {...none, opacity: p, scale: 1.18 - 0.18 * p};
    default: return none;
  }
};

const mix = (a: Rect, b: Rect, t: number): Rect => (t <= 0 ? a : t >= 1 ? b : {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t});

/**
 * Câmera no frame GLOBAL: layout da cena ativa (entrando a partir do layout anterior colado ou da câmera cheia, e
 * voltando à cheia no fim se a próxima cena não continuar), zoom por keyframes e opacidade (layout 'hidden').
 */
export const storyboardCamera = (scenes: ResolvedScene[], frame: number, fps: number, width: number, height: number, protect?: ProtectBand) => {
  const full: Rect = {x: 0, y: 0, w: width, h: height};
  const scene = scenes.find((item) => frame >= item.startFrame && frame < item.endFrame);
  if (!scene) return {rect: full, opacity: 1, zoom: 1, amount: 0, scene: undefined as ResolvedScene | undefined, plate: 0};
  const local = frame - scene.startFrame, length = scene.endFrame - scene.startFrame;
  const layout = scene.camera.layout as CameraLayout, from = scene.cameraFrom as CameraLayout;
  const enterFrames = Math.max(1, Math.min(Math.max(scene.transitionIn?.frames ?? 0, Math.round(0.45 * fps)), Math.floor(length / 3)));
  const exitFrames = Math.max(1, Math.min(Math.round(0.45 * fps), Math.floor(length / 3)));
  const enter = from === layout ? 1 : interpolate(local, [0, enterFrames], [0, 1], {...clampOpts, easing: easingFn('inOut')});
  const exit = scene.cameraJoinedOut || layout === 'full' ? 0 : interpolate(local, [length - exitFrames, length], [0, 1], {...clampOpts, easing: easingFn('inOut')});
  const rect = mix(mix(cameraRect(from, width, height, protect), cameraRect(layout, width, height, protect), enter), full, exit);
  const visible = (name: CameraLayout) => (name === 'hidden' ? 0 : 1);
  const opacity = (visible(from) + (visible(layout) - visible(from)) * enter) * (1 - exit) + exit;
  const zoom = keyframeValue(scene.camera.zoom, local, 1, 'inOut');
  const out = (name: CameraLayout) => (name === 'full' ? 0 : 1);
  const amount = (out(from) + (out(layout) - out(from)) * enter) * (1 - exit);
  // Placa de fundo: aparece já no começo da entrada (sem faixa preta) e só some quando a câmera volta à tela cheia.
  const plate = layout === 'full' && from === 'full' ? 0 : from !== 'full' ? 1 - exit : Math.min(1, enter * 4) * (1 - exit);
  return {rect, opacity, zoom, amount, scene, plate};
};

/** Valor exibido numa contagem (chega exatamente ao valor no fim; casas decimais fixas). */
export const countValue = (from: number, to: number, frame: number, frames: number, decimals: number) => {
  const t = interpolate(frame, [0, Math.max(1, frames)], [0, 1], {...clampOpts, easing: easingFn('out')});
  const value = t >= 1 ? to : from + (to - from) * t;
  return value.toFixed(decimals).replace('.', ',');
};

/** Revelação de um item no frame local (0..1), mola sem quique. */
export const revealAt = (frame: number, at: number, fps: number) => interpolate(frame, [at, at + Math.max(2, Math.round(0.35 * fps))], [0, 1], {...clampOpts, easing: Easing.spring({damping: 200})});

/** Instantes de revelação: os pedidos ou distribuídos na primeira metade da camada. */
export const revealFramesFor = (count: number, length: number, explicit?: number[]) => explicit ?? Array.from({length: count}, (_, i) => Math.round(i * Math.min(length * 0.5, length - 1) / Math.max(1, count)));
