// Storyboard AUTORADO para o motor Remotion: scene graph declarativo (cenas → camadas → primitivas) que o Claude
// (ou o usuário) escreve como DADOS, nunca como código. Este módulo é PURO e browser-safe (sem node:*): o mesmo
// arquivo valida no servidor, resolve frames/geometria no bundle Remotion (prévia e render) e alimenta QA/manifesto.
// Regras: tempos na linha do tempo EDITADA e amarrados aos cortes (segmentsHash); texto puro limitado; imagens/B-roll
// só por assetId registrado (hash conferido no render); números precisam existir na fala/briefing; nada de URL,
// caminho, HTML, CSS livre, JS ou aleatoriedade. Toda animação é função do frame (keyframes + easing).

export const STORYBOARD_VERSION = 1;
export const STORYBOARD_LIMITS = Object.freeze({
  maxScenes: 40, maxLayersPerScene: 12, maxLayers: 240, maxKeyframes: 12, maxSfx: 60, maxAssets: 8, maxItems: 6,
  maxText: 90, maxItem: 48, maxLabel: 28, maxQuote: 240, minSceneSeconds: 0.4, minLayerSeconds: 0.2, maxTransitionSeconds: 1.2,
  maxSeconds: 1800, sfxPerMinute: 6, sfxMinGap: 1.5, minGainDb: -36, maxGainDb: -10, maxSimultaneousText: 4
});
export const storyboardTreatments = Object.freeze(['creator', 'editorial', 'technical']);
export const cameraLayouts = Object.freeze(['full', 'split-left', 'split-right', 'split-top', 'pip', 'hidden']);
/** Composition of a scene when the content has a screen recording (camera+screen pair): camera only, screen only, screen + camera corner. */
export const sceneScreenModes = Object.freeze(['off', 'full', 'with-camera']);
export const transitionKinds = Object.freeze(['cut', 'fade', 'slide', 'push', 'wipe', 'iris', 'zoom']);
export const directions = Object.freeze(['left', 'right', 'up', 'down']);
export const backgroundKinds = Object.freeze(['none', 'solid', 'gradient', 'grid', 'dots']);
export const layerTypes = Object.freeze(['text', 'counter', 'steps', 'process', 'compare', 'bars', 'image', 'video', 'shape', 'arrow', 'callout', 'chapter', 'spotlight']);
export const slots = Object.freeze(['full', 'panel', 'panel-top', 'panel-bottom', 'top', 'center', 'bottom', 'left', 'right', 'top-left', 'top-right']);
export const easings = Object.freeze(['linear', 'in', 'out', 'inOut', 'spring', 'snappy', 'bezier']);
export const enterPresets = Object.freeze(['none', 'fade', 'rise', 'drop', 'slideLeft', 'slideRight', 'pop', 'wipe', 'blur', 'typewriter', 'draw']);
export const exitPresets = Object.freeze(['none', 'fade', 'sink', 'slideLeft', 'slideRight', 'shrink', 'wipe']);
export const maskKinds = Object.freeze(['wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown', 'circle', 'diagonal']);
export const textRoles = Object.freeze(['headline', 'title', 'body', 'label', 'caption', 'quote']);
export const textModes = Object.freeze(['static', 'words', 'chars', 'lines', 'typewriter']);
export const emphasisKinds = Object.freeze(['marker', 'underline', 'color', 'box']);
export const colorTokens = Object.freeze(['text', 'muted', 'accent', 'accent2', 'surface', 'bg', 'ink']);
export const shapeKinds = Object.freeze(['rect', 'circle', 'line', 'ring']);
export const imageFrames = Object.freeze(['none', 'card', 'browser', 'phone']);
export const statUnits = Object.freeze(['%', 'x', 'k', 'mil', 'R$', '$', 'h', 'min', 's']);
export const sfxKinds = Object.freeze(['whoosh', 'pop', 'tick']);
export const factSources = Object.freeze(['speech', 'brief', 'user', 'design']);
export const keyframeProps = Object.freeze({opacity: [0, 1], x: [-1, 1], y: [-1, 1], scale: [0.2, 4], rotate: [-180, 180]});

/**
 * Tratamentos visuais (hierarquia, tipografia, paleta, ritmo). Só fontes do SISTEMA (Windows tem Bahnschrift, Georgia e
 * Cascadia/Consolas); a pilha cai para genéricas em outro SO. Escolhidos para serem realmente distintos entre si.
 */
export const TREATMENTS = Object.freeze({
  creator: Object.freeze({
    label: 'Criador (energia alta)', display: '"Bahnschrift", "Arial Black", "Segoe UI", system-ui, sans-serif', body: '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif',
    displayWeight: 800, upper: true, charWidth: 0.6, radius: 1.4, stroke: 0.5,
    palette: Object.freeze({bg: '#0b0b0f', surface: '#1b1b24', text: '#ffffff', muted: '#d0d0da', accent: '#ffd400', accent2: '#ff3d6e', ink: '#0b0b0f'}),
    enter: 'pop', exit: 'fade', transition: 'push', ease: 'snappy', background: 'solid'
  }),
  editorial: Object.freeze({
    label: 'Editorial (calmo, revista)', display: 'Georgia, Cambria, "Times New Roman", serif', body: '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif',
    displayWeight: 700, upper: false, charWidth: 0.54, radius: 0.4, stroke: 0.22,
    palette: Object.freeze({bg: '#f3efe6', surface: '#ffffff', text: '#1b1a17', muted: '#5d584e', accent: '#c2410c', accent2: '#1d4ed8', ink: '#1b1a17'}),
    enter: 'rise', exit: 'fade', transition: 'fade', ease: 'inOut', background: 'gradient'
  }),
  technical: Object.freeze({
    label: 'Técnico (diagrama, blueprint)', display: '"Cascadia Code", Consolas, "Courier New", monospace', body: '"Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif',
    displayWeight: 700, upper: false, charWidth: 0.62, radius: 0.5, stroke: 0.3,
    palette: Object.freeze({bg: '#07111f', surface: '#0e1d33', text: '#e6f1ff', muted: '#8aa4c4', accent: '#38bdf8', accent2: '#a3e635', ink: '#07111f'}),
    enter: 'wipe', exit: 'fade', transition: 'wipe', ease: 'out', background: 'grid'
  })
});

/** Tamanhos base por papel tipográfico, em "unidades" (1% do menor lado). Retrato ganha corpo maior. */
export const ROLE_SIZES = Object.freeze({headline: 9.2, title: 6.6, body: 4.4, label: 3.2, caption: 3.4, quote: 5.4});
export const SIZE_SCALE = Object.freeze({s: 0.8, m: 1, l: 1.2, xl: 1.45});
/** Menor corpo legível em celular (unidades): ~26 px num 1080 p. */
export const MIN_READABLE_UNITS = 2.4;

const round3 = (value) => Math.round(value * 1000) / 1000;
const round4 = (value) => Math.round(value * 10000) / 10000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ID = /^[a-zA-Z0-9_-]{1,40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
// Sem controles, bidi, marcação, chaves, crase, barra invertida, URL ou javascript:.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩<>{}`\\]|:\/\/|javascript:|www\./i;
export const safeStoryText = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= max && !UNSAFE.test(value);

class StoryboardError extends Error {
  constructor(message, path) { super(path ? `${path}: ${message}` : message); this.name = 'StoryboardError'; this.path = path; }
}
const fail = (path, message) => { throw new StoryboardError(message, path); };
function keys(value, allowed, path) {
  if (!isRecord(value)) fail(path, 'deve ser objeto.');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `campo "${key}" não é permitido.`);
}
const text = (value, max, path) => { if (!safeStoryText(value, max)) fail(path, `texto puro de 1..${max} caracteres (sem URL/marcação).`); return value.replace(/\s+/g, ' ').trim(); };
const optText = (value, max, path) => (value === undefined ? undefined : text(value, max, path));
const oneOf = (value, list, path, fallback) => { if (value === undefined && fallback !== undefined) return fallback; if (!list.includes(value)) fail(path, `use um de: ${list.join(', ')}.`); return value; };
const num = (value, min, max, path, fallback) => { if (value === undefined && fallback !== undefined) return fallback; if (!finite(value) || value < min || value > max) fail(path, `número entre ${min} e ${max}.`); return value; };

/** Hash estável (FNV-1a 32 bits, hex) dos trechos mantidos: amarra o storyboard aos cortes sem depender de node:crypto. */
export function segmentsHash(segments) {
  let hash = 0x811c9dc5;
  const input = (segments ?? []).map((item) => `${Math.round(item.start * 1000)}-${Math.round(item.end * 1000)}`).join('|');
  for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- validação

function easing(value, path) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return oneOf(value, easings.filter((item) => item !== 'bezier'), path);
  keys(value, ['bezier'], path);
  const b = value.bezier;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite) || b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1 || Math.abs(b[1]) > 3 || Math.abs(b[3]) > 3) fail(path, 'bezier = [x1,y1,x2,y2] com x em 0..1.');
  return {bezier: b.map(round4)};
}

