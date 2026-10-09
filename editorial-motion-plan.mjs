// Plano de motion dinâmico para a edição automática: transcrição (palavras) + ênfase da voz MEDIDA no áudio real
// + inferências do texto -> plano temporal editável -> props determinísticas da composição Remotion -> trilha de SFX.
// Regras: sinais medidos (`source:'measured'`) nunca se confundem com inferências do texto (`source:'inferred'`);
// sem áudio ou sem tempos por palavra, o plano declara a limitação em vez de fingir detecção.
import {spawn} from 'node:child_process';
import {normalizeReframe, reframeRenderProps} from './editorial-reframe.mjs';

export const motionIntensities = Object.freeze(['off', 'subtle', 'balanced', 'intense']);
export const motionLayouts = Object.freeze(['camera-full', 'split', 'motion-focus']);
export const motionCueKinds = Object.freeze(['punchIn', 'kineticText', 'keyPoint', 'explainer']);
export const explainerTypes = Object.freeze(['compare', 'steps', 'stat', 'process', 'image']);
export const statUnits = Object.freeze(['%', 'x', 'k', 'mil', 'R$', '$']);
export const sfxKinds = Object.freeze(['whoosh', 'pop', 'tick']);
export const signalKinds = Object.freeze(['loudness', 'pitch', 'pauseBefore', 'stretch', 'keyword', 'number', 'punctuation', 'editorHighlight', 'structure', 'user']);
export const motionLimitations = Object.freeze(['voiceUnavailable', 'wordTimingEstimated', 'transcriptUnavailable', 'tooShort', 'sfxSkipped']);
export const MOTION_LIMITS = Object.freeze({maxCues: 120, maxText: 60, maxReason: 140, maxSignals: 6, maxSeconds: 1800, minCueSeconds: 0.3, maxCueSeconds: 8, maxHighlights: 6, voiceSampleRate: 8000, maxExplainerSeconds: 20, maxQuote: 200, maxItem: 48, maxLabel: 24});

/**
 * Densidade e força por intensidade. Escolhas conservadoras: nada de efeito a cada frase. `maxLayoutShare` = fração
 * máxima do vídeo fora da câmera cheia; `minCameraSeconds` = câmera cheia mínima entre dois layouts (ou transição direta).
 */
export const MOTION_PRESETS = Object.freeze({
  subtle: Object.freeze({maxPerMinute: 4, minGap: 6, punchScale: 1.06, kinetic: false, keyPoints: false, layoutGap: Infinity, sfxPerMinute: 0, threshold: 0.55, sfxBaseDb: -20, explainers: false, maxLayoutShare: 0, minCameraSeconds: Infinity}),
  balanced: Object.freeze({maxPerMinute: 8, minGap: 3.5, punchScale: 1.1, kinetic: true, keyPoints: true, layoutGap: 18, sfxPerMinute: 2, threshold: 0.42, sfxBaseDb: -18, explainers: true, maxLayoutShare: 0.3, minCameraSeconds: 4}),
  intense: Object.freeze({maxPerMinute: 14, minGap: 2, punchScale: 1.16, kinetic: true, keyPoints: true, layoutGap: 10, sfxPerMinute: 4, threshold: 0.32, sfxBaseDb: -15, explainers: true, maxLayoutShare: 0.45, minCameraSeconds: 2})
});
/** Atenuação extra quando o efeito cai sobre fala (ducking planejado; o mix também comprime pelo sinal da voz). */
export const SFX_DUCK_DB = -4;

const round3 = (value) => Math.round(value * 1000) / 1000;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const median = (list) => {
  if (!list.length) return NaN;
  const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const normalizeWord = (text) => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%$€£]+/g, '');
