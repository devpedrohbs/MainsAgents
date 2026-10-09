// Legendas de fala gravadas no MP4 (B05). Texto e tempos vêm de uma versão revisada pelo usuário (transcrição local
// do Whisper, SRT importado ou edição manual); este módulo só valida, monta um ASS com três estilos genéricos e
// grava com FFmpeg/libass. Sem IA, rede, download de fontes ou correção automática do que foi falado.
// O vídeo de origem nunca é escrito; o MP4 final só aparece no destino depois de verificado (rename atômico).
import {createHash, randomBytes} from 'node:crypto';
import {copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hashFile, parseFontMetrics, probeMedia, resolveFont, runProcess, SQUARE_PIXELS} from './editorial-thumbnails.mjs';
import {toSrt} from './editorial-smart-edit.mjs';

export const CAPTIONS_ENGINE_ID = 'ffmpeg-libass';
export const CAPTIONS_ENGINE_VERSION = '1';
export const CAPTIONS_SCHEMA = 'mainsagents.captions/1';
export const BURNED_SCHEMA = 'mainsagents.burned-captions/1';
export const CAPTION_LIMITS = Object.freeze({maxSegments: 2000, maxText: 160, maxLines: 2, minDuration: 0.2, maxDuration: 12, maxVideoSeconds: 3600, maxSrtBytes: 2_000_000, renderTimeoutMs: 3_600_000});

export class CaptionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CaptionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
const fail = (code, message, details) => { throw new CaptionError(code, message, details); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value) => Math.round(value * 1000) / 1000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Três estilos genéricos (não são identidade de loja). Tamanhos e margens são frações do lado menor/altura do vídeo
 * já rotacionado, então valem para 9:16, 16:9 e 1:1. Cores em #RRGGBB, opacidade 0..1.
 */
const STYLES = Object.freeze({
  classic: {label: 'Clássico — texto branco com contorno', size: 0.062, marginV: 0.11, marginH: 0.07, text: '#ffffff', outline: '#000000', outlineWidth: 0.0055, box: null},
  boxed: {label: 'Caixa — texto branco sobre faixa escura', size: 0.058, marginV: 0.11, marginH: 0.08, text: '#ffffff', outline: '#000000', outlineWidth: 0, box: {color: '#000000', opacity: 0.72, pad: 0.012}},
  highlight: {label: 'Destaque — amarelo com contorno, mais alto', size: 0.068, marginV: 0.22, marginH: 0.07, text: '#ffd400', outline: '#000000', outlineWidth: 0.007, box: null},
});
export const CAPTION_STYLE_IDS = Object.freeze(Object.keys(STYLES));
export function listCaptionStyles() {
  return CAPTION_STYLE_IDS.map((id) => ({id, label: STYLES[id].label}));
}
export function validateCaptionStyle(id) {
  if (!CAPTION_STYLE_IDS.includes(id)) fail('invalid_style', 'Escolha um dos estilos de legenda disponíveis.');
  return id;
}