function keyframes(raw, duration, path, ranges = keyframeProps) {
  if (raw === undefined) return undefined;
  keys(raw, Object.keys(ranges), path);
  const out = {};
  for (const [prop, list] of Object.entries(raw)) {
    const [min, max] = ranges[prop];
    if (!Array.isArray(list) || list.length < 1 || list.length > STORYBOARD_LIMITS.maxKeyframes) fail(`${path}.${prop}`, `1..${STORYBOARD_LIMITS.maxKeyframes} keyframes.`);
    let previous = -1;
    out[prop] = list.map((frame, i) => {
      keys(frame, ['t', 'v', 'ease'], `${path}.${prop}[${i}]`);
      const t = num(frame.t, 0, duration + 1e-6, `${path}.${prop}[${i}].t`);
      if (t <= previous) fail(`${path}.${prop}[${i}].t`, 'tempos em ordem crescente.');
      previous = t;
      const ease = easing(frame.ease, `${path}.${prop}[${i}].ease`);
      return {t: round3(Math.min(t, duration)), v: round4(num(frame.v, min, max, `${path}.${prop}[${i}].v`)), ...(ease ? {ease} : {})};
    });
  }
  return Object.keys(out).length ? out : undefined;
}

function motionPreset(raw, list, duration, path) {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return {preset: oneOf(raw, list, path)};
  keys(raw, ['preset', 'seconds', 'ease'], path);
  const ease = easing(raw.ease, `${path}.ease`);
  return {preset: oneOf(raw.preset, list, `${path}.preset`), ...(raw.seconds !== undefined ? {seconds: round3(num(raw.seconds, 0.05, Math.max(0.05, Math.min(3, duration)), `${path}.seconds`))} : {}), ...(ease ? {ease} : {})};
}

const items = (raw, path, max = STORYBOARD_LIMITS.maxItems, min = 2) => {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) fail(path, `${min}..${max} itens.`);
  return raw.map((item, i) => text(item, STORYBOARD_LIMITS.maxItem, `${path}[${i}]`));
};

function reveal(raw, count, duration, path) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== count || raw.some((t, i) => !finite(t) || t < 0 || t > duration || (i && t < raw[i - 1]))) fail(path, `${count} instantes crescentes dentro da camada (s).`);
  return raw.map(round3);
}

const point = (raw, path) => { keys(raw, ['x', 'y'], path); return {x: round4(num(raw.x, 0, 1, `${path}.x`)), y: round4(num(raw.y, 0, 1, `${path}.y`))}; };
const box = (raw, path) => {
  keys(raw, ['x', 'y', 'w', 'h'], path);
  const value = {x: num(raw.x, 0, 1, `${path}.x`), y: num(raw.y, 0, 1, `${path}.y`), w: num(raw.w, 0.04, 1, `${path}.w`), h: num(raw.h, 0.03, 1, `${path}.h`)};
  if (value.x + value.w > 1.0001 || value.y + value.h > 1.0001) fail(path, 'caixa deve caber no quadro (frações 0..1).');
  return {x: round4(value.x), y: round4(value.y), w: round4(value.w), h: round4(value.h)};
};

const LAYER_FIELDS = {
  text: ['text', 'role', 'mode', 'emphasis', 'highlight', 'align'],
  counter: ['value', 'from', 'unit', 'label', 'decimals'],
  steps: ['items', 'reveal'],
  process: ['nodes', 'reveal'],
  compare: ['before', 'after', 'reveal'],
  bars: ['values', 'reveal'],
  image: ['assetId', 'fit', 'frame', 'caption', 'kenBurns'],
  video: ['assetId', 'fit', 'frame', 'caption', 'trimStart'],
  shape: ['shape', 'fill', 'stroke'],
  arrow: ['from', 'to', 'color'],
  callout: ['text', 'target'],
  chapter: ['index', 'text'],
  spotlight: ['target', 'dim']
};
const COMMON_FIELDS = ['id', 'type', 'start', 'end', 'slot', 'box', 'z', 'enter', 'exit', 'keyframes', 'mask', 'style', 'source', 'quote'];

function layerSpecific(raw, duration, path, assetIds) {
  const t = raw.type;
  switch (t) {
    case 'text': {
      const value = text(raw.text, STORYBOARD_LIMITS.maxText, `${path}.text`);
      const highlight = raw.highlight === undefined ? undefined : items(raw.highlight, `${path}.highlight`, 3, 1);
      if (highlight && highlight.some((word) => !value.toLowerCase().includes(word.toLowerCase()))) fail(`${path}.highlight`, 'destaque precisa existir no texto.');
      return {text: value, role: oneOf(raw.role, textRoles, `${path}.role`, 'title'), mode: oneOf(raw.mode, textModes, `${path}.mode`, 'words'),
        ...(raw.emphasis !== undefined ? {emphasis: oneOf(raw.emphasis, emphasisKinds, `${path}.emphasis`)} : {}), ...(highlight ? {highlight} : {}), align: oneOf(raw.align, ['left', 'center', 'right'], `${path}.align`, 'center')};
    }
    case 'counter': {
      const value = num(raw.value, -1e9, 1e9, `${path}.value`), from = num(raw.from, -1e9, 1e9, `${path}.from`, 0);
      return {value, from, ...(raw.unit !== undefined ? {unit: oneOf(raw.unit, statUnits, `${path}.unit`)} : {}), ...(raw.label !== undefined ? {label: text(raw.label, STORYBOARD_LIMITS.maxText, `${path}.label`)} : {}), decimals: Math.round(num(raw.decimals, 0, 2, `${path}.decimals`, Number.isInteger(value) ? 0 : 1))};
    }
    case 'steps': { const list = items(raw.items, `${path}.items`); return {items: list, ...(raw.reveal !== undefined ? {reveal: reveal(raw.reveal, list.length, duration, `${path}.reveal`)} : {})}; }
    case 'process': { const list = items(raw.nodes, `${path}.nodes`, 5); return {nodes: list, ...(raw.reveal !== undefined ? {reveal: reveal(raw.reveal, list.length, duration, `${path}.reveal`)} : {})}; }
    case 'compare': {
      const side = (value, name) => { keys(value, ['label', 'text'], `${path}.${name}`); return {label: text(value.label, STORYBOARD_LIMITS.maxLabel, `${path}.${name}.label`), text: text(value.text, STORYBOARD_LIMITS.maxItem, `${path}.${name}.text`)}; };
      return {before: side(raw.before, 'before'), after: side(raw.after, 'after'), ...(raw.reveal !== undefined ? {reveal: reveal(raw.reveal, 2, duration, `${path}.reveal`)} : {})};
    }
    case 'bars': {
      if (!Array.isArray(raw.values) || raw.values.length < 2 || raw.values.length > 5) fail(`${path}.values`, '2..5 valores.');
      const values = raw.values.map((item, i) => { keys(item, ['label', 'value', 'unit'], `${path}.values[${i}]`); return {label: text(item.label, STORYBOARD_LIMITS.maxLabel, `${path}.values[${i}].label`), value: num(item.value, 0, 1e9, `${path}.values[${i}].value`), ...(item.unit !== undefined ? {unit: oneOf(item.unit, statUnits, `${path}.values[${i}].unit`)} : {})}; });
      return {values, ...(raw.reveal !== undefined ? {reveal: reveal(raw.reveal, values.length, duration, `${path}.reveal`)} : {})};
    }
    case 'image': case 'video': {
      if (typeof raw.assetId !== 'string' || !ID.test(raw.assetId)) fail(`${path}.assetId`, 'id simples de asset registrado (nunca caminho/URL).');
      if (!assetIds.has(raw.assetId)) fail(`${path}.assetId`, `asset "${raw.assetId}" não declarado em storyboard.assets.`);
      const extra = {};
      if (t === 'image' && raw.kenBurns !== undefined) {
        keys(raw.kenBurns, ['from', 'to'], `${path}.kenBurns`);
        const end = (value, name) => { keys(value, ['scale', 'x', 'y'], `${path}.kenBurns.${name}`); return {scale: round3(num(value.scale, 1, 2.5, `${path}.kenBurns.${name}.scale`)), x: round4(num(value.x, 0, 1, `${path}.kenBurns.${name}.x`, 0.5)), y: round4(num(value.y, 0, 1, `${path}.kenBurns.${name}.y`, 0.5))}; };
        extra.kenBurns = {from: end(raw.kenBurns.from, 'from'), to: end(raw.kenBurns.to, 'to')};
      }
      if (t === 'video') extra.trimStart = round3(num(raw.trimStart, 0, 3600, `${path}.trimStart`, 0));
      return {assetId: raw.assetId, fit: oneOf(raw.fit, ['cover', 'contain'], `${path}.fit`, 'contain'), frame: oneOf(raw.frame, imageFrames, `${path}.frame`, 'card'), ...(raw.caption !== undefined ? {caption: text(raw.caption, STORYBOARD_LIMITS.maxText, `${path}.caption`)} : {}), ...extra};
    }
    case 'shape': return {shape: oneOf(raw.shape, shapeKinds, `${path}.shape`), fill: oneOf(raw.fill, [...colorTokens, 'none'], `${path}.fill`, 'accent'), stroke: oneOf(raw.stroke, [...colorTokens, 'none'], `${path}.stroke`, 'none')};
    case 'arrow': return {from: point(raw.from, `${path}.from`), to: point(raw.to, `${path}.to`), color: oneOf(raw.color, colorTokens, `${path}.color`, 'accent')};
    case 'callout': return {text: text(raw.text, STORYBOARD_LIMITS.maxItem, `${path}.text`), target: point(raw.target, `${path}.target`)};
    case 'chapter': return {index: Math.round(num(raw.index, 1, 99, `${path}.index`)), text: text(raw.text, STORYBOARD_LIMITS.maxItem, `${path}.text`)};
    case 'spotlight': return {target: box(raw.target, `${path}.target`), dim: round3(num(raw.dim, 0.2, 0.9, `${path}.dim`, 0.6))};
    default: return fail(`${path}.type`, `use um de: ${layerTypes.join(', ')}.`);
  }
}