const unsafeText = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩<>{}`\\]|:\/\/|javascript:/i;
export const safeMotionText = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= max && !unsafeText.test(value);

// ---------------------------------------------------------------- palavras

/**
 * Palavras com tempo. `timing:'words'` = tempos por palavra do whisper.cpp; `'estimated'` = distribuídos dentro da frase
 * proporcionalmente ao número de letras (honesto: não é alinhamento real); `'none'` sem transcrição.
 */
export function transcriptWords(transcript) {
  if (!transcript || transcript.noSpeech || !Array.isArray(transcript.segments) || !transcript.segments.length) return {timing: 'none', words: []};
  const real = Array.isArray(transcript.words) ? transcript.words.filter((item) => finite(item?.start) && finite(item?.end) && item.end > item.start && typeof item.text === 'string' && item.text.trim()) : [];
  if (real.length) return {timing: 'words', words: real.map((item) => ({start: round3(item.start), end: round3(item.end), text: item.text.trim().slice(0, 40)})).sort((a, b) => a.start - b.start)};
  const words = [];
  for (const segment of transcript.segments) {
    const parts = String(segment.text ?? '').split(/\s+/).filter(Boolean);
    const weights = parts.map((part) => Math.max(1, [...part].length)), total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = segment.start;
    parts.forEach((part, index) => {
      const length = (segment.end - segment.start) * weights[index] / total;
      words.push({start: round3(cursor), end: round3(cursor + length), text: part.slice(0, 40)});
      cursor += length;
    });
  }
  return {timing: words.length ? 'estimated' : 'none', words};
}

// ---------------------------------------------------------------- linha do tempo (cortes)

/** Trechos mantidos (linha do tempo ORIGINAL) com sua posição no vídeo editado. */
export function keptMap(segments) {
  let cursor = 0;
  return segments.map((item) => { const value = {start: item.start, end: item.end, outputStart: round3(cursor)}; cursor += item.end - item.start; return value; });
}

/**
 * Leva um intervalo da gravação para o vídeo editado. Usa o trecho mantido com maior sobreposição (o efeito nunca
 * atravessa um corte). Devolve null quando o intervalo foi removido ou sobra menos que `min` segundos.
 */
export function remapInterval(start, end, map, min = 0.05) {
  let best = null;
  for (const kept of map) {
    const a = Math.max(start, kept.start), b = Math.min(end, kept.end);
    if (b - a > (best ? best.b - best.a : 0)) best = {a, b, kept};
  }
  if (!best || best.b - best.a < min) return null;
  return {start: round3(best.kept.outputStart + best.a - best.kept.start), end: round3(best.kept.outputStart + best.b - best.kept.start)};
}

export function remapWords(words, segments) {
  const map = keptMap(segments), result = [];
  for (const word of words) {
    const out = remapInterval(word.start, word.end, map, Math.min(0.05, (word.end - word.start) / 2));
    if (out) result.push({...word, sourceStart: word.start, sourceEnd: word.end, start: out.start, end: out.end});
  }
  return result;
}

/**
 * Intervalo longo (explicativos) que PODE atravessar cortes: início = primeiro instante mantido >= start, fim = último
 * instante mantido <= end, no vídeo editado. null quando sobra menos que `min` segundos.
 */
export function remapSpan(start, end, map, min = 0.3) {
  let a = null, b = null;
  for (const kept of map) {
    if (kept.end > start && kept.start < end) {
      if (a === null) a = kept.outputStart + Math.max(start, kept.start) - kept.start;
      b = kept.outputStart + Math.min(end, kept.end) - kept.start;
    }
  }
  if (a === null || b - a < min) return null;
  return {start: round3(a), end: round3(b)};
}

/** Tempo do vídeo editado -> gravação (inverso do mapa de cortes). */
export function sourceAt(edited, map) {
  for (const kept of map) if (edited >= kept.outputStart - 1e-9 && edited <= kept.outputStart + kept.end - kept.start + 1e-9) return round3(kept.start + edited - kept.outputStart);
  const last = map[map.length - 1];
  return last ? round3(last.end) : round3(edited);
}

// ---------------------------------------------------------------- voz medida

const HOP_SECONDS = 0.01;

/** Trilha de energia (dB, 10 ms) de PCM mono 16-bit. Pura e determinística. */
export function voiceTrack(samples, sampleRate) {
  if (!(samples instanceof Int16Array) || !Number.isInteger(sampleRate) || sampleRate < 4000) throw new Error('Voice analysis needs mono 16-bit PCM.');
  const hop = Math.round(sampleRate * HOP_SECONDS), frames = Math.floor(samples.length / hop), db = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let i = frame * hop, end = i + hop; i < end; i++) sum += samples[i] * samples[i];
    db[frame] = 10 * Math.log10(sum / hop / (32768 * 32768) + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const noiseFloorDb = frames ? sorted[Math.floor(frames * 0.1)] : -120;
  const speechThresholdDb = Math.max(noiseFloorDb + 10, -50);
  return {samples, sampleRate, hop, db, noiseFloorDb: round2(noiseFloorDb), speechThresholdDb: round2(speechThresholdDb), duration: samples.length / sampleRate};
}

/** Pausas medidas (energia abaixo do limiar de fala por >= minSeconds). */
export function measuredPauses(track, minSeconds = 0.25) {
  const pauses = [], minFrames = Math.round(minSeconds / HOP_SECONDS);
  let open = -1;
  for (let i = 0; i <= track.db.length; i++) {
    const quiet = i < track.db.length && track.db[i] < track.speechThresholdDb;
    if (quiet && open < 0) open = i;
    if (!quiet && open >= 0) { if (i - open >= minFrames) pauses.push({start: round3(open * HOP_SECONDS), end: round3(i * HOP_SECONDS)}); open = -1; }
  }
  return pauses;
}

/**
 * Ajuste MEDIDO dos tempos de palavra: uma palavra que começa dentro de uma pausa medida passa a começar quando a voz
 * volta; uma palavra que atravessa o início de uma pausa termina nela. Corrige o desvio típico do reconhecedor perto
 * de pausas sem inventar palavras nem reordenar o texto.
 */
export function alignWordsToVoice(words, track) {
  const pauses = measuredPauses(track, 0.2);
  return words.map((word) => {
    let {start, end} = word;
    const inside = pauses.find((pause) => start >= pause.start - 0.02 && start < pause.end);
    if (inside && inside.end < end + 0.8) { const length = end - start; start = inside.end; end = Math.max(end, start + Math.min(length, 0.6)); }
    const cut = pauses.find((pause) => pause.start > start + 0.06 && pause.start < end);
    if (cut) end = cut.start;
    return {...word, start: round3(start), end: round3(Math.max(end, start + 0.06))};
  });
}

/** F0 por autocorrelação normalizada (75–400 Hz) numa janela de 40 ms; 0 quando não há voz periódica. */
export function pitchAt(track, seconds) {
  const {samples, sampleRate} = track, size = Math.round(sampleRate * 0.04), start = Math.round(seconds * sampleRate - size / 2);
  if (start < 0 || start + size * 2 > samples.length) return 0;
  const minLag = Math.floor(sampleRate / 400), maxLag = Math.ceil(sampleRate / 75);
  let energy = 0;
  for (let i = 0; i < size; i++) energy += samples[start + i] * samples[start + i];
  if (energy / size < 32768 * 32768 * 1e-5) return 0;
  let bestLag = 0, best = 0;
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0, shifted = 0;
    for (let i = 0; i < size; i++) { const b = samples[start + i + lag]; cross += samples[start + i] * b; shifted += b * b; }
    const score = cross / Math.sqrt(energy * shifted + 1e-9);
    scores[lag] = score;
    if (score > best) { best = score; bestLag = lag; }
  }
  if (best < 0.5 || !bestLag) return 0;
  // Um sinal periódico também correlaciona em 2T, 3T…: fica com o menor período (primeiro pico) quase tão bom quanto o melhor.
  for (let lag = minLag + 1; lag < bestLag; lag++) {
    if (scores[lag] >= best * 0.9 && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) { bestLag = lag; best = scores[lag]; break; }
  }
  // Interpolação parabólica para precisão sub-amostra.
  const a = scores[bestLag - 1] ?? best, c = scores[bestLag + 1] ?? best, denom = a - 2 * best + c;
  const lag = denom ? bestLag + 0.5 * (a - c) / denom : bestLag;
  return sampleRate / lag;
}

const powerMeanDb = (track, start, end) => {
  const a = clamp(Math.floor(start / HOP_SECONDS), 0, track.db.length), b = clamp(Math.ceil(end / HOP_SECONDS), a + 1, track.db.length);
  let sum = 0, count = 0;
  for (let i = a; i < b; i++) { sum += 10 ** (track.db[i] / 10); count++; }
  return count ? 10 * Math.log10(sum / count) : -120;
};

/**
 * Prosódia MEDIDA por palavra (linha do tempo da gravação): volume relativo à vizinhança (±4 s), altura (F0) relativa à
 * mediana do falante em semitons, pausa medida antes da palavra e alongamento relativo. Valores null = não mensurável.
 */
export function wordProsody(track, words) {
  const pauses = measuredPauses(track);
  const base = words.map((word) => {
    const loudness = powerMeanDb(track, word.start, word.end);
    const f0s = [];
    for (let t = word.start + 0.02; t < word.end - 0.01; t += 0.02) { const f0 = pitchAt(track, t); if (f0) f0s.push(f0); }
    const pause = pauses.find((item) => item.end <= word.start + 0.06 && item.end >= word.start - 0.12);
    const letters = Math.max(1, normalizeWord(word.text).length);
    return {loudness, f0: f0s.length ? median(f0s) : null, pauseBefore: pause ? round3(pause.end - pause.start) : 0, perLetter: (word.end - word.start) / letters};
  });
  const speakerF0 = median(base.map((item) => item.f0).filter(Boolean));
  const speakerRate = median(base.map((item) => item.perLetter));
  return base.map((item, index) => {
    const near = base.filter((other, j) => j !== index && Math.abs(words[j].start - words[index].start) <= 4 && other.loudness > track.speechThresholdDb).map((other) => other.loudness);
    const reference = near.length >= 3 ? median(near) : median(base.map((other) => other.loudness));
    const voiced = item.loudness > track.speechThresholdDb;
    return {
      loudnessDb: voiced && Number.isFinite(reference) ? round2(item.loudness - reference) : null,
      pitchSt: voiced && item.f0 && Number.isFinite(speakerF0) ? round2(12 * Math.log2(item.f0 / speakerF0)) : null,
      pauseBefore: item.pauseBefore,
      stretch: voiced && Number.isFinite(speakerRate) && speakerRate > 0 ? round2(item.perLetter / speakerRate) : null
    };
  });
}

/** Extrai PCM mono 8 kHz com FFmpeg (processo local, sem shell). Limitado a 30 min. */
export function extractVoicePcm({ffmpeg = 'ffmpeg', inputPath, signal, maxSeconds = MOTION_LIMITS.maxSeconds, sampleRate = MOTION_LIMITS.voiceSampleRate, timeoutMs = 600000}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Media operation canceled.')); return; }
    const args = ['-nostdin', '-hide_banner', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', inputPath, '-map', '0:a:0', '-vn', '-t', String(maxSeconds), '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1'];
    const child = spawn(ffmpeg, args, {shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = [], limit = maxSeconds * sampleRate * 2 + 4096;
    let size = 0, stderr = '', done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const abort = () => { child.kill(); finish(new Error('Media operation canceled.')); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Voice analysis exceeded its time limit.')); }, timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > limit) { child.kill(); finish(new Error('Voice analysis input exceeded its limit.')); } else chunks.push(chunk); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', (error) => finish(new Error(`${ffmpeg} unavailable: ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { finish(new Error(`Voice extraction failed (${code}): ${stderr.slice(-400)}`)); return; }
      const buffer = Buffer.concat(chunks), samples = new Int16Array(buffer.length >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2);
      finish(null, {samples, sampleRate});
    });
  });
}

// ---------------------------------------------------------------- ênfase

const KEYWORDS = new Set(['nunca', 'sempre', 'muito', 'importante', 'principal', 'segredo', 'erro', 'erros', 'atencao', 'cuidado', 'gratis', 'dica', 'melhor', 'pior', 'primeiro', 'unico', 'unica', 'essencial', 'rapido', 'facil', 'dobro', 'metade', 'todos', 'ninguem', 'nada', 'agora', 'hoje', 'simples', 'problema', 'solucao', 'resultado', 'verdade', 'jamais', 'zero', 'nao',
  'never', 'always', 'important', 'key', 'secret', 'mistake', 'mistakes', 'free', 'tip', 'best', 'worst', 'first', 'only', 'essential', 'fast', 'easy', 'double', 'half', 'everyone', 'nobody', 'nothing', 'now', 'today', 'simple', 'problem', 'solution', 'result', 'truth']);

const signal = (kind, source, value) => ({kind, source, ...(value === undefined ? {} : {value: round2(value)})});

/** Encontra cada frase destacada pelo agente na fala transcrita; frases que não foram ditas são ignoradas, nunca inventadas. */
export function matchHighlights(words, highlights = []) {
  const normalized = words.map((word) => normalizeWord(word.text)), found = [];
  for (const phrase of highlights.slice(0, MOTION_LIMITS.maxHighlights)) {
    const target = String(phrase).split(/\s+/).map(normalizeWord).filter(Boolean);
    if (!target.length || target.length > 8) continue;
    for (let i = 0; i + target.length <= normalized.length; i++) {
      if (target.every((part, j) => normalized[i + j] === part)) { found.push({first: i, last: i + target.length - 1, phrase: String(phrase).trim().slice(0, MOTION_LIMITS.maxText)}); break; }
    }
  }
  return found;
}

/**
 * Pontua cada palavra. Medido: volume (+dB), altura (+semitons), pausa antes e alongamento. Inferido: palavra-chave,
 * número, pontuação e destaque do agente editor. Mantém os sinais separados por origem.
 */
