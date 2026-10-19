// Short, faithful preview of burned speech captions: the SAME ASS document (buildAss over the full version), font file,
// style geometry and libass filter as renderBurnedCaptions, rendered over a few seconds of the base video.
// The source video is only read (sha256 checked before and after); the preview is a temporary file, never a library asset.
import {createHash, randomBytes} from 'node:crypto';
import {copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hashFile, parseFontMetrics, probeMedia, resolveFont, runProcess, SQUARE_PIXELS} from './editorial-thumbnails.mjs';
import {CAPTIONS_ENGINE_ID, CAPTIONS_ENGINE_VERSION, CaptionError, buildAss, captionsHash, fontNames, missingGlyphs, validateCaptionSegments, validateCaptionStyle} from './editorial-captions.mjs';

export const CAPTION_PREVIEW_SCHEMA = 'mainsagents.caption-preview/1';
export const CAPTION_PREVIEW_LIMITS = Object.freeze({maxSeconds: 6, minSeconds: 1, maxHeight: 720, timeoutMs: 120_000});
const fail = (code, message) => { throw new CaptionError(code, message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Preview window on the base video's timeline: start on a 0.1 s grid, at most 6 s, inside the video. */
export function captionPreviewWindow(startSeconds, durationSeconds) {
  const total = Number(durationSeconds), wanted = Number(startSeconds);
  if (!Number.isFinite(total) || total <= 0) fail('invalid_source', 'Duração do vídeo desconhecida.');
  if (!Number.isFinite(wanted) || wanted < 0 || wanted >= total) fail('invalid_window', 'Escolha um instante dentro do vídeo.');
  const length = Math.min(CAPTION_PREVIEW_LIMITS.maxSeconds, total);
  const start = Math.round(Math.max(0, Math.min(wanted, total - length)) * 10) / 10;
  return {start, duration: Math.round(Math.min(length, total - start) * 1000) / 1000};
}

/** sha256 of the font the burn would use now (a replaced font invalidates cached previews). */
export async function captionPreviewFont(fontPath) { return (await resolveFont(fontPath)).sha256; }

/** Cache key: changes with the source file, caption version hash, style, window, font and engine. */
export function captionPreviewKey({sourceSha256, captionsHash: hash, styleId, start, duration, fontSha256}) {
  return sha256(JSON.stringify([CAPTION_PREVIEW_SCHEMA, CAPTIONS_ENGINE_ID, CAPTIONS_ENGINE_VERSION, sourceSha256, hash, styleId, start, duration, fontSha256 ?? null])).slice(0, 32);
}

/**
 * Renders [start, start+duration] of the source with the captions burned exactly as the final file would have them.
 * Timing: frames keep their ORIGINAL timestamps while libass draws (setpts +start), so the unshifted ASS of the whole
 * version is used; the output is then rebased to 0 and scaled down (after drawing) to at most 720 px high.
 */
export async function renderCaptionPreview({source, segments: rawSegments, styleId, startSeconds, outputPath, fontPath, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal} = {}) {
  if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path) || !/^[0-9a-f]{64}$/.test(String(source.sha256))) fail('invalid_source', 'Informe o vídeo pela versão registrada (sha256).');
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || !/\.mp4$/i.test(outputPath) || path.resolve(outputPath) === path.resolve(source.path)) fail('invalid_output', 'outputPath deve ser um .mp4 absoluto diferente do vídeo.');
  validateCaptionStyle(styleId);
  if (await hashFile(source.path).catch(() => null) !== source.sha256) fail('source_changed', 'O vídeo não corresponde mais à versão revisada (sha256 diferente).');
  const media = await probeMedia(source.path, {ffprobePath, signal});
  const segments = validateCaptionSegments(rawSegments, media.durationSeconds), window = captionPreviewWindow(startSeconds, media.durationSeconds);
  const resolved = await resolveFont(fontPath), fontBuffer = await readFile(resolved.path), metrics = parseFontMetrics(fontBuffer), names = fontNames(fontBuffer);
  const missing = missingGlyphs(segments, metrics);
  if (missing.length) fail('unsupported_glyph', `A fonte ${names.family} não tem: ${missing.slice(0, 12).join(' ')}. Troque esses caracteres (ex.: emojis) no texto.`);
  const {width, height} = media.display, ass = buildAss({segments, styleId, width, height, font: names, metrics});
  const work = `${outputPath}.${randomBytes(4).toString('hex')}.work`, partial = path.join(work, 'preview.partial.mp4');
  const scale = height > CAPTION_PREVIEW_LIMITS.maxHeight ? `,scale=-2:${CAPTION_PREVIEW_LIMITS.maxHeight}` : '';
  try {
    await mkdir(path.join(work, 'fonts'), {recursive: true});
    await writeFile(path.join(work, 'captions.ass'), ass, 'utf8');
    await copyFile(resolved.path, path.join(work, 'fonts', path.basename(resolved.path)));
    await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-ss', String(window.start), '-t', String(window.duration), '-i', source.path,
      '-vf', `${SQUARE_PIXELS},setpts=PTS+${window.start}/TB,subtitles=filename=captions.ass:fontsdir=fonts,setpts=PTS-STARTPTS${scale}`,
      '-map', '0:v:0', ...(media.hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', 'preview.partial.mp4'],
    {cwd: work, signal, timeoutMs: CAPTION_PREVIEW_LIMITS.timeoutMs});
    const out = await probeMedia(partial, {ffprobePath, signal});
    if (!out.durationSeconds || Math.abs(out.durationSeconds - window.duration) > 0.1 + (media.fps ? 2 / media.fps : 0.1)) fail('verify_failed', 'A prévia das legendas saiu com duração diferente do trecho.');
    if (await hashFile(source.path) !== source.sha256) fail('source_changed', 'O vídeo original mudou durante a prévia.');
    const info = await stat(partial), digest = await hashFile(partial);
    await rename(partial, outputPath);
    return {
      schema: CAPTION_PREVIEW_SCHEMA, engine: {id: CAPTIONS_ENGINE_ID, version: CAPTIONS_ENGINE_VERSION}, window, style: {id: styleId},
      captions: {hash: captionsHash(segments), count: segments.length, assSha256: sha256(ass), visible: segments.filter((item) => item.end > window.start && item.start < window.start + window.duration).length},
      font: {family: names.family, sha256: resolved.sha256}, source: {sha256: source.sha256, width, height, preserved: true},
      output: {path: outputPath, sha256: digest, size: info.size, durationSeconds: out.durationSeconds, width: out.width, height: out.height, hasAudio: out.hasAudio},
      requiresAi: false, network: false,
    };
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}
