// Amostra de ponta a ponta do motion dinâmico com fixture SINTÉTICA (nada de gravação real):
// "câmera" desenhada pelo FFmpeg + fala gerada pela voz offline do Windows (SSML com ênfase em palavras) ->
// whisper.cpp local (tempos por palavra) -> prosódia MEDIDA no áudio sintético -> cortes de silêncio -> plano de motion
// -> render Remotion real (16:9 intenso e 9:16 equilibrado) -> frames de preview + JSON do plano + medições de áudio.
// Uso: node scripts/render-motion-sample.mjs [pastaDeSaída]   (padrão docs/analysis/editing-motion-frames)
import {spawnSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWhisperTranscriber} from '../editorial-transcribe.mjs';
import {probeVideo, runMediaProcess} from '../editorial-media.mjs';
import {cutFilter, keptSegments, parseSilences, remotionAnimations, silenceCandidates, silenceDetectArgs, validatePlan} from '../editorial-smart-edit.mjs';
import {alignWordsToVoice, buildMotionPlan, describeMotion, extractVoicePcm, transcriptWords, voiceTrack, wordProsody} from '../editorial-motion-plan.mjs';
import {renderAnimatedVideo} from '../editorial-remotion.mjs';
import {audioRms, run} from './test-remotion-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'analysis', 'editing-motion-frames'));
const SSML = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">
Hoje eu vou te mostrar como editar vídeos bem mais rápido.<break time="900ms"/>
O segredo é <prosody volume="x-loud" pitch="+35%" rate="-25%">nunca</prosody> cortar no meio da frase.<break time="1300ms"/>
Com esse cuidado você economiza <prosody volume="x-loud" pitch="+30%" rate="-20%">noventa por cento</prosody> do tempo de revisão.<break time="1000ms"/>
E o mais importante: revise antes de publicar.</speak>`;

function tts(target) {
  const script = "Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$s.SelectVoice($v.VoiceInfo.Name);$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.SpeakSsml($env:SPEECH_SSML);$s.Dispose()";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {env: {...process.env, SPEECH_SSML: SSML, SPEECH_OUT: target}, windowsHide: true});
  if (result.status !== 0) throw new Error(`Voz offline pt-BR indisponível (${result.status}): ${String(result.stderr).slice(0, 300)}`);
}

async function makeSource(work) {
  const wav = path.join(work, 'speech.wav'), figure = path.join(work, 'figure.png'), source = path.join(work, 'source.mp4');
  tts(wav);
  // "Câmera" sintética: fundo em degradê, cabeça e ombros no terço superior (onde o motion protege o rosto).
  const geq = "geq=r='if(lte(hypot(X-480,Y-190),78),224,if(lte(pow((X-480)/230,2)+pow((Y-560)/190,2),1),40,24+Y/12))':g='if(lte(hypot(X-480,Y-190),78),178,if(lte(pow((X-480)/230,2)+pow((Y-560)/190,2),1),88,32+Y/10))':b='if(lte(hypot(X-480,Y-190),78),150,if(lte(pow((X-480)/230,2)+pow((Y-560)/190,2),1),160,52+Y/8))'";
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=960x540', '-vf', geq, '-frames:v', '1', figure]);
  await run('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', figure, '-i', wav, '-vf', "drawbox=x='mod(t*120,960)':y=520:w=40:h=8:color=white@0.7:t=fill,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest', source]);
  return source;
}

async function cut(source, segments, format, target, hasAudio) {
  await runMediaProcess('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-n', '-i', source, '-filter_complex', cutFilter(segments, {hasAudio, format}), '-map', '[vout]', '-map', '[aout]', '-c:a', 'aac', '-ar', '48000', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', target], {timeoutMs: 600000});
}

async function frame(file, seconds, target) {
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=w=min(iw\\,720):h=-2', target]);
}

const windowPcm = (file, start, seconds) => run('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(Math.max(0, start)), '-t', String(seconds), '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], {binary: true});
const dbOf = (sum, n) => Math.round(20 * Math.log10(Math.sqrt(sum / Math.max(1, n)) / 32768 + 1e-9) * 10) / 10;
/** Nível da fala na janela e nível do que o mix ACRESCENTOU (renderizado − só cortado, decodificados com a mesma janela). */
const sfxLevels = async (rendered, cutOnly, start, seconds) => {
  const [a, b] = await Promise.all([windowPcm(rendered, start, seconds), windowPcm(cutOnly, start, seconds)]);
  const n = Math.min(a.length, b.length) >> 1; let speech = 0, added = 0;
  for (let i = 0; i < n; i++) { const x = a.readInt16LE(i * 2), y = b.readInt16LE(i * 2); speech += y * y; added += (x - y) ** 2; }
  return {speechDb: dbOf(speech, n), addedDb: dbOf(added, n)};
};

async function main() {
  await mkdir(out, {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), 'motion-sample-'));
  const report = {fixture: 'SINTÉTICA: vídeo desenhado pelo FFmpeg + voz offline do Windows (SSML). Não é gravação humana; a prosódia medida é a da voz sintética.', variants: []};
  try {
    const source = await makeSource(work), metadata = await probeVideo(source);
    report.source = {duration: metadata.duration, width: metadata.width, height: metadata.height, fps: metadata.fps};
    const transcriber = createWhisperTranscriber();
    const caps = await transcriber.capabilities();
    let transcript = null;
    if (caps.available) transcript = await transcriber.transcribe({inputPath: source, duration: metadata.duration, language: 'pt'});
    report.transcription = caps.available ? {engine: 'whisper.cpp', model: caps.model, words: transcript.words?.length ?? 0, text: transcript.segments.map((item) => item.text).join(' ')} : {unavailable: caps.reasons};
    const {timing, words: heard} = transcriptWords(transcript);
    const pcm = await extractVoicePcm({inputPath: source}), track = voiceTrack(pcm.samples, pcm.sampleRate);
    const words = alignWordsToVoice(heard, track), prosody = words.length ? wordProsody(track, words) : null;
    report.alignment = heard.map((word, i) => ({text: word.text, whisper: [word.start, word.end], aligned: [words[i].start, words[i].end]})).filter((item) => item.whisper[0] !== item.aligned[0] || item.whisper[1] !== item.aligned[1]);
    report.measuredWords = words.map((word, i) => ({...word, ...prosody?.[i]})).filter((item) => (item.loudnessDb ?? 0) >= 3 || (item.pitchSt ?? 0) >= 2.5 || item.pauseBefore >= 0.35);
    const silences = parseSilences(await runMediaProcess('ffmpeg', silenceDetectArgs(source, {thresholdDb: -38, minDuration: 0.5}), {timeoutMs: 120000}), metadata.duration);
    const segments = keptSegments(silenceCandidates(silences, {duration: metadata.duration, padding: 0.15}).candidates, metadata.duration);
    report.cuts = {silences, segments};
    // Quadrado: corte 1:1 do vídeo cortado e SEM a análise de voz, para mostrar o modo honesto só com o texto.
    for (const variant of [{name: 'landscape-intense', format: 'original', intensity: 'intense'}, {name: 'portrait-balanced', format: 'portrait', intensity: 'balanced'}, {name: 'square-text-only', format: 'original', intensity: 'intense', square: true, textOnly: true}]) {
      const reservedCta = {start: segments.reduce((sum, item) => sum + item.end - item.start, 0) - 2.5, end: Infinity};
      const motion = buildMotionPlan({words: variant.textOnly ? heard : words, wordTiming: timing, prosody: variant.textOnly ? null : prosody, segments, intensity: variant.intensity, highlights: ['revise antes de publicar'], reserved: [reservedCta]});
      const {plan, outputDuration} = validatePlan({segments, format: variant.format, theme: 'dark', animations: [{id: 'cta', kind: 'cta', text: 'Siga para mais dicas', start: 0, duration: 2.5}], motion}, metadata.duration);
      const cutFile = path.join(work, `${variant.name}-cut.mp4`), rendered = path.join(work, `${variant.name}.mp4`);
      await cut(source, plan.segments, plan.format, cutFile, true);
      if (variant.square) { const wide = cutFile.replace(/\.mp4$/, '-wide.mp4'); await copyFile(cutFile, wide); await rm(cutFile); await run('ffmpeg', ['-v', 'error', '-n', '-i', wide, '-vf', 'crop=ih:ih', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', cutFile]); }
      const cutMeta = await probeVideo(cutFile);
      const started = Date.now();
      const result = await renderAnimatedVideo({inputPath: cutFile, outputPath: rendered, metadata: {width: cutMeta.width, height: cutMeta.height, fps: cutMeta.fps, durationSeconds: cutMeta.duration, hasAudio: true}, animations: {...remotionAnimations(plan), accent: '#ff5a36'}});
      const frames = [];
      for (const cue of plan.motion.cues) {
        const moments = cue.kind === 'keyPoint' ? [['entrando', cue.start + 0.2], ['cartao', (cue.start + cue.end) / 2], ['retorno', cue.end - 0.15]] : [['pico', Math.min(cue.end - 0.05, cue.start + 0.45)]];
        for (const [label, at] of moments) { const name = `${variant.name}-${cue.id}-${cue.kind}-${label}.png`; await frame(rendered, at, path.join(out, name)); frames.push(name); }
      }
      const sfx = [];
      for (const cue of plan.motion.cues.filter((item) => item.sfx)) {
        sfx.push({cue: cue.id, kind: cue.sfx.kind, at: cue.start, plannedGainDb: cue.sfx.gainDb, ducked: cue.sfx.ducked, during: await sfxLevels(rendered, cutFile, cue.start - 0.35, 0.5), control: await sfxLevels(rendered, cutFile, Math.max(0, cue.start - 2.2), 0.5)});
      }
      const overall = await audioRms(rendered), original = await audioRms(cutFile);
      const keep = path.join(out, `${variant.name}.mp4`);
      if ((await stat(rendered)).size < 4_000_000) await copyFile(rendered, keep);
      report.variants.push({...variant, renderSeconds: Math.round((Date.now() - started) / 100) / 10, outputDuration, rendered: {width: result.width, height: result.height, fps: result.fps, durationSeconds: result.durationSeconds, audio: result.audio}, summary: describeMotion(plan.motion), cues: plan.motion.cues, sfx, audioRms: {rendered: Math.round(overall.rms), cutOnly: Math.round(original.rms)}, frames});
      await writeFile(path.join(out, `${variant.name}-plan.json`), JSON.stringify(plan, null, 2));
      console.log(`${variant.name}: ${describeMotion(plan.motion)} (${result.width}x${result.height}, ${result.durationSeconds}s, áudio ${result.audio.mode})`);
    }
    await writeFile(path.join(out, 'sample-report.json'), JSON.stringify(report, null, 2));
    console.log(`Relatório: ${path.join(out, 'sample-report.json')}`);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
