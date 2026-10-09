// Motor local de capas (F03): três conceitos por vídeo (produto, pessoa, benefício) a partir de frames REAIS
// escolhidos pelo usuário (timestamp + enquadramento), com título, selo opcional e logo. Só FFmpeg local
// (drawtext/geq/overlay), sem IA, rede, download ou Remotion. Nada aqui detecta produto ou rosto: os pontos
// candidatos são mudanças de cena ou espaçamento uniforme, e o foco do enquadramento vem do usuário.
// O vídeo de origem nunca é escrito; o lote só aparece no destino completo (rename atômico), nunca parcial.
import {spawn} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAssetPath} from './editorial-local-files.mjs';

export const ENGINE_ID = 'ffmpeg-drawtext';
export const ENGINE_VERSION = '1';
export const MANIFEST_SCHEMA = 'mainsagents.thumbnails/1';
export const SELECTION_SCHEMA = 'mainsagents.thumbnail-selection/1';
export const CONCEPTS = Object.freeze(['product', 'person', 'benefit']);
export const LIMITS = Object.freeze({
  title: 70, kicker: 24, maxCandidates: 12, maxLogoBytes: 10 * 1024 * 1024, maxLogoSide: 4096,
  maxSourceSide: 8192, minZoom: 1, maxZoom: 3, processTimeoutMs: 90_000, scanTimeoutMs: 180_000
});
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'];
const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const DEFAULT_ACCENT = '#2f6bff';

// Retângulos em frações da tela. São orientações públicas aproximadas das interfaces de cada destino, NÃO
// especificações garantidas: a interface muda sem aviso, então `guidance` precisa ser conferido antes de publicar.
const FORMATS = Object.freeze({
  'youtube-thumbnail': {
    label: 'YouTube — miniatura 16:9', width: 1280, height: 720, fileTypes: ['jpg', 'png'], defaultFileType: 'jpg', maxBytes: 2 * 1024 * 1024,
    safeArea: {x: 0.04, y: 0.06, w: 0.92, h: 0.88},
    reservedZones: [{id: 'duration-badge', x: 0.82, y: 0.84, w: 0.18, h: 0.16}],
    guides: [],
    guidance: 'A Ajuda do YouTube recomenda 1280×720 (mínimo 640 de largura), JPG/PNG e até 2 MB. O selo de duração cobre o canto inferior direito; a área reservada é aproximada.'
  },
  'instagram-reels-cover': {
    label: 'Instagram Reels — capa 9:16', width: 1080, height: 1920, fileTypes: ['jpg', 'png'], defaultFileType: 'jpg', maxBytes: null,
    safeArea: {x: 0.07, y: 0.15, w: 0.86, h: 0.70},
    reservedZones: [],
    guides: [{id: 'profile-grid-3x4', x: 0, y: 0.125, w: 1, h: 0.75}],
    guidance: 'Capa 1080×1920; a grade do perfil mostra um recorte central (3:4 na interface observada em 2025). Textos ficam dentro desse recorte. Confira a interface atual antes de publicar.'
  },
  'tiktok-cover': {
    label: 'TikTok — capa 9:16', width: 1080, height: 1920, fileTypes: ['jpg', 'png'], defaultFileType: 'jpg', maxBytes: null,
    safeArea: {x: 0.07, y: 0.15, w: 0.76, h: 0.62},
    reservedZones: [{id: 'action-rail', x: 0.85, y: 0.35, w: 0.15, h: 0.5}, {id: 'caption-area', x: 0, y: 0.8, w: 1, h: 0.2}],
    guides: [{id: 'profile-grid-3x4', x: 0, y: 0.125, w: 1, h: 0.75}],
    guidance: 'Capa 1080×1920; botões laterais e legenda cobrem a direita e a parte de baixo durante a reprodução, e a grade do perfil recorta o centro. Zonas aproximadas; confira a interface atual.'
  },
  'instagram-feed-4x5': {
    label: 'Instagram feed — 4:5', width: 1080, height: 1350, fileTypes: ['jpg', 'png'], defaultFileType: 'jpg', maxBytes: null,
    safeArea: {x: 0.09, y: 0.06, w: 0.82, h: 0.88},
    reservedZones: [],
    guides: [{id: 'profile-grid-3x4', x: 0.0313, y: 0, w: 0.9375, h: 1}],
    guidance: 'Post 1080×1350 (4:5); a grade do perfil pode recortar as laterais para 3:4. Textos ficam no centro. Confira a interface atual.'
  }
});

export class ThumbnailError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ThumbnailError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ThumbnailError(code, message, details); };
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const px = (rect, format) => ({x: Math.round(rect.x * format.width), y: Math.round(rect.y * format.height), w: Math.round(rect.w * format.width), h: Math.round(rect.h * format.height)});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : isRecord(value) ? `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function onlyKeys(value, allowed, label, code = 'invalid_input') {
  if (!isRecord(value)) fail(code, `${label} deve ser objeto.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(code, `${label}.${key} não é permitido.`);
}

