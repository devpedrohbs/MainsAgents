// Adaptador local do Remotion: sobrepõe título, tarja (lower-third) e CTA sobre um vídeo JÁ CORTADO.
// Sem JS/HTML/URL externa fornecidos pelo usuário, sem cloud: usa o bundle pré-compilado em dist/remotion
// (scripts/build-remotion-video.mjs), um servidor de mídia loopback com token e o Chromium local.
import {spawn} from 'node:child_process';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createReadStream, existsSync, readFileSync} from 'node:fs';
import {copyFile, link, mkdir, open as openFile, stat, unlink, writeFile} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveMotionProps, sfxBedWav, sfxMixFilter} from './editorial-motion-plan.mjs';

export const REMOTION_VERSION = '4.0.534';
export const COMPOSITION_ID = 'OverlayVideo';
export const LIMITS = Object.freeze({
  title: 80, name: 60, role: 80, cta: 80,
  maxWidth: 3840, maxHeight: 3840, maxDurationSeconds: 1800, maxFps: 60, minFps: 1,
  minWindowSeconds: 0.5
});
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BUNDLE_DIR = path.join(MODULE_DIR, 'dist', 'remotion');
const INPUT_TYPES = {'.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska'};
/** Imagens do USUÁRIO para explicativos: só arquivos locais já autorizados pelo servidor (assetId -> caminho), nunca do spec. */
const ASSET_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'};
export const ASSET_LIMITS = Object.freeze({maxAssets: 8, maxBytes: 20 * 1024 * 1024});
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
  onlyKeys(raw, ['title', 'lowerThird', 'cta', 'theme', 'accent', 'motion', 'protect'], 'animations');
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
  if (!out.title && !out.lowerThird && !out.cta && !out.motion) fail('invalid_animations', 'Informe ao menos título, tarja, CTA ou motion.');
  return out;
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
  return {width: video.width, height: video.height, fps: round3(parseRate(video.avg_frame_rate || video.r_frame_rate)), durationSeconds: duration, hasAudio: audio, videoCodec: video.codec_name,
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
const AUDIO_ENCODE_BITRATE = '192k';

/**
 * Cola o áudio ORIGINAL do vídeo de entrada sobre o vídeo renderizado (sem áudio) em arquivo novo.
 * AAC -> -c:a copy (amostras e canais idênticos); outro codec -> AAC limitado a 192k mantendo canais/taxa.
 */
async function remuxOriginalAudio({videoPath, audioSource, target, audio, ffmpegPath, signal}) {
  const binary = resolveFfmpeg(ffmpegPath);
  if (!binary) fail('dependency_missing', 'ffmpeg indicado não existe.');
  const mode = AAC_COPY_CODECS.has(audio.audioCodec) ? 'copy' : 'encode';
  const args = ['-v', 'error', '-nostdin', '-y', '-i', videoPath, '-i', audioSource, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    ...(mode === 'copy' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', AUDIO_ENCODE_BITRATE]), '-movflags', '+faststart', '-f', 'mp4', target];
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
async function remuxWithSfx({videoPath, audioSource, target, audio, sfx, durationSeconds, ffmpegPath, signal}) {
  const binary = resolveFfmpeg(ffmpegPath);
  if (!binary) fail('dependency_missing', 'ffmpeg indicado não existe.');
  const bed = target.replace(/\.mp4$/, '.sfx.wav');
  await writeFile(bed, sfxBedWav(sfx, durationSeconds, audio.audioSampleRate), {flag: 'wx'});
  const args = ['-v', 'error', '-nostdin', '-y', '-i', videoPath, '-i', audioSource, '-i', bed, '-filter_complex', sfxMixFilter({sampleRate: audio.audioSampleRate, channels: audio.audioChannels}),
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
  const bundleReady = existsSync(path.join(bundleDir, 'index.html'));
  if (!bundleReady) reasons.push('Bundle pré-compilado ausente (rode node scripts/build-remotion-video.mjs).');
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
    template: {id: COMPOSITION_ID, overlays: ['title', 'lowerThird', 'cta', 'motion'], limits: LIMITS, defaults: DEFAULTS, inputExtensions: Object.keys(INPUT_TYPES), output: 'mp4/h264/aac'},
    versions,
    bundle: {ready: bundleReady, path: bundleDir},
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
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'};

/**
 * Valida o mapa assetId -> caminho local que o SERVIDOR já autorizou (versão/sha256 conferidos por ele): caminho
 * absoluto, extensão de imagem, assinatura do arquivo compatível, tamanho <= 20 MB, no máximo 8. Nunca vem do spec.
 */
export async function validateAssetFiles(assetFiles) {
  if (assetFiles === undefined || assetFiles === null) return {};
  if (!isRecord(assetFiles) || Object.keys(assetFiles).length > ASSET_LIMITS.maxAssets) fail('invalid_input', `assetFiles: no máximo ${ASSET_LIMITS.maxAssets} imagens.`);
  const out = {};
  for (const [id, file] of Object.entries(assetFiles)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof file !== 'string' || !path.isAbsolute(file)) fail('invalid_input', 'assetFiles: id simples e caminho absoluto.');
    const ext = path.extname(file).toLowerCase();
    if (!ASSET_TYPES[ext]) fail('invalid_input', `assetFiles.${id}: só PNG, JPEG ou WebP.`);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size < 12 || info.size > ASSET_LIMITS.maxBytes) fail('invalid_input', `assetFiles.${id}: arquivo ausente ou maior que 20 MB.`);
    const handle = await openFile(file, 'r');
    try { const head = Buffer.alloc(12); await handle.read(head, 0, 12, 0); if (!IMAGE_MAGIC[ext](head)) fail('invalid_input', `assetFiles.${id}: conteúdo não corresponde a ${ext}.`); } finally { await handle.close(); }
    out[id] = file;
  }
  return out;
}

/**
 * Renderiza overlays sobre o vídeo cortado. `inputPath` deve ter sido verificado pelo engine.
 * Resolve com {outputPath,width,height,fps,durationSeconds,hasAudio,browser}; cancela com RemotionError('cancelled').
 */
export async function renderAnimatedVideo({inputPath, outputPath, metadata, animations, signal, onProgress, browserExecutable, bundleDir = DEFAULT_BUNDLE_DIR, ffprobePath, ffmpegPath, binariesDirectory, assetFiles} = {}) {
  const emit = (phase, progress) => { try { onProgress?.({phase, progress: Math.min(1, Math.max(0, progress))}); } catch { /* observador não deve quebrar o render */ } };
  const checkAbort = () => { if (signal?.aborted) fail('cancelled', 'Render cancelado.'); };
  checkAbort();
  assertInputFile(inputPath);
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mp4') fail('invalid_output', 'outputPath deve ser caminho absoluto .mp4.');
  if (path.resolve(inputPath) === path.resolve(outputPath)) fail('invalid_output', 'outputPath não pode ser o próprio vídeo de entrada.');
  const expected = validateMetadata(metadata);
  const assets = await validateAssetFiles(assetFiles);
  const props = resolveAnimations(animations, expected, {assetIds: Object.keys(assets)});
  const inputInfo = await stat(inputPath).catch(() => null);
  if (!inputInfo?.isFile()) fail('invalid_input', 'inputPath não é um arquivo existente.');
  if (existsSync(outputPath)) fail('output_exists', 'outputPath já existe; o adaptador nunca sobrescreve.');
  if (!existsSync(path.join(bundleDir, 'index.html'))) fail('bundle_missing', 'Bundle Remotion pré-compilado ausente. Rode node scripts/build-remotion-video.mjs.');
  const browser = resolveBrowser({browserExecutable});
  if (browser.status !== 'ready') fail('browser_missing', browser.reason);

  emit('browser', 0);
  const actual = await probeVideo(inputPath, {ffprobePath, signal});
  const frame = 1 / expected.fps;
  if (actual.width !== expected.width || actual.height !== expected.height || Math.abs(actual.fps - expected.fps) > 0.01
    || Math.abs(actual.durationSeconds - expected.durationSeconds) > frame + 0.1 || actual.hasAudio !== expected.hasAudio) {
    fail('metadata_mismatch', 'O vídeo de entrada não corresponde ao metadata informado.', {expected, actual: {width: actual.width, height: actual.height, fps: actual.fps, durationSeconds: actual.durationSeconds, hasAudio: actual.hasAudio}});
  }
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
  try {
    const renderer = await import('@remotion/renderer');
    media = await createMediaServer({video: inputPath, ...Object.fromEntries(Object.entries(assets).map(([id, file]) => [`asset-${id}`, file]))});
    restoreListen = enforceRemotionLoopback();
    const {cancelSignal, cancel} = renderer.makeCancelSignal();
    aborter = () => cancel();
    signal?.addEventListener('abort', aborter, {once: true});
    const chromeMode = browser.chromeMode === 'headless-shell' ? 'headless-shell' : 'chrome-for-testing';
    const executable = browser.source === 'remotion-cache' ? null : browser.path;
    const assetUrls = Object.fromEntries(Object.keys(assets).map((id) => [id, media.url(`asset-${id}`)]));
    const inputProps = {...props, src: media.url('video'), width: expected.width, height: expected.height, fps: expected.fps, durationSeconds: expected.durationSeconds, ...(Object.keys(assetUrls).length ? {assets: assetUrls} : {})};
    const binaries = resolveBinariesDirectory(binariesDirectory);
    if (binariesDirectory && !binaries) fail('dependency_missing', 'binariesDirectory indicado não existe.');
    const common = {serveUrl: bundleDir, browserExecutable: executable, chromeMode, logLevel: 'error', offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024, binariesDirectory: binaries};
    const composition = await renderer.selectComposition({...common, id: COMPOSITION_ID, inputProps});
    checkAbort();
    emit('render', 0);
    await renderer.renderMedia({
      ...common, composition, inputProps, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p', outputLocation: tempPath, overwrite: false,
      crf: 20, concurrency: 2, cancelSignal, muted: true, // o áudio vem do arquivo original (remux), nunca do mixer do Remotion
      onProgress: ({progress}) => emit('render', progress)
    });
    checkAbort();
    let finalTemp = tempPath;
    let audioMode = 'none';
    if (expected.hasAudio) {
      emit('verify', 0);
      const current = await stat(inputPath).catch(() => null);
      if (!current?.isFile() || current.size !== inputInfo.size || current.mtimeMs !== inputInfo.mtimeMs) fail('input_changed', 'O vídeo de entrada mudou durante o render; nada foi entregue.');
      const sfx = props.motion?.sfx ?? [];
      audioMode = sfx.length && [1, 2].includes(actual.audioChannels) && actual.audioSampleRate >= 8000
        ? await remuxWithSfx({videoPath: tempPath, audioSource: inputPath, target: mixPath, audio: actual, sfx, durationSeconds: expected.durationSeconds, ffmpegPath, signal})
        : await remuxOriginalAudio({videoPath: tempPath, audioSource: inputPath, target: mixPath, audio: actual, ffmpegPath, signal});
      finalTemp = mixPath;
      checkAbort();
    }
    emit('verify', 0.5);
    const result = await probeVideo(finalTemp, {ffprobePath, signal});
    const problems = [];
    if (result.width !== expected.width || result.height !== expected.height) problems.push(`dimensões ${result.width}x${result.height}`);
    if (Math.abs(result.durationSeconds - expected.durationSeconds) > 2 * frame + 0.1) problems.push(`duração ${result.durationSeconds}s`);
    if (result.hasAudio !== expected.hasAudio) problems.push(expected.hasAudio ? 'áudio perdido' : 'áudio inesperado');
    if (result.videoCodec !== 'h264') problems.push(`codec ${result.videoCodec}`);
    if (expected.hasAudio) {
      if (result.audioChannels !== actual.audioChannels) problems.push(`canais ${result.audioChannels} (fonte ${actual.audioChannels})`);
      if (result.audioSampleRate !== actual.audioSampleRate) problems.push(`taxa de áudio ${result.audioSampleRate} (fonte ${actual.audioSampleRate})`);
      if (Math.abs(result.audioDurationSeconds - actual.audioDurationSeconds) > 2 * frame + 0.1) problems.push(`duração do áudio ${result.audioDurationSeconds}s (fonte ${actual.audioDurationSeconds}s)`);
    }
    if (problems.length) fail('verify_failed', `Saída não confere com o esperado: ${problems.join(', ')}.`, {expected, actual: result});
    await publishNew(finalTemp, outputPath);
    emit('verify', 1);
    return {outputPath, width: result.width, height: result.height, fps: result.fps, durationSeconds: round3(result.durationSeconds), hasAudio: result.hasAudio, audio: result.hasAudio ? {mode: audioMode, codec: result.audioCodec, channels: result.audioChannels, sampleRate: result.audioSampleRate} : {mode: 'none'}, browser: {source: browser.source, path: browser.path}, animations: props};
  } catch (error) {
    if (error instanceof RemotionError) throw error;
    if (signal?.aborted || /cancel/i.test(String(error?.message))) throw new RemotionError('cancelled', 'Render cancelado.');
    throw new RemotionError('render_failed', `Falha no render Remotion: ${String(error?.message ?? error).slice(0, 600)}`);
  } finally {
    if (aborter) signal?.removeEventListener('abort', aborter);
    restoreListen?.();
    await media?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    await unlink(mixPath).catch(() => {});
  }
}
