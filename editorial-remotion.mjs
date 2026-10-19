// Adaptador local do Remotion: sobrepõe título, tarja (lower-third) e CTA sobre um vídeo JÁ CORTADO.
// Sem JS/HTML/URL externa fornecidos pelo usuário, sem cloud: usa o bundle pré-compilado em dist/remotion
// (scripts/build-remotion-video.mjs), um servidor de mídia loopback com token e o Chromium local.
import {spawn} from 'node:child_process';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync, readFileSync} from 'node:fs';
import {copyFile, link, lstat, mkdir, open as openFile, readdir, stat, unlink, writeFile} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveMotionProps, sfxBedWav, sfxMixFilter} from './editorial-motion-plan.mjs';
import {applyScreenModes, qaFrames, resolveStoryboardProps, storyboardManifest, storyboardQa} from './editorial-storyboard.mjs';

export const REMOTION_VERSION = '4.0.534';
export const COMPOSITION_ID = 'OverlayVideo';
export const LIMITS = Object.freeze({
  title: 80, name: 60, role: 80, cta: 80,
  maxWidth: 3840, maxHeight: 3840, maxDurationSeconds: 1800, maxFps: 60, minFps: 1,
  minWindowSeconds: 0.5
});
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_DIR = path.join(MODULE_DIR, 'dist', 'remotion');
/**
 * Layout publicado por scripts/build-remotion-video.mjs: `<raiz>/versions/<sha16>/` é IMUTÁVEL (nunca reescrito) e
 * `<raiz>/current.json` aponta a versão atual (troca atômica por rename). Cada render fixa UMA versão no início e a
 * usa até o fim; o rebuild só publica pasta nova e troca o ponteiro, nunca apaga a versão em uso. Raiz sem ponteiro
 * com index.html = layout plano legado (aceito, com hash recalculado a cada uso).
 */
export const BUNDLE_SCHEMA = 'mainsagents.remotion-bundle/1';
export const BUNDLE_POINTER = 'current.json';
export const BUNDLE_MANIFEST = 'bundle-manifest.json';
export const BUNDLE_VERSION_PATTERN = /^[a-f0-9]{16}$/;
/** Lease de render em `<raiz>/.leases`: o prune do build não remove versão com lease mais nova que isto. */
export const BUNDLE_LEASE_TTL_MS = 12 * 60 * 60 * 1000;
const INPUT_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska'};
/** Imagens do USUÁRIO para explicativos: só arquivos locais já autorizados pelo servidor (assetId -> caminho), nunca do spec. */
const ASSET_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
/** B-roll do storyboard (vídeo mudo do próprio usuário), também só por assetId autorizado e com hash conferido. */
const VIDEO_ASSET_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm'};
export const ASSET_LIMITS = Object.freeze({maxAssets: 8, maxBytes: 20 * 1024 * 1024, maxVideoBytes: 300 * 1024 * 1024});
const DEFAULTS = Object.freeze({titleStart: 0.3, titleLength: 3, lowerStart: 1.2, lowerLength: 4, ctaLength: 3, theme: 'dark', accent: '#2f6bff'});

export class RemotionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'RemotionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new RemotionError(code, message, details); };
const round3 = (value) => Math.round(value * 1000) / 1000;
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// ---------------------------------------------------------------- validação

export function validateMetadata(raw) {
  if (!isRecord(raw)) fail('invalid_metadata', 'metadata do vídeo cortado é obrigatório.');
  const {width, height, fps, durationSeconds} = raw;
  if (!Number.isInteger(width) || width < 16 || width > LIMITS.maxWidth) fail('invalid_metadata', 'metadata.width inválido.');
  if (!Number.isInteger(height) || height < 16 || height > LIMITS.maxHeight) fail('invalid_metadata', 'metadata.height inválido.');
  if (!finiteNumber(fps) || fps < LIMITS.minFps || fps > LIMITS.maxFps) fail('invalid_metadata', 'metadata.fps inválido.');
  if (!finiteNumber(durationSeconds) || durationSeconds < 1 / fps || durationSeconds > LIMITS.maxDurationSeconds) fail('invalid_metadata', 'metadata.durationSeconds inválido.');
  if (typeof raw.hasAudio !== 'boolean') fail('invalid_metadata', 'metadata.hasAudio deve ser booleano.');
  return {width, height, fps, durationSeconds, hasAudio: raw.hasAudio};
}

function plainText(value, label, max, {required = true} = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('invalid_animations', `${label} é obrigatório.`);
    return undefined;
  }
  if (typeof value !== 'string') fail('invalid_animations', `${label} deve ser texto.`);
  const text = value.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.replace(/\s/g, ' '))) fail('invalid_animations', `${label} contém caracteres de controle.`);
  if (!text) {
    if (required) fail('invalid_animations', `${label} é obrigatório.`);
    return undefined;
  }
  if ([...text].length > max) fail('invalid_animations', `${label} excede ${max} caracteres.`);
  return text;
}

