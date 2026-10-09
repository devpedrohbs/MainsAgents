// Legendas "palavra a palavra" (1–3 palavras por vez) a partir dos tempos por palavra do whisper.cpp (-dtw). O texto é
// exatamente o reconhecido: só os caracteres que o libass não aceita ({ } \ e controles) são retirados, e isso vira
// aviso explícito. O resultado é uma versão normal de legendas (editável, aprovada e gravada pelos estilos existentes).
import {CAPTION_LIMITS, captionsFromTranscript} from './editorial-captions.mjs';

export const WORD_CAPTION_DEFAULTS = Object.freeze({maxWords: 3, maxSeconds: 1.6, maxChars: 26, gapBreak: 0.35, bridgeGap: 0.25});
const round = (value) => Math.round(value * 1000) / 1000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** @returns {{segments: {start:number,end:number,text:string}[], warnings: string[]}} */
export function captionsFromWords(transcript, durationSeconds, options = {}) {
  const o = {...WORD_CAPTION_DEFAULTS, ...options};
  const raw = Array.isArray(transcript?.words) ? transcript.words : [];
  const words = raw.filter((word) => finite(word?.start) && finite(word?.end) && word.end > word.start && word.start < durationSeconds && typeof word.text === 'string' && word.text.trim());
  if (!words.length) {
    const fallback = captionsFromTranscript(transcript, durationSeconds);
    return {segments: fallback.segments, warnings: [...fallback.warnings, 'no-word-timing']};
  }
  let sanitized = false;
  const clean = words.map((word) => {
    const text = word.text.replace(/[{}\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (text !== word.text.trim()) sanitized = true;
    return {start: word.start, end: Math.min(word.end, durationSeconds), text};
  }).filter((word) => word.text);
  // Agrupa sem atravessar pausas nem pontuação final; limita palavras, duração e largura.
  const groups = [];
  let group = [];
  for (const [index, word] of clean.entries()) {
    group.push(word);
    const next = clean[index + 1], text = group.map((item) => item.text).join(' ');
    const full = group.length >= o.maxWords || word.end - group[0].start >= o.maxSeconds || [...text].length >= o.maxChars;
    const breakHere = !next || /[.!?;:,…]$/.test(word.text) || next.start - word.end > o.gapBreak || full
      || [...`${text} ${next.text}`].length > o.maxChars;
    if (breakHere) { groups.push(group); group = []; }
  }
  // Tempos: começa na 1ª palavra; termina na última (ou emenda pausas curtas até a próxima); nunca sobrepõe.
  let segments = groups.map((items) => ({start: items[0].start, end: items.at(-1).end, text: items.map((item) => item.text).join(' ')}));
  for (let i = 0; i < segments.length; i++) {
    const next = segments[i + 1];
    if (next && next.start - segments[i].end < o.bridgeGap) segments[i].end = next.start;
    if (next) segments[i].end = Math.min(segments[i].end, next.start);
    segments[i].end = Math.min(segments[i].end, durationSeconds);
  }
  // Muito curtas para o mínimo do motor: estende até o mínimo se couber, senão junta com a próxima.
  const merged = [];
  for (let i = 0; i < segments.length; i++) {
    const item = {...segments[i]}, next = segments[i + 1];
    if (item.end - item.start < CAPTION_LIMITS.minDuration) {
      const room = (next ? next.start : durationSeconds) - item.start;
      if (room >= CAPTION_LIMITS.minDuration) item.end = item.start + CAPTION_LIMITS.minDuration;
      else if (next) { segments[i + 1] = {start: item.start, end: next.end, text: `${item.text} ${next.text}`}; continue; }
      else if (merged.length) { const last = merged.at(-1); last.end = item.end; last.text = `${last.text} ${item.text}`; continue; }
    }
    merged.push(item);
  }
  segments = merged.filter((item) => item.end - item.start >= CAPTION_LIMITS.minDuration - 0.0005)
    .map((item) => ({start: round(item.start), end: round(item.end), text: [...item.text].slice(0, CAPTION_LIMITS.maxText).join('')}));
  return {segments, warnings: ['whisper-approximate', 'word-timing', ...(sanitized ? ['text-sanitized'] : [])]};
}
