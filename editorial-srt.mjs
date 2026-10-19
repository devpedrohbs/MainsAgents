// SRT editável separado do vídeo (para importar no mesmo projeto do CapCut). Funções puras, sem I/O.
// O texto do SRT (ou o reconhecido pelo Whisper, na geração direta) é a fonte: aqui ele só é dividido em blocos curtos,
// nunca reescrito, truncado ou "corrigido". Os limites de legenda gravada (libass: 160 caracteres, { } \, 0,2–12 s)
// NÃO valem para este SRT — o validador de gravação continua separado em editorial-captions.mjs.
import {createHash} from 'node:crypto';
import {toSrt} from './editorial-smart-edit.mjs';

export const SRT_SCHEMA = 'mainsagents.srt/1';
export const SRT_LIMITS = Object.freeze({maxBytes: 2_000_000, maxCues: 10_000, maxCueChars: 4000, maxSeconds: 6 * 3600});
export const SRT_SPLIT = Object.freeze({minWords: 2, maxWords: 4, defaultWords: 3, bridgeGap: 0.25, pauseGap: 0.3, alignMinRatio: 0.6});

export class SrtError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SrtError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
const fail = (code, message, details) => { throw new SrtError(code, message, details); };
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const ms = (value) => Math.round(value * 1000);
const sec = (value) => value / 1000;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const CLOCK = String.raw`\d{1,3}:\d{1,2}:\d{1,2}(?:[,.]\d{1,3})?`;
/** Linha de tempo SRT completa ("00:00:01,000 --> 00:00:02,000", com posição opcional depois). Texto com "-->" não é tempo. */
const TIMING_LINE = new RegExp(String.raw`^\s*(${CLOCK})\s*-->\s*(${CLOCK})(?:\s+.*)?$`);
const INDEX_LINE = /^\s*\d+\s*$/;
const parseClock = (value) => {
  const match = /^(\d{1,3}):(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(value);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number((match[4] ?? '0').padEnd(3, '0')) / 1000;
};

/** Texto como dados: só remove tags simples de formatação SRT (<i>, <b>, <u>, <font>), que não são falas. */
const stripFormatting = (text) => text.replace(/<\/?[biu]>/gi, '').replace(/<\/?font(?:\s[^>]*)?>/gi, '');

/**
 * SubRip como dados (inclusive o exportado pelo CapCut). Aceita números ausentes, ponto ou vírgula nos milissegundos e
 * linhas em branco extras. Recusa tempos ilegíveis, fim ≤ início e sobreposição — nunca adivinha nem descarta texto.
 * @returns {{cues:{start:number,end:number,text:string}[], warnings:string[]}}
 */
export function parseSrtDocument(text) {
  if (typeof text !== 'string' || !text.trim()) fail('invalid_srt', 'O arquivo SRT está vazio.');
  if (Buffer.byteLength(text) > SRT_LIMITS.maxBytes) fail('invalid_srt', 'O arquivo SRT é grande demais (máximo 2 MB).');
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues = [], warnings = new Set();
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index++;
    if (index >= lines.length) break;
    const block = cues.length + 1;
    if (INDEX_LINE.test(lines[index]) && TIMING_LINE.test(lines[index + 1] ?? '')) index++;
    const timing = TIMING_LINE.exec(lines[index] ?? '');
    if (!timing) fail('invalid_srt', `SRT: o bloco ${block} não tem uma linha de tempo "00:00:01,000 --> 00:00:02,000".`, {block});
    const start = parseClock(timing[1]), end = parseClock(timing[2]);
    if (!finite(start) || !finite(end)) fail('invalid_srt', `SRT: tempo ilegível no bloco ${block}.`, {block});
    index++;
    const body = [];
    // O texto vai até a próxima linha em branco, ou até uma nova linha de tempo completa (SRT sem linha em branco).
    // Um "-->" dentro do texto (ex.: "API A --> B") é texto, não tempo.
    while (index < lines.length && lines[index].trim() && !TIMING_LINE.test(lines[index]) && !(INDEX_LINE.test(lines[index]) && TIMING_LINE.test(lines[index + 1] ?? ''))) body.push(lines[index++]);
    const raw = body.join('\n'), clean = stripFormatting(raw);
    if (clean !== raw) warnings.add('formatting-removed');
    const textValue = clean.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
    if (!textValue) { warnings.add('empty-cue-skipped'); continue; }
    if (CONTROL.test(textValue)) fail('invalid_srt', `SRT: o bloco ${block} contém caracteres de controle.`, {block});
    if ([...textValue].length > SRT_LIMITS.maxCueChars) fail('invalid_srt', `SRT: o bloco ${block} tem texto longo demais para uma legenda.`, {block});
    if (ms(end) <= ms(start)) fail('invalid_srt', `SRT: no bloco ${block} o fim precisa vir depois do início.`, {block});
    const previous = cues.at(-1);
    if (previous && ms(start) < ms(previous.end)) fail('invalid_srt', `SRT: o bloco ${block} começa antes do fim do anterior (sobreposição).`, {block});
    if (end > SRT_LIMITS.maxSeconds) fail('invalid_srt', `SRT: o bloco ${block} passa de 6 horas.`, {block});
    cues.push({start: sec(ms(start)), end: sec(ms(end)), text: textValue});
    if (cues.length > SRT_LIMITS.maxCues) fail('invalid_srt', `SRT: no máximo ${SRT_LIMITS.maxCues} blocos.`);
  }
  if (!cues.length) fail('invalid_srt', 'O SRT não tem nenhuma legenda com texto.');
  return {cues, warnings: [...warnings]};
}