function onlyKeys(value, allowed, label) {
  if (!isRecord(value)) fail('invalid_animations', `${label} deve ser objeto.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('invalid_animations', `${label}.${key} não é permitido.`);
}

function optionalSeconds(value, label) {
  if (value === undefined || value === null) return undefined;
  if (!finiteNumber(value) || value < 0 || value > LIMITS.maxDurationSeconds) fail('invalid_animations', `${label} inválido.`);
  return value;
}

// Resolve start/end absolutos em segundos, alinhados ao frame, sempre dentro de [0, duração].
function resolveWindow({startSeconds, durationSeconds}, {defaultStart, defaultLength, total, fps, anchorEnd = false, label}) {
  const frame = 1 / fps;
  const length = Math.min(durationSeconds ?? defaultLength, total);
  let from = anchorEnd ? total - length : (startSeconds ?? defaultStart);
  if (anchorEnd && startSeconds !== undefined) from = startSeconds;
  from = Math.min(Math.max(0, from), Math.max(0, total - frame));
  let to = Math.min(total, from + length);
  from = Math.round(from * fps) / fps;
  to = Math.round(to * fps) / fps;
  if (to - from < Math.min(LIMITS.minWindowSeconds, total) - 1e-9 && from > 0) from = Math.max(0, round3(to - Math.min(LIMITS.minWindowSeconds, total)));
  if (to <= from) fail('invalid_animations', `${label}: janela de tempo vazia para um vídeo de ${round3(total)}s.`);
  return {from: round3(from), to: round3(to)};
}

/**
 * Valida a especificação de overlays e resolve a linha do tempo determinística.
 * Retorna as props da composição (sem `src`). Lança RemotionError('invalid_animations').
 */
export function resolveAnimations(raw, metadataInput, {assetIds} = {}) {
  const metadata = validateMetadata(metadataInput);
  onlyKeys(raw, ['title', 'lowerThird', 'cta', 'theme', 'accent', 'motion', 'protect', 'storyboard', 'screen'], 'animations');
  const total = round3(Math.round(metadata.durationSeconds * metadata.fps) / metadata.fps);
  const theme = raw.theme ?? DEFAULTS.theme;
  if (theme !== 'dark' && theme !== 'light') fail('invalid_animations', 'animations.theme deve ser "dark" ou "light".');
  const accent = raw.accent ?? DEFAULTS.accent;
  if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) fail('invalid_animations', 'animations.accent deve ser #RRGGBB.');
  const out = {theme, accent: accent.toLowerCase()};
  const common = {total, fps: metadata.fps};
  if (raw.title !== undefined) {
    onlyKeys(raw.title, ['text', 'startSeconds', 'durationSeconds'], 'animations.title');
    out.title = {text: plainText(raw.title.text, 'animations.title.text', LIMITS.title), ...resolveWindow(
      {startSeconds: optionalSeconds(raw.title.startSeconds, 'title.startSeconds'), durationSeconds: optionalSeconds(raw.title.durationSeconds, 'title.durationSeconds')},
      {...common, defaultStart: DEFAULTS.titleStart, defaultLength: DEFAULTS.titleLength, label: 'title'})};
  }
  if (raw.lowerThird !== undefined) {
    onlyKeys(raw.lowerThird, ['name', 'role', 'startSeconds', 'durationSeconds'], 'animations.lowerThird');
    const role = plainText(raw.lowerThird.role, 'animations.lowerThird.role', LIMITS.role, {required: false});
    out.lowerThird = {name: plainText(raw.lowerThird.name, 'animations.lowerThird.name', LIMITS.name), ...(role ? {role} : {}), ...resolveWindow(
      {startSeconds: optionalSeconds(raw.lowerThird.startSeconds, 'lowerThird.startSeconds'), durationSeconds: optionalSeconds(raw.lowerThird.durationSeconds, 'lowerThird.durationSeconds')},
      {...common, defaultStart: DEFAULTS.lowerStart, defaultLength: DEFAULTS.lowerLength, label: 'lowerThird'})};
  }
  if (raw.cta !== undefined) {
    onlyKeys(raw.cta, ['text', 'durationSeconds'], 'animations.cta');
    out.cta = {text: plainText(raw.cta.text, 'animations.cta.text', LIMITS.cta), ...resolveWindow(
      {durationSeconds: optionalSeconds(raw.cta.durationSeconds, 'cta.durationSeconds')},
      {...common, defaultStart: 0, defaultLength: DEFAULTS.ctaLength, anchorEnd: true, label: 'cta'})};
  }
  if (raw.motion !== undefined) {
    try { out.motion = resolveMotionProps(raw.motion, {fps: metadata.fps, durationSeconds: total, protect: raw.protect}); } catch (error) { fail('invalid_animations', `animations.motion: ${error.message}`); }
    // Só enquadramento (foco manual) também é motion: a câmera usa a trilha mesmo sem cues.
    if (!out.motion.cues.length && !out.motion.reframe) delete out.motion;
    // Imagens só por assetId; no render, cada id precisa ter arquivo autorizado (assetFiles) — senão nada é exibido.
    const missing = (out.motion?.cues ?? []).filter((cue) => cue.explainer?.visual.type === 'image' && assetIds && !assetIds.includes(cue.explainer.visual.assetId));
    if (missing.length) fail('invalid_animations', `animations.motion: imagem sem arquivo autorizado (${missing.map((cue) => cue.explainer.visual.assetId).join(', ')}).`);
  } else if (raw.protect !== undefined) {
    try { resolveMotionProps({intensity: 'off', cues: []}, {fps: metadata.fps, durationSeconds: total, protect: raw.protect}); } catch (error) { fail('invalid_animations', `animations.protect: ${error.message}`); }
  }
  if (raw.storyboard !== undefined) {
    // Storyboard autorado substitui os overlays fixos e as cues automáticas (só o enquadramento/reframe continua valendo).
    if (out.title || out.lowerThird || out.cta || out.motion?.cues.length) fail('invalid_animations', 'animations.storyboard substitui título/tarja/CTA e cues de motion; envie só um dos dois.');
    try { out.storyboard = resolveStoryboardProps(raw.storyboard, {fps: metadata.fps, durationSeconds: total, protect: raw.protect}); } catch (error) { fail('invalid_animations', `animations.storyboard: ${error.message}`); }
    const missing = out.storyboard.assets.filter((asset) => assetIds && !assetIds.includes(asset.id));
    if (missing.length) fail('invalid_animations', `animations.storyboard: asset sem arquivo autorizado (${missing.map((asset) => asset.id).join(', ')}).`);
    // SFX do storyboard seguem pelo mesmo mix local (props.motion.sfx) que o editorial-media já usa.
    if (out.storyboard.sfx.length) out.motion = {...(out.motion ?? {intensity: 'off', cues: []}), sfx: out.storyboard.sfx};
  }
  if (raw.screen !== undefined) out.screen = resolveScreen(raw.screen, metadata, out);
  if (!out.title && !out.lowerThird && !out.cta && !out.motion && !out.storyboard && !out.screen) fail('invalid_animations', 'Informe ao menos título, tarja, CTA, motion ou storyboard.');
  return out;
}

/**
 * Trilha da gravação de TELA de um par câmera+tela (já cortada pelo host com a MESMA linha do tempo do vídeo da câmera):
 * {mode: 'with-camera'|'full' (padrão fora de cenas e em cenas sem `screen`), windows: [{start,end}] segundos do vídeo
 * editado onde existe tela, width/height da trilha}. Cenas do storyboard ganham `screenMode` efetivo e o layout de câmera
 * correspondente (pip para with-camera, hidden para full), para slots/QA refletirem o que aparece. Fora das janelas a
 * composição mostra a câmera cheia (nunca congela quadro).
 */
function resolveScreen(raw, metadata, out) {
  onlyKeys(raw, ['mode', 'windows', 'width', 'height'], 'animations.screen');
  if (!['with-camera', 'full'].includes(raw.mode)) fail('invalid_animations', 'animations.screen.mode deve ser "with-camera" ou "full".');
  if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height) || raw.width < 2 || raw.height < 2 || raw.width > LIMITS.maxWidth || raw.height > LIMITS.maxHeight) fail('invalid_animations', 'animations.screen: tamanho da trilha inválido.');
  if (!Array.isArray(raw.windows) || raw.windows.length > 400) fail('invalid_animations', 'animations.screen.windows: lista de até 400 janelas.');
  const total = Math.max(1, Math.round(metadata.durationSeconds * metadata.fps));
  let last = -1;
  const windows = raw.windows.map((item, i) => {
    onlyKeys(item, ['start', 'end'], `animations.screen.windows[${i}]`);
    if (!finiteNumber(item.start) || !finiteNumber(item.end) || item.start < 0 || item.end <= item.start || item.start < last - 1e-6) fail('invalid_animations', `animations.screen.windows[${i}]: janela inválida ou fora de ordem.`);
    last = item.end;
    return {fromFrame: Math.min(total, Math.round(item.start * metadata.fps)), toFrame: Math.min(total, Math.round(item.end * metadata.fps))};
  }).filter((item) => item.toFrame > item.fromFrame);
  if (out.storyboard) applyScreenModes(out.storyboard, raw.mode);
  return {mode: raw.mode, windows, width: raw.width, height: raw.height};
}

/** Versão pública: devolve a especificação normalizada (mesmos campos que o chamador pode persistir/hash). */
export const validateAnimations = resolveAnimations;

// ---------------------------------------------------------------- ffprobe

const compositorPackage = () => {
  const map = {'win32-x64': 'compositor-win32-x64-msvc', 'darwin-arm64': 'compositor-darwin-arm64', 'darwin-x64': 'compositor-darwin-x64', 'linux-x64': 'compositor-linux-x64-gnu', 'linux-arm64': 'compositor-linux-arm64-gnu'};
  return map[`${process.platform}-${process.arch}`];
};

// Electron reports unpacked files as present inside app.asar but cannot spawn them from there (ENOENT); the native
// compositor (remotion/ffmpeg/ffprobe) is shipped in app.asar.unpacked (asarUnpack). Outside an asar this is a no-op.
const outsideAsar = (file) => file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

/** Directory of the platform compositor binaries for selectComposition/renderMedia `binariesDirectory`, always outside app.asar. */
export function resolveBinariesDirectory(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const pkg = compositorPackage();
  if (!pkg) return null;
  for (const base of [path.join(MODULE_DIR, 'node_modules', '@remotion', pkg), path.join(MODULE_DIR, '..', 'app.asar.unpacked', 'node_modules', '@remotion', pkg)]) {
    const directory = outsideAsar(base);
    if (existsSync(directory)) return directory;
  }
  return null; // Remotion resolves its own package (source/dev)
}

export function resolveFfprobe(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const pkg = compositorPackage();
  if (pkg) {
    for (const base of [path.join(MODULE_DIR, 'node_modules', '@remotion', pkg), path.join(MODULE_DIR, '..', 'app.asar.unpacked', 'node_modules', '@remotion', pkg)]) {
      const candidate = outsideAsar(path.join(base, exe));
      if (existsSync(candidate)) return candidate;
    }
  }
  return exe; // PATH; falha de spawn vira dependência ausente diagnosticada
}

function runProcess(command, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('aborted')); return; }
    const child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, {once: true});
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 4_000_000) child.kill(); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(error); });
    child.on('close', (code) => { signal?.removeEventListener('abort', onAbort); code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} saiu com código ${code}`)); });
  });
}