/** Segmentos ordenados, sem sobreposição, dentro do vídeo e com texto curto, sem marcações ASS. */
export function validateCaptionSegments(raw, durationSeconds) {
  if (!Array.isArray(raw) || !raw.length) fail('invalid_captions', 'Inclua pelo menos uma legenda com texto e tempo.');
  if (raw.length > CAPTION_LIMITS.maxSegments) fail('invalid_captions', `Use no máximo ${CAPTION_LIMITS.maxSegments} legendas.`);
  const limit = finite(durationSeconds) && durationSeconds > 0 ? durationSeconds : Infinity;
  let previousEnd = 0;
  return raw.map((item, index) => {
    const n = index + 1;
    if (!item || typeof item !== 'object' || Object.keys(item).some((key) => !['start', 'end', 'text'].includes(key))) fail('invalid_captions', `Legenda ${n}: campos inválidos.`);
    const start = round(Number(item.start)), end = round(Number(item.end));
    if (!finite(item.start) || !finite(item.end) || start < 0 || end <= start) fail('invalid_timing', `Legenda ${n}: o fim precisa vir depois do início.`, {index});
    if (end > limit + 0.05) fail('invalid_timing', `Legenda ${n}: termina depois do fim do vídeo (${limit.toFixed(2)} s).`, {index});
    if (start < previousEnd - 0.001) fail('invalid_timing', `Legenda ${n}: começa antes do fim da anterior. Ajuste para não sobrepor.`, {index});
    if (end - start < CAPTION_LIMITS.minDuration) fail('invalid_timing', `Legenda ${n}: fica menos de ${CAPTION_LIMITS.minDuration} s na tela.`, {index});
    if (end - start > CAPTION_LIMITS.maxDuration) fail('invalid_timing', `Legenda ${n}: fica mais de ${CAPTION_LIMITS.maxDuration} s na tela; divida em partes.`, {index});
    if (typeof item.text !== 'string') fail('invalid_text', `Legenda ${n}: texto inválido.`, {index});
    const text = item.text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (!text) fail('invalid_text', `Legenda ${n}: texto vazio. Remova a linha ou escreva o que foi falado.`, {index});
    if ([...text].length > CAPTION_LIMITS.maxText) fail('invalid_text', `Legenda ${n}: texto longo demais (máximo ${CAPTION_LIMITS.maxText} caracteres).`, {index});
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) fail('invalid_text', `Legenda ${n}: contém caracteres de controle.`, {index});
    if (/[{}\\]/.test(text)) fail('invalid_text', `Legenda ${n}: os caracteres { } \\ não são aceitos em legendas gravadas.`, {index});
    if (text.split('\n').length > CAPTION_LIMITS.maxLines) fail('invalid_text', `Legenda ${n}: use no máximo ${CAPTION_LIMITS.maxLines} linhas.`, {index});
    previousEnd = Math.min(end, limit);
    return {start, end: round(Math.min(end, limit)), text};
  });
}

/** Hash estável da versão: o que é aprovado e gravado no vídeo. */
export function captionsHash(segments) {
  return sha256(JSON.stringify(segments.map(({start, end, text}) => [start, end, text])));
}

const parseClock = (value) => {
  const match = /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/.exec(value);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000;
};
/** SubRip (inclusive o exportado para o CapCut). Tags simples de formatação são removidas; nada é inventado. */
export function parseSrt(text, durationSeconds) {
  if (typeof text !== 'string' || !text.trim()) fail('invalid_srt', 'O arquivo SRT está vazio.');
  if (Buffer.byteLength(text) > CAPTION_LIMITS.maxSrtBytes) fail('invalid_srt', 'O arquivo SRT é grande demais.');
  const blocks = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const segments = [];
  for (const [index, block] of blocks.entries()) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0 || at > 1) fail('invalid_srt', `SRT: bloco ${index + 1} sem tempo válido.`);
    const [from, to] = lines[at].split('-->').map((part) => parseClock(part.trim().split(/\s+/)[0]));
    if (!Number.isFinite(from) || !Number.isFinite(to)) fail('invalid_srt', `SRT: tempo ilegível no bloco ${index + 1}.`);
    const body = lines.slice(at + 1).join('\n').replace(/<\/?[biu]>/gi, '').replace(/<\/?font[^>]*>/gi, '').trim();
    if (body) segments.push({start: from, end: to, text: body});
  }
  return validateCaptionSegments(segments, durationSeconds);
}
export function captionsToSrt(segments) {
  return '\ufeff' + toSrt(segments.map((item) => ({...item, text: item.text.replace(/\n/g, ' ')})));
}

/**
 * Primeira versão a partir da transcrição local. Frases longas são divididas por palavras e o tempo de cada parte é
 * PROPORCIONAL ao número de caracteres: é uma aproximação, nunca sincronia por palavra. `warnings` diz isso ao usuário.
 */
