// Enquadramento da câmera para o motion: foco fixo, foco MANUAL do usuário ou trilha vinda de um detector facial.
// Âncoras na GRAVAÇÃO (como as cues): `t` é tempo do vídeo bruto e `at` (vídeo editado) é sempre recalculado a partir
// dos trechos mantidos, então cortes posteriores mantêm a sincronia. Nenhum detector facial vem instalado: a
// arquitetura aceita um detector INJETADO e, sem ele, o status diz "indisponível" em vez de fingir rastreamento.
import {spawn} from 'node:child_process';

export const DEFAULT_FOCUS = Object.freeze({x: 0.5, y: 0.38});
export const reframeModes = Object.freeze(['fixed', 'manual', 'face']);
export const reframeSources = Object.freeze(['default', 'user', 'detected']);
export const REFRAME_LIMITS = Object.freeze({maxPoints: 600, maxSampleFps: 8, maxSeconds: 1800, minBox: 0.02});

const round3 = (value) => Math.round(value * 1000) / 1000;
const round4 = (value) => Math.round(value * 10000) / 10000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------- tempo (gravação <-> editado)

const kept = (segments) => {
  let cursor = 0;
  return (segments ?? []).map((item) => { const value = {start: item.start, end: item.end, outputStart: cursor}; cursor += item.end - item.start; return value; });
};

/** Tempo da gravação -> vídeo editado; null quando o instante foi cortado. */
export function sourceToEdited(t, segments) {
  for (const item of kept(segments)) if (t >= item.start && t <= item.end) return round3(item.outputStart + t - item.start);
  return null;
}

/** Tempo do vídeo editado (ex.: posição do player na revisão) -> gravação. Usado pela UI para gravar foco manual. */
export function editedToSource(t, segments) {
  const map = kept(segments);
  for (const item of map) if (t >= item.outputStart && t <= item.outputStart + item.end - item.start) return round3(item.start + t - item.outputStart);
  return null;
}

// ---------------------------------------------------------------- validação

const POINT_KEYS = ['t', 'x', 'y', 'w', 'h', 'at'];
const DETECTOR_KEYS = ['name', 'version', 'sampledFps', 'coverage'];

/**
 * Valida o enquadramento do plano e deriva `at` (vídeo editado) de cada ponto. Pontos em trechos cortados saem;
 * `fixed` aplica o seu único ponto ao vídeo todo. `at` recebido é ignorado (sempre recalculado).
 */
export function normalizeReframe(raw, segments) {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || Object.keys(raw).some((key) => !['mode', 'source', 'points', 'detector'].includes(key))) throw new Error('Invalid reframe.');
  if (!reframeModes.includes(raw.mode) || !reframeSources.includes(raw.source)) throw new Error('Unsupported reframe mode or source.');
  const consistent = raw.mode === 'fixed' ? raw.source !== 'detected' : raw.mode === 'manual' ? raw.source === 'user' : raw.source === 'detected';
  if (!consistent) throw new Error('Reframe source does not match its mode (only a detector produces face tracks).');
  if (!Array.isArray(raw.points) || !raw.points.length || raw.points.length > REFRAME_LIMITS.maxPoints || raw.mode === 'fixed' && raw.points.length !== 1) throw new Error('Reframe needs 1 point (fixed) or up to 600 points.');
  let detector;
  if (raw.mode === 'face') {
    const d = raw.detector;
    if (!isRecord(d) || Object.keys(d).some((key) => !DETECTOR_KEYS.includes(key)) || typeof d.name !== 'string' || !/^[\w.@/-]{1,60}$/.test(d.name) || typeof d.version !== 'string' || !/^[\w.+-]{1,30}$/.test(d.version)
      || !finite(d.sampledFps) || d.sampledFps <= 0 || d.sampledFps > REFRAME_LIMITS.maxSampleFps || !finite(d.coverage) || d.coverage < 0 || d.coverage > 1) throw new Error('Face reframe must name its detector and measured coverage.');
    detector = {name: d.name, version: d.version, sampledFps: round3(d.sampledFps), coverage: round3(d.coverage)};
  } else if (raw.detector !== undefined) throw new Error('Only face reframes carry a detector.');
  const points = [];
  for (const point of raw.points) {
    if (!isRecord(point) || Object.keys(point).some((key) => !POINT_KEYS.includes(key)) || !finite(point.t) || point.t < 0 || point.t > REFRAME_LIMITS.maxSeconds
      || !finite(point.x) || !finite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error('Reframe points need t >= 0 and x,y in 0..1.');
    if ((point.w === undefined) !== (point.h === undefined) || point.w !== undefined && (!finite(point.w) || !finite(point.h) || point.w < REFRAME_LIMITS.minBox || point.h < REFRAME_LIMITS.minBox || point.w > 1 || point.h > 1)) throw new Error('Reframe box needs both w and h in 0.02..1.');
    points.push({t: round3(point.t), x: round4(point.x), y: round4(point.y), ...(point.w !== undefined ? {w: round4(point.w), h: round4(point.h)} : {})});
  }
  points.sort((a, b) => a.t - b.t);
  for (let i = 1; i < points.length; i++) if (points[i].t === points[i - 1].t) throw new Error('Reframe points need distinct times.');
  const mapped = raw.mode === 'fixed' ? [{...points[0], at: 0}] : points.map((point) => ({...point, at: sourceToEdited(point.t, segments)})).filter((point) => point.at !== null);
  return {mode: raw.mode, source: raw.source, points: mapped, ...(detector ? {detector} : {})};
}