const parseRate = (value) => {
  const [a, b] = String(value ?? '').split('/').map(Number);
  return b ? a / b : a;
};

export async function probeVideo(file, {ffprobePath, signal} = {}) {
  const binary = resolveFfprobe(ffprobePath);
  if (!binary) fail('dependency_missing', 'ffprobe indicado não existe.');
  let raw;
  try {
    raw = await runProcess(binary, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal);
  } catch (error) {
    if (signal?.aborted) fail('cancelled', 'Operação cancelada.');
    if (error?.code === 'ENOENT') fail('dependency_missing', 'ffprobe não encontrado (instale FFmpeg ou informe ffprobePath).');
    fail('probe_failed', `ffprobe falhou: ${error.message}`);
  }
  const info = JSON.parse(raw);
  const video = (info.streams ?? []).find((stream) => stream.codec_type === 'video');
  if (!video) fail('probe_failed', 'Arquivo sem stream de vídeo.');
  const audioStream = (info.streams ?? []).find((stream) => stream.codec_type === 'audio');
  const audio = Boolean(audioStream);
  const duration = Number(info.format?.duration ?? video.duration);
  const rotation = Number((video.side_data_list ?? []).find((item) => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0) || 0;
  return {width: video.width, height: video.height, fps: round3(parseRate(video.avg_frame_rate || video.r_frame_rate)), durationSeconds: duration, hasAudio: audio, videoCodec: video.codec_name, rotation, colorTransfer: video.color_transfer ?? null,
    ...(audioStream ? {audioCodec: audioStream.codec_name, audioChannels: audioStream.channels, audioSampleRate: Number(audioStream.sample_rate), audioDurationSeconds: Number(audioStream.duration) || duration} : {})};
}

export function resolveFfmpeg(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'; // PATH (build com AAC); o ffmpeg do Remotion não garante encoder AAC
}

/** Verifica o FFmpeg (exigido pelo remux de áudio) sem baixar nada. Nunca expõe ambiente; só caminho explícito ou "PATH". */
export async function checkFfmpeg({ffmpegPath} = {}) {
  const source = ffmpegPath ? 'explicit' : 'path';
  const binary = resolveFfmpeg(ffmpegPath);
  if (!binary) return {ready: false, source, path: ffmpegPath, version: null, reason: 'ffmpegPath indicado não existe.'};
  try {
    const out = await runProcess(binary, ['-hide_banner', '-version']);
    const version = /ffmpeg version ([^ ]+)/.exec(out)?.[1] ?? null;
    return {ready: true, source, path: ffmpegPath ?? 'PATH', version, reason: null};
  } catch {
    return {ready: false, source, path: ffmpegPath ?? 'PATH', version: null, reason: ffmpegPath ? 'ffmpegPath indicado não executa.' : 'ffmpeg não encontrado no PATH (instale FFmpeg ou informe ffmpegPath).'};
  }
}

const AAC_COPY_CODECS = new Set(['aac']);
/** Trecho de teste: lê só a janela [start, start+duration) do áudio original (sempre reencodado). */
const audioWindowArgs = (window) => (window ? ['-ss', window.start.toFixed(6), '-t', window.duration.toFixed(6)] : []);
const AUDIO_ENCODE_BITRATE = '192k';

/**
 * Cola o áudio ORIGINAL do vídeo de entrada sobre o vídeo renderizado (sem áudio) em arquivo novo.
 * AAC -> -c:a copy (amostras e canais idênticos); outro codec -> AAC limitado a 192k mantendo canais/taxa.
 */
async function remuxOriginalAudio({videoPath, audioSource, target, audio, ffmpegPath, signal, window}) {
  const binary = resolveFfmpeg(ffmpegPath);
  if (!binary) fail('dependency_missing', 'ffmpeg indicado não existe.');
  const mode = AAC_COPY_CODECS.has(audio.audioCodec) && !window ? 'copy' : 'encode';
  const args = ['-v', 'error', '-nostdin', '-y', '-i', videoPath, ...audioWindowArgs(window), '-i', audioSource, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    ...(mode === 'copy' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', AUDIO_ENCODE_BITRATE]), ...(window ? ['-shortest'] : []), '-movflags', '+faststart', '-f', 'mp4', target];
  try {
    await runProcess(binary, args, signal);
  } catch (error) {
    if (signal?.aborted) fail('cancelled', 'Render cancelado.');
    if (error?.code === 'ENOENT') fail('dependency_missing', 'ffmpeg não encontrado (instale FFmpeg ou informe ffmpegPath).');
    fail('render_failed', `Falha ao anexar o áudio original: ${String(error.message).slice(0, 400)}`);
  }
  return mode;
}

/**
 * Áudio original + efeitos sonoros do plano de motion: os SFX são sintetizados localmente, posicionados com o ganho
 * planejado e comprimidos pela própria voz (sidechain = ducking), somados sem normalizar a fala. Sempre reencoda AAC.
 */
async function remuxWithSfx({videoPath, audioSource, target, audio, sfx, durationSeconds, ffmpegPath, signal, window}) {
  const binary = resolveFfmpeg(ffmpegPath);
  if (!binary) fail('dependency_missing', 'ffmpeg indicado não existe.');
  const bed = target.replace(/\.mp4$/, '.sfx.wav');
  await writeFile(bed, sfxBedWav(sfx, durationSeconds, audio.audioSampleRate), {flag: 'wx'});
  const args = ['-v', 'error', '-nostdin', '-y', '-i', videoPath, ...audioWindowArgs(window), '-i', audioSource, '-i', bed, '-filter_complex', sfxMixFilter({sampleRate: audio.audioSampleRate, channels: audio.audioChannels}),
    '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', AUDIO_ENCODE_BITRATE, '-ar', String(audio.audioSampleRate), '-ac', String(audio.audioChannels), '-movflags', '+faststart', '-f', 'mp4', target];
  try {
    await runProcess(binary, args, signal);
  } catch (error) {
    if (signal?.aborted) fail('cancelled', 'Render cancelado.');
    if (error?.code === 'ENOENT') fail('dependency_missing', 'ffmpeg não encontrado (instale FFmpeg ou informe ffmpegPath).');
    fail('render_failed', `Falha ao mixar efeitos sonoros: ${String(error.message).slice(0, 400)}`);
  } finally {
    await unlink(bed).catch(() => {});
  }
  return 'mixed-sfx';
}

// ---------------------------------------------------------------- servidor de mídia loopback

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? {start, end} : null;
}

const tokensEqual = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Servidor HTTP somente-loopback que expõe EXATAMENTE os arquivos da allowlist em /media/<token>.
 * O caminho do disco nunca vem da URL: só o token (24 bytes aleatórios) seleciona a entrada.
 */
export async function createMediaServer(files) {
  const entries = new Map();
  const urls = {};
  for (const [name, filePath] of Object.entries(files)) {
    const info = await stat(filePath);
    if (!info.isFile()) fail('invalid_input', `${name} não é arquivo regular.`);
    const ext = path.extname(filePath).toLowerCase();
    const token = randomBytes(24).toString('base64url');
    entries.set(token, {filePath, size: info.size, mtimeMs: info.mtimeMs, type: INPUT_TYPES[ext] ?? ASSET_TYPES[ext] ?? 'application/octet-stream'});
    urls[name] = token;
  }
  let port = 0;
  const server = http.createServer(async (request, response) => {
    const deny = (status) => { response.writeHead(status, {'Cache-Control': 'no-store', 'Content-Length': 0}); response.end(); };
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405);
      const host = String(request.headers.host ?? '');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(403);
      const rawPath = (request.url ?? '').split('?')[0];
      const match = /^\/media\/([A-Za-z0-9_-]{32})$/.exec(rawPath);
      if (!match) return deny(404);
      let entry;
      for (const [token, value] of entries) if (tokensEqual(token, match[1])) entry = value;
      if (!entry) return deny(404);
      const info = await stat(entry.filePath);
      if (!info.isFile() || info.size !== entry.size || info.mtimeMs !== entry.mtimeMs) return deny(409);
      const base = {'Content-Type': entry.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff'};
      let start = 0;
      let end = entry.size - 1;
      let status = 200;
      if (request.headers.range) {
        const range = parseRange(request.headers.range, entry.size);
        if (!range) { response.writeHead(416, {...base, 'Content-Range': `bytes */${entry.size}`, 'Content-Length': 0}); return response.end(); }
        ({start, end} = range);
        status = 206;
        base['Content-Range'] = `bytes ${start}-${end}/${entry.size}`;
      }
      response.writeHead(status, {...base, 'Content-Length': end - start + 1});
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(entry.filePath, {start, end});
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      if (!response.headersSent) deny(500); else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({host: '127.0.0.1', port: 0}, resolve);
  });
  port = server.address().port;
  return {
    port,
    url: (name) => `http://127.0.0.1:${port}/media/${urls[name]}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })
  };
}

// ---------------------------------------------------------------- navegador / capacidades

const SYSTEM_BROWSERS = {
  win32: () => [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ],
  darwin: () => ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: () => ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
};

function projectBrowserCache() {
  const root = path.join(process.cwd(), 'node_modules', '.remotion');
  for (const mode of ['chrome-headless-shell', 'chrome-for-testing']) {
    const version = path.join(root, mode, 'VERSION');
    if (existsSync(version)) return {mode, path: path.join(root, mode)};
  }
  return null;
}

/** Decide qual navegador usar SEM baixar nada. Ordem: indicado > cache Remotion do projeto > Chrome/Edge do sistema. */
export function resolveBrowser({browserExecutable} = {}) {
  if (browserExecutable) {
    if (!existsSync(browserExecutable)) return {status: 'missing', source: 'explicit', path: browserExecutable, reason: 'browserExecutable indicado não existe.'};
    return {status: 'ready', source: 'explicit', path: browserExecutable, chromeMode: 'chrome-for-testing'};
  }
  const cache = projectBrowserCache();
  if (cache) return {status: 'ready', source: 'remotion-cache', path: cache.path, chromeMode: cache.mode, executable: null};
  for (const candidate of (SYSTEM_BROWSERS[process.platform]?.() ?? [])) {
    if (existsSync(candidate)) return {status: 'ready', source: 'system', path: candidate, chromeMode: 'chrome-for-testing'};
  }
  return {status: 'missing', source: 'none', path: null, reason: 'Nenhum Chrome/Edge encontrado e cache Remotion vazio. Execute prepareRemotionBrowser() (download local explícito) ou informe browserExecutable.'};
}

/** Download local explícito e opt-in do navegador para o cache do projeto (nunca é chamado implicitamente). */
export async function prepareRemotionBrowser({onProgress, signal} = {}) {
  const {ensureBrowser} = await import('@remotion/renderer');
  if (signal?.aborted) fail('cancelled', 'Operação cancelada.');
  const status = await ensureBrowser({
    chromeMode: 'headless-shell',
    logLevel: 'error',
    onBrowserDownload: () => ({version: null, onProgress: ({percent, downloadedBytes, totalSizeInBytes}) => onProgress?.({percent: percent ?? null, downloadedBytes, totalSizeInBytes})})
  });
  return status;
}

function installedVersion(pkg) {
  try {
    return JSON.parse(readFileSync(path.join(MODULE_DIR, 'node_modules', ...pkg.split('/'), 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

export const REMOTION_LICENSE = Object.freeze({
  name: 'Remotion License',
  url: 'https://github.com/remotion-dev/remotion/blob/main/LICENSE.md',
  summary: 'Gratuita para indivíduos, empresas com fins lucrativos de até 3 funcionários, sem fins lucrativos e avaliação; organizações maiores exigem Company License paga.',
  requiresReview: true
});

export async function getRemotionCapabilities({bundleDir = DEFAULT_BUNDLE_DIR, browserExecutable, ffprobePath, ffmpegPath} = {}) {
  const reasons = [];
  const versions = Object.fromEntries(['remotion', '@remotion/renderer', '@remotion/bundler'].map((pkg) => [pkg, installedVersion(pkg)]));
  for (const [pkg, version] of Object.entries(versions)) if (version !== REMOTION_VERSION) reasons.push(`${pkg} ${version ?? 'ausente'} (esperado ${REMOTION_VERSION}).`);
  const found = resolveRemotionBundle(bundleDir);
  const bundleReady = found.ready;
  if (!bundleReady) reasons.push(found.reason);
  const browser = resolveBrowser({browserExecutable});
  if (browser.status !== 'ready') reasons.push(browser.reason);
  const ffprobe = resolveFfprobe(ffprobePath);
  let ffprobeOk = false;
  if (ffprobe) {
    try { await runProcess(ffprobe, ['-version']); ffprobeOk = true; } catch { reasons.push('ffprobe indisponível.'); }
  } else reasons.push('ffprobe indicado não existe.');
  const ffmpeg = await checkFfmpeg({ffmpegPath});
  if (!ffmpeg.ready) reasons.push(ffmpeg.reason);
  return {
    available: reasons.length === 0,
    template: {id: COMPOSITION_ID, overlays: ['title', 'lowerThird', 'cta', 'motion', 'storyboard'], limits: LIMITS, defaults: DEFAULTS, inputExtensions: Object.keys(INPUT_TYPES), output: 'mp4/h264/aac'},
    versions,
    bundle: {ready: bundleReady, path: found.dir ?? found.root, root: found.root, layout: found.layout, version: found.version},
    browser,
    ffprobe: {ready: ffprobeOk, path: ffprobe},
    ffmpeg,
    license: REMOTION_LICENSE,
    reasons
  };
}

// ---------------------------------------------------------------- render

// O servidor interno do Remotion escuta em '::'/0.0.0.0 (todas as interfaces). Enquanto o render roda,
// força loopback para servidores criados a partir do renderer, sem afetar outros servidores do processo.
let loopbackGuards = 0;
let originalListen = null;
function enforceRemotionLoopback() {
  if (loopbackGuards++ === 0) {
    originalListen = net.Server.prototype.listen;
    net.Server.prototype.listen = function patchedListen(...args) {
      const first = args[0];
      if (isRecord(first) && (first.host === '::' || first.host === '0.0.0.0') && /@remotion[\\/]renderer/.test(new Error().stack ?? '')) {
        args[0] = {...first, host: '127.0.0.1'};
      }
      return originalListen.apply(this, args);
    };
  }
  return () => {
    if (--loopbackGuards === 0 && originalListen) {
      net.Server.prototype.listen = originalListen;
      originalListen = null;
    }
  };
}

function assertInputFile(inputPath) {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) fail('invalid_input', 'inputPath deve ser um caminho absoluto.');
  if (!(path.extname(inputPath).toLowerCase() in INPUT_TYPES)) fail('invalid_input', `Extensão de vídeo não suportada (${Object.keys(INPUT_TYPES).join(', ')}).`);
}

async function publishNew(tempPath, finalPath) {
  try {
    await link(tempPath, finalPath);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists', 'outputPath já existe; o adaptador nunca sobrescreve.');
    await copyFile(tempPath, finalPath, 1); // COPYFILE_EXCL quando hard link não é suportado
  }
  await unlink(tempPath).catch(() => {});
}

const IMAGE_MAGIC = {'.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  '.mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp', '.m4v': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp', '.mov': (b) => ['ftyp', 'moov', 'wide', 'mdat'].includes(b.subarray(4, 8).toString('latin1')),
  '.webm': (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))};

const fileSha256 = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
});

/** `child` estritamente dentro de `parent` (caminhos resolvidos/absolutos; igual ou fora = false). */
export function isPathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Hash REAL do conteúdo do bundle: caminhos relativos ordenados + tamanho + sha256 de cada arquivo (sem o
 * bundle-manifest.json da raiz da versão). Link simbólico/junção dentro do bundle é recusado.
 */
export async function bundleTreeSha256(dir) {
  const root = path.resolve(dir);
  const files = [];
  const walk = async (current) => {
    for (const entry of (await readdir(current, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink() || (await lstat(full)).isSymbolicLink()) throw new Error(`link simbólico no bundle: ${entry.name}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (rel !== BUNDLE_MANIFEST) files.push(rel);
      }
    }
  };
  await walk(root);
  const hash = createHash('sha256');
  for (const rel of files) {
    const file = path.join(root, ...rel.split('/'));
    hash.update(`${rel}\0${(await stat(file)).size}\0${await fileSha256(file)}\n`);
  }
  return hash.digest('hex');
}