export function scoreEmphasis(words, prosody, {highlights = []} = {}) {
  const matched = matchHighlights(words, highlights);
  return words.map((word, index) => {
    const signals = [], p = prosody?.[index];
    let measured = 0, inferred = 0;
    if (p) {
      if (p.loudnessDb !== null && p.loudnessDb >= 3) { measured += 0.45 * clamp((p.loudnessDb - 3) / 6 + 0.3, 0, 1); signals.push(signal('loudness', 'measured', p.loudnessDb)); }
      if (p.pitchSt !== null && p.pitchSt >= 2.5) { measured += 0.3 * clamp((p.pitchSt - 2.5) / 4 + 0.3, 0, 1); signals.push(signal('pitch', 'measured', p.pitchSt)); }
      if (p.pauseBefore >= 0.35) { measured += 0.15 * clamp(p.pauseBefore / 1.2, 0.3, 1); signals.push(signal('pauseBefore', 'measured', p.pauseBefore)); }
      if (p.stretch !== null && p.stretch >= 1.6) { measured += 0.1 * clamp((p.stretch - 1.6) / 1.2 + 0.3, 0, 1); signals.push(signal('stretch', 'measured', p.stretch)); }
    }
    const key = normalizeWord(word.text);
    if (KEYWORDS.has(key)) { inferred += 0.3; signals.push(signal('keyword', 'inferred')); }
    if (/\d/.test(word.text)) { inferred += 0.35; signals.push(signal('number', 'inferred')); }
    if (/[!?]$/.test(word.text.trim())) { inferred += 0.15; signals.push(signal('punctuation', 'inferred')); }
    const highlight = matched.find((item) => index >= item.first && index <= item.last);
    if (highlight) { inferred += 0.45; signals.push(signal('editorHighlight', 'inferred')); }
    // Sem áudio medido o texto é a única evidência: pesa mais para ordenar, mas continua rotulado como inferência.
    const score = clamp(measured + inferred * (p ? 0.8 : 1.4), 0, 1);
    const source = measured > 0 && inferred > 0 ? 'mixed' : measured > 0 ? 'measured' : 'inferred';
    return {index, score: round3(score), measured: round3(measured), inferred: round3(inferred), source, signals: signals.slice(0, MOTION_LIMITS.maxSignals), highlight: highlight ?? null};
  });
}

// ---------------------------------------------------------------- explicativos (estrutura DITA na fala)

const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'pra', 'com', 'que', 'se', 'eu', 'voce', 'ele', 'ela', 'isso', 'esse', 'essa', 'foi', 'era', 'e', 'lugar', 'passo', 'etapa',
  'the', 'an', 'of', 'to', 'in', 'is', 'was', 'and', 'for', 'it', 'you', 'that', 'this', 'step']);
const ORDINALS = {primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, first: 1, second: 2, third: 3, fourth: 4, fifth: 5};
const CARDINALS = {um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, one: 1, two: 2, three: 3, four: 4, five: 5};
const PROCESS_START = new Set(['primeiro', 'primeira', 'comeca', 'comece', 'first', 'start']);
const PROCESS_NEXT = new Set(['depois', 'entao', 'seguida', 'then', 'next', 'finalmente', 'fim', 'finally', 'afterwards']);
const COMPARE_AFTER = new Set(['depois', 'agora', 'hoje', 'after', 'now', 'today']);
const endsSentence = (text) => /[.;:!?]$/.test(String(text).trim());
const cleanWord = (text) => String(text).trim().replace(/^[^\p{L}\p{N}$R]+|[^\p{L}\p{N}%]+$/gu, '');
export const quoteTokens = (text) => String(text ?? '').split(/\s+/).map(normalizeWord).filter(Boolean);

/** Número falado num token (dígitos, como o whisper escreve): "90%", "1.000", "2,5", "R$50", "3x". */
export function parseSpokenNumber(token) {
  const raw = String(token).trim().replace(/[.,;:!?)]+$/, '');
  const match = /^(R\$|\$)?(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)(%|x|k)?$/i.exec(raw);
  if (!match) return null;
  const digits = /^\d{1,3}(?:\.\d{3})+$/.test(match[2]) ? match[2].replace(/\./g, '') : match[2].replace(',', '.');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  const unit = match[1] ? (match[1].toUpperCase() === 'R$' ? 'R$' : '$') : match[3] ? (match[3].toLowerCase() === 'k' ? 'k' : match[3].toLowerCase()) : undefined;
  return {value, ...(unit ? {unit} : {})};
}

/** Unidade dita logo depois do número ("por cento", "vezes", "mil", "reais"). */
const unitAfter = (words, index) => {
  const next = normalizeWord(words[index + 1]?.text ?? ''), after = normalizeWord(words[index + 2]?.text ?? '');
  if (next === 'porcento' || next === 'por' && after === 'cento' || next === 'percent') return {unit: '%', extra: next === 'por' ? 2 : 1};
  if (next === 'vezes' || next === 'times') return {unit: 'x', extra: 1};
  if (next === 'mil' || next === 'thousand') return {unit: 'mil', extra: 1};
  if (next === 'reais') return {unit: 'R$', extra: 1};
  if (next === 'dolares' || next === 'dollars') return {unit: '$', extra: 1};
  return null;
};

const unitEvidence = (tokens, unit) => ({
  '%': tokens.some((t) => t.endsWith('%') || t === 'porcento' || t === 'cento' || t === 'percent'),
  x: tokens.some((t) => /^\d+(?:\d)*x$/.test(t) || t === 'vezes' || t === 'times'),
  k: tokens.some((t) => /^\d+k$/.test(t) || t === 'mil' || t === 'thousand'),
  mil: tokens.some((t) => t === 'mil' || t === 'thousand' || /^\d+k$/.test(t)),
  'R$': tokens.some((t) => t.startsWith('r$') || t === 'reais'),
  $: tokens.some((t) => t.startsWith('$') || t === 'dolares' || t === 'dollars')
}[unit] ?? false);

/** Até `max` palavras após `from` (parando no fim da frase ou num marcador), sem pontuação final. */
const phraseFrom = (words, from, max, stop = () => false) => {
  const parts = [];
  let last = from - 1;
  for (let i = from; i < words.length && parts.length < max; i++) {
    if (stop(i)) break;
    const word = cleanWord(words[i].text);
    // Nunca corta palavra ao meio: para antes de passar do limite do item.
    if (word && [...[...parts, word].join(' ')].length > MOTION_LIMITS.maxItem) break;
    if (word) { parts.push(word); last = i; }
    if (endsSentence(words[i].text)) break;
  }
  while (parts.length && STOP.has(normalizeWord(parts[parts.length - 1]))) { parts.pop(); last--; }
  return {text: parts.join(' ').trim(), last};
};
const hasContent = (text) => quoteTokens(text).some((t) => !STOP.has(t));
const capitalized = (text) => text ? text[0].toUpperCase() + text.slice(1) : text;

/**
 * Estruturas explicativas DITAS na fala (linha do tempo da gravação): etapas (ordinais 1, 2, 3…), processo
 * (primeiro… depois/então… por fim), antes/depois e comparação numérica (2+ números falados na mesma frase). Cada
 * item vem literalmente das palavras transcritas; `quote` é o trecho dito que sustenta o visual (nada inventado).
 */
