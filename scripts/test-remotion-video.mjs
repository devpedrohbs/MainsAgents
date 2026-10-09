// Smoke REAL do template Remotion: vídeo sintético 320x180@15fps com áudio -> renderAnimatedVideo -> frames de QA.
// Uso: node scripts/test-remotion-video.mjs [pastaDeFrames]   (exit 1 em falha; exit 2 se dependência local faltar)
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildRemotionBundle, remotionBundleDir} from './build-remotion-video.mjs';
import {getRemotionCapabilities, probeVideo, renderAnimatedVideo} from '../editorial-remotion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SMOKE = Object.freeze({width: 320, height: 180, fps: 15, seconds: 6, frames: {start: 1.0, middle: 3.5, end: 5.5}});
export const SMOKE_ANIMATIONS = Object.freeze({
  title: {text: 'Título de teste', startSeconds: 0.3, durationSeconds: 2},
  lowerThird: {name: 'Maria Souza', role: 'Editora', startSeconds: 0.8, durationSeconds: 2.4},
  cta: {text: 'Siga para mais', durationSeconds: 2},
  accent: '#e0245e'
});

export function run(command, args, {binary = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const out = [];
    let err = '';
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-3000); });
    child.on('error', reject);
    child.on('close', (code) => {
      const buffer = Buffer.concat(out);
      code === 0 ? resolve(binary ? buffer : buffer.toString('utf8')) : reject(new Error(`${command} ${code}: ${err}`));
    });
  });
}

export const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

export async function hasFfmpeg() {
  try { await run('ffmpeg', ['-version']); return true; } catch { return false; }
}