/**
 * Resolve a raiz do bundle para a versão publicada (ponteiro) ou o layout plano legado. Nunca segue caminho vindo do
 * ponteiro: a pasta é derivada só do nome de versão validado (`versions/<sha16>`) e conferida dentro da raiz.
 */
export function resolveRemotionBundle(bundleDir = DEFAULT_BUNDLE_DIR) {
  const root = path.resolve(bundleDir);
  const missing = (reason) => ({ready: false, root, dir: null, layout: null, version: null, sha256: null, reason});
  const pointerFile = path.join(root, BUNDLE_POINTER);
  if (existsSync(pointerFile)) {
    let pointer = null;
    try { pointer = JSON.parse(readFileSync(pointerFile, 'utf8')); } catch { return missing('Ponteiro do bundle Remotion ilegível (rode node scripts/build-remotion-video.mjs).'); }
    if (pointer?.schema !== BUNDLE_SCHEMA || !BUNDLE_VERSION_PATTERN.test(String(pointer.version)) || !/^[a-f0-9]{64}$/.test(String(pointer.sha256)) || !pointer.sha256.startsWith(pointer.version)) return missing('Ponteiro do bundle Remotion inválido.');
    const dir = path.join(root, 'versions', pointer.version);
    if (!isPathInside(root, dir) || !existsSync(path.join(dir, 'index.html'))) return missing(`Versão ${pointer.version} do bundle Remotion ausente.`);
    return {ready: true, root, dir, layout: 'versioned', version: pointer.version, sha256: pointer.sha256, reason: null};
  }
  if (existsSync(path.join(root, 'index.html'))) return {ready: true, root, dir: root, layout: 'flat', version: null, sha256: null, reason: null};
  return missing('Bundle pré-compilado ausente (rode node scripts/build-remotion-video.mjs).');
}