export function detectExplainers(words) {
  const norm = words.map((word) => normalizeWord(word.text)), found = [];
  const quoteOf = (first, last) => words.slice(first, last + 1).map((word) => word.text.trim()).join(' ').slice(0, MOTION_LIMITS.maxQuote);
  const push = (type, first, last, visual, reveal) => found.push({type, first, last, visual, quote: quoteOf(first, last), quoteStart: words[first].start, quoteEnd: words[last].end, reveal});
  // Etapas: ordinal 1 seguido de 2 (e 3…) com no máximo 12 s entre marcadores; "passo 1/um" também conta.
  const ordinalAt = (i) => ORDINALS[norm[i]] ?? ((norm[i] === 'passo' || norm[i] === 'etapa' || norm[i] === 'step') ? (Number(norm[i + 1]) || CARDINALS[norm[i + 1]] || 0) : 0);
  for (let i = 0; i < words.length; i++) {
    if (ordinalAt(i) !== 1) continue;
    const markers = [i];
    for (let j = i + 1; j < words.length && words[j].start - words[markers[markers.length - 1]].start <= 12; j++) if (ordinalAt(j) === markers.length + 1) markers.push(j);
    if (markers.length < 2) continue;
    const items = [], reveal = [];
    let last = i;
    for (let k = 0; k < Math.min(5, markers.length); k++) {
      const at = markers[k], skip = ['passo', 'etapa', 'step'].includes(norm[at]) ? 2 : norm[at + 1] === 'lugar' ? 2 : 1;
      const phrase = phraseFrom(words, at + skip, 5, (n) => markers.includes(n));
      if (!hasContent(phrase.text)) break;
      items.push(capitalized(phrase.text)); reveal.push(words[at].start); last = Math.max(last, phrase.last);
    }
    if (items.length >= 2) { push('steps', i, last, {type: 'steps', items}, reveal); i = last; }
  }
  // Processo: início + 2 ou mais conectores ("depois", "então", "em seguida", "por fim"), cada passo com conteúdo.
  for (let i = 0; i < words.length; i++) {
    if (!PROCESS_START.has(norm[i]) || found.some((item) => i >= item.first && i <= item.last)) continue;
    const isNext = (n) => PROCESS_NEXT.has(norm[n]) && (norm[n] !== 'seguida' || norm[n - 1] === 'em') && (norm[n] !== 'fim' || norm[n - 1] === 'por');
    const nodes = [], reveal = [];
    let cursor = i, last = i;
    const first = phraseFrom(words, i + 1, 4, isNext);
    if (!hasContent(first.text)) continue;
    nodes.push(capitalized(first.text)); reveal.push(words[i].start); last = first.last;
    for (let j = first.last + 1; j < words.length && nodes.length < 5 && words[j].start - words[cursor].start <= 10; j++) {
      if (!isNext(j)) continue;
      const step = phraseFrom(words, j + 1, 4, (n) => isNext(n));
      if (!hasContent(step.text)) continue;
      nodes.push(capitalized(step.text)); reveal.push(words[j].start); cursor = j; last = step.last; j = step.last;
    }
    if (nodes.length >= 3) { push('process', i, last, {type: 'process', nodes}, reveal); i = last; }
  }
  // Antes/depois: "antes … depois|agora|hoje" em até 12 s, cada lado com conteúdo dito.
  for (let i = 0; i < words.length; i++) {
    if (!['antes', 'before'].includes(norm[i]) || found.some((item) => i >= item.first && i <= item.last)) continue;
    const j = norm.findIndex((t, n) => n > i + 1 && COMPARE_AFTER.has(t) && words[n].start - words[i].start <= 12);
    if (j < 0) continue;
    const before = phraseFrom(words, i + 1, 8, (n) => n >= j), after = phraseFrom(words, j + 1, 8);
    if (!hasContent(before.text) || !hasContent(after.text)) continue;
    push('compare', i, after.last, {type: 'compare', before: {label: capitalized(cleanWord(words[i].text)).slice(0, MOTION_LIMITS.maxLabel), text: before.text}, after: {label: capitalized(cleanWord(words[j].text)).slice(0, MOTION_LIMITS.maxLabel), text: after.text}}, [words[i].start, words[j].start]);
    i = after.last;
  }
  // Comparação numérica: 2 a 4 números falados (mesma unidade) em até 10 s, cada um com rótulo dito ao lado.
  const numbers = [];
  for (let i = 0; i < words.length; i++) {
    const parsed = parseSpokenNumber(words[i].text);
    if (!parsed) continue;
    const spokenUnit = parsed.unit ? null : unitAfter(words, i);
    const unit = parsed.unit ?? spokenUnit?.unit;
    let label = '', labelAt = i;
    // Rótulo = primeira palavra de conteúdo do trecho dito antes do número (ex.: "as VENDAS subiram 30%").
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) { if (endsSentence(words[k].text) || parseSpokenNumber(words[k].text)) break; const t = cleanWord(words[k].text); if (t && !STOP.has(normalizeWord(t))) { label = t; labelAt = k; } }
    if (!label) for (let k = i + 1 + (spokenUnit?.extra ?? 0); k < Math.min(words.length, i + 5) && !label; k++) { if (parseSpokenNumber(words[k].text)) break; const t = cleanWord(words[k].text); if (t && !STOP.has(normalizeWord(t))) { label = t; labelAt = k; } if (endsSentence(words[k].text)) break; }
    numbers.push({index: i, from: Math.min(i, labelAt), last: Math.max(i + (spokenUnit?.extra ?? 0), labelAt), value: parsed.value, unit, label: capitalized(label).slice(0, MOTION_LIMITS.maxLabel)});
  }
  for (let n = 0; n < numbers.length; n++) {
    const group = [numbers[n]];
    for (let m = n + 1; m < numbers.length && group.length < 4 && words[numbers[m].index].start - words[numbers[n].index].start <= 10 && numbers[m].unit === numbers[n].unit; m++) group.push(numbers[m]);
    const first = Math.min(...group.map((item) => item.from)), last = Math.max(...group.map((item) => item.last));
    if (group.length < 2 || group.some((item) => !item.label) || new Set(group.map((item) => item.label.toLowerCase())).size < group.length || found.some((item) => first <= item.last && last >= item.first)) continue;
    push('stat', first, last, {type: 'stat', chart: 'bar', values: group.map((item) => ({label: item.label, value: item.value, ...(item.unit ? {unit: item.unit} : {})}))}, group.map((item) => words[item.index].start));
    n += group.length - 1;
  }
  return found.sort((a, b) => a.first - b.first);
}

const visualTexts = (visual) => visual.type === 'steps' ? visual.items : visual.type === 'process' ? visual.nodes : visual.type === 'compare' ? [visual.before.label, visual.before.text, visual.after.label, visual.after.text]
  : visual.type === 'stat' ? visual.values.map((item) => item.label) : visual.caption ? [visual.caption] : [];
const visualCount = (visual) => visual.type === 'steps' ? visual.items.length : visual.type === 'process' ? visual.nodes.length : visual.type === 'compare' ? 2 : visual.type === 'stat' ? visual.values.length : 1;

/** Coerência interna de um explicativo `origin:'speech'`: todo texto/número do visual aparece no `quote`. */
export function explainerQuoteProblems(explainer) {
  const problems = [], tokens = quoteTokens(explainer.quote), set = new Set(tokens);
  for (const text of visualTexts(explainer.visual)) for (const token of quoteTokens(text)) if (!set.has(token)) problems.push(`"${token}" não está no trecho dito`);
  if (explainer.visual.type === 'stat') {
    const spoken = String(explainer.quote).split(/\s+/).map(parseSpokenNumber).filter(Boolean).map((item) => item.value);
    for (const item of explainer.visual.values) {
      if (!spoken.some((value) => Math.abs(value - item.value) < 1e-9)) problems.push(`número ${item.value} não foi dito`);
      if (item.unit && !unitEvidence(tokens, item.unit)) problems.push(`unidade ${item.unit} não foi dita`);
    }
  }
  return problems;
}

/**
 * Prova de fala para o servidor: confere o `quote` de cada explicativo `origin:'speech'` contra as palavras REAIS da
 * transcrição (linha do tempo da gravação) na janela quoteStart..quoteEnd (±0,3 s). Itens contra o quote, sozinhos,
 * não comprovam nada — esta função é a verificação que o servidor deve rodar antes de aceitar o plano.
 */
export function verifyExplainersAgainstTranscript(plan, words) {
  const problems = [];
  for (const cue of plan?.cues ?? []) {
    if (cue.kind !== 'explainer' || cue.explainer?.origin !== 'speech') continue;
    const {quote, quoteStart, quoteEnd} = cue.explainer;
    const heard = (words ?? []).filter((word) => word.end > quoteStart - 0.3 && word.start < quoteEnd + 0.3).flatMap((word) => quoteTokens(word.text));
    const target = quoteTokens(quote);
    const found = target.length > 0 && heard.some((_, i) => target.every((token, j) => heard[i + j] === token));
    if (!found) problems.push({id: cue.id, reason: 'O trecho citado não corresponde à transcrição nesse intervalo.'});
    for (const reason of explainerQuoteProblems(cue.explainer)) problems.push({id: cue.id, reason});
  }
  return {ok: problems.length === 0, problems};
}

// ---------------------------------------------------------------- plano

const reasonFor = (kind, item) => {
  const measured = item.signals.filter((s) => s.source === 'measured').map((s) => ({loudness: `voz +${s.value} dB`, pitch: `entonação +${s.value} st`, pauseBefore: `pausa ${s.value}s antes`, stretch: 'palavra alongada'}[s.kind]));
  const inferred = item.signals.filter((s) => s.source === 'inferred').map((s) => ({keyword: 'palavra-chave', number: 'número', punctuation: 'pontuação enfática', editorHighlight: 'destaque do editor'}[s.kind]));
  const what = {punchIn: 'Aproximação', kineticText: 'Texto animado', keyPoint: 'Cartão explicativo'}[kind];
  return `${what}: ${[...(measured.length ? [`medido (${measured.join(', ')})`] : []), ...(inferred.length ? [`texto (${inferred.join(', ')})`] : [])].join('; ')}`.slice(0, MOTION_LIMITS.maxReason);
};

const phraseAround = (words, index, highlight) => {
  if (highlight) return {first: highlight.first, last: highlight.last, text: highlight.phrase};
  let first = index, last = index;
  // Até 2 palavras vizinhas contíguas (fala corrida) para o texto não ficar solto.
  if (index > 0 && words[index].start - words[index - 1].end < 0.25 && normalizeWord(words[index - 1].text).length > 2) first = index - 1;
  if (index + 1 < words.length && words[index + 1].start - words[index].end < 0.25) last = index + 1;
  const text = words.slice(first, last + 1).map((word) => word.text.replace(/[,;:.]+$/, '')).join(' ');
  return {first, last, text: [...text].length <= MOTION_LIMITS.maxText ? text : words[index].text};
};

