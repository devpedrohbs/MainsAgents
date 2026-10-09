import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  MOTION_PRESETS, alignWordsToVoice, buildMotionPlan, describeMotion, keptMap, matchHighlights, measuredPauses, normalizeMotion, pitchAt, remapInterval, remapWords,
  resolveMotionProps, scoreEmphasis, sfxBedWav, sfxMixFilter, synthesizeSfx, transcriptWords, voiceTrack, wordProsody, SFX_LEAD
} from '../editorial-motion-plan.mjs';
import {needsAnimation, planHash, remotionAnimations, validatePlan} from '../editorial-smart-edit.mjs';
import {resolveAnimations} from '../editorial-remotion.mjs';
import {parseWhisperJson} from '../editorial-transcribe.mjs';

const SR = 8000;
/** Fala sintética: "palavras" harmônicas (F0 + 3 harmônicos) com envelope; nada aqui é voz humana real. */
function speech(words, total) {
  const samples = new Int16Array(Math.round(total * SR));
  for (const word of words) {
    let phase = 0;
    const from = Math.round(word.start * SR), to = Math.round(word.end * SR);
    for (let i = from; i < to; i++) {
      const t = (i - from) / (to - from), env = Math.sin(Math.PI * t) ** 0.5;
      phase += 2 * Math.PI * word.f0 / SR;
      const value = (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) / 1.8;
      samples[i] = Math.round(value * env * word.amp * 32767);
    }
  }
  return samples;
}
const sentence = (count, {start = 0.6, gap = 0.08, length = 0.32, amp = 0.2, f0 = 120} = {}) => Array.from({length: count}, (_, i) => ({start: start + i * (length + gap), end: start + i * (length + gap) + length, f0, amp, text: `palavra${'abcdefghijklmnopqrstuvwxyz'[i]}`}));

test('whisper JSON gera palavras inteiras com tempos próprios a partir dos tokens', () => {
  const raw = {transcription: [{offsets: {from: 0, to: 1500}, text: ' Olá pessoal!', tokens: [
    {text: '[_BEG_]', offsets: {from: 0, to: 0}}, {text: ' Ol', offsets: {from: 100, to: 300}}, {text: 'á', offsets: {from: 300, to: 420}},
    {text: ' pessoal', offsets: {from: 500, to: 1100}}, {text: '!', offsets: {from: 1100, to: 1150}}]}]};
  const parsed = parseWhisperJson(raw, 5);
  assert.deepEqual(parsed.words, [{start: 0.1, end: 0.42, text: 'Olá'}, {start: 0.5, end: 1.1, text: 'pessoal!'}]);
});

test('com -dtw, cada palavra começa no tempo alinhado ao áudio do seu primeiro token', () => {
  const raw = {transcription: [{offsets: {from: 5000, to: 9000}, text: ' O segredo', tokens: [
    {text: ' O', offsets: {from: 5010, to: 5040}, t_dtw: 648}, {text: ' seg', offsets: {from: 5040, to: 5470}, t_dtw: 678}, {text: 'redo', offsets: {from: 5470, to: 5900}, t_dtw: 696}]}]};
  assert.deepEqual(parseWhisperJson(raw, 12).words, [{start: 6.48, end: 6.78, text: 'O'}, {start: 6.78, end: 7.68, text: 'segredo'}]);
});

test('transcriptWords distingue tempos por palavra, estimados e ausentes', () => {
  assert.deepEqual(transcriptWords(null), {timing: 'none', words: []});
  const real = transcriptWords({segments: [{start: 0, end: 2, text: 'a b'}], words: [{start: 0.1, end: 0.4, text: 'a'}, {start: 1, end: 1.4, text: 'b'}]});
  assert.equal(real.timing, 'words');
  const estimated = transcriptWords({segments: [{start: 0, end: 3, text: 'um dois três'}]});
  assert.equal(estimated.timing, 'estimated');
  assert.equal(estimated.words.length, 3);
  assert.equal(estimated.words[0].start, 0);
  assert.equal(estimated.words.at(-1).end, 3);
});

test('remapeamento após cortes mantém sincronia e descarta trechos removidos', () => {
  const segments = [{start: 0, end: 2}, {start: 5, end: 8}];
  assert.deepEqual(remapInterval(5.5, 6, keptMap(segments)), {start: 2.5, end: 3});
  assert.equal(remapInterval(3, 4, keptMap(segments)), null);
  // Atravessa um corte: fica no trecho de maior sobreposição, nunca pula o corte.
  assert.deepEqual(remapInterval(1.9, 5.6, keptMap(segments)), {start: 2, end: 2.6});
  const words = remapWords([{start: 1, end: 1.3, text: 'a'}, {start: 3, end: 3.4, text: 'cortada'}, {start: 7, end: 7.5, text: 'b'}], segments);
  assert.deepEqual(words.map((word) => [word.text, word.start, word.end, word.sourceStart]), [['a', 1, 1.3, 1], ['b', 4, 4.5, 7]]);
});