export async function makeSyntheticVideo(file, {channels = 2, audio = 'aac'} = {}) {
  const {width, height, fps, seconds} = SMOKE;
  const video = ['-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=${seconds}`];
  if (audio === 'none') return run('ffmpeg', ['-v', 'error', '-y', ...video, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const layout = channels === 1 ? [] : ['-filter_complex', '[1:a]pan=stereo|c0=c0|c1=c0[a]', '-map', '0:v', '-map', '[a]'];
  const codec = audio === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '128k'] : ['-c:a', 'aac'];
  return run('ffmpeg', ['-v', 'error', '-y', ...video, '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    ...layout, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...codec, '-shortest', file]);
}

async function rawFrame(file, seconds) {
  return run('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {binary: true});
}

export async function savePng(file, seconds, target, scale = 1) {
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', `scale=iw*${scale}:ih*${scale}:flags=neighbor`, target]);
}

export function meanAbsDiff(a, b) {
  let total = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / length;
}

export async function audioRms(file) {
  const pcm = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], {binary: true});
  let sum = 0;
  const samples = Math.floor(pcm.length / 2);
  for (let i = 0; i < samples; i += 1) sum += pcm.readInt16LE(i * 2) ** 2;
  return {rms: Math.sqrt(sum / Math.max(1, samples)), seconds: samples / 8000};
}

/** Executa o smoke completo. Retorna medições; lança Error com a falha. */
export async function runSmoke({framesDir, log = () => {}, bundleDir, source = {}} = {}) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'remotion-smoke-'));
  try {
    const input = path.join(work, 'input-cut.mp4');
    const output = path.join(work, 'output.mp4');
    await makeSyntheticVideo(input, source);
    const metadata = await probeVideo(input);
    const hashBefore = await sha256(input);
    log(`entrada: ${metadata.width}x${metadata.height} ${metadata.fps}fps ${metadata.durationSeconds}s áudio=${metadata.hasAudio}`);
    const bundle = bundleDir ?? (existsSync(path.join(remotionBundleDir, 'index.html')) ? remotionBundleDir : await buildRemotionBundle({outDir: path.join(work, 'bundle')}));
    const capabilities = await getRemotionCapabilities({bundleDir: bundle});
    if (!capabilities.available) {
      const error = new Error(`Dependência ausente: ${capabilities.reasons.join(' ')}`);
      error.code = 'dependency_missing';
      throw error;
    }
    const started = Date.now();
    const progress = [];
    const result = await renderAnimatedVideo({
      inputPath: input, outputPath: output, bundleDir: bundle, animations: SMOKE_ANIMATIONS,
      metadata: {width: metadata.width, height: metadata.height, fps: metadata.fps, durationSeconds: metadata.durationSeconds, hasAudio: metadata.hasAudio},
      onProgress: (item) => progress.push(item.phase)
    });
    const elapsedMs = Date.now() - started;
    const out = await probeVideo(output);
    const audio = metadata.hasAudio ? {input: await audioRms(input), output: await audioRms(output)} : null;
    const sourceIntact = (await sha256(input)) === hashBefore;
    const diffs = {};
    for (const [name, at] of Object.entries(SMOKE.frames)) {
      diffs[name] = meanAbsDiff(await rawFrame(input, at), await rawFrame(output, at));
      if (framesDir) {
        await mkdir(framesDir, {recursive: true});
        await savePng(output, at, path.join(framesDir, `${name}-after-x3.png`), 3);
        await savePng(input, at, path.join(framesDir, `${name}-before-x3.png`), 3);
      }
    }
    return {
      elapsedMs, result, probeOut: out, probeIn: metadata, diffs, audio, sourceIntact, progress,
      sizeBytes: (await stat(output)).size, browser: capabilities.browser, tempOutputsLeft: false
    };
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

export function assertSmoke(m) {
  const problems = [];
  const {width, height, fps, seconds} = SMOKE;
  if (m.probeOut.width !== width || m.probeOut.height !== height) problems.push(`dimensões ${m.probeOut.width}x${m.probeOut.height}`);
  if (Math.abs(m.probeOut.fps - fps) > 0.01) problems.push(`fps ${m.probeOut.fps}`);
  if (Math.abs(m.probeOut.durationSeconds - seconds) > 0.2) problems.push(`duração ${m.probeOut.durationSeconds}`);
  if (!m.sourceIntact) problems.push('arquivo de origem foi alterado');
  if (Math.abs(m.probeOut.durationSeconds - seconds) > 2 / fps + 0.1) problems.push(`duração fora de 2 frames+0,1s`);
  if (m.probeIn.hasAudio !== m.probeOut.hasAudio) problems.push('presença de áudio mudou');
  if (m.probeIn.hasAudio) {
    if (m.probeOut.audioChannels !== m.probeIn.audioChannels) problems.push(`canais ${m.probeOut.audioChannels} vs ${m.probeIn.audioChannels}`);
    if (m.probeOut.audioSampleRate !== m.probeIn.audioSampleRate) problems.push('taxa de áudio mudou');
    const tolerance = m.result.audio.mode === 'copy' ? 0.02 : 0.1;
    if (Math.abs(m.audio.output.rms / m.audio.input.rms - 1) > tolerance) problems.push(`RMS de áudio ${m.audio.output.rms.toFixed(0)} vs ${m.audio.input.rms.toFixed(0)}`);
    if (Math.abs(m.audio.output.seconds - m.audio.input.seconds) > 2 / fps + 0.1) problems.push('duração do áudio mudou');
  }
  if (m.diffs.start < 2) problems.push(`frame inicial sem overlay (diff ${m.diffs.start.toFixed(2)})`);
  if (m.diffs.end < 2) problems.push(`frame final sem CTA (diff ${m.diffs.end.toFixed(2)})`);
  if (m.diffs.middle > 4) problems.push(`frame do meio deveria estar limpo (diff ${m.diffs.middle.toFixed(2)})`);
  if (problems.length) throw new Error(`Smoke Remotion reprovado: ${problems.join('; ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const framesDir = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'analysis', 'editing-remotion-frames'));
  try {
    if (!(await hasFfmpeg())) { console.error('ffmpeg ausente no PATH (necessário para gerar o vídeo sintético).'); process.exit(2); }
    const metrics = await runSmoke({framesDir, log: console.log});
    assertSmoke(metrics);
    console.log(JSON.stringify({ok: true, elapsedMs: metrics.elapsedMs, sizeBytes: metrics.sizeBytes, out: metrics.probeOut, diffs: metrics.diffs, audio: metrics.audio, browser: metrics.browser, framesDir}, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error?.code === 'dependency_missing' ? 2 : 1);
  }
}