const verifiedBundles = new Map(); // pasta de versão imutável -> sha256 já conferido neste processo

/**
 * Fixa o bundle de UM render: resolve, registra lease (melhor esforço; raiz só-leitura no app empacotado não
 * impede o render), confere o hash real contra ponteiro+manifesto e devolve {dir, sha256, version, release}.
 */
export async function pinRemotionBundle(bundleDir = DEFAULT_BUNDLE_DIR) {
  const found = resolveRemotionBundle(bundleDir);
  if (!found.ready) fail('bundle_missing', found.reason);
  let leaseFile = null;
  if (found.layout === 'versioned') {
    const leases = path.join(found.root, '.leases');
    const candidate = path.join(leases, `${found.version}.${process.pid}.${randomBytes(6).toString('hex')}.lease`);
    if (isPathInside(found.root, candidate)) {
      try {
        await mkdir(leases, {recursive: true});
        await writeFile(candidate, JSON.stringify({version: found.version, pid: process.pid, at: new Date().toISOString()}), {flag: 'wx'});
        leaseFile = candidate;
      } catch { /* raiz só-leitura: segue sem lease */ }
    }
  }
  const release = async () => { if (leaseFile) await unlink(leaseFile).catch(() => {}); leaseFile = null; };
  try {
    // Re-confere DEPOIS da lease: versão removida entre resolver e lease não chega ao renderer.
    if (!existsSync(path.join(found.dir, 'index.html'))) fail('bundle_missing', 'Bundle Remotion removido durante a preparação do render.');
    let sha256 = found.layout === 'versioned' ? verifiedBundles.get(found.dir) : null;
    if (!sha256) {
      sha256 = await bundleTreeSha256(found.dir).catch((error) => fail('bundle_missing', `Bundle Remotion ilegível: ${String(error?.message ?? error).slice(0, 200)}`));
      if (found.layout === 'versioned') {
        let manifest = null;
        try { manifest = JSON.parse(readFileSync(path.join(found.dir, BUNDLE_MANIFEST), 'utf8')); } catch { /* conferido abaixo */ }
        if (sha256 !== found.sha256 || manifest?.sha256 !== sha256) fail('bundle_missing', `Bundle Remotion ${found.version} não confere com o manifesto (alterado após publicar); rode o build de novo.`);
        verifiedBundles.set(found.dir, sha256);
      }
    }
    return {dir: found.dir, sha256, version: found.version, layout: found.layout, release};
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Valida o mapa assetId -> arquivo que o SERVIDOR já autorizou: `caminho` (legado) ou `{path, sha256}`. Caminho
 * absoluto, extensão de imagem (ou vídeo, para B-roll), assinatura do arquivo compatível, tamanho limitado, no máximo
 * 8. Com sha256 declarado, o hash REAL do arquivo precisa bater. Nunca vem do spec/storyboard (lá só há ids e hashes).
 * Retorna {files: id->caminho, hashes: id->sha256 calculado (só quando pedido)}.
 */
async function checkAssets(assetFiles, {hashIds = []} = {}) {
  if (assetFiles === undefined || assetFiles === null) return {files: {}, hashes: {}};
  if (!isRecord(assetFiles) || Object.keys(assetFiles).length > ASSET_LIMITS.maxAssets) fail('invalid_input', `assetFiles: no máximo ${ASSET_LIMITS.maxAssets} arquivos.`);
  const files = {}, hashes = {};
  for (const [id, entry] of Object.entries(assetFiles)) {
    const file = typeof entry === 'string' ? entry : isRecord(entry) ? entry.path : undefined;
    const declared = isRecord(entry) ? entry.sha256 : undefined;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof file !== 'string' || !path.isAbsolute(file)) fail('invalid_input', 'assetFiles: id simples e caminho absoluto.');
    if (isRecord(entry) && (Object.keys(entry).some((key) => !['path', 'sha256'].includes(key)) || declared !== undefined && !/^[a-f0-9]{64}$/.test(declared))) fail('invalid_input', `assetFiles.${id}: {path, sha256}.`);
    const ext = path.extname(file).toLowerCase(), video = Boolean(VIDEO_ASSET_TYPES[ext]);
    if (!ASSET_TYPES[ext] && !video) fail('invalid_input', `assetFiles.${id}: só PNG, JPEG, WebP ou vídeo MP4/MOV/WebM.`);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size < 12 || info.size > (video ? ASSET_LIMITS.maxVideoBytes : ASSET_LIMITS.maxBytes)) fail('invalid_input', `assetFiles.${id}: arquivo ausente ou acima do limite.`);
    const handle = await openFile(file, 'r');
    try { const head = Buffer.alloc(12); await handle.read(head, 0, 12, 0); if (!IMAGE_MAGIC[ext](head)) fail('invalid_input', `assetFiles.${id}: conteúdo não corresponde a ${ext}.`); } finally { await handle.close(); }
    if (declared || hashIds.includes(id)) {
      const actual = await fileSha256(file);
      if (declared && actual !== declared) fail('asset_hash_mismatch', `assetFiles.${id}: sha256 do arquivo não confere com o registrado.`);
      hashes[id] = actual;
    }
    files[id] = file;
  }
  return {files, hashes};
}