/**
 * Constrói o plano de motion. `words` na linha do tempo ORIGINAL; `segments` = trechos mantidos; seleção feita no vídeo
 * editado (densidade por minuto, distância mínima, bordas e janelas reservadas para título/tarja/CTA).
 */
export function buildMotionPlan({words = [], wordTiming = 'none', prosody = null, segments, intensity = 'balanced', highlights = [], reserved = [], voice = prosody ? 'measured' : 'unavailable', limitations = [], explainers, reframe}) {
  if (!motionIntensities.includes(intensity)) throw new Error('Unsupported motion intensity.');
  const outputDuration = segments.reduce((sum, item) => sum + item.end - item.start, 0);
  const notes = new Set(limitations);
  if (!prosody) notes.add('voiceUnavailable');
  if (wordTiming === 'estimated') notes.add('wordTimingEstimated');
  if (wordTiming === 'none') notes.add('transcriptUnavailable');
  const analysis = {wordTiming, voice, limitations: [...notes].filter((item) => motionLimitations.includes(item)), measuredCandidates: 0, inferredCandidates: 0};
  const withReframe = (plan) => (reframe ? {...plan, reframe} : plan);
  if (intensity === 'off' || !words.length) return withReframe({version: 1, intensity, analysis, cues: []});
  if (outputDuration < 3) { analysis.limitations.push('tooShort'); return withReframe({version: 1, intensity, analysis, cues: []}); }
  const preset = MOTION_PRESETS[intensity];
  const scored = scoreEmphasis(words, prosody, {highlights});
  analysis.measuredCandidates = scored.filter((item) => item.measured > 0 && item.score >= preset.threshold).length;
  analysis.inferredCandidates = scored.filter((item) => item.measured === 0 && item.score >= preset.threshold).length;
  const map = keptMap(segments);
  const busy = (start, end) => reserved.some((item) => start < item.end && end > item.start);
  const maxCues = Math.min(MOTION_LIMITS.maxCues, Math.max(1, Math.ceil(preset.maxPerMinute * outputDuration / 60)));
  const maxSfx = Math.floor(preset.sfxPerMinute * outputDuration / 60 + (preset.sfxPerMinute ? 0.5 : 0));
  const layoutBudget = preset.maxLayoutShare * outputDuration;
  // Explicativos têm prioridade (estrutura dita), sob o orçamento de layout e com câmera cheia entre eles.
  const placed = [];
  let layoutUsed = 0;
  if (explainers ?? preset.explainers) {
    for (const found of detectExplainers(words)) {
      if (placed.length >= maxCues) break;
      const spoken = remapSpan(found.quoteStart, found.quoteEnd, map, 0.6);
      if (!spoken || spoken.start < 0.5) continue;
      const start = round3(Math.max(0, spoken.start - 0.08));
      const reading = 1.4 + visualCount(found.visual) * 0.7;
      const end = round3(Math.min(outputDuration - 0.2, start + MOTION_LIMITS.maxExplainerSeconds, Math.max(spoken.end + 1.2, start + reading)));
      if (end - start < 2 || busy(start - 0.5, end)) continue;
      const prev = placed[placed.length - 1];
      if (prev && (start - prev.start < preset.layoutGap || start - prev.end < preset.minCameraSeconds)) continue;
      if (layoutUsed + (end - start) > layoutBudget) continue;
      layoutUsed += end - start;
      placed.push({explainer: found, start, end});
    }
  }
  const nearExplainer = (start, end, pad) => placed.some((item) => start < item.end + pad && end > item.start - pad);
  const ranked = scored.filter((item) => item.score >= preset.threshold).sort((a, b) => b.score - a.score || a.index - b.index);
  const chosen = [];
  for (const item of ranked) {
    if (chosen.length + placed.length >= maxCues) break;
    const phrase = phraseAround(words, item.index, item.highlight);
    const sourceStart = words[phrase.first].start, sourceEnd = words[phrase.last].end;
    const out = remapInterval(sourceStart, sourceEnd, map, 0.12);
    if (!out || out.start < 0.5 || out.end > outputDuration - 1) continue;
    if (nearExplainer(out.start, out.end, 0.3)) continue;
    if (chosen.some((cue) => Math.abs(cue.start - out.start) < preset.minGap || (out.start < cue.end && out.end > cue.start))) continue;
    chosen.push({item, phrase, sourceStart, sourceEnd, ...out});
  }
  const timeline = [...chosen, ...placed].sort((a, b) => a.start - b.start);
  let lastLayout = -Infinity, lastLayoutEnd = -Infinity, sfxCount = 0, keyIndex = 0;
  const cues = timeline.map((entry, n) => {
    const next = timeline[n + 1];
    if (entry.explainer) {
      const {explainer: found, start} = entry;
      const end = round3(Math.min(entry.end, next ? next.start - 0.1 : Infinity));
      lastLayout = start; lastLayoutEnd = end; keyIndex++;
      const items = visualCount(found.visual);
      const layout = intensity === 'intense' && (found.visual.type === 'steps' || found.visual.type === 'process') && items >= 4 ? 'motion-focus' : 'split';
      const cue = {
        id: `m${n + 1}`, kind: 'explainer', sourceStart: round3(found.quoteStart - 0.08), sourceEnd: sourceAt(end, map), start, end, layout, strength: 0.8,
        source: 'inferred', timing: wordTiming === 'words' ? 'words' : 'estimated',
        reason: `Explicativo (${{steps: 'etapas', process: 'processo', compare: 'antes/depois', stat: 'números'}[found.visual.type]}): estrutura dita na fala`.slice(0, MOTION_LIMITS.maxReason),
        signals: [signal('structure', 'inferred'), ...(found.visual.type === 'stat' ? [signal('number', 'inferred')] : [])],
        explainer: {visual: found.visual, origin: 'speech', quote: found.quote, quoteStart: round3(found.quoteStart), quoteEnd: round3(found.quoteEnd), reveal: found.reveal.slice(0, items).map(round3)}
      };
      if (sfxCount < maxSfx) {
        const overSpeech = words.some((word) => word.start < found.quoteStart + 0.15 && word.end > found.quoteStart - 0.15);
        cue.sfx = {kind: 'whoosh', gainDb: round2(preset.sfxBaseDb + (overSpeech ? SFX_DUCK_DB : 0)), ducked: overSpeech};
        sfxCount++;
      }
      return cue;
    }
    const {item, phrase, sourceStart, start, end} = entry;
    const layoutRoom = start - lastLayout >= preset.layoutGap && (start - lastLayoutEnd >= preset.minCameraSeconds || start - lastLayoutEnd < 0.6) && !nearExplainer(start, start + 4, preset.minCameraSeconds);
    const isKey = preset.keyPoints && (item.highlight || item.signals.some((s) => s.kind === 'number')) && layoutRoom && !busy(start - 0.5, start + 4);
    const strongVoice = item.measured >= 0.3;
    // Texto na tela só quando o próprio conteúdo sustenta (palavra-chave, número, destaque); ênfase só vocal vira aproximação.
    let kind = isKey ? 'keyPoint' : !preset.kinetic || busy(start, end) || (strongVoice && item.inferred === 0) ? 'punchIn' : 'kineticText';
    // Cartões ficam tempo suficiente para leitura (~ 0.35 s por palavra + entrada/saída); demais seguem a fala.
    const wordsCount = phrase.text.split(/\s+/).length;
    const spanOf = (k) => k === 'keyPoint' ? clamp(Math.max(end - start + 1.2, 1.4 + wordsCount * 0.35), 2.5, 5) : k === 'kineticText' ? clamp(end - start + 0.6, 0.9, 2.2) : clamp(end - start + 0.35, 0.6, 1.6);
    if (kind === 'keyPoint' && layoutUsed + spanOf(kind) > layoutBudget + 1e-9) kind = preset.kinetic && !busy(start, end) ? 'kineticText' : 'punchIn';
    const span = spanOf(kind);
    const cueEnd = round3(Math.min(outputDuration - 0.2, start - 0.08 + span, next ? next.start - 0.1 : Infinity));
    const cueStart = round3(Math.max(0, start - 0.08));
    if (kind === 'keyPoint') { lastLayout = cueStart; lastLayoutEnd = cueEnd; layoutUsed += cueEnd - cueStart; keyIndex++; }
    const layout = kind === 'keyPoint' ? (intensity === 'intense' && keyIndex % 2 === 0 ? 'motion-focus' : 'split') : 'camera-full';
    const strength = round2(clamp(item.score, 0.2, 1));
    const cue = {
      id: `m${n + 1}`, kind, sourceStart: round3(sourceStart - 0.08), sourceEnd: round3(sourceStart - 0.08 + (cueEnd - cueStart)), start: cueStart, end: cueEnd,
      text: kind === 'punchIn' ? undefined : phrase.text, focus: words[item.index].text.replace(/[^\p{L}\p{N}%$€£]+/gu, '').slice(0, 30) || undefined,
      layout, strength, ...(kind === 'punchIn' ? {scale: round3(1 + (preset.punchScale - 1) * (0.6 + 0.4 * strength))} : {}),
      source: item.source, timing: wordTiming === 'words' ? 'words' : 'estimated', reason: '', signals: item.signals
    };
    cue.reason = reasonFor(kind, item);
    if (kind === 'punchIn') delete cue.text;
    if (!cue.focus) delete cue.focus;
    const wantsSfx = sfxCount < maxSfx && (kind === 'keyPoint' || (intensity === 'intense' && kind === 'punchIn' && strength >= 0.7));
    if (wantsSfx) {
      const sfxKind = kind === 'keyPoint' ? 'whoosh' : 'pop';
      const overSpeech = words.some((word) => word.start < sourceStart + 0.15 && word.end > sourceStart - 0.15);
      cue.sfx = {kind: sfxKind, gainDb: round2(preset.sfxBaseDb + (overSpeech ? SFX_DUCK_DB : 0)), ducked: overSpeech};
      sfxCount++;
    }
    return cue;
  });
  return withReframe({version: 1, intensity, analysis, cues});
}