/** Foco fixo escolhido pelo usuário (ou o padrão, rotulado `default`). */
export const fixedReframe = (focus = DEFAULT_FOCUS, source = focus === DEFAULT_FOCUS ? 'default' : 'user') => ({mode: 'fixed', source, points: [{t: 0, x: round4(clamp(focus.x, 0, 1)), y: round4(clamp(focus.y, 0, 1))}]});

/** Foco manual ajustável: pontos {t (gravação), x, y} marcados pelo usuário; a câmera interpola suavemente entre eles. */
export function manualReframe(points) {
  if (!Array.isArray(points) || !points.length) throw new Error('Manual reframe needs at least one point.');
  const clean = points.map((point) => ({t: round3(Math.max(0, Number(point.t))), x: round4(clamp(Number(point.x), 0, 1)), y: round4(clamp(Number(point.y), 0, 1)), ...(finite(point.w) && finite(point.h) ? {w: round4(clamp(point.w, 0.02, 1)), h: round4(clamp(point.h, 0.02, 1))} : {})}))
    .filter((point) => finite(point.t) && finite(point.x) && finite(point.y)).sort((a, b) => a.t - b.t);
  const unique = clean.filter((point, i) => !i || point.t !== clean[i - 1].t);
  return {mode: 'manual', source: 'user', points: unique.slice(0, REFRAME_LIMITS.maxPoints)};
}

// ---------------------------------------------------------------- trilha de rosto (detector injetado)

/**
 * Suaviza amostras de um detector ({t, box normalizado | null, score}) numa trilha estável: zona morta (o foco só se
 * move quando o rosto sai dela), velocidade máxima (fração do quadro por segundo) e retenção da última posição
 * conhecida quando o detector perde o rosto (nunca inventa movimento). Pura e determinística.
 */
export function smoothFaceSamples(samples, {minScore = 0.6, deadzone = 0.05, maxSpeed = 0.35, boxEase = 0.3, detector = {name: 'injected', version: '0', sampledFps: 4}} = {}) {
  const valid = (samples ?? []).filter((item) => finite(item?.t)).sort((a, b) => a.t - b.t);
  const hits = valid.filter((item) => item.box && item.score >= minScore && item.box.w >= REFRAME_LIMITS.minBox && item.box.h >= REFRAME_LIMITS.minBox);
  const coverage = valid.length ? round3(hits.length / valid.length) : 0;
  if (!hits.length) return {reframe: fixedReframe(), coverage, reason: valid.length ? 'Nenhum rosto detectado com confiança suficiente; foco fixo padrão.' : 'Sem amostras do detector; foco fixo padrão.'};
  let x = hits[0].box.x + hits[0].box.w / 2, y = hits[0].box.y + hits[0].box.h / 2, w = hits[0].box.w, h = hits[0].box.h, last = hits[0].t;
  const points = [{t: round3(hits[0].t), x: round4(x), y: round4(y), w: round4(w), h: round4(h)}];
  for (const item of hits.slice(1)) {
    const dt = item.t - last; last = item.t;
    const cx = item.box.x + item.box.w / 2, cy = item.box.y + item.box.h / 2, step = maxSpeed * dt;
    // Zona morta: pequenas oscilações do detector não mexem a câmera; fora dela segue com velocidade limitada.
    if (Math.abs(cx - x) > deadzone) x += clamp(cx - x - Math.sign(cx - x) * deadzone, -step, step);
    if (Math.abs(cy - y) > deadzone) y += clamp(cy - y - Math.sign(cy - y) * deadzone, -step, step);
    w += (item.box.w - w) * boxEase; h += (item.box.h - h) * boxEase;
    const prev = points[points.length - 1];
    if (Math.abs(prev.x - x) > 0.004 || Math.abs(prev.y - y) > 0.004 || Math.abs(prev.w - w) > 0.01 || Math.abs(prev.h - h) > 0.01 || item.t - prev.t >= 2) points.push({t: round3(item.t), x: round4(x), y: round4(y), w: round4(clamp(w, 0.02, 1)), h: round4(clamp(h, 0.02, 1))});
  }
  return {reframe: {mode: 'face', source: 'detected', points: points.slice(0, REFRAME_LIMITS.maxPoints), detector: {name: detector.name, version: detector.version, sampledFps: detector.sampledFps, coverage}}, coverage, reason: null};
}

