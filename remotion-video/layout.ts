// Geometria e envelopes puros do motion (sem JSX): testados em Node (tests/motion-layout.test.mjs, tests/motion-explainer-layout.test.mjs).
// Mesmas funções no render e na prévia (Player): nenhuma decisão de layout fora daqui.
import {Easing, interpolate} from 'remotion';
import type {FocusPoint, MotionCue, MotionProps, ProtectProps, ReframeProps} from './types';

export const FOCAL = {x: 0.5, y: 0.38};
export const clampOpts = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** Transição de layout: entrada 0,4 s e saída 0,5 s (limitadas a 1/3 da cue). */
export const TRANSITION = {enterSeconds: 0.4, exitSeconds: 0.5};

export type Rect = {x: number; y: number; w: number; h: number};
export type Box = {left: number; top: number; right: number; bottom: number};
export type Shape = 'portrait' | 'landscape' | 'square';
export const shapeOf = (width: number, height: number): Shape => (height > width * 1.15 ? 'portrait' : width > height * 1.15 ? 'landscape' : 'square');

/** Área segura: laterais 6%, topo 8%, base 10% (20% no vertical, onde ficam botões das redes). */
export const safeArea = (width: number, height: number) => {
  const shape = shapeOf(width, height);
  return {left: width * 0.06, right: width * 0.94, top: height * 0.08, bottom: height * (shape === 'portrait' ? 0.8 : 0.9)};
};

/**
 * Remove de uma caixa a faixa protegida (legenda queimada): fica com a maior parte acima ou abaixo da faixa,
 * com margem de 1,5% da altura. Sem faixa, devolve a caixa intacta.
 */
export const avoidBand = (box: Box, height: number, protect?: ProtectProps): Box => {
  const band = protect?.captionBand;
  if (!band) return box;
  const top = band.top * height - height * 0.015, bottom = band.bottom * height + height * 0.015;
  if (box.bottom <= top || box.top >= bottom) return box;
  const above = {...box, bottom: Math.min(box.bottom, top)}, below = {...box, top: Math.max(box.top, bottom)};
  return above.bottom - above.top >= below.bottom - below.top ? above : below;
};

/**
 * Altura da câmera no split vertical/quadrado: metade da tela, ou menos (até 34%) quando a faixa da legenda deixaria o
 * painel abaixo dela com menos de 22% da altura — o explicativo continua legível sem invadir a legenda.
 */
const splitCameraHeight = (height: number, protect?: ProtectProps) => {
  const band = protect?.captionBand;
  if (!band || band.top * height >= height * 0.5 + height * 0.22 + height * 0.015) return height / 2;
  return Math.max(height * 0.34, Math.min(height / 2, band.top * height - height * 0.015 - height * 0.22));
};

/** Retângulo da câmera para cada layout. Split: metade (lado no horizontal, topo no vertical/quadrado). Foco: janela pequena. */
export const cameraRect = (layout: MotionCue['layout'], width: number, height: number, protect?: ProtectProps): Rect => {
  const shape = shapeOf(width, height);
  if (layout === 'split') return shape === 'landscape' ? {x: 0, y: 0, w: width / 2, h: height} : {x: 0, y: 0, w: width, h: splitCameraHeight(height, protect)};
  if (layout === 'motion-focus') {
    // No vertical com legenda protegida, a janela encolhe (até 24%) para o texto abaixo dela manter >= 22% da altura.
    const band = protect?.captionBand, portraitFraction = band ? Math.max(0.24, Math.min(0.4, band.top - 0.345)) : 0.4;
    const safe = safeArea(width, height), w = width * (shape === 'landscape' ? 0.26 : shape === 'portrait' ? portraitFraction : 0.4), h = w * height / width;
    return shape === 'portrait' ? {x: safe.right - w, y: safe.top, w, h} : {x: safe.right - w, y: safe.bottom - h, w, h};
  }
  return {x: 0, y: 0, w: width, h: height};
};