/** Blocos editados pelo usuário (ou divididos aqui): ordem, sem sobreposição, ≥ 1 ms, texto não vazio. Sem limite de libass. */
export function validateSrtBlocks(raw, {durationSeconds} = {}) {
  if (!Array.isArray(raw) || !raw.length) fail('invalid_blocks', 'Inclua pelo menos um bloco com texto e tempo.');
  if (raw.length > SRT_LIMITS.maxCues) fail('invalid_blocks', `No máximo ${SRT_LIMITS.maxCues} blocos.`);
  const limit = finite(durationSeconds) && durationSeconds > 0 ? ms(durationSeconds) + 50 : ms(SRT_LIMITS.maxSeconds);
  let previousEnd = 0;
  return raw.map((item, index) => {
    const n = index + 1;
    if (!item || typeof item !== 'object') fail('invalid_blocks', `Bloco ${n}: inválido.`, {index});
    if (!finite(item.start) || !finite(item.end)) fail('invalid_timing', `Bloco ${n}: tempo ilegível.`, {index});
    const start = ms(item.start), end = ms(item.end);
    if (start < 0 || end <= start) fail('invalid_timing', `Bloco ${n}: o fim precisa vir depois do início.`, {index});
    if (start < previousEnd) fail('invalid_timing', `Bloco ${n}: começa antes do fim do anterior. Ajuste para não sobrepor.`, {index});
    if (end > limit) fail('invalid_timing', `Bloco ${n}: termina depois do fim do vídeo.`, {index});
    if (typeof item.text !== 'string') fail('invalid_text', `Bloco ${n}: texto inválido.`, {index});
    const text = item.text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
    if (!text) fail('invalid_text', `Bloco ${n}: texto vazio. Remova o bloco ou escreva o que foi falado.`, {index});
    if (CONTROL.test(text)) fail('invalid_text', `Bloco ${n}: contém caracteres de controle.`, {index});
    // "-->" no texto é permitido; só uma linha idêntica a uma linha de tempo completa tornaria o arquivo ambíguo.
    if (text.split('\n').some((line) => TIMING_LINE.test(line))) fail('invalid_text', `Bloco ${n}: uma linha do texto é igual a uma linha de tempo do SRT; mude o texto.`, {index});
    if ([...text].length > SRT_LIMITS.maxCueChars) fail('invalid_text', `Bloco ${n}: texto longo demais.`, {index});
    previousEnd = end;
    const timing = ['words', 'aligned', 'estimated', 'imported', 'manual'].includes(item.timing) ? item.timing : 'manual';
    return {start: sec(start), end: sec(end), text, timing, ...(Number.isSafeInteger(item.unit) && item.unit >= 0 ? {unit: item.unit} : {})};
  });
}