function validateLayer(raw, sceneDuration, path, assetIds) {
  if (!isRecord(raw)) fail(path, 'camada deve ser objeto.');
  const type = oneOf(raw.type, layerTypes, `${path}.type`);
  keys(raw, [...COMMON_FIELDS, ...LAYER_FIELDS[type]], path);
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail(`${path}.id`, 'id simples (a-z, 0-9, _ e -).');
  const start = num(raw.start, 0, sceneDuration, `${path}.start`, 0), end = num(raw.end, 0, sceneDuration + 1e-6, `${path}.end`, sceneDuration);
  if (end - start < STORYBOARD_LIMITS.minLayerSeconds) fail(path, `camada dura ao menos ${STORYBOARD_LIMITS.minLayerSeconds}s dentro da cena.`);
  const duration = Math.min(end, sceneDuration) - start;
  if (raw.slot !== undefined && raw.box !== undefined) fail(path, 'use slot OU box.');
  const placement = raw.box !== undefined ? {box: box(raw.box, `${path}.box`)} : {slot: oneOf(raw.slot, slots, `${path}.slot`, type === 'spotlight' || type === 'arrow' ? 'full' : 'center')};
  let style;
  if (raw.style !== undefined) {
    keys(raw.style, ['color', 'size', 'weight', 'background', 'italic'], `${path}.style`);
    style = {...(raw.style.color !== undefined ? {color: oneOf(raw.style.color, colorTokens, `${path}.style.color`)} : {}), ...(raw.style.size !== undefined ? {size: oneOf(raw.style.size, Object.keys(SIZE_SCALE), `${path}.style.size`)} : {}),
      ...(raw.style.weight !== undefined ? {weight: oneOf(raw.style.weight, ['regular', 'bold', 'black'], `${path}.style.weight`)} : {}), ...(raw.style.background !== undefined ? {background: oneOf(raw.style.background, ['none', 'surface', 'accent', 'ink', 'scrim'], `${path}.style.background`)} : {}),
      ...(raw.style.italic !== undefined ? {italic: raw.style.italic === true} : {})};
  }
  let mask;
  if (raw.mask !== undefined) {
    keys(raw.mask, ['kind', 'seconds', 'ease'], `${path}.mask`);
    const ease = easing(raw.mask.ease, `${path}.mask.ease`);
    mask = {kind: oneOf(raw.mask.kind, maskKinds, `${path}.mask.kind`), seconds: round3(num(raw.mask.seconds, 0.1, Math.max(0.1, Math.min(3, duration)), `${path}.mask.seconds`, Math.min(0.6, duration / 2))), ...(ease ? {ease} : {})};
  }
  const source = oneOf(raw.source, factSources, `${path}.source`, 'design');
  const quote = optText(raw.quote, STORYBOARD_LIMITS.maxQuote, `${path}.quote`);
  if (quote && source !== 'speech' && source !== 'brief') fail(`${path}.quote`, 'citação só para conteúdo da fala ou do briefing.');
  const z = raw.z === undefined ? undefined : Math.round(num(raw.z, -10, 10, `${path}.z`));
  const enter = motionPreset(raw.enter, enterPresets, duration, `${path}.enter`), exit = motionPreset(raw.exit, exitPresets, duration, `${path}.exit`);
  if (enter?.preset === 'typewriter' && type !== 'text' && type !== 'callout') fail(`${path}.enter`, 'typewriter só para texto.');
  return {id: raw.id, type, start: round3(start), end: round3(Math.min(end, sceneDuration)), ...placement, ...(z !== undefined ? {z} : {}), ...(enter ? {enter} : {}), ...(exit ? {exit} : {}),
    ...(raw.keyframes !== undefined ? {keyframes: keyframes(raw.keyframes, duration, `${path}.keyframes`)} : {}), ...(mask ? {mask} : {}), ...(style ? {style} : {}), source, ...(quote ? {quote} : {}),
    ...layerSpecific(raw, duration, path, assetIds)};
}

function validateScene(raw, index, assetIds, outputDuration) {
  const path = `scenes[${index}]`;
  keys(raw, ['id', 'name', 'start', 'end', 'camera', 'screen', 'background', 'transitionIn', 'layers'], path);
  const screen = raw.screen === undefined ? undefined : oneOf(raw.screen, sceneScreenModes, `${path}.screen`);
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) fail(`${path}.id`, 'id simples.');
  const start = num(raw.start, 0, outputDuration, `${path}.start`), end = num(raw.end, 0, outputDuration + 0.05, `${path}.end`);
  if (end - start < STORYBOARD_LIMITS.minSceneSeconds) fail(path, `cena dura ao menos ${STORYBOARD_LIMITS.minSceneSeconds}s.`);
  const duration = Math.min(end, outputDuration) - start;
  const cam = raw.camera ?? {};
  keys(cam, ['layout', 'zoom', 'focus'], `${path}.camera`);
  const camera = {layout: oneOf(cam.layout, cameraLayouts, `${path}.camera.layout`, 'full'),
    ...(cam.zoom !== undefined ? {zoom: keyframes({scale: cam.zoom}, duration, `${path}.camera.zoom`, {scale: [1, 2.5]}).scale} : {}), ...(cam.focus !== undefined ? {focus: point(cam.focus, `${path}.camera.focus`)} : {})};
  const bg = raw.background ?? {};
  keys(bg, ['kind', 'tone'], `${path}.background`);
  const background = {kind: oneOf(bg.kind, backgroundKinds, `${path}.background.kind`, 'none'), tone: oneOf(bg.tone, ['bg', 'surface', 'accent', 'ink'], `${path}.background.tone`, 'bg')};
  let transitionIn;
  if (raw.transitionIn !== undefined) {
    const tr = typeof raw.transitionIn === 'string' ? {kind: raw.transitionIn} : raw.transitionIn;
    keys(tr, ['kind', 'seconds', 'direction', 'ease'], `${path}.transitionIn`);
    const kind = oneOf(tr.kind, transitionKinds, `${path}.transitionIn.kind`), ease = easing(tr.ease, `${path}.transitionIn.ease`);
    const seconds = kind === 'cut' ? 0 : round3(num(tr.seconds, 0.1, STORYBOARD_LIMITS.maxTransitionSeconds, `${path}.transitionIn.seconds`, 0.45));
    if (seconds > duration / 2) fail(`${path}.transitionIn.seconds`, 'transição cabe na primeira metade da cena.');
    transitionIn = {kind, seconds, direction: oneOf(tr.direction, directions, `${path}.transitionIn.direction`, 'left'), ...(ease ? {ease} : {})};
  }
  if (!Array.isArray(raw.layers) || raw.layers.length > STORYBOARD_LIMITS.maxLayersPerScene) fail(`${path}.layers`, `0..${STORYBOARD_LIMITS.maxLayersPerScene} camadas por cena.`);
  const ids = new Set();
  const layers = raw.layers.map((layer, i) => {
    const value = validateLayer(layer, duration, `${path}.layers[${i}]`, assetIds);
    if (ids.has(value.id)) fail(`${path}.layers[${i}].id`, 'id repetido na cena.');
    ids.add(value.id);
    return value;
  });
  return {id: raw.id, ...(raw.name !== undefined ? {name: text(raw.name, STORYBOARD_LIMITS.maxLabel, `${path}.name`)} : {}), start: round3(start), end: round3(Math.min(end, outputDuration)), camera, ...(screen ? {screen} : {}), background, ...(transitionIn ? {transitionIn} : {}), layers};
}

/**
 * Valida e normaliza um storyboard autorado. `outputDuration` = duração do vídeo editado; `segments` (opcional) = trechos
 * mantidos: quando informados, `timeline.segmentsHash` precisa bater (cortes mudaram => storyboard desatualizado).
 */