/** Área do painel de motion no layout (complemento da câmera; no foco, a tela toda). */
export const panelRect = (layout: MotionCue['layout'], width: number, height: number, protect?: ProtectProps): Rect => {
  const shape = shapeOf(width, height);
  if (layout === 'split') { if (shape === 'landscape') return {x: width / 2, y: 0, w: width / 2, h: height}; const top = splitCameraHeight(height, protect); return {x: 0, y: top, w: width, h: height - top}; }
  return {x: 0, y: 0, w: width, h: height};
};

/** Caixa do texto do cartão: dentro do painel e da área segura; no foco, nunca sob a janela da câmera; fora da faixa da legenda. */
export const cardBox = (layout: MotionCue['layout'], width: number, height: number, protect?: ProtectProps): Box => {
  const panel = panelRect(layout, width, height, protect), safe = safeArea(width, height), camera = cameraRect(layout, width, height, protect);
  const box = {left: Math.max(panel.x, safe.left), top: Math.max(panel.y, safe.top), right: Math.min(panel.x + panel.w, safe.right), bottom: Math.min(panel.y + panel.h, safe.bottom)};
  if (layout === 'motion-focus') { if (shapeOf(width, height) === 'portrait') box.top = Math.max(box.top, camera.y + camera.h + height * 0.03); else box.right = Math.min(box.right, camera.x - width * 0.03); }
  return avoidBand(box, height, protect);
};

/** Faixa vertical livre para texto cinético (área segura menos a faixa da legenda). */
export const textBand = (width: number, height: number, protect?: ProtectProps) => {
  const safe = safeArea(width, height);
  const box = avoidBand({left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom}, height, protect);
  return {top: box.top, bottom: box.bottom};
};

const mixRect = (a: Rect, b: Rect, t: number): Rect => (t <= 0 ? a : t >= 1 ? b : {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t});
const changesLayout = (cue: MotionCue) => (cue.kind === 'keyPoint' || cue.kind === 'explainer') && cue.layout !== 'camera-full';

/** Entrada/saída do layout de um cartão: 0 = câmera inteira, 1 = layout do cartão. Retorno suave à câmera. */
export const layoutAmount = (cue: MotionCue, frame: number, fps: number) => {
  if (frame < cue.startFrame || frame >= cue.endFrame) return 0;
  const length = cue.endFrame - cue.startFrame, enter = Math.min(Math.round(TRANSITION.enterSeconds * fps), Math.floor(length / 3)), exit = Math.min(Math.round(TRANSITION.exitSeconds * fps), Math.floor(length / 3));
  return interpolate(frame, [cue.startFrame, cue.startFrame + Math.max(1, enter), cue.endFrame - Math.max(1, exit), cue.endFrame], [0, 1, 1, 0], {...clampOpts, easing: EASE_IN_OUT});
};

/** Aproximação (punch-in): ataque rápido (~0,12 s) na palavra enfatizada, sustentação e soltura de ~0,3 s. */
export const punchAmount = (cue: MotionCue, frame: number, fps: number) => {
  if (frame < cue.startFrame || frame >= cue.endFrame) return 0;
  const length = cue.endFrame - cue.startFrame, attack = Math.max(2, Math.min(Math.round(0.12 * fps), Math.floor(length / 3))), release = Math.max(2, Math.min(Math.round(0.3 * fps), Math.floor(length / 2)));
  return interpolate(frame, [cue.startFrame, cue.startFrame + attack, cue.endFrame - release, cue.endFrame], [0, 1, 1, 0], {...clampOpts, easing: EASE_OUT});
};

/**
 * Linha do tempo de layout: cada cue de layout entra a partir da câmera cheia, ou DIRETO do layout anterior quando
 * as duas se encostam (resolveMotionProps junta cues separadas por até 0,6 s), e só volta à câmera cheia se a próxima
 * não continuar. `amount` = quanto o quadro está fora da câmera cheia (sombra/borda da janela).
 */