test('voz medida: volume, altura, pausa e alongamento vêm do áudio, não do texto', () => {
  const words = sentence(12);
  // Palavra 8: 0,6 s de pausa antes, +8 dB, F0 170 Hz (~+6 st) e mais longa.
  const shift = 0.6;
  for (let i = 8; i < words.length; i++) { words[i].start += shift; words[i].end += shift; }
  Object.assign(words[8], {amp: 0.5, f0: 170, end: words[8].end + 0.25});
  for (let i = 9; i < words.length; i++) { words[i].start += 0.25; words[i].end += 0.25; }
  const track = voiceTrack(speech(words, 8), SR);
  assert.ok(Math.abs(pitchAt(track, (words[2].start + words[2].end) / 2) - 120) < 4, 'F0 base ~120 Hz');
  assert.ok(Math.abs(pitchAt(track, (words[8].start + words[8].end) / 2) - 170) < 5, 'F0 enfático ~170 Hz');
  assert.ok(measuredPauses(track).some((pause) => pause.end - pause.start > 0.55));
  const prosody = wordProsody(track, words);
  assert.ok(prosody[8].loudnessDb >= 6, `loudness ${prosody[8].loudnessDb}`);
  assert.ok(prosody[8].pitchSt >= 5 && prosody[8].pitchSt <= 7, `pitch ${prosody[8].pitchSt}`);
  assert.ok(prosody[8].pauseBefore >= 0.5);
  assert.ok(prosody[8].stretch >= 1.6);
  assert.ok(Math.abs(prosody[3].loudnessDb) < 1.5 && Math.abs(prosody[3].pitchSt) < 1);
  const scored = scoreEmphasis(words, prosody);
  assert.equal(scored[8].source, 'measured');
  assert.ok(scored[8].signals.every((s) => s.source === 'measured'));
  assert.ok(scored[8].score > scored[3].score + 0.4);
});

test('tempos do reconhecedor dentro de uma pausa medida são ajustados à volta da voz', () => {
  const real = [{start: 0.5, end: 1.2, f0: 120, amp: 0.3}, {start: 2.4, end: 3, f0: 120, amp: 0.3}];
  const track = voiceTrack(speech(real, 4), SR);
  const aligned = alignWordsToVoice([{start: 0.5, end: 1.2, text: 'antes'}, {start: 1.6, end: 2.6, text: 'depois'}], track);
  assert.deepEqual(aligned[0], {start: 0.5, end: 1.2, text: 'antes'});
  assert.ok(Math.abs(aligned[1].start - 2.4) < 0.05, `início ${aligned[1].start}`);
  assert.ok(aligned[1].end > aligned[1].start + 0.2);
});

test('sem áudio: só inferências do texto, rotuladas; destaque do agente que não foi dito é ignorado', () => {
  const words = [{start: 1, end: 1.3, text: 'Isso'}, {start: 1.4, end: 1.8, text: 'nunca'}, {start: 1.9, end: 2.3, text: 'falha'}, {start: 2.4, end: 2.8, text: '90%'}];
  assert.deepEqual(matchHighlights(words, ['nunca falha', 'frase que não existe']).map((item) => item.phrase), ['nunca falha']);
  const scored = scoreEmphasis(words, null, {highlights: ['nunca falha', 'inventado']});
  assert.ok(scored.every((item) => item.measured === 0 && item.signals.every((s) => s.source === 'inferred')));
  assert.deepEqual(scored[1].signals.map((s) => s.kind), ['keyword', 'editorHighlight']);
  assert.ok(scored[3].signals.some((s) => s.kind === 'number'));
});

const longWords = (seconds) => {
  const list = [];
  for (let t = 0.6, i = 0; t < seconds - 0.5; t += 0.45, i++) list.push({start: Math.round(t * 1000) / 1000, end: Math.round((t + 0.35) * 1000) / 1000, text: i % 9 === 4 ? 'importante' : i % 23 === 11 ? '42' : `w${(i % 26 + 10).toString(36)}${(Math.floor(i / 26) % 26 + 10).toString(36)}`});
  return list;
};