export function validateStoryboard(raw, {outputDuration, segments} = {}) {
  if (!finite(outputDuration) || outputDuration <= 0 || outputDuration > STORYBOARD_LIMITS.maxSeconds) fail('storyboard', 'duração do vídeo editado inválida.');
  keys(raw, ['version', 'title', 'timeline', 'style', 'assets', 'scenes', 'sfx', 'notes'], 'storyboard');
  if (raw.version !== STORYBOARD_VERSION) fail('storyboard.version', `use ${STORYBOARD_VERSION}.`);
  const timeline = raw.timeline ?? {basis: 'output'};
  keys(timeline, ['basis', 'segmentsHash'], 'storyboard.timeline');
  if (timeline.basis !== 'output') fail('storyboard.timeline.basis', 'tempos são do vídeo editado ("output").');
  if (timeline.segmentsHash !== undefined && !/^[0-9a-f]{8}$/.test(timeline.segmentsHash)) fail('storyboard.timeline.segmentsHash', 'hash de 8 hex.');
  if (segments) {
    const expected = segmentsHash(segments);
    if (timeline.segmentsHash === undefined) fail('storyboard.timeline.segmentsHash', `obrigatório (cortes atuais = ${expected}).`);
    if (timeline.segmentsHash !== expected) fail('storyboard.timeline.segmentsHash', `storyboard desatualizado: os cortes mudaram (atual ${expected}). Reautore os tempos.`);
  }
  const st = raw.style ?? {};
  keys(st, ['treatment', 'accent', 'accent2'], 'storyboard.style');
  const treatment = oneOf(st.treatment, storyboardTreatments, 'storyboard.style.treatment', 'creator');
  for (const name of ['accent', 'accent2']) if (st[name] !== undefined && (typeof st[name] !== 'string' || !HEX.test(st[name]))) fail(`storyboard.style.${name}`, '#RRGGBB.');
  const style = {treatment, ...(st.accent ? {accent: st.accent.toLowerCase()} : {}), ...(st.accent2 ? {accent2: st.accent2.toLowerCase()} : {})};
  const rawAssets = raw.assets ?? [];
  if (!Array.isArray(rawAssets) || rawAssets.length > STORYBOARD_LIMITS.maxAssets) fail('storyboard.assets', `até ${STORYBOARD_LIMITS.maxAssets} assets.`);
  const assetIds = new Set();
  const assets = rawAssets.map((asset, i) => {
    keys(asset, ['id', 'kind', 'sha256', 'role', 'label'], `storyboard.assets[${i}]`);
    if (typeof asset.id !== 'string' || !ID.test(asset.id) || assetIds.has(asset.id)) fail(`storyboard.assets[${i}].id`, 'id simples e único.');
    if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) fail(`storyboard.assets[${i}].sha256`, 'sha256 (64 hex minúsculos) do arquivo registrado.');
    assetIds.add(asset.id);
    return {id: asset.id, kind: oneOf(asset.kind, ['image', 'video'], `storyboard.assets[${i}].kind`), sha256: asset.sha256, role: oneOf(asset.role, ['screenshot', 'broll', 'photo', 'logo', 'diagram'], `storyboard.assets[${i}].role`, 'photo'), ...(asset.label !== undefined ? {label: text(asset.label, STORYBOARD_LIMITS.maxLabel, `storyboard.assets[${i}].label`)} : {})};
  });
  const kindOf = Object.fromEntries(assets.map((asset) => [asset.id, asset.kind]));
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > STORYBOARD_LIMITS.maxScenes) fail('storyboard.scenes', `1..${STORYBOARD_LIMITS.maxScenes} cenas.`);
  const sceneIds = new Set();
  let previousEnd = 0, total = 0;
  const scenes = raw.scenes.map((scene, i) => {
    const value = validateScene(scene, i, assetIds, outputDuration);
    if (sceneIds.has(value.id)) fail(`scenes[${i}].id`, 'id de cena repetido.');
    sceneIds.add(value.id);
    if (value.start < previousEnd - 0.001) fail(`scenes[${i}].start`, 'cenas em ordem e sem sobreposição.');
    previousEnd = value.end;
    total += value.layers.length;
    for (const layer of value.layers) if ((layer.type === 'image' || layer.type === 'video') && kindOf[layer.assetId] !== layer.type) fail(`scenes[${i}].layers.${layer.id}`, `asset "${layer.assetId}" não é ${layer.type}.`);
    return value;
  });
  if (total > STORYBOARD_LIMITS.maxLayers) fail('storyboard.scenes', `até ${STORYBOARD_LIMITS.maxLayers} camadas no total.`);
  const rawSfx = raw.sfx ?? [];
  if (!Array.isArray(rawSfx) || rawSfx.length > STORYBOARD_LIMITS.maxSfx) fail('storyboard.sfx', 'lista de efeitos sonoros.');
  const sfx = rawSfx.map((item, i) => { keys(item, ['kind', 'at', 'gainDb'], `storyboard.sfx[${i}]`); return {kind: oneOf(item.kind, sfxKinds, `storyboard.sfx[${i}].kind`), at: round3(num(item.at, 0, outputDuration, `storyboard.sfx[${i}].at`)), gainDb: Math.round(num(item.gainDb, STORYBOARD_LIMITS.minGainDb, STORYBOARD_LIMITS.maxGainDb, `storyboard.sfx[${i}].gainDb`, -20) * 10) / 10}; }).sort((a, b) => a.at - b.at);
  // SFX discretos: espaçamento mínimo e teto por minuto (nada de spam a cada frase).
  for (let i = 1; i < sfx.length; i++) if (sfx[i].at - sfx[i - 1].at < STORYBOARD_LIMITS.sfxMinGap) fail(`storyboard.sfx[${i}]`, `efeitos a pelo menos ${STORYBOARD_LIMITS.sfxMinGap}s um do outro.`);
  if (sfx.length > Math.max(2, Math.ceil(outputDuration / 60 * STORYBOARD_LIMITS.sfxPerMinute))) fail('storyboard.sfx', `no máximo ${STORYBOARD_LIMITS.sfxPerMinute} efeitos por minuto.`);
  return {version: STORYBOARD_VERSION, ...(raw.title !== undefined ? {title: text(raw.title, STORYBOARD_LIMITS.maxText, 'storyboard.title')} : {}), timeline: {basis: 'output', ...(timeline.segmentsHash ? {segmentsHash: timeline.segmentsHash} : {})}, style, assets, scenes, sfx,
    ...(raw.notes !== undefined ? {notes: text(raw.notes, 400, 'storyboard.notes')} : {})};
}

// ---------------------------------------------------------------- fatos (fala/briefing)

const norm = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (value) => norm(value).replace(/[^a-z0-9%$]+/g, ' ').split(/\s+/).filter(Boolean);
const NUMBER_WORDS = {zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quinhentos: 500, mil: 1000};
/** Números presentes num texto: algarismos (1.5, 1,5, 90%) e numerais por extenso simples em português ("noventa por cento"). */
export function numbersIn(value) {
  const found = new Set();
  // pt-BR: "1.127" = mil cento e vinte e sete (separador de milhar); "1,5" = decimal.
  for (const match of norm(value).matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const raw = match[0];
    found.add(/^\d{1,3}(?:\.\d{3})+/.test(raw) ? Number(raw.replace(/\./g, '').replace(',', '.')) : Number(raw.replace(',', '.')));
  }
  // Numerais por extenso, frase a frase (pontuação encerra o número); "por cento" é unidade, não 100.
  for (const sentence of norm(value).split(/[.;:!?\n]+/)) {
    const words = tokens(sentence);
    let acc = null;
    words.forEach((word, i) => {
      const unit = word === 'cento' && words[i - 1] === 'por';
      if (word in NUMBER_WORDS && !unit) { const n = NUMBER_WORDS[word]; acc = n === 1000 ? (acc !== null && acc < 1000 ? acc : 1) * 1000 : (acc ?? 0) + n; return; }
      if (word === 'e' && acc !== null) return;
      if (acc !== null) { found.add(acc); acc = null; }
    });
    if (acc !== null) found.add(acc);
  }
  return [...found];
}
const layerFactText = (layer) => {
  switch (layer.type) {
    case 'text': case 'callout': case 'chapter': return [layer.text];
    case 'counter': return [String(layer.value), layer.label ?? ''];
    case 'steps': return layer.items;
    case 'process': return layer.nodes;
    case 'compare': return [layer.before.label, layer.before.text, layer.after.label, layer.after.text];
    case 'bars': return layer.values.flatMap((item) => [item.label, String(item.value)]);
    case 'image': case 'video': return [layer.caption ?? ''];
    default: return [];
  }
};

/**
 * Prova de fatos: todo número exibido precisa existir na fonte declarada (fala = transcrição; brief = briefing do
 * usuário); citações precisam aparecer literalmente (tokens em sequência). 'design' (rótulos estruturais) não pode
 * trazer números além do índice de capítulo. 'user' é HOST-OWNED: o texto exibido precisa estar em `userTexts`
 * (o que o usuário digitou na UI, fornecido pelo host) — o modelo não consegue se declarar "usuário" para fugir da prova.
 */