/** Densidade efetiva do plano no vídeo editado (para a UI exibir/limitar). */
export function motionDensity(plan, durationSeconds) {
  const minutes = Math.max(durationSeconds, 1e-9) / 60, cues = plan?.cues ?? [];
  const layoutSeconds = cues.filter((cue) => cue.layout !== 'camera-full').reduce((sum, cue) => sum + Math.max(0, cue.end - cue.start), 0);
  return {cuesPerMinute: round2(cues.length / minutes), layoutShare: round3(Math.min(1, layoutSeconds / Math.max(durationSeconds, 1e-9))), sfxPerMinute: round2(cues.filter((cue) => cue.sfx).length / minutes)};
}

// ---------------------------------------------------------------- validação (plano editável)

const ANALYSIS_KEYS = ['wordTiming', 'voice', 'limitations', 'measuredCandidates', 'inferredCandidates'];
const CUE_KEYS = ['id', 'kind', 'sourceStart', 'sourceEnd', 'start', 'end', 'text', 'focus', 'layout', 'strength', 'scale', 'source', 'timing', 'reason', 'signals', 'sfx', 'explainer'];
const LAYOUT_KINDS = ['keyPoint', 'explainer'];
const EXPLAINER_KEYS = ['visual', 'origin', 'quote', 'quoteStart', 'quoteEnd', 'reveal', 'revealAt'];
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
const itemText = (value, max = MOTION_LIMITS.maxItem) => safeMotionText(value, max);

/** Visual explicativo validado (texto simples curto, contagens limitadas, números finitos, asset só por id). */
function normalizeVisual(visual) {
  const bad = (message) => { throw new Error(`Explainer ${message}`); };
  if (!isRecord(visual) || !explainerTypes.includes(visual.type)) bad('type is not supported.');
  if (visual.type === 'steps' || visual.type === 'process') {
    const key = visual.type === 'steps' ? 'items' : 'nodes';
    if (!exactKeys(visual, ['type', key]) || !Array.isArray(visual[key]) || visual[key].length < 2 || visual[key].length > 5 || !visual[key].every((item) => itemText(item))) bad(`${key} must be 2..5 short plain texts.`);
    return {type: visual.type, [key]: visual[key].map((item) => item.trim())};
  }
  if (visual.type === 'compare') {
    const side = (value) => exactKeys(value, ['label', 'text']) && itemText(value.label, MOTION_LIMITS.maxLabel) && itemText(value.text);
    if (!exactKeys(visual, ['type', 'before', 'after']) || !side(visual.before) || !side(visual.after)) bad('compare needs before/after with label and text.');
    return {type: 'compare', before: {label: visual.before.label.trim(), text: visual.before.text.trim()}, after: {label: visual.after.label.trim(), text: visual.after.text.trim()}};
  }
  if (visual.type === 'stat') {
    if (!exactKeys(visual, ['type', 'chart', 'values']) || !['number', 'bar'].includes(visual.chart) || !Array.isArray(visual.values) || visual.values.length < 1 || visual.values.length > 4) bad('stat needs chart number|bar and 1..4 values.');
    if (visual.chart === 'bar' && visual.values.length < 2) bad('bar chart needs 2+ values.');
    const values = visual.values.map((item) => {
      if (!exactKeys(item, ['label', 'value', 'unit']) || !itemText(item.label, MOTION_LIMITS.maxLabel) || !finite(item.value) || item.value < 0 || item.value > 1e9 || item.unit !== undefined && !statUnits.includes(item.unit)) bad('stat values need label, value >= 0 and a known unit.');
      return {label: item.label.trim(), value: item.value, ...(item.unit ? {unit: item.unit} : {})};
    });
    return {type: 'stat', chart: visual.chart, values};
  }
  if (!exactKeys(visual, ['type', 'assetId', 'caption']) || typeof visual.assetId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(visual.assetId) || visual.caption !== undefined && !itemText(visual.caption, 80)) bad('image needs an assetId (no paths/URLs) and optional caption.');
  return {type: 'image', assetId: visual.assetId, ...(visual.caption ? {caption: visual.caption.trim()} : {})};
}

function normalizeExplainer(raw, cue, map, out) {
  if (!exactKeys(raw, EXPLAINER_KEYS) || !['speech', 'user'].includes(raw.origin)) throw new Error('Explainer needs a visual and origin speech|user.');
  const visual = normalizeVisual(raw.visual);
  const result = {visual, origin: raw.origin};
  if (visual.type === 'image' && raw.origin !== 'user') throw new Error('Image explainers are user-provided material.');
  if (raw.origin === 'speech') {
    if (!safeMotionText(raw.quote, MOTION_LIMITS.maxQuote) || !finite(raw.quoteStart) || !finite(raw.quoteEnd) || raw.quoteEnd <= raw.quoteStart || raw.quoteStart < cue.sourceStart - 0.5 || raw.quoteStart > cue.sourceEnd) throw new Error('Spoken explainers need the literal quote and its recording times.');
    const problems = explainerQuoteProblems({visual, quote: raw.quote});
    if (problems.length) throw new Error(`Explainer text must come from what was said: ${problems[0]}.`);
    Object.assign(result, {quote: raw.quote.trim(), quoteStart: round3(raw.quoteStart), quoteEnd: round3(raw.quoteEnd)});
  } else if (raw.quote !== undefined || raw.quoteStart !== undefined || raw.quoteEnd !== undefined) throw new Error('User explainers carry no transcript quote.');
  if (raw.reveal !== undefined) {
    if (!Array.isArray(raw.reveal) || raw.reveal.length !== visualCount(visual) || raw.reveal.some((t, i) => !finite(t) || t < cue.sourceStart - 0.5 || t > cue.sourceEnd || i && t < raw.reveal[i - 1])) throw new Error('Explainer reveal times must follow the items inside the cue.');
    result.reveal = raw.reveal.map(round3);
    // Revelação de cada item no vídeo editado (relativa ao início do vídeo), presa ao intervalo da cue.
    result.revealAt = result.reveal.map((t) => { const at = remapSpan(t, t + 0.05, map, 0)?.start ?? out.start; return round3(clamp(at, out.start, out.end)); });
  }
  return result;
}

/**
 * Normaliza um plano de motion (editado pelo usuário ou vindo do builder). As âncoras são da GRAVAÇÃO
 * (`sourceStart/sourceEnd`); `start/end` no vídeo editado são SEMPRE recalculados a partir dos trechos mantidos, então
 * ajustar cortes depois mantém a sincronia. Cues cujo trecho foi cortado são descartadas. Explicativos podem
 * atravessar cortes (fala longa); demais cues nunca atravessam. Plano sem campos novos sai idêntico ao formato antigo.
 */