/**
 * Status do detector facial. Nada é instalado ou baixado: sem um detector injetado (ex.: MediaPipe Face Detector com
 * modelo e wasm locais, aprovado pelo integrador) o resultado é `available:false` e o app oferece foco manual/fixo.
 */
export function faceDetectorStatus(detector) {
  if (detector && typeof detector.detect === 'function' && typeof detector.name === 'string') return {available: true, name: detector.name, version: String(detector.version ?? '0')};
  return {available: false, reason: 'Detecção facial indisponível: nenhum detector local está instalado no app. Use o foco manual (ou o foco fixo padrão no terço superior).'};
}

/**
 * Quadros RGBA reduzidos (FFmpeg local, sem shell) para um detector. Async iterator: memória limitada a 1 quadro.
 * `t` = tempo do arquivo de entrada (use a GRAVAÇÃO para que os pontos sejam âncoras válidas).
 */
export async function* sampleFramesForDetection({ffmpeg = 'ffmpeg', inputPath, sourceWidth, sourceHeight, fps = 4, width = 320, signal, maxSeconds = REFRAME_LIMITS.maxSeconds}) {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth < 2 || sourceHeight < 2) throw new Error('Frame sampling needs the source dimensions.');
  const rate = clamp(fps, 0.5, REFRAME_LIMITS.maxSampleFps), w = Math.max(16, Math.round(width / 2) * 2), h = Math.max(2, Math.round(w * sourceHeight / sourceWidth / 2) * 2), size = w * h * 4;
  const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', inputPath, '-t', String(maxSeconds), '-an', '-vf', `fps=${rate},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const queue = [], waiters = [];
  let pending = Buffer.alloc(0), index = 0, ended = false, failure = null, stderr = '';
  const wake = () => { while (waiters.length) waiters.shift()(); };
  const abort = () => { failure = new Error('Media operation canceled.'); child.kill(); wake(); };
  signal?.addEventListener('abort', abort, {once: true});
  child.stdout.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= size) { queue.push({t: round3(index++ / rate), rgba: new Uint8ClampedArray(pending.subarray(0, size)), width: w, height: h}); pending = pending.subarray(size); }
    if (queue.length > 4) child.stdout.pause();
    wake();
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-1000); });
  child.on('error', (error) => { failure = new Error(`${ffmpeg} unavailable: ${error.message}`); wake(); });
  child.on('close', (code) => { if (code !== 0 && !failure) failure = new Error(`Frame sampling failed (${code}): ${stderr.slice(-300)}`); ended = true; wake(); });
  try {
    for (;;) {
      if (queue.length) { const frame = queue.shift(); if (queue.length <= 2) child.stdout.resume(); yield frame; continue; }
      if (failure) throw failure;
      if (ended) return;
      await new Promise((resolve) => waiters.push(resolve));
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!ended) child.kill();
  }
}

/**
 * Trilha de foco a partir de um detector INJETADO: `detector.detect({rgba,width,height,t})` devolve
 * [{box:{x,y,w,h} em pixels do quadro amostrado, score}]. Fica com o maior rosto confiável por quadro.
 * Sem detector -> erro explícito (o chamador usa foco manual/fixo).
 */