export function storyboardFactProblems(storyboard, {transcriptText = '', briefText = '', userTexts = []} = {}) {
  const problems = [];
  const sources = {speech: transcriptText, brief: briefText};
  const sourceNumbers = {speech: new Set(numbersIn(transcriptText)), brief: new Set(numbersIn(briefText))};
  const containsSeq = (haystack, needle) => { const h = tokens(haystack).join(' '), n = tokens(needle).join(' '); return Boolean(n) && ` ${h} `.includes(` ${n} `); };
  for (const scene of storyboard.scenes) for (const layer of scene.layers) {
    const at = `${scene.id}/${layer.id}`, shown = layerFactText(layer).join(' ');
    const shownNumbers = layer.type === 'chapter' ? numbersIn(layer.text) : numbersIn(shown);
    if (layer.source === 'design' && shownNumbers.length) problems.push({id: at, reason: 'números exibidos precisam de fonte speech/brief/user, não design.'});
    if (layer.source === 'speech' || layer.source === 'brief') {
      const source = sources[layer.source];
      if (!source.trim()) { problems.push({id: at, reason: `fonte ${layer.source} indisponível para conferir.`}); continue; }
      for (const n of shownNumbers) if (!sourceNumbers[layer.source].has(n)) problems.push({id: at, reason: `número ${n} não aparece na ${layer.source === 'speech' ? 'fala' : 'briefing'}.`});
      if (layer.quote && !containsSeq(source, layer.quote)) problems.push({id: at, reason: 'citação não aparece literalmente na fonte.'});
    }
    if (layer.source === 'user') {
      const parts = layerFactText(layer).filter((part) => String(part).trim());
      if (!parts.every((part) => userTexts.some((typed) => containsSeq(typed, part)))) problems.push({id: at, reason: 'conteúdo "user" precisa ter sido digitado pelo usuário (host userTexts).'});
    }
  }
  return problems;
}

// ---------------------------------------------------------------- geometria (compartilhada por render, prévia e QA)

export const shapeOf = (width, height) => (height > width * 1.15 ? 'portrait' : width > height * 1.15 ? 'landscape' : 'square');
/** Área segura: laterais 6%, topo 8% (11% no vertical), base 10% (20% no vertical, interface das redes). */
export const safeArea = (width, height) => {
  const portrait = shapeOf(width, height) === 'portrait';
  return {left: width * 0.06, right: width * 0.94, top: height * (portrait ? 0.11 : 0.08), bottom: height * (portrait ? 0.8 : 0.9)};
};
const rectToBox = (rect) => ({left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h});
const boxToRect = (box) => ({x: box.left, y: box.top, w: Math.max(0, box.right - box.left), h: Math.max(0, box.bottom - box.top)});
/** Tira de uma caixa a faixa protegida (legenda queimada), ficando com a maior parte acima/abaixo. */
export const avoidBand = (box, height, protect) => {
  const band = protect?.captionBand;
  if (!band) return box;
  const top = band.top * height - height * 0.015, bottom = band.bottom * height + height * 0.015;
  if (box.bottom <= top || box.top >= bottom) return box;
  const above = {...box, bottom: Math.min(box.bottom, top)}, below = {...box, top: Math.max(box.top, bottom)};
  return above.bottom - above.top >= below.bottom - below.top ? above : below;
};

/** Retângulo da câmera por layout. Vertical: split sempre com câmera em cima; pip no canto superior direito. */
export const cameraRect = (layout, width, height, protect) => {
  const shape = shapeOf(width, height), full = {x: 0, y: 0, w: width, h: height};
  if (layout === 'full' || layout === 'hidden') return full;
  if (layout === 'pip') {
    const safe = safeArea(width, height), w = width * (shape === 'landscape' ? 0.27 : shape === 'portrait' ? 0.36 : 0.36), h = w * height / width;
    // Sempre no canto SUPERIOR direito: embaixo ficaria sob a faixa da legenda queimada e a interface das redes.
    return {x: safe.right - w, y: safe.top, w, h};
  }
  if (shape === 'landscape' && layout === 'split-left') return {x: 0, y: 0, w: width / 2, h: height};
  if (shape === 'landscape' && layout === 'split-right') return {x: width / 2, y: 0, w: width / 2, h: height};
  const band = protect?.captionBand;
  // Vertical/quadrado (ou split-top): câmera em cima; encolhe até 36% se a legenda deixaria o painel < 22% da altura.
  let h = height * (shape === 'landscape' ? 0.5 : 0.46);
  if (band) h = Math.max(height * 0.36, Math.min(h, band.top * height - height * 0.015 - height * 0.22));
  return {x: 0, y: 0, w: width, h};
};

/**
 * Caixa da gravação de TELA (par câmera+tela). `full`: o quadro todo. `with-camera`: o espaço que a câmera no canto (pip) deixa
 * livre — à esquerda dela no horizontal, abaixo no vertical —, para a câmera nunca cobrir a interface real. A tela é sempre
 * desenhada "contain" dentro desta caixa (aspecto preservado, sem corte nem distorção).
 */
export const screenBox = (mode, width, height, protect) => {
  if (mode !== 'with-camera') return {x: 0, y: 0, w: width, h: height};
  const cam = cameraRect('pip', width, height, protect), margin = Math.min(width, height) * 0.03;
  if (shapeOf(width, height) === 'landscape') return {x: margin, y: margin, w: Math.max(2, cam.x - 2 * margin), h: height - 2 * margin};
  const top = cam.y + cam.h + margin;
  return {x: margin, y: top, w: width - 2 * margin, h: Math.max(2, height - top - margin)};
};
/** Retângulo "contain" de um vídeo w×h dentro de uma caixa (centralizado). */
export const containRect = (box, w, h) => {
  const scale = Math.min(box.w / w, box.h / h), cw = w * scale, ch = h * scale;
  return {x: box.x + (box.w - cw) / 2, y: box.y + (box.h - ch) / 2, w: cw, h: ch};
};

/** Painel livre para gráficos: complemento da câmera, dentro da área segura e fora da faixa da legenda. */
export const panelBox = (layout, width, height, protect) => {
  const safe = safeArea(width, height), cam = cameraRect(layout, width, height, protect), shape = shapeOf(width, height);
  let box = {left: safe.left, top: safe.top, right: safe.right, bottom: safe.bottom};
  if (layout === 'split-left' && shape === 'landscape') box.left = Math.max(box.left, cam.x + cam.w + width * 0.04);
  else if (layout === 'split-right' && shape === 'landscape') box.right = Math.min(box.right, cam.x - width * 0.04);
  else if (layout.startsWith('split')) box.top = Math.max(box.top, cam.y + cam.h + height * 0.03);
  else if (layout === 'pip') { if (shape === 'landscape') box.right = Math.min(box.right, cam.x - width * 0.03); else box.top = Math.max(box.top, cam.y + cam.h + height * 0.03); }
  return avoidBand(box, height, protect);
};

/** Caixa de uma camada (px) a partir do slot nomeado ou da caixa livre (frações). Determinística. */
export const slotBox = (placement, layout, width, height, protect) => {
  if (placement.box) return rectToBox({x: placement.box.x * width, y: placement.box.y * height, w: placement.box.w * width, h: placement.box.h * height});
  const safe = avoidBand(safeArea(width, height), height, protect), panel = panelBox(layout, width, height, protect);
  const base = layout === 'full' || layout === 'hidden' ? safe : panel;
  const h = base.bottom - base.top, w = base.right - base.left;
  switch (placement.slot) {
    case 'full': return {...safe};
    case 'panel': return {...base};
    case 'panel-top': return {...base, bottom: base.top + h * 0.48};
    case 'panel-bottom': return {...base, top: base.top + h * 0.52};
    case 'top': return {...base, bottom: base.top + h * 0.3};
    case 'bottom': return {...base, top: base.bottom - h * 0.3};
    case 'left': return {...base, right: base.left + w * 0.48};
    case 'right': return {...base, left: base.right - w * 0.48};
    case 'top-left': return {left: base.left, top: base.top, right: base.left + w * 0.48, bottom: base.top + h * 0.3};
    case 'top-right': return {left: base.right - w * 0.48, top: base.top, right: base.right, bottom: base.top + h * 0.3};
    default: return {left: base.left, right: base.right, top: base.top + h * 0.3, bottom: base.bottom - h * 0.3};
  }
};