export const layoutState = (motion: MotionProps | undefined, frame: number, fps: number, width: number, height: number) => {
  const list = (motion?.cues ?? []).filter(changesLayout).sort((a, b) => a.startFrame - b.startFrame);
  const full = cameraRect('camera-full', width, height);
  for (let i = 0; i < list.length; i++) {
    const cue = list[i];
    if (frame < cue.startFrame || frame >= cue.endFrame) continue;
    const prev = list[i - 1], next = list[i + 1];
    const joinedIn = Boolean(prev && prev.endFrame === cue.startFrame), joinedOut = Boolean(next && next.startFrame === cue.endFrame);
    const length = cue.endFrame - cue.startFrame;
    const enterFrames = Math.max(1, Math.min(Math.round(TRANSITION.enterSeconds * fps), Math.floor(length / 3))), exitFrames = Math.max(1, Math.min(Math.round(TRANSITION.exitSeconds * fps), Math.floor(length / 3)));
    const from: MotionCue['layout'] = joinedIn ? prev.layout : 'camera-full';
    const enter = from === cue.layout ? 1 : interpolate(frame, [cue.startFrame, cue.startFrame + enterFrames], [0, 1], {...clampOpts, easing: EASE_IN_OUT});
    const exit = joinedOut ? 0 : interpolate(frame, [cue.endFrame - exitFrames, cue.endFrame], [0, 1], {...clampOpts, easing: EASE_IN_OUT});
    const protect = motion?.protect;
    const rect = mixRect(mixRect(cameraRect(from, width, height, protect), cameraRect(cue.layout, width, height, protect), enter), full, exit);
    return {rect, amount: (from === 'camera-full' ? enter : 1) * (1 - exit), layout: cue.layout, from, joinedIn, joinedOut, cue};
  }
  return {rect: full, amount: 0, layout: 'camera-full' as MotionCue['layout'], from: 'camera-full' as MotionCue['layout'], joinedIn: false, joinedOut: false, cue: undefined};
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Foco no frame: trilha do plano (fixo/manual/rosto) interpolada suavemente entre pontos; sem trilha, FOCAL. */
export const focusAt = (reframe: ReframeProps | undefined, frame: number): FocusPoint => {
  const points = reframe?.points ?? [];
  if (!points.length) return {frame, ...FOCAL};
  if (frame <= points[0].frame) return {...points[0], frame};
  const last = points[points.length - 1];
  if (frame >= last.frame) return {...last, frame};
  let i = 1;
  while (points[i].frame < frame) i++;
  const a = points[i - 1], b = points[i], t = smoothstep((frame - a.frame) / (b.frame - a.frame));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {frame, x: lerp(a.x, b.x), y: lerp(a.y, b.y), ...(a.w !== undefined && b.w !== undefined && a.h !== undefined && b.h !== undefined ? {w: lerp(a.w, b.w), h: lerp(a.h, b.h)} : {})};
};

/**
 * Recorte (cover) do vídeo dentro da janela da câmera centrado no foco. Com caixa de rosto conhecida, o zoom é limitado
 * para o rosto inteiro caber (margem de 8%) — o punch-in nunca corta um rosto medido. Coordenadas relativas à janela.
 */
export const cameraCrop = (rect: Rect, zoom: number, width: number, height: number, focus: {x: number; y: number; w?: number; h?: number}) => {
  const cover = Math.max(rect.w / width, rect.h / height);
  let effective = zoom;
  if (focus.w !== undefined && focus.h !== undefined) {
    const fit = Math.min(rect.w * 0.84 / (focus.w * width * cover), rect.h * 0.84 / (focus.h * height * cover));
    effective = Math.max(1, Math.min(zoom, fit));
  }
  const vw = width * cover * effective, vh = height * cover * effective;
  const left = Math.min(0, Math.max(rect.w - vw, rect.w / 2 - vw * focus.x)), top = Math.min(0, Math.max(rect.h - vh, rect.h / 2 - vh * focus.y));
  return {left, top, vw, vh, zoom: effective};
};

/** Fração (0..1) da caixa do rosto que fica visível na janela — medida usada pelos testes de enquadramento. */
export const focusVisibility = (rect: Rect, crop: {left: number; top: number; vw: number; vh: number}, focus: {x: number; y: number; w?: number; h?: number}) => {
  if (focus.w === undefined || focus.h === undefined) {
    const px = crop.left + crop.vw * focus.x, py = crop.top + crop.vh * focus.y;
    return px >= 0 && px <= rect.w && py >= 0 && py <= rect.h ? 1 : 0;
  }
  const l = crop.left + crop.vw * (focus.x - focus.w / 2), r = crop.left + crop.vw * (focus.x + focus.w / 2), t = crop.top + crop.vh * (focus.y - focus.h / 2), b = crop.top + crop.vh * (focus.y + focus.h / 2);
  const iw = Math.max(0, Math.min(r, rect.w) - Math.max(l, 0)), ih = Math.max(0, Math.min(b, rect.h) - Math.max(t, 0));
  return (iw * ih) / Math.max(1e-9, (r - l) * (b - t));
};

/** Estado da câmera no frame: retângulo, escala extra, layout dominante e foco. Determinístico. */
export const cameraState = (motion: MotionProps | undefined, frame: number, fps: number, width: number, height: number) => {
  let zoom = 1;
  for (const cue of motion?.cues ?? []) if (cue.kind === 'punchIn') zoom = Math.max(zoom, 1 + ((cue.scale ?? 1.08) - 1) * punchAmount(cue, frame, fps));
  const state = layoutState(motion, frame, fps, width, height);
  return {rect: state.rect, amount: state.amount, layout: state.layout, zoom, focus: focusAt(motion?.reframe, frame), joinedIn: state.joinedIn};
};

// ---------------------------------------------------------------- explicativos

/** Formata o valor EXATO com a unidade dita (sem arredondar para outro número). */
export const formatStat = (value: number, unit?: string) => {
  const text = (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)).replace('.', ',');
  if (unit === 'R$' || unit === '$') return `${unit} ${text}`;
  if (unit === 'mil') return `${text} mil`;
  return unit ? `${text}${unit}` : text;
};