export function captionsFromTranscript(transcript, durationSeconds, {maxChars = 84} = {}) {
  const source = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const warnings = ['whisper-approximate'];
  if (transcript?.timing !== 'words') warnings.push('sentence-timing');
  const segments = [];
  let split = false;
  for (const item of source) {
    const text = String(item?.text ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
    const start = Number(item?.start), end = Math.min(Number(item?.end), durationSeconds);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end - start < CAPTION_LIMITS.minDuration) continue;
    const parts = [];
    let current = '';
    for (const word of text.split(' ')) {
      const next = current ? `${current} ${word}` : word;
      if ([...next].length > maxChars && current) { parts.push(current); current = word; } else current = [...next].slice(0, CAPTION_LIMITS.maxText).join('');
    }
    if (current) parts.push(current);
    const pieces = [];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let cursor = start;
    for (const [index, part] of parts.entries()) {
      const pieceEnd = index === parts.length - 1 ? end : round(cursor + (end - start) * part.length / total);
      pieces.push({start: round(cursor), end: round(pieceEnd), text: part});
      cursor = pieceEnd;
    }
    if (pieces.length > 1) split = true;
    for (const piece of pieces) {
      const last = segments.at(-1);
      if (last && piece.start < last.end) piece.start = last.end;
      if (piece.end - piece.start > CAPTION_LIMITS.maxDuration) piece.end = round(piece.start + CAPTION_LIMITS.maxDuration);
      if (piece.end - piece.start >= CAPTION_LIMITS.minDuration) segments.push(piece);
    }
  }
  if (split) warnings.push('split-proportional');
  if (!segments.length) return {segments: [], warnings: [...warnings, 'no-speech']};
  return {segments: validateCaptionSegments(segments, durationSeconds), warnings};
}

/** Família e subfamília (tabela `name`) para o libass encontrar a mesma fonte que mediu o texto. */
export function fontNames(buffer) {
  const count = buffer.readUInt16BE(4);
  let table;
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    if (buffer.toString('latin1', at, at + 4) === 'name') table = buffer.readUInt32BE(at + 8);
  }
  if (table === undefined) fail('invalid_font', 'Fonte sem a tabela name.');
  const records = buffer.readUInt16BE(table + 2), strings = table + buffer.readUInt16BE(table + 4);
  const found = {};
  for (let index = 0; index < records; index += 1) {
    const at = table + 6 + index * 12;
    const platform = buffer.readUInt16BE(at), language = buffer.readUInt16BE(at + 4), id = buffer.readUInt16BE(at + 6), length = buffer.readUInt16BE(at + 8), offset = buffer.readUInt16BE(at + 10);
    if (![1, 2].includes(id)) continue;
    const bytes = buffer.subarray(strings + offset, strings + offset + length);
    if (platform === 3 && language === 0x409) found[id] = Buffer.from(bytes).swap16().toString('utf16le');
    else if (platform === 1 && found[id] === undefined) found[id] = bytes.toString('latin1');
  }
  if (!found[1]) fail('invalid_font', 'Não foi possível ler o nome da fonte.');
  return {family: found[1], subfamily: found[2] ?? 'Regular'};
}