/** Quebra gulosa estimada (largura média por caractere da fonte) → linhas. A mesma estimativa serve à QA. */
export const wrapLines = (value, size, boxWidth, charWidth) => {
  const words = String(value).split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && [...next].length * size * charWidth > boxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

/**
 * Corpo do texto que cabe na caixa: parte do tamanho do papel e reduz em passos de 8% até caber (altura e linhas),
 * nunca abaixo do mínimo legível — se nem assim couber, a QA acusa `textOverflow`.
 */
export const fitText = (value, role, sizeKey, box, width, height, treatment, {maxLines = 4, display = true} = {}) => {
  const t = TREATMENTS[treatment] ?? TREATMENTS.creator, unit = Math.min(width, height) / 100, portrait = shapeOf(width, height) === 'portrait';
  const shown = t.upper && display && (role === 'headline' || role === 'title') ? String(value).toUpperCase() : String(value);
  const charWidth = (display ? t.charWidth : 0.52) * (shown === String(value).toUpperCase() && /[a-z]/i.test(shown) ? 1.12 : 1);
  let size = unit * ROLE_SIZES[role] * (SIZE_SCALE[sizeKey] ?? 1) * (portrait ? 1.1 : 1);
  const bw = box.right - box.left, bh = box.bottom - box.top, lineHeight = role === 'body' || role === 'caption' ? 1.28 : 1.1;
  let lines = wrapLines(shown, size, bw, charWidth);
  const fits = () => lines.length <= maxLines && lines.length * size * lineHeight <= bh && lines.every((line) => [...line].length * size * charWidth <= bw * 1.02);
  while (!fits() && size > unit * MIN_READABLE_UNITS) { size = Math.max(unit * MIN_READABLE_UNITS, size * 0.92); lines = wrapLines(shown, size, bw, charWidth); }
  return {size: round3(size), lines, lineHeight, overflow: !fits(), text: shown, units: round3(size / unit)};
};

// ---------------------------------------------------------------- props por frame

const toFrames = (seconds, fps) => Math.round(seconds * fps);

/**
 * Converte o storyboard normalizado em props por frame (cenas e camadas com frames absolutos; keyframes/revelações em
 * frames relativos à camada). O que sai daqui é EXATAMENTE o que a composição renderiza (prévia e MP4).
 */
export function resolveStoryboardProps(storyboard, {fps, durationSeconds, protect} = {}) {
  if (!finite(fps) || fps <= 0 || !finite(durationSeconds) || durationSeconds <= 0) fail('storyboard', 'fps/duração inválidos.');
  const sb = validateStoryboard(storyboard, {outputDuration: durationSeconds});
  const total = Math.max(1, Math.round(durationSeconds * fps));
  const t = TREATMENTS[sb.style.treatment];
  const palette = {...t.palette, ...(sb.style.accent ? {accent: sb.style.accent} : {}), ...(sb.style.accent2 ? {accent2: sb.style.accent2} : {})};
  const kf = (map) => (map ? Object.fromEntries(Object.entries(map).map(([prop, list]) => [prop, list.map((item) => ({...item, f: toFrames(item.t, fps)}))])) : undefined);
  const dropped = [];
  const scenes = [];
  for (const scene of sb.scenes) {
    const startFrame = clamp(toFrames(scene.start, fps), 0, total - 1), endFrame = clamp(toFrames(scene.end, fps), startFrame + 1, total);
    const length = endFrame - startFrame;
    const layers = [];
    for (const layer of scene.layers) {
      const from = clamp(toFrames(layer.start, fps), 0, length - 1), to = clamp(toFrames(layer.end, fps), from + 1, length);
      if (to - from < 2) { dropped.push({id: `${scene.id}/${layer.id}`, reason: 'camada some ao arredondar para frames.'}); continue; }
      const out = {...layer, fromFrame: startFrame + from, toFrame: startFrame + to};
      delete out.start; delete out.end;
      if (layer.keyframes) out.keyframes = kf(layer.keyframes);
      if (layer.reveal) out.revealFrames = layer.reveal.map((s) => clamp(toFrames(s, fps), 0, to - from - 1));
      delete out.reveal;
      if (layer.enter) out.enter = {...layer.enter, frames: Math.max(1, toFrames(layer.enter.seconds ?? 0.45, fps))};
      if (layer.exit) out.exit = {...layer.exit, frames: Math.max(1, toFrames(layer.exit.seconds ?? 0.3, fps))};
      if (layer.mask) out.mask = {...layer.mask, frames: Math.max(1, toFrames(layer.mask.seconds, fps))};
      layers.push(out);
    }
    scenes.push({id: scene.id, ...(scene.name ? {name: scene.name} : {}), startFrame, endFrame, camera: {...scene.camera, ...(scene.camera.zoom ? {zoom: scene.camera.zoom.map((item) => ({...item, f: toFrames(item.t, fps)}))} : {})}, ...(scene.screen ? {screen: scene.screen} : {}),
      background: scene.background, ...(scene.transitionIn ? {transitionIn: {...scene.transitionIn, frames: toFrames(scene.transitionIn.seconds, fps)}} : {}), layers});
  }
  // Câmera: cena colada à anterior (≤ 1 frame) herda o layout de partida; senão entra a partir da câmera cheia.
  for (let i = 0; i < scenes.length; i++) {
    const prev = scenes[i - 1], next = scenes[i + 1];
    scenes[i].cameraFrom = prev && scenes[i].startFrame - prev.endFrame <= 1 ? prev.camera.layout : 'full';
    scenes[i].cameraJoinedOut = Boolean(next && next.startFrame - scenes[i].endFrame <= 1);
  }
  const sfx = sb.sfx.filter((item) => item.at < durationSeconds).map((item) => ({kind: item.kind, at: item.at, gainDb: item.gainDb}));
  return {version: sb.version, treatment: sb.style.treatment, palette, fonts: {display: t.display, body: t.body, displayWeight: t.displayWeight, upper: t.upper, charWidth: t.charWidth, radius: t.radius, stroke: t.stroke},
    defaults: {enter: t.enter, exit: t.exit, transition: t.transition, ease: t.ease}, assets: sb.assets, scenes, sfx, ...(protect?.captionBand ? {protect: {captionBand: {...protect.captionBand}}} : {}), dropped};
}

/**
 * Par câmera+tela: modo de tela efetivo de cada cena resolvida (`scene.screen` ou o padrão do par) e o layout de câmera
 * correspondente (with-camera -> pip, full -> hidden), recalculando a herança de câmera entre cenas coladas. Mesma regra no
 * render, na QA e na prova do ajuste localizado.
 */
export function applyScreenModes(props, mode) {
  const layoutOf = (value) => (value === 'with-camera' ? 'pip' : value === 'full' ? 'hidden' : null);
  for (const scene of props.scenes) { scene.screenMode = scene.screen ?? mode; const layout = layoutOf(scene.screenMode); if (layout) scene.camera = {...scene.camera, layout}; }
  const scenes = props.scenes;
  for (let i = 0; i < scenes.length; i++) {
    const prev = scenes[i - 1], next = scenes[i + 1];
    scenes[i].cameraFrom = prev && scenes[i].startFrame - prev.endFrame <= 1 ? prev.camera.layout : 'full';
    scenes[i].cameraJoinedOut = Boolean(next && next.startFrame - scenes[i].endFrame <= 1);
  }
  return props;
}

// ---------------------------------------------------------------- QA e manifesto

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex) => { const [r, g, b] = hexRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Contraste WCAG entre duas cores #RRGGBB. */
export const contrastRatio = (a, b) => { const x = luminance(a), y = luminance(b); return round3((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)); };
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const area = (a) => Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top);
const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** Cor do texto de uma camada (token): a pedida, ou tinta sobre fundo de destaque, senão `text`. Render e QA usam a MESMA regra. */
export const textColorToken = (layer) => layer.style?.color ?? (layer.style?.background === 'accent' ? 'ink' : 'text');
const TEXTUAL = new Set(['text', 'counter', 'steps', 'process', 'compare', 'bars', 'callout', 'chapter']);
/** Fundo efetivo sob uma camada: superfície pedida, painel do layout ou a própria câmera (sem cor conhecida). */
const backdropOf = (layer, scene, palette, overCamera) => {
  const bg = layer.style?.background;
  if (bg && bg !== 'none' && bg !== 'scrim') return palette[bg];
  if (bg === 'scrim') return palette.ink;
  if (!overCamera) return palette[scene.background.tone] ?? palette.bg;
  return null;
};

/**
 * QA geométrica/temporal das props resolvidas: área segura, faixa da legenda, sobreposição de textos simultâneos,
 * corpo mínimo legível, contraste, rosto/foco coberto, tempo de leitura e cortes de transição. Erros bloqueiam o export;
 * avisos vão para o relatório.
 */