/** Valor exibido durante a contagem (chega exatamente ao valor dito no fim da animação). */
export const countUp = (value: number, frame: number, fps: number) => {
  const t = interpolate(frame, [0, Math.round(0.7 * fps)], [0, 1], {...clampOpts, easing: EASE_OUT});
  if (t >= 1) return value;
  const decimals = Number.isInteger(value) ? 0 : 2;
  return Math.round(value * t * 10 ** decimals) / 10 ** decimals;
};

/** Entrada de um item revelado no frame `at` (0..1, mola sem quique). */
export const revealAmount = (frame: number, at: number, fps: number) => interpolate(frame, [at, at + Math.max(2, Math.round(0.35 * fps))], [0, 1], {...clampOpts, easing: Easing.spring({damping: 200})});

/** Tamanho de fonte que cabe na caixa para `rows` linhas de até `chars` caracteres (determinístico). */
export const fitFont = (box: Box, rows: number, chars: number, unit: number, max = 5.4) => {
  const w = box.right - box.left, h = box.bottom - box.top;
  return Math.max(unit * 1.6, Math.min(unit * max, h / (Math.max(1, rows) * 2.3), w / (Math.max(8, chars) * 0.58)));
};

/** Direção do diagrama/comparação: lado a lado se a caixa for larga o bastante, senão empilhado. */
export const flowDirection = (box: Box, items: number) => ((box.right - box.left) / Math.max(1, box.bottom - box.top) > 1.25 && items <= 3 ? 'row' : 'column');