const assColor = (hex, opacity = 1) => {
  const alpha = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0');
  return `&H${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
};
const assTime = (seconds) => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

/** Geometria do estilo em pixels do vídeo como ele é exibido (pós-rotação e pixels quadrados). */
export function captionGeometry(styleId, {width, height}) {
  const style = STYLES[validateCaptionStyle(styleId)], side = Math.min(width, height);
  return {
    fontSize: Math.max(12, Math.round(side * style.size)), marginV: Math.round(height * style.marginV), marginH: Math.round(width * style.marginH),
    outline: style.box ? Math.max(2, Math.round(side * style.box.pad)) : Math.max(1, Math.round(side * style.outlineWidth)), maxLineWidth: width - 2 * Math.round(width * style.marginH),
  };
}

/** Quebra por largura medida na própria fonte (conservadora: em-box, sem kerning). Mais de duas linhas é erro, não corte. */
export function layoutCaptionText(text, {metrics, fontSize, maxLineWidth}) {
  const widthOf = (value) => metrics.measure(value) * fontSize / metrics.unitsPerEm;
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const next = current ? `${current} ${word}` : word;
      if (current && widthOf(next) > maxLineWidth) { lines.push(current); current = word; } else current = next;
      if (widthOf(current) > maxLineWidth) return {ok: false, lines: [...lines, current]};
    }
    if (current) lines.push(current);
  }
  return {ok: lines.length <= CAPTION_LIMITS.maxLines, lines};
}

/** Todos os caracteres precisam existir na fonte (sem substituição silenciosa por quadradinhos). */
export function missingGlyphs(segments, metrics) {
  const missing = new Set();
  for (const item of segments) for (const char of item.text) if (!/\s/.test(char) && !metrics.hasGlyph(char)) missing.add(char);
  return [...missing];
}

/** Documento ASS completo; quebras de linha explícitas (WrapStyle 2) para o resultado bater com a validação. */
export function buildAss({segments, styleId, width, height, font, metrics}) {
  const style = STYLES[validateCaptionStyle(styleId)], g = captionGeometry(styleId, {width, height});
  const bold = /bold|black|heavy|semibold/i.test(font.subfamily) ? -1 : 0;
  const back = style.box ? assColor(style.box.color, style.box.opacity) : assColor('#000000', 0);
  const events = segments.map((item, index) => {
    const layout = layoutCaptionText(item.text, {metrics, fontSize: g.fontSize, maxLineWidth: g.maxLineWidth});
    if (!layout.ok) fail('layout_overflow', `Legenda ${index + 1} não cabe em ${CAPTION_LIMITS.maxLines} linhas neste vídeo. Divida o texto em duas legendas.`, {index});
    return `Dialogue: 0,${assTime(item.start)},${assTime(item.end)},Caption,,0,0,0,,${layout.lines.join('\\N')}`;
  });
  return ['[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', 'YCbCr Matrix: TV.709', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font.family.replace(/,/g, ' ')},${g.fontSize},${assColor(style.text)},${assColor(style.text)},${style.box ? back : assColor(style.outline)},${back},${bold},0,0,0,100,100,0,0,${style.box ? 3 : 1},${g.outline},0,2,${g.marginH},${g.marginH},${g.marginV},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, ''].join('\n');
}

/** Diagnóstico sem efeitos: FFmpeg com libass (filtro subtitles), ffprobe e uma fonte local legível. */
export async function getCaptionCapabilities({ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', fontPath} = {}) {
  const reasons = [];
  let subtitles = false;
  try {
    const {stdout} = await runProcess(ffmpegPath, ['-hide_banner', '-filters'], {timeoutMs: 15_000});
    subtitles = /\ssubtitles\s/.test(stdout);
    if (!subtitles) reasons.push('Este FFmpeg não tem libass (filtro subtitles).');
  } catch (error) { reasons.push(`FFmpeg indisponível: ${error.message}`); }
  try { await runProcess(ffprobePath, ['-hide_banner', '-version'], {timeoutMs: 15_000}); } catch { reasons.push('ffprobe indisponível.'); }
  let font = null;
  try { const resolved = await resolveFont(fontPath); font = {name: fontNames(await readFile(resolved.path)).family, sha256: resolved.sha256}; } catch (error) { reasons.push(error.message); }
  return {available: reasons.length === 0, engine: {id: CAPTIONS_ENGINE_ID, version: CAPTIONS_ENGINE_VERSION}, subtitles, font, styles: listCaptionStyles(), requiresAi: false, network: false, reasons};
}

const SAFE_AUDIO = ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'opus'];

/**
 * Grava as legendas aprovadas num MP4 novo. Áudio copiado sem recodificar quando o codec cabe em MP4; o vídeo é
 * recodificado (x264) porque o texto passa a fazer parte da imagem. Tudo ou nada: cancelamento/falha não deixa arquivo.
 */
export async function renderBurnedCaptions({source, segments: rawSegments, styleId, outputPath, fontPath, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, onProgress} = {}) {
  if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path) || !/^[0-9a-f]{64}$/.test(String(source.sha256)) || typeof source.assetId !== 'string' || typeof source.versionId !== 'string') fail('invalid_source', 'Informe o vídeo pela versão registrada (asset, versão e sha256).');
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || !/\.mp4$/i.test(outputPath) || /[\0\r\n]/.test(outputPath)) fail('invalid_output', 'outputPath deve ser um .mp4 absoluto.');
  if (path.resolve(outputPath) === path.resolve(source.path)) fail('invalid_output', 'O vídeo original nunca é substituído.');
  if (await stat(outputPath).then(() => true, () => false)) fail('output_exists', 'O arquivo de saída já existe; nada foi sobrescrito.');
  validateCaptionStyle(styleId);
  if (await hashFile(source.path).catch(() => null) !== source.sha256) fail('source_changed', 'O vídeo não corresponde mais à versão revisada (sha256 diferente).');
  const media = await probeMedia(source.path, {ffprobePath, signal});
  if (!media.durationSeconds || media.durationSeconds > CAPTION_LIMITS.maxVideoSeconds) fail('invalid_source', 'Duração do vídeo desconhecida ou acima de uma hora.');
  const segments = validateCaptionSegments(rawSegments, media.durationSeconds);
  const resolved = await resolveFont(fontPath), fontBuffer = await readFile(resolved.path), metrics = parseFontMetrics(fontBuffer), names = fontNames(fontBuffer);
  const missing = missingGlyphs(segments, metrics);
  if (missing.length) fail('unsupported_glyph', `A fonte ${names.family} não tem: ${missing.slice(0, 12).join(' ')}. Troque esses caracteres (ex.: emojis) no texto.`, {missing});
  const {width, height} = media.display;
  const ass = buildAss({segments, styleId, width, height, font: names, metrics});
  const work = `${outputPath}.${randomBytes(4).toString('hex')}.work`;
  const partial = path.join(work, 'output.partial.mp4');
  const audio = !media.hasAudio ? 'none' : SAFE_AUDIO.includes(String((await audioCodec(source.path, ffprobePath, signal)) ?? '')) ? 'copied' : 'reencoded';
  try {
    await mkdir(path.join(work, 'fonts'), {recursive: true});
    await writeFile(path.join(work, 'captions.ass'), ass, 'utf8');
    await copyFile(resolved.path, path.join(work, 'fonts', path.basename(resolved.path)));
    // Caminhos relativos ao diretório de trabalho: evita o escape de "C:\" dentro do filtro.
    const args = ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-i', source.path,
      '-vf', `${SQUARE_PIXELS},subtitles=filename=captions.ass:fontsdir=fonts`, '-map', '0:v:0', ...(media.hasAudio ? ['-map', '0:a:0'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', ...(audio === 'copied' ? ['-c:a', 'copy'] : audio === 'reencoded' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', 'output.partial.mp4'];
    let last = 0;
    await runProcess(ffmpegPath, args, {cwd: work, signal, timeoutMs: Math.max(600_000, Math.min(CAPTION_LIMITS.renderTimeoutMs, media.durationSeconds * 20_000)), onStdout: (chunk) => {
      const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)];
      if (!matches.length || Date.now() - last < 400) return;
      last = Date.now();
      onProgress?.({phase: 'render', progress: Math.min(0.99, Number(matches.at(-1)[1]) / 1e6 / media.durationSeconds)});
    }});
    onProgress?.({phase: 'verify', progress: 1});
    const out = await probeMedia(partial, {ffprobePath, signal});
    const tolerance = 0.1 + (media.fps ? 2 / media.fps : 0.1);
    if (!out.durationSeconds || Math.abs(out.durationSeconds - media.durationSeconds) > tolerance) fail('verify_failed', 'O vídeo legendado mudou de duração.');
    if (media.hasAudio && !out.hasAudio) fail('verify_failed', 'O vídeo legendado perdeu o áudio.');
    if (out.width !== width || out.height !== height) fail('verify_failed', 'O vídeo legendado mudou de tamanho.');
    if (await hashFile(source.path) !== source.sha256) fail('source_changed', 'O vídeo original mudou durante a gravação das legendas.');
    const info = await stat(partial), digest = await hashFile(partial);
    await rename(partial, outputPath);
    return {
      schema: BURNED_SCHEMA, engine: {id: CAPTIONS_ENGINE_ID, version: CAPTIONS_ENGINE_VERSION}, createdAt: new Date().toISOString(),
      source: {assetId: source.assetId, versionId: source.versionId, sha256: source.sha256, durationSeconds: media.durationSeconds, width, height, rotation: media.rotation, preserved: true},
      captions: {hash: captionsHash(segments), count: segments.length}, style: {id: styleId}, font: {family: names.family, sha256: resolved.sha256}, audio,
      output: {path: outputPath, sha256: digest, size: info.size, durationSeconds: out.durationSeconds, width: out.width, height: out.height, hasAudio: out.hasAudio},
      requiresAi: false, network: false,
    };
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

async function audioCodec(file, ffprobePath, signal) {
  const {stdout} = await runProcess(ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], {signal});
  return stdout.trim() || null;
}