export function storyboardQa(props, {width, height, fps, cutsAt = [], focus = {x: 0.5, y: 0.38}} = {}) {
  const errors = [], warnings = [], checks = {layers: 0, textLayers: 0, minTextUnits: null, minContrast: null, scenes: props.scenes.length};
  const safe = safeArea(width, height), band = props.protect?.captionBand, unit = Math.min(width, height) / 100;
  const bandBox = band ? {left: 0, right: width, top: band.top * height, bottom: band.bottom * height} : null;
  const placed = [];
  // Parte pedida que não chegou ao render (ex.: camada curta demais ao arredondar) reprova: nada some calado.
  for (const item of props.dropped ?? []) errors.push({id: item.id, code: 'droppedLayer', detail: item.reason});
  for (const scene of props.scenes) {
    const layout = scene.camera.layout, cam = rectToBox(cameraRect(layout, width, height, props.protect));
    const camFocus = scene.camera.focus ?? focus, face = layout === 'hidden' ? null : {left: cam.left + (cam.right - cam.left) * camFocus.x - unit * 13, right: cam.left + (cam.right - cam.left) * camFocus.x + unit * 13, top: cam.top + (cam.bottom - cam.top) * camFocus.y - unit * 16, bottom: cam.top + (cam.bottom - cam.top) * camFocus.y + unit * 16};
    for (const cut of cutsAt) {
      const f = Math.round(cut * fps), tr = scene.transitionIn;
      if (tr && tr.kind !== 'cut' && f > scene.startFrame && f < scene.startFrame + tr.frames) warnings.push({id: scene.id, code: 'transitionAcrossCut', detail: `corte do vídeo em ${cut}s cai dentro da transição.`});
    }
    for (const layer of scene.layers) {
      checks.layers++;
      const id = `${scene.id}/${layer.id}`, b = slotBox(layer, layout, width, height, props.protect);
      const overCamera = layout !== 'hidden' && intersects(b, cam) && layout === 'full';
      if (layer.type !== 'spotlight' && layer.type !== 'arrow') {
        if (b.left < safe.left - 1 || b.right > safe.right + 1 || b.top < safe.top - 1 || b.bottom > safe.bottom + 1) (TEXTUAL.has(layer.type) ? errors : warnings).push({id, code: 'outsideSafeArea'});
        if (bandBox && TEXTUAL.has(layer.type) && intersects(b, bandBox)) errors.push({id, code: 'captionBandOverlap'});
      }
      if (TEXTUAL.has(layer.type)) {
        checks.textLayers++;
        placed.push({id, box: b, from: layer.fromFrame, to: layer.toFrame});
        if (face && layout !== 'full' && overlapArea(b, face) > area(face) * 0.25) warnings.push({id, code: 'coversFocus'});
        if (face && layout === 'full' && overlapArea(b, face) > area(face) * 0.4) warnings.push({id, code: 'coversFocus'});
        const label = layer.type === 'text' || layer.type === 'callout' ? layer.text : layer.type === 'chapter' ? layer.text : null;
        if (label) {
          // Mesmos parâmetros do render: capítulo = título em 1 linha ao lado do número; callout = corpo.
          const fit = layer.type === 'chapter' ? fitText(label, 'title', layer.style?.size, {...b, left: b.left + unit * 17}, width, height, props.treatment, {maxLines: 1})
            : fitText(label, layer.type === 'text' ? layer.role : 'label', layer.style?.size, b, width, height, props.treatment, {display: layer.type !== 'callout'});
          checks.minTextUnits = checks.minTextUnits === null ? fit.units : Math.min(checks.minTextUnits, fit.units);
          if (fit.overflow) errors.push({id, code: 'textOverflow', detail: `"${label}" não cabe na caixa nem no corpo mínimo.`});
          const words = label.split(/\s+/).length, seconds = (layer.toFrame - layer.fromFrame) / fps;
          if (seconds < 0.5 + words * 0.18) warnings.push({id, code: 'tooShortToRead', detail: `${words} palavras em ${round3(seconds)}s.`});
        }
        const color = props.palette[textColorToken(layer)], backdrop = backdropOf(layer, scene, props.palette, overCamera);
        if (backdrop) {
          const ratio = contrastRatio(color, backdrop);
          checks.minContrast = checks.minContrast === null ? ratio : Math.min(checks.minContrast, ratio);
          if (ratio < 4.5) (ratio < 3 ? errors : warnings).push({id, code: 'lowContrast', detail: `contraste ${ratio}:1.`});
        } else warnings.push({id, code: 'textOverCamera', detail: 'texto direto sobre a câmera: renderizado com sombra; prefira style.background "scrim".'});
      }
    }
  }
  // Textos simultâneos que se sobrepõem no quadro.
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.from < b.to && b.from < a.to && overlapArea(a.box, b.box) > Math.min(area(a.box), area(b.box)) * 0.15) errors.push({id: `${a.id}+${b.id}`, code: 'textOverlap'});
  }
  for (let f = 0; f < (props.scenes.at(-1)?.endFrame ?? 0); f += Math.max(1, Math.round(fps / 2))) {
    const active = placed.filter((item) => item.from <= f && item.to > f).length;
    if (active > STORYBOARD_LIMITS.maxSimultaneousText) { warnings.push({id: `frame-${f}`, code: 'crowded', detail: `${active} blocos de texto ao mesmo tempo.`}); break; }
  }
  return {ok: errors.length === 0, errors, warnings, checks};
}

/** Frames de inspeção por cena: entrada (fim da transição/entrada), meio e saída — base do contact sheet. */
export function qaFrames(props, {perScene = 3} = {}) {
  const list = [];
  for (const scene of props.scenes) {
    // "Entrada" = logo após a transição e a entrada das primeiras camadas (~0,8 s a 30 fps), não no meio da animação.
    const length = scene.endFrame - scene.startFrame, firstLayer = Math.min(...scene.layers.map((layer) => layer.fromFrame - scene.startFrame), length), enter = Math.min(length - 1, Math.max(scene.transitionIn?.frames ?? 0, firstLayer + 24));
    const picks = perScene <= 1 ? [Math.floor(length / 2)] : [enter, Math.floor(length / 2), Math.max(0, length - 6)];
    for (const [i, offset] of picks.entries()) list.push({sceneId: scene.id, moment: perScene <= 1 ? 'mid' : ['entrada', 'meio', 'saida'][i], frame: scene.startFrame + offset});
  }
  return list.filter((item, i, all) => all.findIndex((other) => other.frame === item.frame) === i);
}

const EFFECTS_OF = (layer, defaults) => {
  const list = [`enter:${layer.enter?.preset ?? defaults.enter}`, `exit:${layer.exit?.preset ?? defaults.exit}`];
  if (layer.mask) list.push(`mask:${layer.mask.kind}`);
  if (layer.keyframes) list.push(...Object.keys(layer.keyframes).map((prop) => `keyframes:${prop}(${layer.keyframes[prop].length})`));
  if (layer.type === 'text') list.push(`kinetic:${layer.mode}`, ...(layer.highlight ? [`emphasis:${layer.emphasis ?? 'marker'}`] : []));
  if (layer.type === 'image' && layer.kenBurns) list.push('kenBurns');
  if (layer.revealFrames) list.push(`reveal:${layer.revealFrames.length}`);
  return list;
};

/**
 * Manifesto do que FOI aplicado (das props resolvidas que a composição renderiza), não da intenção: cenas, câmera,
 * transições, camadas com efeitos, fontes de cada fato, assets usados, SFX e o que foi descartado e por quê.
 */
export function storyboardManifest(props, {fps, qa, assetsVerified} = {}) {
  const seconds = (f) => round3(f / fps);
  return {
    engine: 'remotion-storyboard', version: props.version, treatment: props.treatment,
    scenes: props.scenes.map((scene) => ({id: scene.id, ...(scene.name ? {name: scene.name} : {}), start: seconds(scene.startFrame), end: seconds(scene.endFrame), camera: {layout: scene.camera.layout, from: scene.cameraFrom, zoomKeyframes: scene.camera.zoom?.length ?? 0},
      transition: scene.transitionIn ? `${scene.transitionIn.kind}${scene.transitionIn.kind === 'cut' ? '' : ` ${scene.transitionIn.seconds}s`}` : 'none', background: scene.background.kind,
      layers: scene.layers.map((layer) => ({id: layer.id, type: layer.type, start: seconds(layer.fromFrame), end: seconds(layer.toFrame), placement: layer.box ? 'box' : layer.slot, source: layer.source, effects: EFFECTS_OF(layer, props.defaults), ...(layer.assetId ? {assetId: layer.assetId} : {})}))})),
    assets: props.assets.map((asset) => ({id: asset.id, kind: asset.kind, role: asset.role, sha256: asset.sha256, verified: assetsVerified ? assetsVerified.includes(asset.id) : null})),
    sfx: props.sfx, dropped: props.dropped, ...(qa ? {qa: {ok: qa.ok, errors: qa.errors, warnings: qa.warnings, checks: qa.checks}} : {}),
    counts: {scenes: props.scenes.length, layers: props.scenes.reduce((sum, scene) => sum + scene.layers.length, 0), transitions: props.scenes.filter((scene) => scene.transitionIn && scene.transitionIn.kind !== 'cut').length, sfx: props.sfx.length}
  };
}

/** Resumo curto para chat/UI. */
export function describeStoryboard(storyboard) {
  const layers = storyboard.scenes.flatMap((scene) => scene.layers);
  const types = [...new Set(layers.map((layer) => layer.type))];
  return `${storyboard.scenes.length} cenas (${TREATMENTS[storyboard.style.treatment].label}), ${layers.length} camadas: ${types.join(', ')}; ${storyboard.sfx.length} SFX.`;
}

// ---------------------------------------------------------------- JSON Schema (draft-07) para ferramentas do editor

/**
 * JSON Schema draft-07 do storyboard (para structured output / ferramenta write_plan do Claude). É um guia de forma:
 * a autoridade continua sendo validateStoryboard (limites de tempo, ids, hashes, fatos) — o schema nunca basta sozinho.
 */