export function normalizeMotion(raw, segments) {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || Object.keys(raw).some((key) => !['version', 'intensity', 'analysis', 'cues', 'reframe'].includes(key))) throw new Error('Invalid motion plan.');
  if (raw.version !== 1 || !motionIntensities.includes(raw.intensity)) throw new Error('Unsupported motion plan version or intensity.');
  const a = raw.analysis ?? {};
  if (!isRecord(a) || Object.keys(a).some((key) => !ANALYSIS_KEYS.includes(key)) || !['words', 'estimated', 'none'].includes(a.wordTiming ?? 'none') || !['measured', 'unavailable'].includes(a.voice ?? 'unavailable')
    || !Array.isArray(a.limitations ?? []) || (a.limitations ?? []).some((item) => !motionLimitations.includes(item))) throw new Error('Invalid motion analysis summary.');
  const analysis = {wordTiming: a.wordTiming ?? 'none', voice: a.voice ?? 'unavailable', limitations: [...new Set(a.limitations ?? [])], measuredCandidates: Number.isInteger(a.measuredCandidates) ? a.measuredCandidates : 0, inferredCandidates: Number.isInteger(a.inferredCandidates) ? a.inferredCandidates : 0};
  if (!Array.isArray(raw.cues) || raw.cues.length > MOTION_LIMITS.maxCues) throw new Error(`Use at most ${MOTION_LIMITS.maxCues} motion cues.`);
  const map = keptMap(segments), ids = new Set(), cues = [];
  for (const cue of raw.cues) {
    if (!isRecord(cue) || Object.keys(cue).some((key) => !CUE_KEYS.includes(key)) || typeof cue.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(cue.id) || ids.has(cue.id)) throw new Error('Motion cues need unique ids and known fields.');
    ids.add(cue.id);
    if (!motionCueKinds.includes(cue.kind) || !motionLayouts.includes(cue.layout) || !['measured', 'inferred', 'mixed', 'user'].includes(cue.source) || !['words', 'estimated'].includes(cue.timing)) throw new Error('Unsupported motion cue kind, layout or source.');
    const changesLayout = LAYOUT_KINDS.includes(cue.kind);
    if (!changesLayout && cue.layout !== 'camera-full' || changesLayout && cue.layout === 'camera-full') throw new Error('Only key points and explainers change the layout.');
    const maxSeconds = cue.kind === 'explainer' ? MOTION_LIMITS.maxExplainerSeconds : MOTION_LIMITS.maxCueSeconds;
    if (!finite(cue.sourceStart) || !finite(cue.sourceEnd) || cue.sourceStart < 0 || cue.sourceEnd - cue.sourceStart < MOTION_LIMITS.minCueSeconds || cue.sourceEnd - cue.sourceStart > maxSeconds + (cue.kind === 'explainer' ? MOTION_LIMITS.maxSeconds : 0)) throw new Error('Motion cue timing is invalid.');
    if (cue.kind === 'punchIn' ? cue.text !== undefined : cue.kind === 'explainer' ? cue.text !== undefined && !safeMotionText(cue.text, MOTION_LIMITS.maxText) : !safeMotionText(cue.text, MOTION_LIMITS.maxText)) throw new Error('Motion text must be short plain text (punch-ins have no text).');
    if (cue.focus !== undefined && !safeMotionText(cue.focus, 30)) throw new Error('Motion focus word must be short plain text.');
    if (!finite(cue.strength) || cue.strength < 0 || cue.strength > 1) throw new Error('Motion strength must be 0..1.');
    if (cue.kind === 'punchIn' ? !finite(cue.scale) || cue.scale < 1 || cue.scale > 1.3 : cue.scale !== undefined) throw new Error('Punch-in scale must be 1..1.3.');
    if (typeof cue.reason !== 'string' || [...cue.reason].length > MOTION_LIMITS.maxReason || unsafeText.test(cue.reason)) throw new Error('Motion reason must be short plain text.');
    // Cue escolhida pelo usuário (source 'user') carrega só o sinal 'user'; nunca se mistura com medido/inferido.
    if (!Array.isArray(cue.signals) || cue.signals.length > MOTION_LIMITS.maxSignals || cue.signals.some((s) => !isRecord(s) || Object.keys(s).some((key) => !['kind', 'source', 'value'].includes(key)) || !signalKinds.includes(s.kind) || !['measured', 'inferred', 'user'].includes(s.source) || s.value !== undefined && !finite(s.value)
      || (cue.source === 'user' ? s.kind !== 'user' || s.source !== 'user' : s.kind === 'user' || s.source === 'user' || (['loudness', 'pitch', 'pauseBefore', 'stretch'].includes(s.kind) ? s.source !== 'measured' : s.source !== 'inferred')))) throw new Error('Motion signals must keep measured and inferred evidence apart (user choices too).');
    if (cue.sfx !== undefined && (!isRecord(cue.sfx) || Object.keys(cue.sfx).some((key) => !['kind', 'gainDb', 'ducked'].includes(key)) || !sfxKinds.includes(cue.sfx.kind) || !finite(cue.sfx.gainDb) || cue.sfx.gainDb > -10 || cue.sfx.gainDb < -40 || typeof cue.sfx.ducked !== 'boolean')) throw new Error('Sound effects must stay at -10 dB or lower.');
    if ((cue.kind === 'explainer') !== (cue.explainer !== undefined)) throw new Error('Explainer cues (and only them) carry an explainer visual.');
    const out = cue.kind === 'explainer' ? remapSpan(cue.sourceStart, cue.sourceEnd, map, MOTION_LIMITS.minCueSeconds) : remapInterval(cue.sourceStart, cue.sourceEnd, map, MOTION_LIMITS.minCueSeconds);
    if (out && cue.kind === 'explainer' && out.end - out.start > MOTION_LIMITS.maxExplainerSeconds) throw new Error('Explainer cues last at most 20 s in the edited video.');
    const explainer = cue.kind === 'explainer' ? normalizeExplainer(cue.explainer, cue, map, out ?? {start: 0, end: 0}) : undefined;
    if (!out) continue; // trecho removido nesta edição
    const normalized = {id: cue.id, kind: cue.kind, sourceStart: round3(cue.sourceStart), sourceEnd: round3(cue.sourceEnd), start: out.start, end: out.end, ...(cue.text !== undefined ? {text: cue.text.trim()} : {}), ...(cue.focus !== undefined ? {focus: cue.focus.trim()} : {}),
      layout: cue.layout, strength: round2(cue.strength), ...(cue.scale !== undefined ? {scale: round3(cue.scale)} : {}), source: cue.source, timing: cue.timing, reason: cue.reason, signals: cue.signals.map((s) => ({kind: s.kind, source: s.source, ...(s.value !== undefined ? {value: round2(s.value)} : {})})),
      ...(cue.sfx ? {sfx: {kind: cue.sfx.kind, gainDb: round2(cue.sfx.gainDb), ducked: cue.sfx.ducked}} : {}), ...(explainer ? {explainer} : {})};
    cues.push(normalized);
  }
  cues.sort((x, y) => x.start - y.start || x.id.localeCompare(y.id));
  for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end - 0.001) cues[i - 1].end = round3(Math.max(cues[i - 1].start + 0.1, cues[i].start - 0.05));
  for (const cue of cues) if (cue.explainer?.revealAt) cue.explainer.revealAt = cue.explainer.revealAt.map((t) => round3(clamp(t, cue.start, cue.end)));
  const reframe = normalizeReframe(raw.reframe, segments);
  return {version: 1, intensity: raw.intensity, analysis, cues, ...(reframe ? {reframe} : {})};
}

// ---------------------------------------------------------------- props da composição

/** Faixa protegida (legenda queimada etc.) em frações da altura. */
function normalizeProtect(protect) {
  if (protect === undefined || protect === null) return undefined;
  const band = protect.captionBand;
  if (!exactKeys(protect, ['captionBand']) || band !== undefined && (!exactKeys(band, ['top', 'bottom']) || !finite(band.top) || !finite(band.bottom) || band.top < 0 || band.bottom > 1 || band.bottom - band.top < 0.02)) throw new Error('protect.captionBand precisa de top/bottom em 0..1.');
  return band ? {captionBand: {top: round3(band.top), bottom: round3(band.bottom)}} : undefined;
}

/** Duas cues de layout separadas por até 0,6 s viram transição DIRETA (sem voltar à câmera cheia no meio). */
export const LAYOUT_JOIN_SECONDS = 0.6;

/**
 * Converte o plano normalizado (vídeo editado) em props por frame para a composição Remotion. Validação de fronteira:
 * o adaptador só aceita o que esta função devolve. Mesma função para a prévia (Player) e para o render.
 */