/** Hash estável do conteúdo exportável (tempos em ms + texto). */
export function srtBlocksHash(blocks) {
  return createHash('sha256').update(JSON.stringify(blocks.map(({start, end, text}) => [ms(start), ms(end), text]))).digest('hex');
}

/**
 * UTF-8 SEM BOM e CRLF. O guia oficial do CapCut sobre falhas de legenda recomenda UTF-8 sem BOM;
 * a importação aqui aceita BOM, LF ou CRLF.
 */
export function blocksToSrt(blocks) {
  return toSrt(blocks.map(({start, end, text}) => ({start, end, text})));
}

// --- divisão em blocos curtos ---------------------------------------------------------------------------------------

/** Palavras que soam cortadas no fim de um bloco ("pela", "do", "de", "no"…): artigos, preposições, conjunções. */
const WEAK_END = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas num numa nuns numas por pela pelo pelas pelos para pra pro pros pras '
  + 'com sem sob sobre entre até ao aos à às e ou nem mas que se porque quando como onde meu minha meus minhas seu sua seus suas teu tua nosso nossa '
  + 'este esta estes estas esse essa esses essas aquele aquela lhe me te nos vos mais muito muita bem tão '
  + 'the an of to in on at for from with and or but my your his her our their this that these those is are was '
  + 'el la los las del al y en con por para un una mi tu su').split(' '));