test('densidade: limite por minuto, distância mínima e bordas por intensidade; off não cria nada', () => {
  const seconds = 120, words = longWords(seconds), segments = [{start: 0, end: seconds}];
  const counts = {};
  for (const intensity of ['subtle', 'balanced', 'intense']) {
    const plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity});
    const preset = MOTION_PRESETS[intensity];
    counts[intensity] = plan.cues.length;
    assert.ok(plan.cues.length <= Math.ceil(preset.maxPerMinute * seconds / 60));
    for (let i = 1; i < plan.cues.length; i++) assert.ok(plan.cues[i].start - plan.cues[i - 1].start >= preset.minGap - 0.2, `${intensity} gap`);
    assert.ok(plan.cues.every((cue) => cue.start >= 0.4 && cue.end <= seconds - 0.2 && cue.end > cue.start));
    assert.ok(plan.cues.filter((cue) => cue.sfx).length <= Math.floor(preset.sfxPerMinute * seconds / 60 + 0.5));
    assert.ok(plan.cues.every((cue) => !cue.sfx || cue.sfx.gainDb <= -12));
    const layouts = plan.cues.filter((cue) => cue.layout !== 'camera-full');
    for (let i = 1; i < layouts.length; i++) assert.ok(layouts[i].start - layouts[i - 1].start >= preset.layoutGap - 0.2);
    assert.deepEqual(plan.analysis.limitations, ['voiceUnavailable']);
  }
  assert.ok(counts.subtle < counts.balanced && counts.balanced < counts.intense, JSON.stringify(counts));
  assert.equal(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'subtle'}).cues.some((cue) => cue.kind !== 'punchIn'), false);
  assert.equal(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'off'}).cues.length, 0);
  const estimated = buildMotionPlan({words, wordTiming: 'estimated', segments, intensity: 'balanced'});
  assert.ok(estimated.analysis.limitations.includes('wordTimingEstimated'));
  assert.ok(estimated.cues.every((cue) => cue.timing === 'estimated'));
  assert.match(describeMotion(estimated), /estimados/);
});

test('janelas reservadas (título/tarja/CTA) não recebem cartões nem texto animado', () => {
  const words = longWords(60), segments = [{start: 0, end: 60}];
  const plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'intense', reserved: [{start: 0, end: 20}]});
  assert.ok(plan.cues.filter((cue) => cue.start < 20).every((cue) => cue.kind === 'punchIn'));
});

test('plano editável: tempos do vídeo editado são sempre derivados das âncoras da gravação', () => {
  const words = longWords(60), segments = [{start: 0, end: 60}];
  const motion = normalizeMotion(buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'balanced'}), segments);
  assert.ok(motion.cues.length >= 3);
  const target = motion.cues[1];
  // Usuário corta 5 s antes do segundo destaque: ele recua 5 s; destaques dentro do corte somem.
  const cut = [{start: 0, end: target.sourceStart - 6}, {start: target.sourceStart - 1, end: 60}];
  const moved = normalizeMotion(motion, cut);
  const again = moved.cues.find((cue) => cue.id === target.id);
  assert.equal(again.start, Math.round((target.start - 5) * 1000) / 1000);
  const removed = normalizeMotion(motion, [{start: 0, end: target.sourceStart - 0.5}, {start: target.sourceEnd + 0.5, end: 60}]);
  assert.equal(removed.cues.some((cue) => cue.id === target.id), false);
  // Entrada adulterada é rejeitada.
  const bad = (change, pattern) => assert.throws(() => normalizeMotion({...motion, cues: [{...motion.cues[0], ...change}]}, segments), pattern);
  bad({kind: 'punchIn', text: 'texto', scale: 1.1, layout: 'camera-full'}, /plain text/);
  bad({kind: 'kineticText', text: '<img src=x onerror=1>', scale: undefined, layout: 'camera-full'}, /plain text/);
  bad({signals: [{kind: 'loudness', source: 'inferred', value: 6}]}, /measured and inferred/);
  bad({sfx: {kind: 'whoosh', gainDb: -3, ducked: false}}, /-10 dB/);
  bad({kind: 'punchIn', text: undefined, scale: 1.1, layout: 'split'}, /layout/);
  bad({kind: 'keyPoint', text: 'ok', scale: undefined, layout: 'camera-full'}, /layout/);
  bad({extra: 1}, /known fields/);
  assert.throws(() => normalizeMotion({...motion, intensity: 'max'}, segments), /intensity/);
});