export function resolveMotionProps(motion, {fps, durationSeconds, protect} = {}) {
  if (motion === undefined || motion === null) return undefined;
  if (!isRecord(motion) || !motionIntensities.includes(motion.intensity) || !Array.isArray(motion.cues) || motion.cues.length > MOTION_LIMITS.maxCues) throw new Error('motion inválido.');
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const cues = [];
  for (const cue of motion.cues) {
    if (!isRecord(cue) || !motionCueKinds.includes(cue.kind) || !motionLayouts.includes(cue.layout) || !finite(cue.start) || !finite(cue.end) || cue.end <= cue.start) throw new Error('motion.cues contém item inválido.');
    if (cue.text !== undefined && !safeMotionText(cue.text, MOTION_LIMITS.maxText) || cue.focus !== undefined && !safeMotionText(cue.focus, 30)) throw new Error('motion.cues: texto inválido.');
    if ((cue.kind === 'explainer') !== isRecord(cue.explainer)) throw new Error('motion.cues: explicativo sem visual.');
    const startFrame = clamp(Math.round(cue.start * fps), 0, totalFrames - 1), endFrame = clamp(Math.round(cue.end * fps), startFrame + 1, totalFrames);
    let explainer;
    if (cue.kind === 'explainer') {
      const visual = normalizeVisual(cue.explainer.visual), count = visualCount(visual);
      const revealAt = Array.isArray(cue.explainer.revealAt) && cue.explainer.revealAt.length === count && cue.explainer.revealAt.every(finite) ? cue.explainer.revealAt : null;
      // Sem tempos ditos (ex.: material do usuário), os itens entram espaçados na primeira metade da cue.
      const revealFrames = Array.from({length: count}, (_, i) => clamp(revealAt ? Math.round(revealAt[i] * fps) - startFrame : Math.round(i * (endFrame - startFrame) * 0.5 / count), 0, endFrame - startFrame - 1));
      explainer = {visual, origin: cue.explainer.origin === 'user' ? 'user' : 'speech', revealFrames};
    }
    cues.push({id: String(cue.id).slice(0, 40), kind: cue.kind, layout: cue.layout, startFrame, endFrame, strength: clamp(Number(cue.strength) || 0.5, 0, 1), ...(cue.kind === 'punchIn' ? {scale: clamp(Number(cue.scale) || 1.08, 1, 1.3)} : {}), ...(cue.text ? {text: cue.text} : {}), ...(cue.focus ? {focus: cue.focus} : {}), ...(explainer ? {explainer} : {})});
  }
  cues.sort((a, b) => a.startFrame - b.startFrame);
  const join = Math.round(LAYOUT_JOIN_SECONDS * fps);
  const layoutCues = cues.filter((cue) => cue.layout !== 'camera-full');
  for (let i = 1; i < layoutCues.length; i++) {
    const prev = layoutCues[i - 1], cur = layoutCues[i], gap = cur.startFrame - prev.endFrame;
    if (gap > 0 && gap <= join && !cues.some((cue) => cue.startFrame >= prev.endFrame && cue.startFrame < cur.startFrame)) prev.endFrame = cur.startFrame;
  }
  const sfx = motion.cues.filter((cue) => cue.sfx).map((cue) => ({kind: cue.sfx.kind, at: round3(cue.start), gainDb: clamp(cue.sfx.gainDb, -40, -10)})).filter((item) => sfxKinds.includes(item.kind) && item.at < durationSeconds);
  const reframe = reframeRenderProps(motion.reframe, {fps, durationSeconds});
  const safe = normalizeProtect(protect);
  return {intensity: motion.intensity, cues, sfx, ...(reframe ? {reframe} : {}), ...(safe ? {protect: safe} : {})};
}

// ---------------------------------------------------------------- SFX sintetizados (sem arquivos de terceiros)

/** PRNG determinístico (mulberry32) para que o mesmo plano gere sempre o mesmo áudio. */
const prng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/** Efeitos gerados localmente (ruído filtrado/senoides); domínio próprio, sem licença de terceiros. Pico -1 dBFS. */
export function synthesizeSfx(kind, sampleRate) {
  const make = (seconds) => new Float32Array(Math.round(seconds * sampleRate));
  let out;
  if (kind === 'whoosh') {
    out = make(0.5); const random = prng(7); let low = 0, band = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / out.length, cutoff = 300 + 2700 * Math.sin(Math.PI * t) ** 2, alpha = 1 - Math.exp(-2 * Math.PI * cutoff / sampleRate);
      const noise = random() * 2 - 1; low += alpha * (noise - low); band += alpha * 0.5 * (low - band);
      out[i] = (low - band) * Math.sin(Math.PI * Math.min(1, t / 0.6)) ** 2 * (t > 0.6 ? Math.cos(Math.PI / 2 * (t - 0.6) / 0.4) : 1);
    }
  } else if (kind === 'pop') {
    out = make(0.1); let phase = 0;
    for (let i = 0; i < out.length; i++) { const t = i / sampleRate, f = 300 + 400 * Math.exp(-t * 40); phase += 2 * Math.PI * f / sampleRate; out[i] = Math.sin(phase) * Math.exp(-t * 35) * Math.min(1, i / (sampleRate * 0.002)); }
  } else if (kind === 'tick') {
    out = make(0.035);
    for (let i = 0; i < out.length; i++) { const t = i / sampleRate; out[i] = Math.sin(2 * Math.PI * 2000 * t) * Math.exp(-t * 140); }
  } else throw new Error('Unknown sound effect.');
  let peak = 0; for (const value of out) peak = Math.max(peak, Math.abs(value));
  const gain = peak ? 10 ** (-1 / 20) / peak : 0;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/** Quanto antes do instante o efeito começa (o pico do whoosh cai sobre a entrada do cartão). */
export const SFX_LEAD = Object.freeze({whoosh: 0.3, pop: 0, tick: 0});

/** Trilha mono PCM16 (WAV) com os efeitos posicionados e com o ganho planejado. */
export function sfxBedWav(sfx, durationSeconds, sampleRate) {
  const length = Math.max(1, Math.round(durationSeconds * sampleRate)), mix = new Float32Array(length);
  for (const item of sfx) {
    const sound = synthesizeSfx(item.kind, sampleRate), gain = 10 ** (item.gainDb / 20);
    const offset = Math.round(Math.max(0, item.at - (SFX_LEAD[item.kind] ?? 0)) * sampleRate);
    for (let i = 0; i < sound.length && offset + i < length; i++) mix[offset + i] += sound[i] * gain;
  }
  const data = Buffer.alloc(length * 2);
  for (let i = 0; i < length; i++) data.writeInt16LE(Math.round(clamp(mix[i], -1, 1) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Filtro FFmpeg: SFX comprimidos pela própria voz (sidechain = ducking dinâmico) e somados sem normalizar a fala. */
export function sfxMixFilter({sampleRate, channels}) {
  const layout = channels === 1 ? 'mono' : 'stereo';
  return `[1:a:0]aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout},asplit=2[voice][key];`
    + `[2:a:0]aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}[fx];`
    + '[fx][key]sidechaincompress=threshold=0.05:ratio=3:attack=5:release=200[ducked];'
    + '[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]';
}

// ---------------------------------------------------------------- resumo legível

/** Resumo sem jargão para o chat da produção e para a revisão. */
export function describeMotion(motion, pt = true) {
  if (!motion || motion.intensity === 'off' && !motion.cues?.length && !motion.reframe) return pt ? 'sem motion' : 'no motion';
  const count = (kind) => motion.cues.filter((cue) => cue.kind === kind).length;
  const measured = motion.cues.filter((cue) => cue.source === 'measured' || cue.source === 'mixed').length, sfx = motion.cues.filter((cue) => cue.sfx).length;
  const chosen = motion.cues.filter((cue) => cue.source === 'user').length;
  const label = {off: pt ? 'manual' : 'manual', subtle: pt ? 'sutil' : 'subtle', balanced: pt ? 'equilibrado' : 'balanced', intense: pt ? 'intenso' : 'intense'}[motion.intensity];
  const notes = motion.analysis.limitations.map((item) => ({
    voiceUnavailable: pt ? 'ênfase da voz não medida (sem áudio utilizável); destaques vêm só do texto' : 'voice emphasis not measured (no usable audio); highlights come from text only',
    wordTimingEstimated: pt ? 'tempos por palavra estimados dentro de cada frase' : 'word timings estimated within each sentence',
    transcriptUnavailable: pt ? 'sem transcrição: nenhum destaque de fala' : 'no transcript: no speech highlights',
    tooShort: pt ? 'vídeo curto demais para motion' : 'video too short for motion',
    sfxSkipped: pt ? 'efeitos sonoros omitidos' : 'sound effects skipped'
  }[item]));
  const main = pt
    ? `${label}: ${motion.cues.length} momento(s) — ${count('punchIn')} aproximação(ões), ${count('kineticText')} texto(s) animado(s), ${count('keyPoint')} cartão(ões) com tela dividida; ${measured} apoiado(s) na voz medida; ${sfx} efeito(s) sonoro(s) suave(s)`
    : `${label}: ${motion.cues.length} moment(s) — ${count('punchIn')} punch-in(s), ${count('kineticText')} animated text(s), ${count('keyPoint')} split-screen card(s); ${measured} backed by measured voice; ${sfx} soft sound effect(s)`;
  const explainers = motion.cues.filter((cue) => cue.kind === 'explainer' && cue.explainer?.origin !== 'user').length;
  const extra = (explainers ? (pt ? `; ${explainers} explicativo(s) com base no que foi dito` : `; ${explainers} explainer(s) based on what was said`) : '')
    + (chosen ? (pt ? `; ${chosen} escolhido(s) por você` : `; ${chosen} chosen by you`) : '');
  const frame = motion.reframe ? ({
    fixed: pt ? (motion.reframe.source === 'user' ? 'foco fixo escolhido' : 'foco fixo padrão') : (motion.reframe.source === 'user' ? 'chosen fixed focus' : 'default fixed focus'),
    manual: pt ? 'foco manual' : 'manual focus',
    face: pt ? `rosto detectado em ${Math.round((motion.reframe.detector?.coverage ?? 0) * 100)}% das amostras` : `face detected in ${Math.round((motion.reframe.detector?.coverage ?? 0) * 100)}% of samples`
  }[motion.reframe.mode]) : null;
  const all = frame ? [...notes, frame] : notes;
  return all.length ? `${main}${extra}. ${all.join('; ')}.` : `${main}${extra}.`;
}