const STRONG = /[.!?…;:]["'”’»)\]]*$/u;
const COMMA = /[,—–-]["'”’»)\]]*$/u;
const PUNCT_ONLY = /^[^\p{L}\p{N}]+$/u;
const bare = (token) => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
/** Forma comparável (sem acento, caixa ou pontuação) só para alinhar com o Whisper; o texto exibido nunca muda. */
export const normalizeToken = (token) => token.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
export const tokenize = (text) => String(text).split(/\s+/).filter(Boolean);

/**
 * Agrupa tokens em blocos de até `maxWords`, por programação dinâmica: menos blocos, quebra em pontuação e pausas,
 * evita terminar em palavra fraca e evita bloco de uma palavra só. Empates preferem o primeiro bloco mais cheio
 * ("Eu hoje entrei / pela porta / do carro"). Nunca descarta, junta ou altera tokens.
 * @param {string[]} tokens
 * @param {{maxWords?:number, pauses?:boolean[]}} options pauses[i] = há pausa audível depois do token i
 * @returns {number[]} tamanhos dos blocos, somando tokens.length
 */
export function groupTokens(tokens, {maxWords = SRT_SPLIT.defaultWords, pauses = []} = {}) {
  const n = tokens.length;
  if (!n) return [];
  const best = new Array(n + 1).fill(Infinity), choice = new Array(n + 1).fill(0);
  best[n] = 0;
  const cost = (from, to) => { // tokens [from, to)
    const size = to - from, last = tokens[to - 1];
    let value = 1;
    if (size === 1 && n > 1 && maxWords > 1) value += PUNCT_ONLY.test(last) ? 0 : 0.6;
    if (to < n && !STRONG.test(last) && !COMMA.test(last) && WEAK_END.has(bare(last))) value += 3;
    if (PUNCT_ONLY.test(tokens[from]) && from > 0) value += 3; // "—" ou "?" sozinho no início fica com o anterior
    for (let k = from; k < to - 1; k++) {
      if (STRONG.test(tokens[k])) value += 4;
      else if (COMMA.test(tokens[k])) value += 2.5;
      if (pauses[k]) value += 2;
    }
    return value;
  };
  for (let i = n - 1; i >= 0; i--) {
    for (let size = Math.min(maxWords, n - i); size >= 1; size--) {
      const value = cost(i, i + size) + best[i + size];
      if (value < best[i] - 1e-9) { best[i] = value; choice[i] = size; }
    }
  }
  const sizes = [];
  for (let i = 0; i < n; i += choice[i]) sizes.push(choice[i]);
  return sizes;
}

const checkMaxWords = (value) => {
  const n = value === undefined ? SRT_SPLIT.defaultWords : Number(value);
  if (!Number.isInteger(n) || n < SRT_SPLIT.minWords || n > SRT_SPLIT.maxWords) fail('invalid_split', `Escolha de ${SRT_SPLIT.minWords} a ${SRT_SPLIT.maxWords} palavras por bloco.`);
  return n;
};

/** Tempos de borda monotônicos (ms inteiros), cada bloco ≥ 1 ms, dentro de [lo, hi]. */
function settle(spans, lo, hi) {
  let cursor = lo;
  return spans.map((span, index) => {
    const left = spans.length - index - 1;
    const start = Math.min(Math.max(span.start, cursor), hi - left - 1);
    const nextStart = index < spans.length - 1 ? Math.max(spans[index + 1].start, start + 1) : hi;
    const end = Math.max(start + 1, Math.min(span.end, nextStart, hi - left));
    cursor = end;
    return {...span, start, end};
  });
}

/**
 * Tempo de cada token (ms): os alinhados mantêm o do Whisper; os demais dividem o intervalo livre entre âncoras vizinhas
 * (ou as bordas da frase) proporcionalmente aos caracteres — estimativa, não medição.
 */
function fillTokenTimes(tokens, times, lo, hi) {
  const out = times.slice();
  for (let i = 0; i < tokens.length;) {
    if (out[i]) { i++; continue; }
    let j = i;
    while (j < tokens.length && !times[j]) j++;
    const from = i > 0 ? out[i - 1].end : lo, to = Math.max(from, j < tokens.length ? times[j].start : hi);
    const weights = tokens.slice(i, j).map((token) => Math.max(1, [...token].length)), total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let k = i; k < j; k++) {
      const start = from + Math.round((to - from) * acc / total);
      acc += weights[k - i];
      out[k] = {start, end: k === j - 1 ? to : from + Math.round((to - from) * acc / total)};
    }
    i = j;
  }
  return out;
}

/**
 * Alinha os tokens de cada bloco do SRT às palavras do Whisper do MESMO vídeo (LCS sobre a forma normalizada, só com
 * palavras dentro da janela de tempo do bloco). O texto continua sendo o do SRT; o Whisper só empresta tempos.
 * @returns {{times:(({start:number,end:number})|null)[][], ratio:number}}
 */
export function alignCuesToWords(cues, words) {
  const list = (Array.isArray(words) ? words : []).filter((w) => w && finite(w.start) && finite(w.end) && w.end > w.start && typeof w.text === 'string')
    .map((w) => ({start: ms(w.start), end: ms(w.end), key: normalizeToken(w.text)})).filter((w) => w.key);
  let matched = 0, total = 0;
  const times = cues.map((cue) => {
    const tokens = tokenize(cue.text), keys = tokens.map(normalizeToken);
    total += keys.filter(Boolean).length;
    const lo = ms(cue.start), hi = ms(cue.end);
    const pool = list.filter((w) => (w.start + w.end) / 2 >= lo - 500 && (w.start + w.end) / 2 <= hi + 500);
    const result = tokens.map(() => null);
    if (!pool.length) return result;
    const a = keys.length, b = pool.length, table = Array.from({length: a + 1}, () => new Uint16Array(b + 1));
    for (let i = a - 1; i >= 0; i--) for (let j = b - 1; j >= 0; j--) table[i][j] = keys[i] && keys[i] === pool[j].key ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    for (let i = 0, j = 0; i < a && j < b;) {
      if (keys[i] && keys[i] === pool[j].key) {
        const start = Math.min(Math.max(pool[j].start, lo), hi - 1), end = Math.max(start + 1, Math.min(pool[j].end, hi));
        result[i] = {start, end};
        matched++; i++; j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++;
    }
    return result;
  });
  return {times, ratio: total ? matched / total : 0};
}

/**
 * Divide legendas por frase (SRT importado) em blocos curtos dentro do tempo de cada frase. Com `words` do mesmo vídeo
 * e casamento suficiente, usa os tempos do Whisper ("aligned"); senão, tempos proporcionais ao texto, marcados
 * "estimated" bloco a bloco, com aviso. Nenhum bloco sai do intervalo da frase original.
 */
export function splitCues(cues, {maxWords, words} = {}) {
  const max = checkMaxWords(maxWords);
  const alignment = words?.length ? alignCuesToWords(cues, words) : null;
  const useAlignment = !!alignment && alignment.ratio >= SRT_SPLIT.alignMinRatio;
  const warnings = new Set();
  if (alignment && !useAlignment) warnings.add('alignment-low');
  const blocks = [];
  for (const [cueIndex, cue] of cues.entries()) {
    const tokens = tokenize(cue.text), lo = ms(cue.start), hi = ms(cue.end);
    const times = useAlignment ? alignment.times[cueIndex] : tokens.map(() => null);
    const pauses = tokens.map((_, i) => !!(times[i] && times[i + 1] && times[i + 1].start - times[i].end >= SRT_SPLIT.pauseGap * 1000));
    let sizes = groupTokens(tokens, {maxWords: max, pauses});
    if (sizes.length > hi - lo) { sizes = [tokens.length]; warnings.add('cue-too-short'); } // < 1 ms por bloco: mantém a frase inteira
    const filled = fillTokenTimes(tokens, times, lo, hi);
    const spans = [];
    for (let at = 0, g = 0; g < sizes.length; at += sizes[g++]) {
      const last = at + sizes[g] - 1, text = tokens.slice(at, last + 1).join(' ');
      const timing = times[at] && times[last] ? 'aligned' : sizes.length === 1 ? 'imported' : 'estimated';
      spans.push({start: filled[at].start, end: filled[last].end, text, timing, unit: Number.isSafeInteger(cue.unit) ? cue.unit : cueIndex});
    }
    // Pausas curtas entre blocos são emendadas (sem piscar); os estimados já são contíguos.
    for (let i = 0; i < spans.length - 1; i++) if (spans[i + 1].start - spans[i].end < SRT_SPLIT.bridgeGap * 1000) spans[i].end = spans[i + 1].start;
    for (const span of settle(spans, lo, hi)) {
      if (span.timing === 'estimated') warnings.add('estimated-timing');
      blocks.push({start: sec(span.start), end: sec(span.end), text: span.text, timing: span.timing, unit: span.unit});
    }
  }
  if (useAlignment) warnings.add('aligned-whisper');
  return {blocks, warnings: [...warnings], alignment: alignment ? {ratio: Math.round(alignment.ratio * 1000) / 1000, used: useAlignment} : null};
}

/** Palavras do Whisper válidas, ordenadas e dentro do vídeo. */
const cleanWords = (words, limit) => (Array.isArray(words) ? words : [])
  .filter((w) => w && finite(w.start) && finite(w.end) && w.end > w.start && typeof w.text === 'string' && w.text.trim() && ms(w.start) < limit && !CONTROL.test(w.text))
  .map((w) => ({start: sec(ms(w.start)), end: sec(Math.min(ms(w.end), limit)), text: w.text.trim()}))
  .filter((w) => ms(w.end) > ms(w.start))
  .sort((x, y) => x.start - y.start);

/**
 * Frases ("unidades") a partir das palavras: um trecho contínuo de fala até uma pausa audível ou pontuação final.
 * São a base para dividir e redividir; o texto é exatamente o reconhecido.
 */
export function cuesFromWords(words) {
  const cues = [];
  let run = [];
  const flush = () => { if (run.length) cues.push({start: run[0].start, end: run.at(-1).end, text: run.map((w) => w.text).join(' '), unit: cues.length}); run = []; };
  for (const [index, word] of words.entries()) {
    run.push(word);
    const next = words[index + 1];
    if (!next || next.start - word.end >= SRT_SPLIT.pauseGap || STRONG.test(word.text)) flush();
  }
  // Frases não se sobrepõem (palavras do Whisper podem encostar umas nas outras).
  for (let i = 1; i < cues.length; i++) if (ms(cues[i].start) < ms(cues[i - 1].end)) cues[i].start = cues[i - 1].end;
  for (let i = 0; i < cues.length; i++) if (ms(cues[i].end) <= ms(cues[i].start)) cues[i].end = sec(ms(cues[i].start) + 1);
  return cues;
}

/**
 * Geração direta a partir das palavras do Whisper local de um vídeo: o texto é exatamente o reconhecido (aproximado,
 * revise), cada bloco usa os tempos das próprias palavras. Sem palavras com tempo, cai para frases (proporcional).
 */
export function blocksFromTranscript(transcript, {maxWords, durationSeconds} = {}) {
  const max = checkMaxWords(maxWords);
  const limit = finite(durationSeconds) && durationSeconds > 0 ? ms(durationSeconds) : ms(SRT_LIMITS.maxSeconds);
  const words = cleanWords(transcript?.words, limit);
  if (!words.length) {
    const cues = (Array.isArray(transcript?.segments) ? transcript.segments : [])
      .filter((s) => s && finite(s.start) && finite(s.end) && typeof s.text === 'string' && s.text.trim() && ms(s.start) < limit)
      .map((s) => ({start: sec(ms(s.start)), end: sec(Math.min(ms(s.end), limit)), text: s.text.replace(/\s+/g, ' ').trim()}))
      .filter((s, i, all) => ms(s.end) > ms(s.start) && (i === 0 || ms(s.start) >= ms(all[i - 1].end)))
      .map((s, unit) => ({...s, unit}));
    if (!cues.length) return {blocks: [], warnings: ['no-speech']};
    const split = splitCues(cues, {maxWords: max});
    return {blocks: split.blocks, warnings: ['whisper-approximate', 'no-word-timing', ...split.warnings]};
  }
  return wordBlocks(cuesFromWords(words), words, max);
}

/** Divide frases com as palavras do Whisper do mesmo vídeo; blocos com as duas pontas reconhecidas ficam "words". */
export function wordBlocks(cues, words, maxWords) {
  const split = splitCues(cues, {maxWords, words});
  const blocks = split.blocks.map((block) => block.timing === 'aligned' ? {...block, timing: 'words'} : block);
  return {blocks, warnings: ['whisper-approximate', 'word-timing', ...split.warnings.filter((w) => w !== 'aligned-whisper' && w !== 'alignment-low')]};
}

/**
 * Base de revisão para redividir: junta os blocos da versão atual (com as correções de texto e os limites do usuário)
 * em frases pela unidade de origem. Blocos sem unidade viram uma frase cada.
 */
export function unitsFromBlocks(blocks) {
  const cues = [];
  let previous;
  for (const [index, block] of blocks.entries()) {
    const unit = Number.isSafeInteger(block.unit) ? block.unit : `solo-${index}`;
    const last = cues.at(-1);
    if (last && unit === previous) { last.end = block.end; last.text = `${last.text} ${block.text}`; }
    else cues.push({start: block.start, end: block.end, text: block.text, unit: cues.length});
    previous = unit;
  }
  return cues.map((cue) => ({...cue, text: tokenize(cue.text).join(' ')}));
}

/** Mesmas palavras, mesma ordem: prova de que a divisão/edição automática não inventou nem perdeu texto. */
export function sameWords(a, b) {
  const left = a.flatMap((item) => tokenize(item.text)), right = b.flatMap((item) => tokenize(item.text));
  return left.length === right.length && left.every((token, index) => token === right[index]);
}