export function storyboardJsonSchema() {
  const str = (max) => ({type: 'string', minLength: 1, maxLength: max});
  const id = {type: 'string', pattern: '^[a-zA-Z0-9_-]{1,40}$'};
  const enumOf = (list) => ({type: 'string', enum: [...list]});
  const ref = (name) => ({$ref: `#/definitions/${name}`});
  const easeDef = {oneOf: [enumOf(easings.filter((item) => item !== 'bezier')), {type: 'object', additionalProperties: false, required: ['bezier'], properties: {bezier: {type: 'array', minItems: 4, maxItems: 4, items: {type: 'number'}}}}]};
  const keyframeList = (min, max) => ({type: 'array', minItems: 1, maxItems: STORYBOARD_LIMITS.maxKeyframes, items: {type: 'object', additionalProperties: false, required: ['t', 'v'], properties: {t: {type: 'number', minimum: 0, description: 'segundos desde o início da camada/cena'}, v: {type: 'number', minimum: min, maximum: max}, ease: ref('ease')}}});
  const point = {type: 'object', additionalProperties: false, required: ['x', 'y'], properties: {x: {type: 'number', minimum: 0, maximum: 1}, y: {type: 'number', minimum: 0, maximum: 1}}};
  const box01 = {type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: {x: {type: 'number', minimum: 0, maximum: 1}, y: {type: 'number', minimum: 0, maximum: 1}, w: {type: 'number', minimum: 0.04, maximum: 1}, h: {type: 'number', minimum: 0.03, maximum: 1}}};
  const preset = (list) => ({oneOf: [enumOf(list), {type: 'object', additionalProperties: false, required: ['preset'], properties: {preset: enumOf(list), seconds: {type: 'number', minimum: 0.05, maximum: 3}, ease: ref('ease')}}]});
  const itemList = (max) => ({type: 'array', minItems: 2, maxItems: max, items: str(STORYBOARD_LIMITS.maxItem)});
  const reveal = {type: 'array', items: {type: 'number', minimum: 0}, description: 'segundos (relativos à camada) em que cada item foi dito'};
  const common = {
    id, start: {type: 'number', minimum: 0, description: 'segundos desde o início da CENA'}, end: {type: 'number', minimum: 0}, slot: enumOf(slots), box: box01, z: {type: 'integer', minimum: -10, maximum: 10},
    enter: ref('enter'), exit: ref('exit'), keyframes: ref('keyframes'),
    mask: ref('mask'), style: ref('style'),
    source: {...enumOf(factSources), description: 'speech = transcrição; brief = briefing; user = só texto que o host confirma como digitado pelo usuário; design = rótulo sem números'}, quote: str(STORYBOARD_LIMITS.maxQuote)
  };
  const side = {type: 'object', additionalProperties: false, required: ['label', 'text'], properties: {label: str(STORYBOARD_LIMITS.maxLabel), text: str(STORYBOARD_LIMITS.maxItem)}};
  const kb = {type: 'object', additionalProperties: false, required: ['scale'], properties: {scale: {type: 'number', minimum: 1, maximum: 2.5}, x: {type: 'number', minimum: 0, maximum: 1}, y: {type: 'number', minimum: 0, maximum: 1}}};
  const specific = {
    text: {required: ['text'], properties: {text: str(STORYBOARD_LIMITS.maxText), role: enumOf(textRoles), mode: enumOf(textModes), emphasis: enumOf(emphasisKinds), highlight: {type: 'array', minItems: 1, maxItems: 3, items: str(STORYBOARD_LIMITS.maxItem)}, align: enumOf(['left', 'center', 'right'])}},
    counter: {required: ['value'], properties: {value: {type: 'number'}, from: {type: 'number'}, unit: enumOf(statUnits), label: str(STORYBOARD_LIMITS.maxText), decimals: {type: 'integer', minimum: 0, maximum: 2}}},
    steps: {required: ['items'], properties: {items: itemList(STORYBOARD_LIMITS.maxItems), reveal}},
    process: {required: ['nodes'], properties: {nodes: itemList(5), reveal}},
    compare: {required: ['before', 'after'], properties: {before: side, after: side, reveal}},
    bars: {required: ['values'], properties: {values: {type: 'array', minItems: 2, maxItems: 5, items: {type: 'object', additionalProperties: false, required: ['label', 'value'], properties: {label: str(STORYBOARD_LIMITS.maxLabel), value: {type: 'number', minimum: 0}, unit: enumOf(statUnits)}}}, reveal}},
    image: {required: ['assetId'], properties: {assetId: id, fit: enumOf(['cover', 'contain']), frame: enumOf(imageFrames), caption: str(STORYBOARD_LIMITS.maxText), kenBurns: {type: 'object', additionalProperties: false, required: ['from', 'to'], properties: {from: kb, to: kb}}}},
    video: {required: ['assetId'], properties: {assetId: id, fit: enumOf(['cover', 'contain']), frame: enumOf(imageFrames), caption: str(STORYBOARD_LIMITS.maxText), trimStart: {type: 'number', minimum: 0}}},
    shape: {required: ['shape'], properties: {shape: enumOf(shapeKinds), fill: enumOf([...colorTokens, 'none']), stroke: enumOf([...colorTokens, 'none'])}},
    arrow: {required: ['from', 'to'], properties: {from: point, to: point, color: enumOf(colorTokens)}},
    callout: {required: ['text', 'target'], properties: {text: str(STORYBOARD_LIMITS.maxItem), target: point}},
    chapter: {required: ['index', 'text'], properties: {index: {type: 'integer', minimum: 1, maximum: 99}, text: str(STORYBOARD_LIMITS.maxItem)}},
    spotlight: {required: ['target'], properties: {target: box01, dim: {type: 'number', minimum: 0.2, maximum: 0.9}}}
  };
  const layer = {oneOf: layerTypes.map((type) => ({type: 'object', additionalProperties: false, required: ['id', 'type', ...specific[type].required], properties: {type: {const: type}, ...common, ...specific[type].properties}}))};
  const tones = enumOf(['bg', 'surface', 'accent', 'ink']);
  const scene = {type: 'object', additionalProperties: false, required: ['id', 'start', 'end', 'layers'], properties: {
    id, name: str(STORYBOARD_LIMITS.maxLabel), start: {type: 'number', minimum: 0, description: 'segundos no vídeo EDITADO'}, end: {type: 'number', minimum: 0},
    camera: {type: 'object', additionalProperties: false, properties: {layout: enumOf(cameraLayouts), zoom: keyframeList(1, 2.5), focus: point}},
    screen: {...enumOf(sceneScreenModes), description: 'só com gravação de tela no conteúdo: off = câmera, full = tela inteira, with-camera = tela + câmera no canto'},
    background: {type: 'object', additionalProperties: false, properties: {kind: enumOf(backgroundKinds), tone: tones}},
    transitionIn: {oneOf: [enumOf(transitionKinds), {type: 'object', additionalProperties: false, required: ['kind'], properties: {kind: enumOf(transitionKinds), seconds: {type: 'number', minimum: 0.1, maximum: STORYBOARD_LIMITS.maxTransitionSeconds}, direction: enumOf(directions), ease: ref('ease')}}]},
    layers: {type: 'array', maxItems: STORYBOARD_LIMITS.maxLayersPerScene, items: layer}}};
  const hex = {type: 'string', pattern: '^#[0-9a-fA-F]{6}$'};
  return {
    $schema: 'http://json-schema.org/draft-07/schema#', $id: 'mainsagents.storyboard/1', title: 'MainsAgents authored Remotion storyboard', type: 'object', additionalProperties: false, required: ['version', 'scenes'],
    definitions: {
      ease: easeDef, enter: preset(enterPresets), exit: preset(exitPresets),
      keyframes: {type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(keyframeProps).map(([prop, [min, max]]) => [prop, keyframeList(min, max)]))},
      mask: {type: 'object', additionalProperties: false, required: ['kind'], properties: {kind: enumOf(maskKinds), seconds: {type: 'number', minimum: 0.1, maximum: 3}, ease: ref('ease')}},
      style: {type: 'object', additionalProperties: false, properties: {color: enumOf(colorTokens), size: enumOf(Object.keys(SIZE_SCALE)), weight: enumOf(['regular', 'bold', 'black']), background: enumOf(['none', 'surface', 'accent', 'ink', 'scrim']), italic: {type: 'boolean'}}}
    },
    properties: {
      version: {const: STORYBOARD_VERSION}, title: str(STORYBOARD_LIMITS.maxText), notes: str(400),
      timeline: {type: 'object', additionalProperties: false, required: ['basis'], properties: {basis: {const: 'output'}, segmentsHash: {type: 'string', pattern: '^[0-9a-f]{8}$', description: 'segmentsHash(segments) dos cortes atuais'}}},
      style: {type: 'object', additionalProperties: false, properties: {treatment: enumOf(storyboardTreatments), accent: hex, accent2: hex}},
      assets: {type: 'array', maxItems: STORYBOARD_LIMITS.maxAssets, items: {type: 'object', additionalProperties: false, required: ['id', 'kind', 'sha256'], properties: {id, kind: enumOf(['image', 'video']), sha256: {type: 'string', pattern: '^[a-f0-9]{64}$'}, role: enumOf(['screenshot', 'broll', 'photo', 'logo', 'diagram']), label: str(STORYBOARD_LIMITS.maxLabel)}}},
      scenes: {type: 'array', minItems: 1, maxItems: STORYBOARD_LIMITS.maxScenes, items: scene},
      sfx: {type: 'array', maxItems: STORYBOARD_LIMITS.maxSfx, items: {type: 'object', additionalProperties: false, required: ['kind', 'at'], properties: {kind: enumOf(sfxKinds), at: {type: 'number', minimum: 0}, gainDb: {type: 'number', minimum: STORYBOARD_LIMITS.minGainDb, maximum: STORYBOARD_LIMITS.maxGainDb}}}}
    }
  };
}

/** Cenas da revisão (timeline editada, s) para o gate de cobertura do editor: [{id, name?, start, end}]. */
export const storyboardScenes = (storyboard) => (storyboard?.scenes ?? []).map((scene) => ({id: scene.id, ...(scene.name ? {name: scene.name} : {}), start: scene.start, end: scene.end}));