export async function detectFaceTrack({inputPath, sourceWidth, sourceHeight, detector, fps = 4, width = 320, ffmpeg, signal, minScore = 0.6, sample = sampleFramesForDetection}) {
  const status = faceDetectorStatus(detector);
  if (!status.available) throw new Error(status.reason);
  const samples = [];
  for await (const frame of sample({ffmpeg, inputPath, sourceWidth, sourceHeight, fps, width, signal})) {
    const found = (await detector.detect(frame) ?? []).filter((item) => item?.box && finite(item.score));
    const best = found.filter((item) => item.score >= minScore).sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height || b.score - a.score)[0];
    samples.push(best ? {t: frame.t, score: best.score, box: {x: clamp(best.box.x / frame.width, 0, 1), y: clamp(best.box.y / frame.height, 0, 1), w: clamp(best.box.width / frame.width, 0, 1), h: clamp(best.box.height / frame.height, 0, 1)}} : {t: frame.t, score: 0, box: null});
  }
  return {...smoothFaceSamples(samples, {minScore, detector: {name: status.name, version: status.version, sampledFps: clamp(fps, 0.5, REFRAME_LIMITS.maxSampleFps)}}), samples: samples.length};
}

// ---------------------------------------------------------------- props da composição

/** Pontos em frames do vídeo editado para a composição (mesma função no preview e no render). */
export function reframeRenderProps(reframe, {fps, durationSeconds}) {
  if (!reframe || !Array.isArray(reframe.points) || !reframe.points.length) return undefined;
  const total = Math.max(1, Math.round(durationSeconds * fps)), byFrame = new Map();
  for (const point of reframe.points) {
    if (!finite(point.at) || !finite(point.x) || !finite(point.y)) continue;
    const frame = clamp(Math.round(point.at * fps), 0, total - 1);
    byFrame.set(frame, {frame, x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1), ...(finite(point.w) && finite(point.h) ? {w: clamp(point.w, 0.02, 1), h: clamp(point.h, 0.02, 1)} : {})});
  }
  const points = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return points.length ? {mode: reframe.mode, source: reframe.source, points} : undefined;
}

// ---------------------------------------------------------------- conversão de proporção (ex.: 16:9 -> 9:16)

const even = (value) => Math.max(2, Math.round(value / 2) * 2);
const num = (value) => String(Math.round(value * 1000) / 1000);

/** Até `max` pontos preservando início, fim e as maiores mudanças (expressão FFmpeg curta). */
const decimate = (points, max) => {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({length: max}, (_, i) => points[Math.round(i * step)]);
};

/**
 * Filtro FFmpeg que converte a proporção recortando ao redor do foco (fixo, manual ou trilha), em vez do recorte
 * central: `scale` para cobrir o destino + `crop` com x/y lineares por partes no tempo do vídeo EDITADO (usa `at`;
 * sem `at`, usa `t`). Sem reframe, foco padrão. O integrador troca o `crop` central do corte por este filtro.
 */
export function reframeCropFilter(reframe, {sourceWidth, sourceHeight, width, height, maxPoints = 48}) {
  if (![sourceWidth, sourceHeight, width, height].every((value) => Number.isInteger(value) && value >= 2)) throw new Error('Crop needs integer source and output sizes.');
  const scale = Math.max(width / sourceWidth, height / sourceHeight), sw = Math.max(width, even(sourceWidth * scale)), sh = Math.max(height, even(sourceHeight * scale));
  const raw = reframe?.points?.length ? reframe.points : [{t: 0, ...DEFAULT_FOCUS}];
  const points = decimate(raw.map((point) => ({time: finite(point.at) ? point.at : point.t, x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1)})).sort((a, b) => a.time - b.time), Math.max(2, maxPoints));
  const axis = (key, size, out) => {
    const pos = (p) => p[key] * size - out / 2, max = size - out;
    if (max <= 0) return '0';
    if (points.length === 1 || reframe?.mode === 'fixed') return num(clamp(pos(points[0]), 0, max));
    let expr = num(pos(points[points.length - 1]));
    for (let i = points.length - 2; i >= 0; i--) {
      const a = points[i], b = points[i + 1], dt = Math.max(1e-3, b.time - a.time);
      expr = `if(lt(t\\,${num(b.time)})\\,${num(pos(a))}+(${num(pos(b) - pos(a))})*(t-${num(a.time)})/${num(dt)}\\,${expr})`;
    }
    return `clip(if(lt(t\\,${num(points[0].time)})\\,${num(pos(points[0]))}\\,${expr})\\,0\\,${max})`;
  };
  return {filter: `scale=${sw}:${sh},crop=${width}:${height}:${axis('x', sw, width)}:${axis('y', sh, height)}`, scaledWidth: sw, scaledHeight: sh};
}