/** Texto simples de uma linha: espaços normalizados, sem controle/bidi, limite em caracteres visíveis. */
function plainText(value, label, max, {required = true} = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('invalid_text', `${label} é obrigatório.`);
    return undefined;
  }
  if (typeof value !== 'string') fail('invalid_text', `${label} deve ser texto.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value.replace(/[ \t\n]/g, ' '))) fail('invalid_text', `${label} contém caracteres de controle.`);
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) {
    if (required) fail('invalid_text', `${label} é obrigatório.`);
    return undefined;
  }
  if ([...text].length > max) fail('invalid_text', `${label} excede ${max} caracteres.`);
  return text;
}

// ---------------------------------------------------------------- formatos

export function listThumbnailFormats() {
  return Object.entries(FORMATS).map(([id, format]) => ({id, ...structuredClone(format), aspect: round(format.width / format.height, 4), status: 'guidance-unverified'}));
}

export function resolveFormat(id) {
  if (typeof id !== 'string' || !Object.hasOwn(FORMATS, id)) fail('invalid_format', `Formato desconhecido. Use: ${Object.keys(FORMATS).join(', ')}.`);
  return {id, ...FORMATS[id]};
}

// ---------------------------------------------------------------- métricas de fonte (TrueType/OpenType)

/** Lê só o necessário para medir texto: unitsPerEm, métricas verticais, avanços (hmtx) e cmap 4/12. Sem kerning. */
export function parseFontMetrics(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) fail('invalid_font', 'Arquivo de fonte vazio ou inválido.');
  const tag = buffer.toString('latin1', 0, 4);
  if (tag === 'ttcf') fail('invalid_font', 'Coleções .ttc não são suportadas; informe um .ttf ou .otf.');
  if (buffer.readUInt32BE(0) !== 0x00010000 && tag !== 'OTTO' && tag !== 'true') fail('invalid_font', 'Formato de fonte não reconhecido.');
  try {
    const tables = {};
    const count = buffer.readUInt16BE(4);
    for (let index = 0; index < count; index += 1) {
      const at = 12 + index * 16;
      tables[buffer.toString('latin1', at, at + 4)] = buffer.readUInt32BE(at + 8);
    }
    for (const name of ['head', 'hhea', 'hmtx', 'cmap', 'maxp']) if (tables[name] === undefined) fail('invalid_font', `Fonte sem a tabela ${name}.`);
    const unitsPerEm = buffer.readUInt16BE(tables.head + 18);
    const ascender = buffer.readInt16BE(tables.hhea + 4);
    const descender = buffer.readInt16BE(tables.hhea + 6);
    const metricsCount = buffer.readUInt16BE(tables.hhea + 34);
    const glyphCount = buffer.readUInt16BE(tables.maxp + 4);
    let capHeight = Math.round(unitsPerEm * 0.7);
    if (tables['OS/2'] !== undefined && buffer.readUInt16BE(tables['OS/2']) >= 2) capHeight = buffer.readInt16BE(tables['OS/2'] + 88) || capHeight;
    if (!unitsPerEm || !metricsCount) fail('invalid_font', 'Métricas da fonte inválidas.');

    const cmap = tables.cmap;
    let lookup = null;
    const subtables = [];
    for (let index = 0, total = buffer.readUInt16BE(cmap + 2); index < total; index += 1) {
      const at = cmap + 4 + index * 8;
      subtables.push({platform: buffer.readUInt16BE(at), encoding: buffer.readUInt16BE(at + 2), offset: cmap + buffer.readUInt32BE(at + 4)});
    }
    const pick = (predicate) => subtables.find((item) => predicate(item) && [4, 12].includes(buffer.readUInt16BE(item.offset)));
    const chosen = pick((item) => item.platform === 3 && item.encoding === 10) ?? pick((item) => item.platform === 0 && buffer.readUInt16BE(item.offset) === 12)
      ?? pick((item) => item.platform === 3 && item.encoding === 1) ?? pick((item) => item.platform === 0);
    if (!chosen) fail('invalid_font', 'Fonte sem mapa Unicode (cmap 4/12).');
    const o = chosen.offset;
    if (buffer.readUInt16BE(o) === 12) {
      const groups = buffer.readUInt32BE(o + 12);
      lookup = (code) => {
        let low = 0;
        let high = groups - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          const at = o + 16 + mid * 12;
          const start = buffer.readUInt32BE(at);
          const end = buffer.readUInt32BE(at + 4);
          if (code < start) high = mid - 1;
          else if (code > end) low = mid + 1;
          else return buffer.readUInt32BE(at + 8) + code - start;
        }
        return 0;
      };
    } else {
      const segX2 = buffer.readUInt16BE(o + 6);
      const ends = o + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      lookup = (code) => {
        if (code > 0xffff) return 0;
        for (let seg = 0; seg < segX2; seg += 2) {
          if (buffer.readUInt16BE(ends + seg) < code) continue;
          const start = buffer.readUInt16BE(starts + seg);
          if (start > code) return 0;
          const delta = buffer.readInt16BE(deltas + seg);
          const rangeOffset = buffer.readUInt16BE(ranges + seg);
          if (!rangeOffset) return (code + delta) & 0xffff;
          const glyph = buffer.readUInt16BE(ranges + seg + rangeOffset + 2 * (code - start));
          return glyph ? (glyph + delta) & 0xffff : 0;
        }
        return 0;
      };
    }
    const cache = new Map();
    const glyphOf = (code) => {
      if (!cache.has(code)) {
        const glyph = lookup(code);
        cache.set(code, glyph > 0 && glyph < glyphCount ? glyph : 0);
      }
      return cache.get(code);
    };
    const advance = (glyph) => buffer.readUInt16BE(tables.hmtx + Math.min(glyph, metricsCount - 1) * 4);
    return {
      unitsPerEm, ascender, descender, capHeight,
      hasGlyph: (char) => char === ' ' || glyphOf(char.codePointAt(0)) > 0,
      /** Largura em unidades da fonte (sem kerning: o HarfBuzz do drawtext só estreita pares, então a medida é conservadora). */
      measure: (text) => [...text].reduce((sum, char) => sum + advance(glyphOf(char.codePointAt(0))), 0)
    };
  } catch (error) {
    if (error instanceof ThumbnailError) throw error;
    fail('invalid_font', `Fonte ilegível: ${error.message}`);
  }
}

const FONT_CANDIDATES = {
  win32: ['segoeuib.ttf', 'arialbd.ttf', 'bahnschrift.ttf'].map((name) => path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name)),
  darwin: ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf'],
  linux: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf']
};

/** Fonte explícita ou a primeira fonte bold do sistema que exista. Nunca baixa fontes. */
export async function resolveFont(fontPath) {
  const candidates = fontPath ? [fontPath] : FONT_CANDIDATES[process.platform] ?? [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /[\0\r\n]/.test(candidate) || !/\.(ttf|otf)$/i.test(candidate)) {
      if (fontPath) fail('invalid_font', 'fontPath deve ser um .ttf/.otf local absoluto.');
      continue;
    }
    let buffer;
    try {
      const info = await stat(candidate);
      if (!info.isFile() || info.size > 40 * 1024 * 1024) throw new Error('not a file');
      buffer = await readFile(candidate);
    } catch {
      if (fontPath) fail('invalid_font', 'fontPath não pode ser lido.');
      continue;
    }
    return {path: candidate, name: path.basename(candidate), sha256: sha256(buffer), metrics: parseFontMetrics(buffer)};
  }
  fail('dependency_missing', 'Nenhuma fonte bold local encontrada; informe brand.fontPath (.ttf/.otf).');
}

// ---------------------------------------------------------------- cor e contraste (WCAG 2.x)

const hexToRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
export const contrastRatio = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
const mix = (top, bottom, alpha) => top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));
const ffColor = (hex, alpha = 1) => `0x${hex.slice(1)}@${round(alpha, 3)}`;
const WHITE = '#ffffff';
const BLACK = '#000000';
const bestTextOn = (hex) => contrastRatio(hexToRgb(hex), [1, 1, 1]) >= contrastRatio(hexToRgb(hex), [0, 0, 0]) ? WHITE : BLACK;
const MIN_CONTRAST = 4.5;

/** Menor opacidade de véu que garante MIN_CONTRAST para o texto mesmo sobre o pior pixel possível do frame. */
function scrimAlphaFor(textHex, scrimHex) {
  const text = hexToRgb(textHex);
  const worst = textHex === WHITE ? [1, 1, 1] : [0, 0, 0];
  for (let alpha = 0.62; alpha <= 1.0001; alpha += 0.01) if (contrastRatio(text, mix(hexToRgb(scrimHex), worst, alpha)) >= MIN_CONTRAST + 0.3) return round(alpha, 2);
  return 1;
}

// ---------------------------------------------------------------- validação da entrada

function validateSource(raw) {
  onlyKeys(raw, ['path', 'assetId', 'versionId', 'sha256'], 'source', 'invalid_source');
  let file;
  try { file = localAssetPath(raw.path); } catch (error) { fail('invalid_source', error.message); }
  if (!VIDEO_EXTENSIONS.includes(path.extname(file).toLowerCase())) fail('invalid_source', 'source.path deve ser um vídeo local.');
  for (const key of ['assetId', 'versionId']) if (typeof raw[key] !== 'string' || !raw[key] || raw[key].length > 160 || /[\0\r\n|]/.test(raw[key])) fail('invalid_source', `source.${key} é obrigatório.`);
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) fail('invalid_source', 'source.sha256 deve ser o hash sha256 (hex) da versão revisada.');
  return {path: file, assetId: raw.assetId, versionId: raw.versionId, sha256: raw.sha256};
}

function validateBrand(raw = {}) {
  onlyKeys(raw, ['theme', 'accent', 'logoPath', 'logoSha256', 'fontPath'], 'brand');
  const theme = raw.theme ?? 'dark';
  if (theme !== 'dark' && theme !== 'light') fail('invalid_input', 'brand.theme deve ser "dark" ou "light".');
  const accent = (raw.accent ?? DEFAULT_ACCENT);
  if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) fail('invalid_input', 'brand.accent deve ser #RRGGBB.');
  let logoPath;
  if (raw.logoPath !== undefined && raw.logoPath !== null) {
    if (typeof raw.logoPath !== 'string' || !path.isAbsolute(raw.logoPath) || /[\0\r\n]/.test(raw.logoPath) || /^[\\/]{2}/.test(raw.logoPath)) fail('invalid_logo', 'brand.logoPath deve ser um arquivo local absoluto.');
    if (!LOGO_EXTENSIONS.includes(path.extname(raw.logoPath).toLowerCase())) fail('invalid_logo', 'Logo deve ser PNG, JPG ou WebP.');
    logoPath = path.normalize(raw.logoPath);
  }
  if (raw.logoSha256 !== undefined && (typeof raw.logoSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.logoSha256))) fail('invalid_logo', 'brand.logoSha256 deve ser sha256 hex.');
  if (raw.logoSha256 && !logoPath) fail('invalid_logo', 'brand.logoSha256 exige brand.logoPath.');
  return {theme, accent: accent.toLowerCase(), ...(logoPath ? {logoPath} : {}), ...(raw.logoSha256 ? {logoSha256: raw.logoSha256} : {}), ...(raw.fontPath ? {fontPath: raw.fontPath} : {})};
}

function validateConcept(raw, index) {
  const label = `concepts[${index}]`;
  onlyKeys(raw, ['concept', 'timestampSeconds', 'title', 'kicker', 'framing'], label);
  if (!CONCEPTS.includes(raw.concept)) fail('invalid_concepts', `${label}.concept deve ser ${CONCEPTS.join(', ')}.`);
  if (!finite(raw.timestampSeconds) || raw.timestampSeconds < 0) fail('invalid_concepts', `${label}.timestampSeconds deve ser um tempo real do vídeo (s).`);
  const framing = raw.framing ?? {};
  onlyKeys(framing, ['focusX', 'focusY', 'zoom'], `${label}.framing`);
  const focusX = framing.focusX ?? 0.5;
  const focusY = framing.focusY ?? 0.5;
  const zoom = framing.zoom ?? 1;
  for (const [key, value] of [['focusX', focusX], ['focusY', focusY]]) if (!finite(value) || value < 0 || value > 1) fail('invalid_concepts', `${label}.framing.${key} deve estar entre 0 e 1.`);
  if (!finite(zoom) || zoom < LIMITS.minZoom || zoom > LIMITS.maxZoom) fail('invalid_concepts', `${label}.framing.zoom deve estar entre ${LIMITS.minZoom} e ${LIMITS.maxZoom}.`);
  const kicker = plainText(raw.kicker, `${label}.kicker`, LIMITS.kicker, {required: false});
  return {concept: raw.concept, timestampSeconds: round(raw.timestampSeconds), title: plainText(raw.title, `${label}.title`, LIMITS.title), ...(kicker ? {kicker} : {}), framing: {focusX: round(focusX), focusY: round(focusY), zoom: round(zoom)}};
}

/** Normaliza a especificação do lote. Exatamente três conceitos, um de cada; mais alternativas são ação explícita (novo lote). */
export function validateThumbnailRequest(raw) {
  onlyKeys(raw, ['source', 'format', 'fileType', 'brand', 'concepts', 'safeAreaPreview', 'outputDirectory'], 'request');
  const format = resolveFormat(raw.format);
  const fileType = raw.fileType ?? format.defaultFileType;
  if (!format.fileTypes.includes(fileType)) fail('invalid_format', `fileType deve ser ${format.fileTypes.join(' ou ')}.`);
  if (!Array.isArray(raw.concepts) || raw.concepts.length !== 3) fail('invalid_concepts', 'Envie exatamente três conceitos: product, person e benefit.');
  const concepts = raw.concepts.map(validateConcept);
  if (new Set(concepts.map((item) => item.concept)).size !== 3) fail('invalid_concepts', 'Cada conceito (product, person, benefit) aparece uma vez.');
  concepts.sort((a, b) => CONCEPTS.indexOf(a.concept) - CONCEPTS.indexOf(b.concept));
  if (raw.safeAreaPreview !== undefined && typeof raw.safeAreaPreview !== 'boolean') fail('invalid_input', 'safeAreaPreview deve ser booleano.');
  return {source: validateSource(raw.source), format: format.id, fileType, brand: validateBrand(raw.brand), concepts, safeAreaPreview: raw.safeAreaPreview ?? true};
}

// ---------------------------------------------------------------- layout puro

const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

/** Quebra gulosa por palavra; devolve null se alguma palavra não cabe ou se passar de maxLines. */
function wrap(text, widthOf, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (widthOf(word) > maxWidth) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(candidate) <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  if (lines.length > maxLines) return null;
  // Evita órfã de uma palavra curta na última linha quando cabe rebalancear (a linha anterior cede uma palavra).
  if (lines.length > 1) {
    const last = lines.length - 1;
    const previous = lines[last - 1].split(' ');
    if (lines[last].split(' ').length === 1 && previous.length > 2) {
      const moved = `${previous.at(-1)} ${lines[last]}`;
      if (widthOf(moved) <= maxWidth) { lines[last - 1] = previous.slice(0, -1).join(' '); lines[last] = moved; }
    }
  }
  return lines;
}

const TEMPLATE_LABELS = {product: 'Produto em destaque', person: 'Pessoa e reação', benefit: 'Benefício em destaque'};

/** Escala tipográfica por orientação, relativa ao lado curto; o mínimo é o piso de legibilidade na miniatura. */
function typeScale(format, concept) {
  const landscape = format.width > format.height;
  const short = Math.min(format.width, format.height);
  const title = landscape
    ? {max: (concept === 'benefit' ? 0.13 : 0.15) * short, min: 0.075 * short}
    : {max: (concept === 'benefit' ? 0.1 : 0.105) * short, min: 0.06 * short};
  return {title: {max: Math.round(title.max), min: Math.round(title.min)}, kicker: Math.round((landscape ? 0.052 : 0.042) * short), lineHeight: 1.12, short, landscape};
}

/**
 * Layout determinístico de um conceito: onde fica o frame, véu, painel, selo, título e logo, em pixels da saída.
 * Lança layout_overflow quando o título não cabe no piso de legibilidade (nunca corta texto em silêncio).
 */
export function layoutConcept({format: formatId, concept, title, kicker, framing, theme, accent, font, logo}) {
  const format = resolveFormat(formatId);
  const {width: W, height: H} = format;
  const scale = typeScale(format, concept);
  const safe = px(format.safeArea, format);
  const reserved = format.reservedZones.map((zone) => ({id: zone.id, ...px(zone, format)}));
  const {metrics} = font;
  for (const char of [...title, ...(kicker ?? '')]) if (!metrics.hasGlyph(char)) fail('unsupported_glyph', `A fonte ${font.name} não tem o caractere "${char}". Remova-o ou use outra fonte.`);
  const themeBase = theme === 'dark' ? BLACK : WHITE;
  const themeText = theme === 'dark' ? WHITE : BLACK;
  const gap = Math.round(scale.short * 0.025);

  // Região do frame e onde o bloco de texto pode ficar.
  let frameRect = {x: 0, y: 0, w: W, h: H};
  let panel = null;
  let box;
  let align = 'left';
  let anchor;
  let textColor = themeText;
  let side = null;
  if (concept === 'product') {
    box = {x: safe.x, y: safe.y, w: scale.landscape ? Math.round(safe.w * 0.66) : safe.w, h: safe.h};
    anchor = 'bottom';
  } else if (concept === 'person') {
    if (scale.landscape) {
      side = framing.focusX < 0.5 ? 'right' : 'left';
      const w = Math.round(safe.w * 0.5);
      box = {x: side === 'right' ? safe.x + safe.w - w : safe.x, y: safe.y, w, h: safe.h};
      anchor = 'middle';
    } else {
      side = framing.focusY <= 0.5 ? 'bottom' : 'top';
      box = {...safe};
      anchor = side;
      align = 'center';
    }
  } else {
    panel = scale.landscape ? {x: 0, y: 0, w: Math.round(W * 0.5), h: H} : {x: 0, y: 0, w: W, h: Math.round(H * 0.5)};
    frameRect = scale.landscape ? {x: panel.w, y: 0, w: W - panel.w, h: H} : {x: 0, y: panel.h, w: W, h: H - panel.h};
    textColor = bestTextOn(accent);
    box = scale.landscape
      ? {x: safe.x, y: safe.y, w: panel.w - safe.x - gap * 2, h: safe.h}
      : {x: safe.x, y: safe.y, w: safe.w, h: panel.h - safe.y - gap * 2};
    anchor = scale.landscape ? 'middle' : 'bottom';
  }

  // Logo: cabe numa caixa proporcional, no canto do lado do texto (ou oposto, no vertical da pessoa).
  let logoRect = null;
  if (logo) {
    const maxH = Math.round(scale.short * (scale.landscape ? 0.085 : 0.06));
    const maxW = Math.round(safe.w * 0.3);
    const factor = Math.min(maxH / logo.height, maxW / logo.width);
    const w = Math.max(2, Math.round(logo.width * factor / 2) * 2);
    const h = Math.max(2, Math.round(logo.height * factor / 2) * 2);
    let x = safe.x;
    let y = safe.y;
    if (concept === 'person' && scale.landscape && side === 'right') x = safe.x + safe.w - w;
    if (concept === 'person' && !scale.landscape) { x = Math.round((W - w) / 2); y = side === 'bottom' ? safe.y : safe.y + safe.h - h; }
    logoRect = {x, y, w, h};
    // O texto não disputa o canto do logo: a caixa encolhe pelo lado em que o logo está.
    if (intersects(logoRect, box)) {
      if (logoRect.y <= box.y + 1) { const top = logoRect.y + logoRect.h + gap; box = {...box, h: box.y + box.h - top, y: top}; }
      else box = {...box, h: logoRect.y - gap - box.y};
    }
  }

  const accentBar = concept === 'product' ? Math.max(4, Math.round(scale.short * 0.012)) : 0;
  const textX = box.x + (accentBar ? accentBar + gap : 0);
  const textW = box.w - (accentBar ? accentBar + gap : 0);
  const unit = (size) => size / metrics.unitsPerEm;
  const kickerSize = kicker ? scale.kicker : 0;
  const kickerPad = Math.round(kickerSize * 0.6);
  const kickerH = kicker ? Math.round(kickerSize * 1.7) : 0;
  const kickerW = kicker ? Math.round(metrics.measure(kicker) * unit(kickerSize)) + kickerPad * 2 : 0;
  if (kicker && kickerW > textW) fail('layout_overflow', `O selo "${kicker}" não cabe no formato ${format.id}; encurte o texto.`);

  let fit = null;
  for (let size = scale.title.max; size >= scale.title.min; size -= 2) {
    const lines = wrap(title, (text) => metrics.measure(text) * unit(size) * 1.01, textW, scale.landscape ? (concept === 'product' ? 3 : 4) : 4);
    if (!lines) continue;
    const pitch = Math.round(size * scale.lineHeight);
    const ascent = Math.round(Math.max(metrics.ascender, metrics.capHeight) * unit(size));
    const descent = Math.round(Math.abs(metrics.descender) * unit(size));
    const titleH = ascent + pitch * (lines.length - 1) + descent;
    const blockH = titleH + (kicker ? kickerH + gap : 0);
    if (blockH <= box.h) { fit = {size, lines, pitch, ascent, descent, titleH, blockH}; break; }
  }
  if (!fit) fail('layout_overflow', `O título não cabe legível em ${format.id} (mínimo ${scale.title.min}px, ${TEMPLATE_LABELS[concept]}). Encurte o título.`);

  const centerX = Math.round(box.x + box.w / 2);
  const blockTop = anchor === 'top' ? box.y : anchor === 'bottom' ? box.y + box.h - fit.blockH : Math.round(box.y + (box.h - fit.blockH) / 2);
  const kickerRect = kicker ? {x: align === 'center' ? centerX - Math.round(kickerW / 2) : textX, y: blockTop, w: kickerW, h: kickerH} : null;
  const titleTop = blockTop + (kicker ? kickerH + gap : 0);
  const lineRects = fit.lines.map((text, index) => {
    const w = Math.round(metrics.measure(text) * unit(fit.size));
    const baseline = titleTop + fit.ascent + index * fit.pitch;
    return {text, baseline, x: align === 'center' ? centerX - Math.round(w / 2) : textX, y: baseline - fit.ascent, w, h: fit.ascent + fit.descent};
  });
  const titleRect = {x: Math.min(...lineRects.map((r) => r.x)), y: titleTop, w: Math.max(...lineRects.map((r) => r.x + r.w)) - Math.min(...lineRects.map((r) => r.x)), h: fit.titleH};
  const blockRect = {x: Math.min(titleRect.x, kickerRect?.x ?? Infinity, accentBar ? box.x : Infinity), y: blockTop, w: 0, h: fit.blockH};
  blockRect.w = Math.max(titleRect.x + titleRect.w, kickerRect ? kickerRect.x + kickerRect.w : 0) - blockRect.x;
  const accentRect = accentBar ? {x: box.x, y: blockTop, w: accentBar, h: fit.blockH} : null;

  // Véu: garante contraste sobre o pior pixel do frame onde o texto pousa (não depende do conteúdo da imagem).
  let scrim = null;
  let contrast;
  if (!panel) {
    const alpha = scrimAlphaFor(textColor, themeBase);
    const ramp = Math.round(scale.short * 0.22);
    if (concept === 'person' && scale.landscape) scrim = {direction: side, color: themeBase, alpha, from: side === 'right' ? blockRect.x - ramp - gap : blockRect.x + blockRect.w + gap + ramp, to: side === 'right' ? blockRect.x - gap : blockRect.x + blockRect.w + gap};
    else if (anchor === 'top') scrim = {direction: 'top', color: themeBase, alpha, from: blockRect.y + blockRect.h + gap + ramp, to: blockRect.y + blockRect.h + gap};
    else scrim = {direction: 'bottom', color: themeBase, alpha, from: blockRect.y - gap - ramp, to: blockRect.y - gap};
    contrast = round(contrastRatio(hexToRgb(textColor), mix(hexToRgb(themeBase), textColor === WHITE ? [1, 1, 1] : [0, 0, 0], alpha)), 2);
  } else contrast = round(contrastRatio(hexToRgb(textColor), hexToRgb(accent)), 2);
  const kickerFill = concept === 'benefit' ? textColor : accent;
  const kickerText = bestTextOn(kickerFill);
  const kickerContrast = kicker ? round(contrastRatio(hexToRgb(kickerText), hexToRgb(kickerFill)), 2) : null;

  // Verificação de limites: tudo dentro da área segura, fora das zonas reservadas, sem sobreposição com o logo.
  const elements = [{id: 'title', rect: titleRect}, ...(kickerRect ? [{id: 'kicker', rect: kickerRect}] : []), ...(accentRect ? [{id: 'accent', rect: accentRect}] : []), ...(logoRect ? [{id: 'logo', rect: logoRect}] : [])];
  const problems = [];
  for (const element of elements) {
    if (!inside(element.rect, safe)) problems.push(`${element.id} fora da área segura`);
    for (const zone of reserved) if (intersects(element.rect, zone)) problems.push(`${element.id} invade ${zone.id}`);
  }
  if (logoRect && (intersects(logoRect, titleRect) || (kickerRect && intersects(logoRect, kickerRect)))) problems.push('logo sobrepõe o texto');
  if (contrast < MIN_CONTRAST || (kickerContrast !== null && kickerContrast < MIN_CONTRAST)) problems.push('contraste abaixo de 4.5:1');
  if (problems.length) fail('layout_overflow', `Layout inválido em ${format.id}: ${problems.join('; ')}.`, problems);

  return {
    concept, template: TEMPLATE_LABELS[concept], canvas: {width: W, height: H}, safeArea: safe, reservedZones: reserved,
    frameRect, panel: panel ? {...panel, color: accent} : null, scrim, align, centerX, side,
    title: {size: fit.size, lines: lineRects, rect: titleRect, color: textColor},
    kicker: kickerRect ? {text: kicker, size: kickerSize, rect: kickerRect, fill: kickerFill, color: kickerText, padX: kickerPad, baseline: Math.round(kickerRect.y + (kickerRect.h + metrics.capHeight * unit(kickerSize)) / 2)} : null,
    accent: accentRect ? {rect: accentRect, color: accent} : null,
    logo: logoRect, contrast: {title: contrast, kicker: kickerContrast, minimum: MIN_CONTRAST, basis: panel ? 'opaque-panel' : 'worst-case-pixel-under-scrim'}
  };
}

/** Recorte do frame de origem para a região de destino: aspecto da região, foco do usuário e zoom, sempre dentro da imagem. */
export function cropFor({sourceWidth, sourceHeight, region, framing}) {
  const aspect = region.w / region.h;
  let w = sourceWidth;
  let h = w / aspect;
  if (h > sourceHeight) { h = sourceHeight; w = h * aspect; }
  w /= framing.zoom;
  h /= framing.zoom;
  w = Math.max(2, Math.floor(w / 2) * 2);
  h = Math.max(2, Math.floor(h / 2) * 2);
  const x = Math.round(clamp(framing.focusX * sourceWidth - w / 2, 0, sourceWidth - w));
  const y = Math.round(clamp(framing.focusY * sourceHeight - h / 2, 0, sourceHeight - h));
  return {x, y, w, h, upscale: round(Math.max(region.w / w, region.h / h), 2)};
}

/**
 * Plano completo e PURO do lote (sem IO): recebe fatos já verificados (metadata do vídeo, métricas da fonte e
 * dimensões do logo) e devolve layout, recortes, specHash e batchId. O mesmo plano com os mesmos fatos dá o mesmo hash.
 */
export function planThumbnailSet(request, {sourceMetadata, font, logo, frames}) {
  const spec = validateThumbnailRequest(request);
  const format = resolveFormat(spec.format);
  if (!sourceMetadata || !finite(sourceMetadata.durationSeconds) || !Number.isInteger(sourceMetadata.width) || !Number.isInteger(sourceMetadata.height)) fail('invalid_source', 'Metadata do vídeo ausente.');
  if (sourceMetadata.durationSeconds <= 0) fail('invalid_source', 'Duração do vídeo inválida.');
  const lastFrame = Math.max(0, sourceMetadata.durationSeconds - 1 / (sourceMetadata.fps || 30));
  const items = spec.concepts.map((concept) => {
    if (concept.timestampSeconds > lastFrame) fail('invalid_concepts', `${concept.concept}: timestamp ${concept.timestampSeconds}s passa do último frame (${round(lastFrame)}s).`);
    const layout = layoutConcept({format: format.id, concept: concept.concept, title: concept.title, kicker: concept.kicker, framing: concept.framing, theme: spec.brand.theme, accent: spec.brand.accent, font, logo});
    // `frames` (tamanho decodificado de fato) vence a metadata do ffprobe; sem ele, usa o tamanho exibido previsto.
    const frame = frames?.[concept.concept] ?? sourceMetadata.display ?? sourceMetadata;
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 2 || frame.height < 2) fail('invalid_source', 'Tamanho do frame inválido.');
    const crop = cropFor({sourceWidth: frame.width, sourceHeight: frame.height, region: layout.frameRect, framing: concept.framing});
    const warnings = crop.upscale > 2 ? [`O frame foi ampliado ${crop.upscale}× e pode parecer suave; reduza o zoom ou use um vídeo de maior resolução.`] : [];
    // O contraste do logo depende das cores do próprio logo, que o motor não avalia: só avisa onde ele pousa.
    if (layout.logo) warnings.push(layout.panel ? 'Logo sobre o painel na cor de destaque: confira se ele não some na prévia.' : 'Logo direto sobre o frame: confira a legibilidade na prévia.');
    return {...concept, layout, crop, warnings};
  });
  const specHash = sha256(canonical({
    engine: {id: ENGINE_ID, version: ENGINE_VERSION}, source: {assetId: spec.source.assetId, versionId: spec.source.versionId, sha256: spec.source.sha256},
    format: format.id, fileType: spec.fileType, theme: spec.brand.theme, accent: spec.brand.accent, font: font.sha256, logo: logo?.sha256 ?? null,
    safeAreaPreview: spec.safeAreaPreview, concepts: spec.concepts
  }));
  return {spec, format, items, specHash, batchId: `thumbs-${specHash.slice(0, 16)}`};
}

// ---------------------------------------------------------------- processos

/**
 * Cancel and timeout settle only after the child process has exited: on Windows a live FFmpeg keeps its output and
 * working directory locked, so cleaning up before `close` fails with EBUSY and could leave partial files behind.
 */
export function runProcess(command, args, {signal, cwd, timeoutMs = LIMITS.processTimeoutMs, keepStderr = 8000, onSpawn, onStdout} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ThumbnailError('cancelled', 'Operação cancelada.')); return; }
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stopping = null;
    let forceKill;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKill);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve(value);
    };
    // Ask the process to stop and settle with `reason` once it has really exited (escalate if it ignores the signal).
    const stop = (reason) => {
      if (settled || stopping) return;
      stopping = reason;
      if (!child || child.exitCode !== null || child.signalCode !== null) { done(reason); return; }
      child.kill();
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
      forceKill.unref?.();
    };
    const onAbort = () => stop(new ThumbnailError('cancelled', 'Operação cancelada.'));
    const timer = setTimeout(() => stop(new ThumbnailError('render_failed', `${path.basename(command)} excedeu o tempo limite.`)), timeoutMs);
    timer.unref?.();
    try {
      child = spawn(command, args, {cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      done(error);
      return;
    }
    signal?.addEventListener('abort', onAbort, {once: true});
    child.once('spawn', () => { if (!stopping) onSpawn?.(); });
    child.stdout.on('data', (chunk) => { stdout += chunk; if (onStdout) { onStdout(String(chunk)); stdout = stdout.slice(-4000); } if (stdout.length > 2_000_000) stop(new ThumbnailError('render_failed', `${path.basename(command)} produziu saída demais.`)); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-keepStderr); });
    child.on('error', (error) => done(stopping ?? (error.code === 'ENOENT' ? new ThumbnailError('dependency_missing', `${path.basename(command)} não encontrado (instale FFmpeg ou informe o caminho).`) : error)));
    child.on('close', (code) => done(stopping ?? (code === 0 ? null : new ThumbnailError('render_failed', `${path.basename(command)} falhou (${code}): ${stderr.trim().slice(-600)}`)), {stdout, stderr}));
  });
}

/** ffprobe de vídeo (com rotação de exibição aplicada) ou de imagem. */
export async function probeMedia(file, {ffprobePath = 'ffprobe', signal} = {}) {
  const {stdout} = await runProcess(ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file', '-show_streams', '-show_format', '-of', 'json', file], {signal});
  let data;
  try { data = JSON.parse(stdout); } catch { fail('invalid_source', 'ffprobe devolveu dados ilegíveis.'); }
  const video = data.streams?.find((item) => item.codec_type === 'video');
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height)) fail('invalid_source', 'O arquivo não tem imagem legível.');
  const rotation = Number(video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const swap = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const [num, den] = String(video.avg_frame_rate && video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : video.r_frame_rate ?? '').split('/').map(Number);
  const fps = den ? num / den : num;
  const duration = Number(data.format?.duration ?? video.duration);
  const [sarNum, sarDen] = String(video.sample_aspect_ratio ?? '1:1').split(':').map(Number);
  const sar = sarNum > 0 && sarDen > 0 ? sarNum / sarDen : 1;
  // Mesma conta de SQUARE_PIXELS, aplicada no eixo que o FFmpeg entrega depois da autorrotação.
  const stored = {width: video.width, height: video.height};
  const square = sar >= 1 ? {width: Math.trunc(stored.width * sar / 2) * 2, height: Math.trunc(stored.height / 2) * 2} : {width: Math.trunc(stored.width / 2) * 2, height: Math.trunc(stored.height / sar / 2) * 2};
  return {
    width: swap ? video.height : video.width, height: swap ? video.width : video.height, rotation,
    sampleAspectRatio: round(sar, 4), stored, display: swap ? {width: square.height, height: square.width} : square,
    durationSeconds: Number.isFinite(duration) ? duration : null, fps: Number.isFinite(fps) && fps > 0 ? round(fps) : null,
    codec: video.codec_name, hasAudio: Boolean(data.streams?.some((item) => item.codec_type === 'audio'))
  };
}

/**
 * Normaliza pixels não quadrados (SAR ≠ 1) para quadrados antes do recorte, sem perder resolução (estica o eixo menor).
 * Vem depois da autorrotação do FFmpeg, então o recorte sempre trabalha no frame como ele é exibido.
 */
export const SQUARE_PIXELS = "scale='if(gte(sar,1),trunc(iw*sar/2)*2,trunc(iw/2)*2)':'if(gte(sar,1),trunc(ih/2)*2,trunc(ih/sar/2)*2)':flags=lanczos,setsar=1";

/**
 * Decodifica (sem gravar nada) o frame que o render vai usar no timestamp e devolve o tamanho REAL que chega aos filtros
 * (pós-autorrotação e SAR) e o pts exibido. Fonte de verdade para o recorte; null quando não há frame nesse ponto.
 */
export async function probeFrame(file, timestampSeconds, {ffmpegPath = 'ffmpeg', signal} = {}) {
  if (!finite(timestampSeconds) || timestampSeconds < 0) fail('invalid_concepts', 'timestamp inválido.');
  const {stderr} = await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-copyts', '-ss', String(timestampSeconds), '-i', file, '-frames:v', '1', '-an', '-sn', '-dn', '-vf', `${SQUARE_PIXELS},showinfo`, '-f', 'null', '-'],
    {signal, keepStderr: 20_000});
  const line = stderr.split(/\r?\n/).find((item) => /Parsed_showinfo.*\bn:\s*0\b/.test(item));
  if (!line) return null;
  const size = / s:(\d+)x(\d+)/.exec(line);
  const pts = /pts_time:\s*(-?[0-9.]+)/.exec(line);
  if (!size) return null;
  return {width: Number(size[1]), height: Number(size[2]), ptsTimeSeconds: pts && Number.isFinite(Number(pts[1])) ? round(Number(pts[1])) : null};
}

/** Diagnóstico sem efeitos colaterais: FFmpeg/ffprobe no PATH (ou explícitos), filtros exigidos e fonte local. */
export async function getThumbnailCapabilities({ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', fontPath} = {}) {
  const reasons = [];
  let version = null;
  const filters = {};
  try {
    const {stdout} = await runProcess(ffmpegPath, ['-hide_banner', '-version'], {timeoutMs: 15_000});
    version = /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null;
    const list = (await runProcess(ffmpegPath, ['-hide_banner', '-filters'], {timeoutMs: 15_000})).stdout;
    for (const name of ['drawtext', 'drawbox', 'geq', 'overlay', 'crop', 'scale', 'select', 'showinfo']) filters[name] = new RegExp(`\\s${name}\\s`).test(list);
    const drawtext = filters.drawtext ? (await runProcess(ffmpegPath, ['-hide_banner', '-h', 'filter=drawtext'], {timeoutMs: 15_000})).stdout : '';
    filters.drawtextBaseline = /y_align/.test(drawtext);
    for (const [name, ok] of Object.entries(filters)) if (!ok) reasons.push(`FFmpeg sem suporte a ${name}.`);
  } catch (error) {
    reasons.push(error.code === 'dependency_missing' ? error.message : `FFmpeg indisponível: ${error.message}`);
  }
  let ffprobe = false;
  try { await runProcess(ffprobePath, ['-hide_banner', '-version'], {timeoutMs: 15_000}); ffprobe = true; } catch { reasons.push('ffprobe indisponível.'); }
  let font = null;
  try { const resolved = await resolveFont(fontPath); font = {name: resolved.name, path: resolved.path, sha256: resolved.sha256}; } catch (error) { reasons.push(error.message); }
  return {
    available: reasons.length === 0, engine: {id: ENGINE_ID, version: ENGINE_VERSION}, ffmpeg: {path: ffmpegPath, version, filters}, ffprobe, font,
    concepts: CONCEPTS, formats: listThumbnailFormats().map(({id, label, width, height, fileTypes, maxBytes, status}) => ({id, label, width, height, fileTypes, maxBytes, status})),
    requiresAi: false, network: false, reasons
  };
}

/** Confere que o arquivo ainda é exatamente a versão revisada (hash). */
// Digest por estado do arquivo (path, tamanho, mtime, ctime: qualquer escrita muda o ctime). Prévias de frame pedem a
// mesma versão várias vezes; sem isso cada miniatura releria o vídeo inteiro. Limitado a 32 estados.
const sourceDigests = new Map();
async function verifySource(source) {
  let info;
  try { info = await stat(source.path); } catch { fail('source_changed', 'O vídeo de origem foi movido ou removido.'); }
  if (!info.isFile()) fail('invalid_source', 'source.path não é um arquivo.');
  const key = `${path.resolve(source.path)}|${info.size}|${info.mtimeMs}|${info.ctimeMs}`;
  if (!sourceDigests.has(key)) {
    if (sourceDigests.size >= 32) sourceDigests.delete(sourceDigests.keys().next().value);
    sourceDigests.set(key, hashFile(source.path).catch((error) => { sourceDigests.delete(key); throw error; }));
  }
  const digest = await sourceDigests.get(key);
  if (digest !== source.sha256) fail('source_changed', 'O vídeo de origem não corresponde à versão revisada (sha256 diferente).');
  return {size: info.size, mtimeMs: info.mtimeMs};
}

// ---------------------------------------------------------------- pontos candidatos honestos

/**
 * Sugere timestamps para o usuário escolher: mudanças de cena medidas pelo FFmpeg (só keyframes, rápido) completadas
 * por pontos espaçados. Não identifica produto, pessoa nem expressão; `reason` diz exatamente de onde veio cada ponto.
 */
export async function suggestCandidateFrames({source: rawSource, count = 6, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal, sceneThreshold = 0.3} = {}) {
  const source = validateSource(rawSource);
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.maxCandidates) fail('invalid_input', `count deve estar entre 1 e ${LIMITS.maxCandidates}.`);
  if (!finite(sceneThreshold) || sceneThreshold <= 0 || sceneThreshold >= 1) fail('invalid_input', 'sceneThreshold deve estar entre 0 e 1.');
  await verifySource(source);
  const metadata = await probeMedia(source.path, {ffprobePath, signal});
  if (!metadata.durationSeconds) fail('invalid_source', 'Duração do vídeo desconhecida.');
  const duration = metadata.durationSeconds;
  const margin = Math.min(0.5, duration * 0.05);
  const scenes = [];
  try {
    const {stderr} = await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-skip_frame', 'nokey', '-i', source.path, '-an', '-sn', '-vf', `select='gt(scene,${sceneThreshold})',showinfo`, '-f', 'null', '-'],
      {signal, timeoutMs: LIMITS.scanTimeoutMs, keepStderr: 400_000});
    for (const match of stderr.matchAll(/pts_time:\s*([0-9.]+)/g)) {
      const time = Number(match[1]);
      if (Number.isFinite(time) && time >= margin && time <= duration - margin) scenes.push(round(time));
    }
  } catch (error) {
    if (error.code === 'cancelled') throw error;
  }
  const picked = [];
  const spacing = Math.max(0.5, duration / (count * 3));
  const far = (time) => picked.every((item) => Math.abs(item.timestampSeconds - time) >= spacing);
  for (const time of scenes) if (picked.length < count && far(time)) picked.push({timestampSeconds: time, reason: 'scene-change'});
  for (let index = 0; picked.length < count && index < count * 4; index += 1) {
    const time = round(margin + ((index % count) + 0.5) * ((duration - 2 * margin) / count) + Math.floor(index / count) * spacing * 0.37);
    if (time <= duration - margin && far(time)) picked.push({timestampSeconds: time, reason: 'evenly-spaced'});
  }
  picked.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  return {source: {assetId: source.assetId, versionId: source.versionId, sha256: source.sha256}, durationSeconds: round(duration), candidates: picked,
    note: 'Pontos sugeridos por mudança de cena ou espaçamento; nenhum reconhecimento de produto, rosto ou expressão. O usuário escolhe o frame.'};
}

/** Extrai um frame JPG de prévia (para a galeria escolher timestamp). Arquivo novo; nunca sobrescreve. */
export async function extractFramePreview({source: rawSource, timestampSeconds, outputPath, maxWidth = 640, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', signal} = {}) {
  const source = validateSource(rawSource);
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath) || /[\0\r\n]/.test(outputPath) || !/\.jpe?g$/i.test(outputPath)) fail('invalid_output', 'outputPath deve ser .jpg absoluto.');
  if (path.resolve(outputPath) === path.resolve(source.path)) fail('invalid_output', 'A prévia nunca substitui o vídeo de origem.');
  if (!Number.isInteger(maxWidth) || maxWidth < 64 || maxWidth > 1920) fail('invalid_input', 'maxWidth deve estar entre 64 e 1920.');
  if (await stat(outputPath).then(() => true, () => false)) fail('output_exists', 'A prévia já existe; use outro caminho.');
  await verifySource(source);
  const metadata = await probeMedia(source.path, {ffprobePath, signal});
  if (!finite(timestampSeconds) || timestampSeconds < 0 || timestampSeconds > (metadata.durationSeconds ?? 0)) fail('invalid_input', 'timestampSeconds fora do vídeo.');
  const partial = `${outputPath}.${randomBytes(4).toString('hex')}.partial.jpg`;
  try {
    await runProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(timestampSeconds), '-i', source.path, '-frames:v', '1', '-an', '-vf', `${SQUARE_PIXELS},scale='min(${maxWidth},iw)':-2,format=yuvj420p`, '-q:v', '3', '-update', '1', '-n', partial], {signal});
    await rename(partial, outputPath);
  } catch (error) {
    await rm(partial, {force: true});
    throw error;
  }
  return {path: outputPath, timestampSeconds: round(timestampSeconds), sha256: await hashFile(outputPath), kind: 'frame-preview'};
}

// ---------------------------------------------------------------- render

const scrimFilter = ({scrim, canvas}) => {
  const {width: W, height: H} = canvas;
  const value = scrim.color === WHITE ? 255 : 0;
  const axis = scrim.direction === 'left' || scrim.direction === 'right' ? 'X' : 'Y';
  // Rampa suave (smoothstep) de 0 em `from` até alpha em `to`, constante além de `to`.
  const t = `clip((${axis}-(${scrim.from}))/(${scrim.to - scrim.from}),0,1)`;
  return `color=c=black:s=${W}x${H}:d=1,format=rgba,geq=r=${value}:g=${value}:b=${value}:a='255*${scrim.alpha}*(${t})*(${t})*(3-2*(${t}))'`;
};

function filterGraph(item, {sourceStream, logoStream, preview, fileType, format}) {
  const {layout, crop} = item;
  const {width: W, height: H} = layout.canvas;
  const parts = [];
  const region = layout.frameRect;
  parts.push(`[${sourceStream}]${SQUARE_PIXELS},crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${region.w}:${region.h}:flags=lanczos,setsar=1,format=rgba[frame]`);
  let base = 'frame';
  if (layout.panel) {
    parts.push(`color=c=${ffColor(layout.panel.color)}:s=${W}x${H}:d=1,format=rgba[panel]`);
    parts.push(`[panel][frame]overlay=${region.x}:${region.y}:format=auto[base]`);
    base = 'base';
  }
  if (layout.scrim) {
    parts.push(`${scrimFilter(layout)}[scrim]`);
    parts.push(`[${base}][scrim]overlay=0:0:format=auto[veiled]`);
    base = 'veiled';
  }
  const draw = [];
  if (layout.accent) draw.push(`drawbox=x=${layout.accent.rect.x}:y=${layout.accent.rect.y}:w=${layout.accent.rect.w}:h=${layout.accent.rect.h}:color=${ffColor(layout.accent.color)}:t=fill`);
  if (layout.kicker) {
    const k = layout.kicker;
    draw.push(`drawbox=x=${k.rect.x}:y=${k.rect.y}:w=${k.rect.w}:h=${k.rect.h}:color=${ffColor(k.fill)}:t=fill`);
    draw.push(`drawtext=fontfile=font.ttf:textfile=kicker.txt:expansion=none:fontsize=${k.size}:fontcolor=${ffColor(k.color)}:x=${k.rect.x + Math.round(k.rect.w / 2)}-text_w/2:y=${k.baseline}:y_align=baseline`);
  }
  layout.title.lines.forEach((line, index) => {
    const x = layout.align === 'center' ? `${layout.centerX}-text_w/2` : String(line.x);
    draw.push(`drawtext=fontfile=font.ttf:textfile=line${index}.txt:expansion=none:fontsize=${layout.title.size}:fontcolor=${ffColor(layout.title.color)}:x=${x}:y=${line.baseline}:y_align=baseline`);
  });
  parts.push(`[${base}]${draw.join(',')}[texted]`);
  base = 'texted';
  if (layout.logo && logoStream) {
    parts.push(`[${logoStream}]scale=${layout.logo.w}:${layout.logo.h}:flags=lanczos,format=rgba[logo]`);
    parts.push(`[${base}][logo]overlay=${layout.logo.x}:${layout.logo.y}:format=auto[branded]`);
    base = 'branded';
  }
  if (preview) {
    // Guias só na prévia: área segura (ciano), zonas reservadas (vermelho) e recortes de grade (amarelo).
    const guides = [`drawbox=x=${layout.safeArea.x}:y=${layout.safeArea.y}:w=${layout.safeArea.w}:h=${layout.safeArea.h}:color=0x00e5ff@0.95:t=4`];
    for (const zone of layout.reservedZones) guides.push(`drawbox=x=${zone.x}:y=${zone.y}:w=${zone.w}:h=${zone.h}:color=0xff3b30@0.35:t=fill`);
    for (const guide of format.guides) {
      const rect = px(guide, format);
      guides.push(`drawbox=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:color=0xffd60a@0.95:t=3`);
    }
    parts.push(`[${base}]${guides.join(',')}[guided]`);
    base = 'guided';
  }
  parts.push(`[${base}]${fileType === 'jpg' ? 'format=yuvj444p' : 'format=rgb24'}[out]`);
  return parts.join(';');
}

async function renderOne(item, {ffmpegPath, sourcePath, logoPath, workDir, fileName, preview, fileType, format, signal, quality, onSpawn}) {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(item.timestampSeconds), '-i', sourcePath];
  if (logoPath && item.layout.logo) args.push('-i', logoPath);
  const graph = filterGraph(item, {sourceStream: '0:v:0', logoStream: logoPath && item.layout.logo ? '1:v:0' : null, preview, fileType, format});
  args.push('-filter_complex', graph, '-map', '[out]', '-frames:v', '1', '-an', '-sn', '-update', '1');
  if (fileType === 'jpg') args.push('-c:v', 'mjpeg', '-q:v', String(quality), '-huffman', 'optimal');
  else args.push('-c:v', 'png', '-compression_level', '9');
  args.push('-n', fileName);
  await runProcess(ffmpegPath, args, {signal, cwd: workDir, onSpawn});
}

const throwIfAborted = (signal) => { if (signal?.aborted) fail('cancelled', 'Geração de capas cancelada.'); };

/**
 * Gera as três capas (e, opcionalmente, as prévias com guias) de uma versão de vídeo. Tudo é renderizado e verificado
 * num diretório temporário dentro de outputDirectory; só depois o lote inteiro aparece em outputDirectory/<batchId>
 * (rename atômico) com manifest.json. Cancelamento ou falha remove o temporário; nada parcial é entregue.
 */
export async function renderThumbnailSet({signal, onProgress, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', ...request} = {}) {
  const spec = validateThumbnailRequest(request);
  const outputDirectory = request.outputDirectory;
  if (typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory) || /[\0\r\n]/.test(outputDirectory) || /^[\\/]{2}/.test(outputDirectory)) fail('invalid_output', 'outputDirectory deve ser uma pasta local absoluta.');
  const outDir = path.resolve(outputDirectory);
  const outInfo = await stat(outDir).catch(() => null);
  if (!outInfo?.isDirectory()) fail('invalid_output', 'outputDirectory não existe ou não é pasta.');
  throwIfAborted(signal);
  const progress = (phase, completed, total) => onProgress?.({phase, completed, total});

  progress('validate', 0, 1);
  const sourceBefore = await verifySource(spec.source);
  throwIfAborted(signal);
  const metadata = await probeMedia(spec.source.path, {ffprobePath, signal});
  if (metadata.width > LIMITS.maxSourceSide || metadata.height > LIMITS.maxSourceSide) fail('invalid_source', 'Resolução do vídeo acima do limite suportado.');
  if (!finite(metadata.durationSeconds) || metadata.durationSeconds <= 0) fail('invalid_source', 'Duração do vídeo desconhecida; não é possível validar os timestamps.');
  // Frame real de cada conceito: tamanho pós-autorrotação/SAR e pts exibido (VFR). Diverge do ffprobe => vence o decodificado.
  const frames = {};
  for (const concept of spec.concepts) {
    if (concept.timestampSeconds > metadata.durationSeconds) fail('invalid_concepts', `${concept.concept}: timestamp ${concept.timestampSeconds}s passa da duração (${round(metadata.durationSeconds)}s).`);
    throwIfAborted(signal);
    const frame = await probeFrame(spec.source.path, concept.timestampSeconds, {ffmpegPath, signal});
    if (!frame) fail('invalid_concepts', `${concept.concept}: nenhum frame decodificável em ${concept.timestampSeconds}s; escolha um ponto anterior.`);
    if (frame.width > LIMITS.maxSourceSide * 2 || frame.height > LIMITS.maxSourceSide * 2) fail('invalid_source', 'Frame decodificado acima do limite suportado.');
    frames[concept.concept] = frame;
  }
  const decoded = frames[spec.concepts[0].concept];
  const orientation = {rotation: metadata.rotation, sampleAspectRatio: metadata.sampleAspectRatio, stored: metadata.stored, expected: metadata.display, decoded: {width: decoded.width, height: decoded.height},
    consistent: Object.values(frames).every((item) => item.width === metadata.display.width && item.height === metadata.display.height)};
  const font = await resolveFont(spec.brand.fontPath);
  let logo = null;
  if (spec.brand.logoPath) {
    const info = await stat(spec.brand.logoPath).catch(() => null);
    if (!info?.isFile()) fail('invalid_logo', 'Logo não encontrado.');
    if (info.size > LIMITS.maxLogoBytes) fail('invalid_logo', 'Logo acima de 10 MB.');
    const logoSha = await hashFile(spec.brand.logoPath);
    if (spec.brand.logoSha256 && spec.brand.logoSha256 !== logoSha) fail('invalid_logo', 'O logo mudou desde que foi escolhido (sha256 diferente).');
    const logoMeta = await probeMedia(spec.brand.logoPath, {ffprobePath, signal}).catch((error) => { if (error.code === 'cancelled') throw error; fail('invalid_logo', 'Logo ilegível.'); });
    if (logoMeta.width > LIMITS.maxLogoSide || logoMeta.height > LIMITS.maxLogoSide) fail('invalid_logo', 'Logo acima de 4096 px.');
    logo = {width: logoMeta.width, height: logoMeta.height, sha256: logoSha};
  }
  const plan = planThumbnailSet(request, {sourceMetadata: metadata, font, logo, frames});
  if (!orientation.consistent) for (const item of plan.items) item.warnings.push(`Rotação/SAR do ffprobe (${metadata.display.width}×${metadata.display.height}) diverge do frame decodificado (${frames[item.concept].width}×${frames[item.concept].height}); o recorte usou o frame decodificado.`);
  const finalDir = path.join(outDir, plan.batchId);
  if (await stat(finalDir).then(() => true, () => false)) fail('output_exists', `O lote ${plan.batchId} já existe; ele corresponde exatamente a esta especificação.`, {batchDirectory: finalDir});
  progress('validate', 1, 1);

  const workDir = path.join(outDir, `.${plan.batchId}.${randomBytes(6).toString('hex')}.partial`);
  await mkdir(workDir);
  let committed = false;
  try {
    const total = plan.items.length * (spec.safeAreaPreview ? 2 : 1);
    let completed = 0;
    const items = [];
    for (const item of plan.items) {
      throwIfAborted(signal);
      const textDir = path.join(workDir, item.concept);
      await mkdir(textDir);
      await copyFile(font.path, path.join(textDir, 'font.ttf'));
      await Promise.all(item.layout.title.lines.map((line, index) => writeFile(path.join(textDir, `line${index}.txt`), line.text, 'utf8')));
      if (item.layout.kicker) await writeFile(path.join(textDir, 'kicker.txt'), item.layout.kicker.text, 'utf8');
      const ext = spec.fileType;
      const exportName = `${item.concept}-${plan.format.id}.${ext}`;
      const outputs = {};
      for (const preview of spec.safeAreaPreview ? [false, true] : [false]) {
        const name = preview ? `${item.concept}-${plan.format.id}.safe-area-preview.png` : exportName;
        const fileType = preview ? 'png' : ext;
        progress('render', completed, total);
        let quality = 2;
        for (;;) {
          await rm(path.join(textDir, name), {force: true});
          await renderOne(item, {ffmpegPath, sourcePath: spec.source.path, logoPath: spec.brand.logoPath, workDir: textDir, fileName: name, preview, fileType, format: plan.format, signal, quality, onSpawn: () => onProgress?.({phase: 'render', completed, total, process: 'running'})});
          const size = (await stat(path.join(textDir, name))).size;
          // Limite documentado do destino (ex.: YouTube 2 MB): só o JPG final reencoda com mais compressão.
          if (preview || !plan.format.maxBytes || size <= plan.format.maxBytes) break;
          if (fileType !== 'jpg' || quality >= 10) fail('verify_failed', `A capa ${item.concept} passou de ${plan.format.maxBytes} bytes; use JPG.`);
          quality += 2;
        }
        completed += 1;
        const facts = await probeMedia(path.join(textDir, name), {ffprobePath, signal});
        if (facts.width !== plan.format.width || facts.height !== plan.format.height) fail('verify_failed', `Dimensão gerada ${facts.width}×${facts.height} difere de ${plan.format.width}×${plan.format.height}.`);
        if (facts.codec !== (fileType === 'jpg' ? 'mjpeg' : 'png')) fail('verify_failed', `Codec inesperado (${facts.codec}).`);
        outputs[preview ? 'preview' : 'export'] = {name, fileType, quality: fileType === 'jpg' ? quality : null};
      }
      items.push({item, textDir, outputs});
    }
    throwIfAborted(signal);
    progress('verify', 0, 1);
    await verifySource({...spec.source});
    const after = await stat(spec.source.path);
    if (after.size !== sourceBefore.size || after.mtimeMs !== sourceBefore.mtimeMs) fail('source_changed', 'O vídeo de origem mudou durante a geração.');

    // Monta o diretório final dentro do temporário: arquivos + manifest, depois um único rename.
    const stage = path.join(workDir, 'batch');
    await mkdir(stage);
    const manifestItems = [];
    for (const {item, textDir, outputs} of items) {
      const entry = {id: `${plan.batchId}:${item.concept}`, concept: item.concept, template: item.layout.template, title: item.title, ...(item.kicker ? {kicker: item.kicker} : {}), timestampSeconds: item.timestampSeconds, frameTimestampSeconds: frames[item.concept].ptsTimeSeconds, framing: item.framing,
        crop: item.crop, layout: {titleSize: item.layout.title.size, lines: item.layout.title.lines.map((line) => line.text), titleRect: item.layout.title.rect, kickerRect: item.layout.kicker?.rect ?? null, logoRect: item.layout.logo, frameRect: item.layout.frameRect, safeArea: item.layout.safeArea, reservedZones: item.layout.reservedZones, contrast: item.layout.contrast, align: item.layout.align, side: item.layout.side},
        warnings: item.warnings};
      for (const [kind, output] of Object.entries(outputs)) {
        await rename(path.join(textDir, output.name), path.join(stage, output.name));
        const file = path.join(finalDir, output.name);
        const info = await stat(path.join(stage, output.name));
        entry[kind] = {kind: kind === 'export' ? 'thumbnail' : 'safe-area-preview', fileName: output.name, path: file, sha256: await hashFile(path.join(stage, output.name)), size: info.size,
          width: plan.format.width, height: plan.format.height, mime: output.fileType === 'jpg' ? 'image/jpeg' : 'image/png', ...(output.quality ? {jpegQuality: output.quality} : {})};
      }
      manifestItems.push(entry);
    }
    throwIfAborted(signal);
    const manifest = {
      schema: MANIFEST_SCHEMA, engine: {id: ENGINE_ID, version: ENGINE_VERSION}, batchId: plan.batchId, specHash: plan.specHash, createdAt: new Date().toISOString(), directory: finalDir,
      source: {assetId: spec.source.assetId, versionId: spec.source.versionId, sha256: spec.source.sha256, width: metadata.width, height: metadata.height, durationSeconds: round(metadata.durationSeconds), preserved: true,
        display: {width: decoded.width, height: decoded.height, rotation: metadata.rotation, sampleAspectRatio: metadata.sampleAspectRatio, consistentWithProbe: orientation.consistent}},
      format: {id: plan.format.id, label: plan.format.label, width: plan.format.width, height: plan.format.height, maxBytes: plan.format.maxBytes, guidance: plan.format.guidance, status: 'guidance-unverified'},
      fileType: spec.fileType, brand: {theme: spec.brand.theme, accent: spec.brand.accent, logo: logo ? {sha256: logo.sha256, width: logo.width, height: logo.height} : null}, font: {name: font.name, sha256: font.sha256},
      requiresAi: false, items: manifestItems
    };
    await writeFile(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
    progress('commit', 0, 1);
    throwIfAborted(signal);
    await rename(stage, finalDir);
    committed = true;
    progress('commit', 1, 1);
    return manifest;
  } catch (error) {
    if (committed) await rm(finalDir, {recursive: true, force: true});
    if (signal?.aborted && !(error instanceof ThumbnailError && error.code === 'cancelled')) throw new ThumbnailError('cancelled', 'Geração de capas cancelada.');
    throw error;
  } finally {
    await rm(workDir, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------- seleção por versão (contrato para persistência)

/** Chave única de escolha: uma capa por conteúdo + versão do vídeo + formato de destino. */
export const selectionKey = ({contentId, assetId, versionId, format}) => [contentId, assetId, versionId, format].join('|');

/** Registro imutável da escolha do usuário. A persistência (estado editorial) é do integrador. */
export function createThumbnailSelection(manifest, concept, {contentId, selectedAt = new Date().toISOString()} = {}) {
  if (!isRecord(manifest) || manifest.schema !== MANIFEST_SCHEMA) fail('invalid_input', 'Manifest de capas inválido.');
  if (typeof contentId !== 'string' || !contentId || /[|\0]/.test(contentId)) fail('invalid_input', 'contentId é obrigatório.');
  const item = manifest.items?.find((entry) => entry.concept === concept);
  if (!item?.export) fail('invalid_input', `O lote não tem a capa ${concept}.`);
  return {
    schema: SELECTION_SCHEMA,
    key: selectionKey({contentId, assetId: manifest.source.assetId, versionId: manifest.source.versionId, format: manifest.format.id}),
    contentId, source: {assetId: manifest.source.assetId, versionId: manifest.source.versionId, sha256: manifest.source.sha256},
    format: manifest.format.id, batchId: manifest.batchId, specHash: manifest.specHash, concept,
    file: {path: item.export.path, sha256: item.export.sha256, size: item.export.size, width: item.export.width, height: item.export.height, mime: item.export.mime},
    selectedAt
  };
}

/**
 * Estado PURO de uma escolha frente à versão atual do vídeo: 'current' ou 'stale' (com motivos). A capa escolhida
 * para a versão A nunca vale para a versão B; o integrador pede nova escolha quando a versão muda.
 */
export function checkThumbnailSelection(selection, {currentSource, file} = {}) {
  const reasons = [];
  if (!isRecord(selection) || selection.schema !== SELECTION_SCHEMA) return {status: 'invalid', reasons: ['Seleção sem schema reconhecido.']};
  if (selection.key !== selectionKey({contentId: selection.contentId, assetId: selection.source?.assetId, versionId: selection.source?.versionId, format: selection.format})) reasons.push('Chave da seleção não corresponde aos campos.');
  if (!currentSource) reasons.push('Versão atual do vídeo desconhecida.');
  else {
    if (currentSource.assetId !== selection.source.assetId) reasons.push('Outro vídeo está ligado ao conteúdo.');
    if (currentSource.versionId !== selection.source.versionId) reasons.push('A versão do vídeo mudou desde a escolha.');
    if (currentSource.sha256 !== selection.source.sha256) reasons.push('O arquivo do vídeo mudou desde a escolha.');
  }
  if (file && (file.sha256 !== selection.file.sha256 || (file.size !== undefined && file.size !== selection.file.size))) reasons.push('O arquivo da capa mudou ou foi substituído.');
  return reasons.length ? {status: reasons[0].startsWith('Chave') ? 'invalid' : 'stale', reasons} : {status: 'current', reasons};
}

/** Lê o arquivo escolhido e confere hash/tamanho (IO). */
export async function verifyThumbnailSelectionFile(selection, {currentSource} = {}) {
  let file = null;
  try {
    const info = await stat(selection.file.path);
    file = {size: info.size, sha256: await hashFile(selection.file.path)};
  } catch {
    return {status: 'stale', reasons: ['O arquivo da capa não existe mais.']};
  }
  return checkThumbnailSelection(selection, {currentSource, file});
}