/** Compatível com a versão anterior: devolve id -> caminho (aceita também {path, sha256}). */
export async function validateAssetFiles(assetFiles) {
  return (await checkAssets(assetFiles)).files;
}

/** Os assets do storyboard precisam de arquivo autorizado cujo hash REAL seja o declarado no storyboard. */
function assertStoryboardAssets(storyboard, hashes) {
  for (const asset of storyboard?.assets ?? []) {
    if (!hashes[asset.id]) fail('invalid_input', `storyboard: asset ${asset.id} sem arquivo autorizado.`);
    if (hashes[asset.id] !== asset.sha256) fail('asset_hash_mismatch', `storyboard: asset ${asset.id} difere do registrado (sha256).`);
  }
}

const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
/** Amarra o relatório à fonte e à composição: sha256 do vídeo de entrada e das props resolvidas; avisa HDR/rotação. */
async function bindReport(report, {inputPath, props, probe}) {
  if (!report) return report;
  report.manifest.source = {sha256: await fileSha256(inputPath), fps: probe.fps, width: probe.width, height: probe.height, rotation: probe.rotation ?? 0, colorTransfer: probe.colorTransfer ?? null};
  report.manifest.compositionSha256 = createHash('sha256').update(JSON.stringify({id: COMPOSITION_ID, version: REMOTION_VERSION, storyboard: props.storyboard})).digest('hex');
  if (HDR_TRANSFERS.has(probe.colorTransfer)) report.qa.warnings.push({id: 'source', code: 'hdrSource', detail: `transferência ${probe.colorTransfer}: o render sai em SDR (yuv420p/bt709); confira cores.`});
  if (probe.rotation) report.qa.warnings.push({id: 'source', code: 'rotatedSource', detail: `rotação ${probe.rotation}° nos metadados; o corte já deveria normalizar.`});
  return report;
}

/**
 * QA + manifesto do que FOI aplicado (só storyboard): props resolvidas = o que a composição renderiza.
 * `cutsAt` = instantes de corte no vídeo editado (para avisar transições sobre cortes).
 */
export function storyboardReport(props, {width, height, fps, cutsAt, focus, assetsVerified} = {}) {
  if (!props?.storyboard) return null;
  const qa = storyboardQa(props.storyboard, {width, height, fps, cutsAt, focus});
  return {qa, manifest: storyboardManifest(props.storyboard, {fps, qa, assetsVerified})};
}

/** Trecho de teste [início, fim] (frames inclusivos, como no renderMedia) dentro do vídeo; null = vídeo inteiro. */
export function resolveFrameRange(frameRange, totalFrames) {
  if (frameRange === undefined || frameRange === null) return null;
  if (!Array.isArray(frameRange) || frameRange.length !== 2 || !frameRange.every(Number.isInteger) || frameRange[0] < 0 || frameRange[1] < frameRange[0] || frameRange[1] > totalFrames - 1) fail('invalid_input', `frameRange = [início, fim] inteiros dentro de 0..${totalFrames - 1}.`);
  return [frameRange[0], frameRange[1]];
}

/**
 * Renderiza overlays sobre o vídeo cortado. `inputPath` deve ter sido verificado pelo engine.
 * Resolve com {outputPath,width,height,fps,durationSeconds,hasAudio,browser}; cancela com RemotionError('cancelled').
 */
/** The cut screen track matches the composition (same duration within a frame, the declared size); else the render refuses. */
async function checkScreenTrack(props, screenPath, expected, {ffprobePath, signal}) {
  if (!props.screen && screenPath === undefined) return null;
  if (!props.screen) fail('invalid_input', 'screenPath sem animations.screen.');
  assertInputFile(screenPath);
  const info = await probeVideo(screenPath, {ffprobePath, signal});
  if (info.width !== props.screen.width || info.height !== props.screen.height || Math.abs(info.durationSeconds - expected.durationSeconds) > 2 / expected.fps + 0.15) fail('metadata_mismatch', 'A trilha da tela não corresponde à linha do tempo do vídeo da câmera.', {expected: {width: props.screen.width, height: props.screen.height, durationSeconds: expected.durationSeconds}, actual: {width: info.width, height: info.height, durationSeconds: info.durationSeconds}});
  return info;
}