test('validatePlan inclui o motion no hash e remotionAnimations o entrega ao adaptador', () => {
  const words = longWords(40), segments = [{start: 0, end: 40}];
  const motion = buildMotionPlan({words, wordTiming: 'words', segments, intensity: 'intense'});
  const {plan} = validatePlan({segments, animations: [], motion}, 40);
  assert.ok(needsAnimation(plan));
  assert.equal(needsAnimation(validatePlan({segments}, 40).plan), false);
  const source = {contentId: 'c', assetId: 'a', versionId: 'v', sha256: 'x'.repeat(64)};
  assert.equal(planHash(source, plan), planHash(source, validatePlan(plan, 40).plan), 'normalização idempotente');
  const lighter = validatePlan({segments, motion: {...plan.motion, cues: plan.motion.cues.slice(1)}}, 40).plan;
  assert.notEqual(planHash(source, plan), planHash(source, lighter));
  const spec = remotionAnimations(plan);
  assert.equal(spec.motion.cues.length, plan.motion.cues.length);
  const resolved = resolveAnimations(spec, {width: 1080, height: 1920, fps: 30, durationSeconds: 40, hasAudio: true});
  assert.equal(resolved.title, undefined);
  for (const cue of resolved.motion.cues) {
    const source = plan.motion.cues.find((item) => item.id === cue.id);
    assert.equal(cue.startFrame, Math.round(source.start * 30));
    assert.equal(cue.endFrame, Math.round(source.end * 30));
  }
  const at25 = resolveMotionProps(plan.motion, {fps: 25, durationSeconds: 40});
  assert.equal(at25.cues[0].startFrame, Math.round(plan.motion.cues[0].start * 25));
  assert.throws(() => resolveAnimations({motion: {...plan.motion, cues: [{...plan.motion.cues[0], text: 'a‮b'}]}}, {width: 320, height: 180, fps: 15, durationSeconds: 40, hasAudio: true}), (error) => error.code === 'invalid_animations');
});

test('SFX sintetizados são determinísticos, curtos e posicionados com o ganho planejado', () => {
  const a = synthesizeSfx('whoosh', 48000), b = synthesizeSfx('whoosh', 48000);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.max(...a.map(Math.abs)) - 10 ** (-1 / 20)) < 1e-3);
  const wav = sfxBedWav([{kind: 'pop', at: 1, gainDb: -20}, {kind: 'whoosh', at: 2, gainDb: -26}], 3, 16000);
  assert.equal(wav.length, 44 + 3 * 16000 * 2);
  const sample = (seconds) => wav.readInt16LE(44 + Math.round(seconds * 16000) * 2) / 32767;
  let popPeak = 0, before = 0;
  for (let i = 0; i < 1600; i++) { popPeak = Math.max(popPeak, Math.abs(sample(1 + i / 16000))); before = Math.max(before, Math.abs(sample(0.5 + i / 16000))); }
  assert.equal(before, 0);
  assert.ok(Math.abs(20 * Math.log10(popPeak) - (-21)) < 0.6, `pop ${20 * Math.log10(popPeak)} dB`);
  let whooshStart = 0;
  for (let i = Math.round((2 - SFX_LEAD.whoosh - 0.05) * 16000); i < 2 * 16000; i++) if (Math.abs(wav.readInt16LE(44 + i * 2)) > 0) { whooshStart = i / 16000; break; }
  assert.ok(Math.abs(whooshStart - (2 - SFX_LEAD.whoosh)) < 0.01);
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], {windowsHide: true}).status === 0;
test('ducking real: o mesmo efeito fica bem mais baixo sob a fala do que no silêncio (FFmpeg sidechain)', {skip: ffmpegAvailable ? false : 'ffmpeg ausente'}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'motion-duck-')), sr = 48000, seconds = 3;
  // "Voz": tom de 180 Hz em 0-1,5 s, silêncio depois. Efeitos idênticos em 0,8 s (sob a voz) e 2,2 s (no silêncio).
  const voice = Buffer.alloc(44 + seconds * sr * 2);
  voice.set(sfxBedWav([], seconds, sr).subarray(0, 44));
  for (let i = 0; i < 1.5 * sr; i++) voice.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 180 * i / sr) * 0.3 * 32767), 44 + i * 2);
  writeFileSync(join(dir, 'voice.wav'), voice);
  writeFileSync(join(dir, 'sfx.wav'), sfxBedWav([{kind: 'pop', at: 0.8, gainDb: -14}, {kind: 'pop', at: 2.2, gainDb: -14}], seconds, sr));
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=size=32x32:rate=10:duration=${seconds}`, '-i', join(dir, 'voice.wav'), '-i', join(dir, 'sfx.wav'),
    '-filter_complex', sfxMixFilter({sampleRate: sr, channels: 1}), '-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', String(sr), '-ac', '1', join(dir, 'out.wav')], {windowsHide: true});
  assert.equal(result.status, 0, String(result.stderr));
  const out = readFileSync(join(dir, 'out.wav')), data = out.subarray(out.indexOf('data') + 8);
  const residualPeak = (from) => { let peak = 0; for (let i = Math.round(from * sr); i < Math.round((from + 0.1) * sr); i++) { const voiceValue = i < 1.5 * sr ? Math.sin(2 * Math.PI * 180 * i / sr) * 0.3 : 0; peak = Math.max(peak, Math.abs(data.readInt16LE(i * 2) / 32767 - voiceValue)); } return peak; };
  const underSpeech = residualPeak(0.8), inSilence = residualPeak(2.2);
  assert.ok(inSilence > 0.1, `sfx audível no silêncio (${inSilence})`);
  assert.ok(underSpeech < inSilence * 0.5, `ducking ${underSpeech} vs ${inSilence}`);
});