export async function renderAnimatedVideo({inputPath, outputPath, metadata, animations, signal, onProgress, browserExecutable, bundleDir = DEFAULT_BUNDLE_DIR, ffprobePath, ffmpegPath, binariesDirectory, assetFiles, frameRange, qaPolicy = 'block', cutsAt, screenPath} = {}) {
  const emit = (phase, progress) => { try { onProgress?.({phase, progress: Math.min(1, Math.max(0, progress))}); } catch { /* observador não deve quebrar o render */ } };
  const checkAbort = () => { if (signal?.aborted) fail('cancelled', 'Render cancelado.'); };
  checkAbort();
  assertInputFile(inputPath);
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mp4') fail('invalid_output', 'outputPath deve ser caminho absoluto .mp4.');
  if (path.resolve(inputPath) === path.resolve(outputPath)) fail('invalid_output', 'outputPath não pode ser o próprio vídeo de entrada.');
  const expected = validateMetadata(metadata);
  const authored = isRecord(animations) && animations.storyboard !== undefined;
  const checked = await checkAssets(assetFiles, {hashIds: authored && isRecord(assetFiles) ? Object.keys(assetFiles) : []});
  const assets = checked.files;
  const props = resolveAnimations(animations, expected, {assetIds: Object.keys(assets)});
  if (props.storyboard) assertStoryboardAssets(props.storyboard, checked.hashes);
  const report = storyboardReport(props, {width: expected.width, height: expected.height, fps: expected.fps, cutsAt, assetsVerified: Object.keys(checked.hashes)});
  if (report && !report.qa.ok && qaPolicy !== 'report') fail('qa_failed', `QA do storyboard reprovou: ${report.qa.errors.slice(0, 4).map((item) => `${item.id} ${item.code}`).join('; ')}.`, report);
  const totalFrames = Math.max(1, Math.round(expected.durationSeconds * expected.fps));
  const range = resolveFrameRange(frameRange, totalFrames);
  const window = range ? {start: range[0] / expected.fps, duration: (range[1] - range[0] + 1) / expected.fps} : null;
  const inputInfo = await stat(inputPath).catch(() => null);
  if (!inputInfo?.isFile()) fail('invalid_input', 'inputPath não é um arquivo existente.');
  if (existsSync(outputPath)) fail('output_exists', 'outputPath já existe; o adaptador nunca sobrescreve.');
  const foundBundle = resolveRemotionBundle(bundleDir);
  if (!foundBundle.ready) fail('bundle_missing', foundBundle.reason);
  const browser = resolveBrowser({browserExecutable});
  if (browser.status !== 'ready') fail('browser_missing', browser.reason);

  emit('browser', 0);
  const actual = await probeVideo(inputPath, {ffprobePath, signal});
  const frame = 1 / expected.fps;
  if (actual.width !== expected.width || actual.height !== expected.height || Math.abs(actual.fps - expected.fps) > 0.01
    || Math.abs(actual.durationSeconds - expected.durationSeconds) > frame + 0.1 || actual.hasAudio !== expected.hasAudio) {
    fail('metadata_mismatch', 'O vídeo de entrada não corresponde ao metadata informado.', {expected, actual: {width: actual.width, height: actual.height, fps: actual.fps, durationSeconds: actual.durationSeconds, hasAudio: actual.hasAudio}});
  }
  await bindReport(report, {inputPath, props, probe: actual});
  const screenInfo = await checkScreenTrack(props, screenPath, expected, {ffprobePath, signal});
  if (expected.hasAudio) {
    const ffmpeg = await checkFfmpeg({ffmpegPath});
    if (!ffmpeg.ready) fail('dependency_missing', ffmpeg.reason); // antes de criar qualquer arquivo
  }
  checkAbort();

  await mkdir(path.dirname(outputPath), {recursive: true});
  const tempPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath, '.mp4')}.${randomBytes(6).toString('hex')}.remotion-tmp.mp4`);
  const mixPath = tempPath.replace(/.remotion-tmp.mp4$/, '.remotion-mix.mp4');
  let media = null;
  let restoreListen = null;
  let aborter = null;
  let pinned = null;
  try {
    pinned = await pinRemotionBundle(bundleDir);
    if (report) report.manifest.bundle = {sha256: pinned.sha256, version: pinned.version};
    const renderer = await import('@remotion/renderer');
    media = await createMediaServer({video: inputPath, ...(screenInfo ? {screen: screenPath} : {}), ...Object.fromEntries(Object.entries(assets).map(([id, file]) => [`asset-${id}`, file]))});
    restoreListen = enforceRemotionLoopback();
    const {cancelSignal, cancel} = renderer.makeCancelSignal();
    aborter = () => cancel();
    signal?.addEventListener('abort', aborter, {once: true});
    const chromeMode = browser.chromeMode === 'headless-shell' ? 'headless-shell' : 'chrome-for-testing';
    const executable = browser.source === 'remotion-cache' ? null : browser.path;
    const assetUrls = Object.fromEntries(Object.keys(assets).map((id) => [id, media.url(`asset-${id}`)]));
    const inputProps = {...props, src: media.url('video'), ...(screenInfo ? {screenSrc: media.url('screen')} : {}), width: expected.width, height: expected.height, fps: expected.fps, durationSeconds: expected.durationSeconds, ...(Object.keys(assetUrls).length ? {assets: assetUrls} : {})};
    const binaries = resolveBinariesDirectory(binariesDirectory);
    if (binariesDirectory && !binaries) fail('dependency_missing', 'binariesDirectory indicado não existe.');
    const common = {serveUrl: pinned.dir, browserExecutable: executable, chromeMode, logLevel: 'error', offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024, binariesDirectory: binaries};
    const composition = await renderer.selectComposition({...common, id: COMPOSITION_ID, inputProps});
    checkAbort();
    emit('render', 0);
    await renderer.renderMedia({
      ...common, composition, inputProps, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', outputLocation: tempPath, overwrite: false,
      crf: 20, concurrency: 2, cancelSignal, muted: true, ...(range ? {frameRange: range} : {}), // o áudio vem do arquivo original (remux), nunca do mixer do Remotion
      onProgress: ({progress}) => emit('render', progress)
    });
    checkAbort();
    let finalTemp = tempPath;
    let audioMode = 'none';
    if (expected.hasAudio) {
      emit('verify', 0);
      const current = await stat(inputPath).catch(() => null);
      if (!current?.isFile() || current.size !== inputInfo.size || current.mtimeMs !== inputInfo.mtimeMs) fail('input_changed', 'O vídeo de entrada mudou durante o render; nada foi entregue.');
      const sfx = (props.motion?.sfx ?? []).filter((item) => !window || (item.at >= window.start && item.at < window.start + window.duration)).map((item) => (window ? {...item, at: round3(item.at - window.start)} : item));
      audioMode = sfx.length && [1, 2].includes(actual.audioChannels) && actual.audioSampleRate >= 8000
        ? await remuxWithSfx({videoPath: tempPath, audioSource: inputPath, target: mixPath, audio: actual, sfx, durationSeconds: window ? window.duration : expected.durationSeconds, ffmpegPath, signal, window})
        : await remuxOriginalAudio({videoPath: tempPath, audioSource: inputPath, target: mixPath, audio: actual, ffmpegPath, signal, window});
      finalTemp = mixPath;
      checkAbort();
    }
    emit('verify', 0.5);
    const result = await probeVideo(finalTemp, {ffprobePath, signal});
    const problems = [];
    if (result.width !== expected.width || result.height !== expected.height) problems.push(`dimensões ${result.width}x${result.height}`);
    const wanted = window ? window.duration : expected.durationSeconds;
    if (Math.abs(result.durationSeconds - wanted) > 2 * frame + 0.1) problems.push(`duração ${result.durationSeconds}s`);
    if (result.hasAudio !== expected.hasAudio) problems.push(expected.hasAudio ? 'áudio perdido' : 'áudio inesperado');
    if (result.videoCodec !== 'h264') problems.push(`codec ${result.videoCodec}`);
    if (expected.hasAudio) {
      if (result.audioChannels !== actual.audioChannels) problems.push(`canais ${result.audioChannels} (fonte ${actual.audioChannels})`);
      if (result.audioSampleRate !== actual.audioSampleRate) problems.push(`taxa de áudio ${result.audioSampleRate} (fonte ${actual.audioSampleRate})`);
      const audioWanted = window ? Math.min(window.duration, actual.audioDurationSeconds - window.start) : actual.audioDurationSeconds;
      if (Math.abs(result.audioDurationSeconds - audioWanted) > 2 * frame + 0.1) problems.push(`duração do áudio ${result.audioDurationSeconds}s (esperado ${round3(audioWanted)}s)`);
    }
    if (problems.length) fail('verify_failed', `Saída não confere com o esperado: ${problems.join(', ')}.`, {expected, actual: result});
    await publishNew(finalTemp, outputPath);
    emit('verify', 1);
    return {outputPath, width: result.width, height: result.height, fps: result.fps, durationSeconds: round3(result.durationSeconds), hasAudio: result.hasAudio, audio: result.hasAudio ? {mode: audioMode, codec: result.audioCodec, channels: result.audioChannels, sampleRate: result.audioSampleRate} : {mode: 'none'}, browser: {source: browser.source, path: browser.path}, animations: props, bundle: {sha256: pinned.sha256, version: pinned.version}, ...(range ? {excerpt: {frameRange: range, startSeconds: round3(window.start), durationSeconds: round3(window.duration)}} : {}), ...(report ? {storyboard: report} : {})};
  } catch (error) {
    if (error instanceof RemotionError) throw error;
    if (signal?.aborted || /cancel/i.test(String(error?.message))) throw new RemotionError('cancelled', 'Render cancelado.');
    throw new RemotionError('render_failed', `Falha no render Remotion: ${String(error?.message ?? error).slice(0, 600)}`);
  } finally {
    if (aborter) signal?.removeEventListener('abort', aborter);
    await pinned?.release();
    restoreListen?.();
    await media?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    await unlink(mixPath).catch(() => {});
  }
}

/**
 * Iteração ANTES do MP4: renderiza stills da MESMA composição/props do export (entrada/meio/saída de cada cena, ou
 * `frames` explícitos) e monta um contact sheet. Não toca no vídeo de entrada; grava só em `outDir` (novo/vazio).
 * Resolve com {stills:[{frame,sceneId,moment,path}], contactSheet, storyboard:{qa,manifest}}.
 */
export async function renderStoryboardStills({inputPath, outDir, metadata, animations, assetFiles, frames, sceneIds, maxImages = 60, perScene = 3, scale = 0.5, columns, tileLimit = 16, tags, signal, browserExecutable, bundleDir = DEFAULT_BUNDLE_DIR, ffprobePath, ffmpegPath, binariesDirectory, cutsAt, screenPath} = {}) {
  const checkAbort = () => { if (signal?.aborted) fail('cancelled', 'Render cancelado.'); };
  assertInputFile(inputPath);
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) fail('invalid_output', 'outDir deve ser caminho absoluto.');
  if (!finiteNumber(scale) || scale < 0.1 || scale > 1) fail('invalid_input', 'scale entre 0.1 e 1.');
  if (!Number.isInteger(tileLimit) || tileLimit < 2 || tileLimit > 16) fail('invalid_input', 'tileLimit entre 2 e 16.');
  // Etiquetas do host (revisão/planHash) seguem em cada still: o revisor sabe exatamente qual plano está vendo.
  if (tags !== undefined && (!isRecord(tags) || Object.entries(tags).some(([key, value]) => !/^[a-zA-Z]{1,24}$/.test(key) || !(typeof value === 'string' && value.length <= 128 || Number.isInteger(value))))) fail('invalid_input', 'tags: {chave: texto curto | inteiro}.');
  const expected = validateMetadata(metadata);
  const authored = isRecord(animations) && animations.storyboard !== undefined;
  const checked = await checkAssets(assetFiles, {hashIds: authored && isRecord(assetFiles) ? Object.keys(assetFiles) : []});
  const props = resolveAnimations(animations, expected, {assetIds: Object.keys(checked.files)});
  if (props.storyboard) assertStoryboardAssets(props.storyboard, checked.hashes);
  const report = storyboardReport(props, {width: expected.width, height: expected.height, fps: expected.fps, cutsAt, assetsVerified: Object.keys(checked.hashes)});
  const totalFrames = Math.max(1, Math.round(expected.durationSeconds * expected.fps));
  const picks = frames !== undefined
    ? (Array.isArray(frames) && frames.length >= 1 && frames.length <= 60 && frames.every((f) => Number.isInteger(f) && f >= 0 && f < totalFrames) ? frames.map((frame) => ({frame, sceneId: null, moment: 'manual'})) : fail('invalid_input', `frames: 1..60 inteiros em 0..${totalFrames - 1}.`))
    : props.storyboard ? qaFrames(props.storyboard, {perScene}).filter((item) => !sceneIds || sceneIds.includes(item.sceneId)) : [0, Math.floor(totalFrames / 2), totalFrames - 1].map((frame) => ({frame, sceneId: null, moment: 'auto'}));
  if (sceneIds !== undefined && (!Array.isArray(sceneIds) || !props.storyboard || sceneIds.some((id) => !props.storyboard.scenes.some((scene) => scene.id === id)))) fail('invalid_input', 'sceneIds: ids de cenas do storyboard.');
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 60) fail('invalid_input', 'maxImages entre 1 e 60.');
  if (picks.length > maxImages) picks.length = maxImages;
  const foundBundle = resolveRemotionBundle(bundleDir);
  if (!foundBundle.ready) fail('bundle_missing', foundBundle.reason);
  const browser = resolveBrowser({browserExecutable});
  if (browser.status !== 'ready') fail('browser_missing', browser.reason);
  const actual = await probeVideo(inputPath, {ffprobePath, signal});
  if (actual.width !== expected.width || actual.height !== expected.height || Math.abs(actual.fps - expected.fps) > 0.01) fail('metadata_mismatch', 'O vídeo de entrada não corresponde ao metadata informado.', {expected, actual});
  await bindReport(report, {inputPath, props, probe: actual});
  const screenInfo = await checkScreenTrack(props, screenPath, {...expected, durationSeconds: actual.durationSeconds}, {ffprobePath, signal});
  await mkdir(outDir, {recursive: true});
  let media = null, restoreListen = null, instance = null, pinned = null;
  const stills = [];
  try {
    pinned = await pinRemotionBundle(bundleDir);
    if (report) report.manifest.bundle = {sha256: pinned.sha256, version: pinned.version};
    const renderer = await import('@remotion/renderer');
    media = await createMediaServer({video: inputPath, ...(screenInfo ? {screen: screenPath} : {}), ...Object.fromEntries(Object.entries(checked.files).map(([id, file]) => [`asset-${id}`, file]))});
    restoreListen = enforceRemotionLoopback();
    const chromeMode = browser.chromeMode === 'headless-shell' ? 'headless-shell' : 'chrome-for-testing';
    const executable = browser.source === 'remotion-cache' ? null : browser.path;
    const assetUrls = Object.fromEntries(Object.keys(checked.files).map((id) => [id, media.url(`asset-${id}`)]));
    const inputProps = {...props, src: media.url('video'), ...(screenInfo ? {screenSrc: media.url('screen')} : {}), width: expected.width, height: expected.height, fps: expected.fps, durationSeconds: expected.durationSeconds, ...(Object.keys(assetUrls).length ? {assets: assetUrls} : {})};
    const binaries = resolveBinariesDirectory(binariesDirectory);
    const common = {serveUrl: pinned.dir, browserExecutable: executable, chromeMode, logLevel: 'error', binariesDirectory: binaries};
    instance = await renderer.openBrowser('chrome', {browserExecutable: executable, chromeMode, logLevel: 'error'});
    const composition = await renderer.selectComposition({...common, id: COMPOSITION_ID, inputProps, puppeteerInstance: instance});
    for (const [index, pick] of picks.entries()) {
      checkAbort();
      const file = path.join(outDir, `still-${String(index).padStart(3, '0')}.png`);
      if (existsSync(file)) fail('output_exists', `${file} já existe; use uma pasta nova.`);
      await renderer.renderStill({...common, composition, inputProps, frame: pick.frame, output: file, imageFormat: 'png', scale, overwrite: false, puppeteerInstance: instance});
      stills.push({...pick, position: {entrada: 'in', meio: 'mid', saida: 'out'}[pick.moment] ?? pick.moment, seconds: round3(pick.frame / expected.fps), path: file, ...(tags ? {tags} : {})});
    }
  } catch (error) {
    if (error instanceof RemotionError) throw error;
    if (signal?.aborted) throw new RemotionError('cancelled', 'Render cancelado.');
    throw new RemotionError('render_failed', `Falha nos stills Remotion: ${String(error?.message ?? error).slice(0, 600)}`);
  } finally {
    await instance?.close({silent: true}).catch(() => {});
    await pinned?.release();
    restoreListen?.();
    await media?.close().catch(() => {});
  }
  // Contact sheets de no máximo `tileLimit` quadros (cobre o storyboard inteiro, não só o começo).
  const contactSheets = [];
  const binary = resolveFfmpeg(ffmpegPath);
  for (let start = 0; stills.length > 1 && start < stills.length; start += tileLimit) {
    const count = Math.min(tileLimit, stills.length - start);
    const cols = columns ?? (expected.height > expected.width ? Math.min(8, count) : Math.min(4, count)), rows = Math.ceil(count / cols);
    const sheet = path.join(outDir, `contact-sheet-${String(contactSheets.length).padStart(2, '0')}.jpg`);
    const width = Math.round(expected.width * scale / 2) * 2;
    try {
      await runProcess(binary, ['-v', 'error', '-nostdin', '-n', '-framerate', '1', '-start_number', String(start), '-i', path.join(outDir, 'still-%03d.png'), '-frames:v', '1', '-vf', `trim=end_frame=${count},scale=${Math.min(width, 480)}:-2,tile=${cols}x${rows}:padding=8:margin=8:color=0x202020`, '-q:v', '3', sheet], signal);
      contactSheets.push({path: sheet, frames: stills.slice(start, start + count).map((item) => item.frame)});
    } catch (error) {
      if (report) report.contactSheetError = String(error?.message ?? error).slice(0, 300);
      break;
    }
  }
  const contactSheet = contactSheets[0]?.path ?? null;
  const bundle = {sha256: pinned.sha256, version: pinned.version};
  await writeFile(path.join(outDir, 'stills.json'), JSON.stringify({...(tags ? {tags} : {}), bundle, stills: stills.map(({path: file, ...rest}) => ({...rest, file: path.basename(file)})), contactSheets: contactSheets.map((item) => ({...item, path: path.basename(item.path)})), storyboard: report}, null, 2), {flag: 'wx'}).catch(() => {});
  return {stills, contactSheet, contactSheets, bundle, storyboard: report};
}
