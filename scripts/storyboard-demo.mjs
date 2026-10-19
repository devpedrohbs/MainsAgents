// Demonstração REAL do motor de storyboard autorado, com fixtures SINTÉTICAS (nunca gravação pessoal do usuário):
//   node scripts/storyboard-demo.mjs prepare   -> fontes sintéticas (FFmpeg + voz offline do Windows), whisper.cpp local,
//                                                cortes de silêncio, palavras no vídeo EDITADO, segmentsHash e asset registrado
//   (o Claude lê work/<assunto>/words.json e AUTORA docs/.../storyboards/<id>.json — dados, não código)
//   node scripts/storyboard-demo.mjs render    -> valida plano + fatos, stills/contact sheet (renderStill), trecho de teste,
//                                                MP4 final e o "antes" (motion automático legado) para comparação.
// Pasta de trabalho: %TEMP%/mainsagents-storyboard-demo (fora do repo). Evidências: docs/analysis/editing-ai-motion-engine-2026-10-12.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWhisperTranscriber} from '../editorial-transcribe.mjs';
import {probeVideo, runMediaProcess} from '../editorial-media.mjs';
import {cutFilter, keptSegments, parseSilences, remotionAnimations, silenceCandidates, silenceDetectArgs, validatePlan} from '../editorial-smart-edit.mjs';
import {buildMotionPlan, describeMotion, remapWords, transcriptWords} from '../editorial-motion-plan.mjs';
import {renderAnimatedVideo, renderStoryboardStills} from '../editorial-remotion.mjs';
import {describeStoryboard, segmentsHash, storyboardFactProblems} from '../editorial-storyboard.mjs';
import {run} from './test-remotion-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'analysis', 'editing-ai-motion-engine-2026-10-12');
const work = path.join(os.tmpdir(), 'mainsagents-storyboard-demo');

/** Assuntos sintéticos: o roteiro é o "briefing" (fonte de fatos 'brief'); a transcrição local é a fonte 'speech'. */
export const SUBJECTS = {
  edicao: {
    title: 'Editar vídeos mais rápido',
    ssml: `Hoje eu vou te mostrar como editar vídeos bem mais rápido.<break time="900ms"/>
O segredo é <prosody volume="x-loud" pitch="+30%" rate="-20%">nunca</prosody> cortar no meio da frase.<break time="1100ms"/>
Primeiro você corta os silêncios, depois revisa as retomadas, e por último coloca as legendas.<break time="1000ms"/>
Com esse cuidado você economiza <prosody volume="x-loud" pitch="+25%" rate="-15%">noventa por cento</prosody> do tempo de revisão.<break time="900ms"/>
E o mais importante: revise antes de publicar.`,
    figure: {skin: [224, 178, 150], shirt: [40, 88, 160]}
  },
  juros: {
    title: 'Juros compostos',
    ssml: `Juros compostos são juros sobre juros.<break time="900ms"/>
Você investe, o rendimento entra no saldo, e no mês seguinte rende sobre o total.<break time="1000ms"/>
Com um por cento ao mês, mil reais viram mil cento e vinte e sete em um ano.<break time="900ms"/>
Nos juros simples seriam mil cento e vinte.<break time="900ms"/>
Comece cedo: o tempo faz o trabalho pesado.`,
    figure: {skin: [198, 150, 120], shirt: [150, 60, 60]}
  }
};
const plainScript = (ssml) => ssml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function tts(ssml, target) {
  const doc = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">${ssml}</speak>`;
  const script = "Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$v=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -eq 'pt-BR'}|Select-Object -First 1;if(-not $v){exit 3};$s.SelectVoice($v.VoiceInfo.Name);$s.SetOutputToWaveFile($env:SPEECH_OUT);$s.SpeakSsml($env:SPEECH_SSML);$s.Dispose()";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {env: {...process.env, SPEECH_SSML: doc, SPEECH_OUT: target}, windowsHide: true});
  if (result.status !== 0) throw new Error(`Voz offline pt-BR indisponível (${result.status}): ${String(result.stderr).slice(0, 300)}`);
}

/** "Câmera" sintética 1280x720: pessoa (cabeça/ombros) no centro-alto, fundo em degradê e um marcador que se move (prova de vídeo real). */
async function makeSource(dir, subject) {
  const wav = path.join(dir, 'speech.wav'), figure = path.join(dir, 'figure.png'), source = path.join(dir, 'source.mp4');
  tts(subject.ssml, wav);
  const [sr, sg, sb] = subject.figure.skin, [cr, cg, cb] = subject.figure.shirt;
  const head = 'lte(hypot(X-640,Y-250),96)', body = 'lte(pow((X-640)/290,2)+pow((Y-700)/250,2),1)';
  const geq = `geq=r='if(${head},${sr},if(${body},${cr},20+Y/14))':g='if(${head},${sg},if(${body},${cg},26+Y/12))':b='if(${head},${sb},if(${body},${cb},44+Y/9))'`;
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720', '-vf', geq, '-frames:v', '1', figure]);
  await run('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-framerate', '30', '-i', figure, '-i', wav, '-vf', "drawbox=x='mod(t*160,1280)':y=690:w=48:h=10:color=white@0.7:t=fill,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest', source]);
  return source;
}

/** Asset "registrado" do usuário para o assunto juros: um print sintético de planilha (PNG), com sha256. */
async function makeScreenshot(dir) {
  const file = path.join(dir, 'planilha.png');
  const bars = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `drawbox=x=${120 + i * 80}:y=${560 - Math.round(200 * Math.pow(1.01, i * 6) / 2.1)}:w=56:h=${Math.round(200 * Math.pow(1.01, i * 6) / 2.1)}:color=0x2e7d32:t=fill`).join(',');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xf7f7f2:s=1200x700', '-vf', `drawbox=x=0:y=0:w=1200:h=64:color=0x1f6f43:t=fill,drawbox=x=80:y=120:w=1040:h=2:color=0x999999:t=fill,drawbox=x=80:y=560:w=1040:h=2:color=0x555555:t=fill,${bars},drawbox=x=1000:y=150:w=120:h=40:color=0xffd400:t=fill`, '-frames:v', '1', file]);
  return file;
}

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

async function cutVideo(source, segments, format, target) {
  await runMediaProcess('ffmpeg', ['-nostdin', '-hide_banner', '-v', 'error', '-y', '-i', source, '-filter_complex', cutFilter(segments, {hasAudio: true, format}), '-map', '[vout]', '-map', '[aout]', '-c:a', 'aac', '-ar', '48000', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30', target], {timeoutMs: 600000});
}

async function prepare() {
  await mkdir(work, {recursive: true});
  const transcriber = createWhisperTranscriber(), caps = await transcriber.capabilities();
  for (const [key, subject] of Object.entries(SUBJECTS)) {
    const dir = path.join(work, key);
    await rm(dir, {recursive: true, force: true});
    await mkdir(dir, {recursive: true});
    const source = await makeSource(dir, subject), meta = await probeVideo(source);
    const transcript = caps.available ? await transcriber.transcribe({inputPath: source, duration: meta.duration, language: 'pt'}) : null;
    const {timing, words} = transcriptWords(transcript);
    const silences = parseSilences(await runMediaProcess('ffmpeg', silenceDetectArgs(source, {thresholdDb: -38, minDuration: 0.5}), {timeoutMs: 120000}), meta.duration);
    const segments = keptSegments(silenceCandidates(silences, {duration: meta.duration, padding: 0.15}).candidates, meta.duration);
    const outputDuration = Math.round(segments.reduce((sum, item) => sum + item.end - item.start, 0) * 1000) / 1000;
    let cursor = 0; const cutsAt = segments.slice(1).map((item, i) => (cursor += segments[i].end - segments[i].start, Math.round(cursor * 1000) / 1000));
    for (const format of ['original', 'portrait']) await cutVideo(source, segments, format, path.join(dir, `cut-${format}.mp4`));
    const asset = key === 'juros' ? await makeScreenshot(dir) : null;
    const info = {subject: key, title: subject.title, brief: plainScript(subject.ssml), transcript: transcript ? transcript.segments.map((item) => item.text).join(' ') : '', wordTiming: timing,
      sourceDuration: meta.duration, segments, outputDuration, segmentsHash: segmentsHash(segments), cutsAt,
      words: remapWords(words, segments).map((word) => ({text: word.text, start: word.start, end: word.end})), ...(asset ? {asset: {id: 'planilha', kind: 'image', role: 'screenshot', sha256: await sha256(asset), file: path.basename(asset)}} : {})};
    await writeFile(path.join(dir, 'words.json'), JSON.stringify(info, null, 2));
    console.log(`${key}: ${outputDuration}s editados, hash ${info.segmentsHash}, ${info.words.length} palavras (${timing}). Transcrição: ${info.transcript}`);
  }
}

const frameAt = (file, seconds, target) => run('ffmpeg', ['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=w=min(iw\\,540):h=-2', target]);

async function render(only) {
  const dir = path.join(out, 'storyboards');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && (!only || name.startsWith(only)));
  const summary = [];
  for (const name of files) {
    const id = name.replace(/\.json$/, ''), authored = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    const {subject, format, storyboard} = authored;
    const subjectDir = path.join(work, subject), info = JSON.parse(await readFile(path.join(subjectDir, 'words.json'), 'utf8'));
    const cut = path.join(subjectDir, `cut-${format}.mp4`), meta = await probeVideo(cut);
    const metadata = {width: meta.width, height: meta.height, fps: meta.fps, durationSeconds: meta.duration, hasAudio: true};
    // 1) Plano: validatePlan com storyboard amarrado aos cortes (segmentsHash) + prova de fatos.
    const {plan} = validatePlan({segments: info.segments, format, storyboard}, info.sourceDuration);
    // userTexts simula o que o HOST registraria como digitado pelo usuário (legenda do print que ele mesmo enviou).
    const facts = storyboardFactProblems(plan.storyboard, {transcriptText: info.transcript, briefText: info.brief, userTexts: info.asset ? ['Planilha do usuário'] : []});
    if (facts.length) throw new Error(`${id}: fatos sem fonte: ${JSON.stringify(facts)}`);
    const animations = remotionAnimations(plan, {source: {width: 1280, height: 720}});
    const assetFiles = info.asset && plan.storyboard.assets.length ? {[info.asset.id]: {path: path.join(subjectDir, info.asset.file), sha256: info.asset.sha256}} : undefined;
    const target = path.join(out, id);
    await rm(target, {recursive: true, force: true});
    await mkdir(target, {recursive: true});
    // 2) Iteração antes do MP4: stills entrada/meio/saída por cena + contact sheet (mesma composição/props do export).
    let started = Date.now();
    const stills = await renderStoryboardStills({inputPath: cut, outDir: path.join(target, 'stills'), metadata, animations, assetFiles, scale: format === 'portrait' ? 0.4 : 0.5, cutsAt: info.cutsAt, tags: {storyboard: id, segmentsHash: info.segmentsHash}});
    const stillsSeconds = (Date.now() - started) / 1000;
    if (!stills.storyboard.qa.ok) { console.log(`${id}: QA reprovou`, JSON.stringify(stills.storyboard.qa.errors)); summary.push({id, qa: stills.storyboard.qa}); continue; }
    // 3) Trecho de teste (≈3 s do meio) e 4) MP4 final — mesma composição, mesmas props.
    const fps = metadata.fps, total = Math.round(metadata.durationSeconds * fps), mid = Math.floor(total / 2);
    started = Date.now();
    const excerpt = await renderAnimatedVideo({inputPath: cut, outputPath: path.join(target, 'excerpt.mp4'), metadata, animations, assetFiles, frameRange: [mid - fps, Math.min(total - 1, mid + fps * 2)], cutsAt: info.cutsAt});
    const excerptSeconds = (Date.now() - started) / 1000;
    started = Date.now();
    const final = await renderAnimatedVideo({inputPath: cut, outputPath: path.join(target, 'final.mp4'), metadata, animations, assetFiles, cutsAt: info.cutsAt});
    const finalSeconds = (Date.now() - started) / 1000;
    // Frames do MP4 final (prova de que o export bate com os stills) nos mesmos instantes.
    const finalFrames = [];
    for (const still of stills.stills) { const file = path.join(target, `final-${String(still.frame).padStart(4, '0')}.jpg`); await frameAt(path.join(target, 'final.mp4'), still.seconds + 0.5 / fps, file); finalFrames.push(path.basename(file)); }
    await writeFile(path.join(target, 'report.json'), JSON.stringify({id, subject, format, treatment: plan.storyboard.style.treatment, summary: describeStoryboard(plan.storyboard), timings: {stillsSeconds, excerptSeconds, finalSeconds},
      final: {width: final.width, height: final.height, fps: final.fps, durationSeconds: final.durationSeconds, audio: final.audio}, excerpt: excerpt.excerpt, qa: final.storyboard.qa, manifest: final.storyboard.manifest, finalFrames, stills: stills.stills.map((item) => ({...item, path: path.relative(out, item.path)}))}, null, 2));
    summary.push({id, summary: describeStoryboard(plan.storyboard), qa: final.storyboard.qa.ok, warnings: final.storyboard.qa.warnings.length, seconds: final.durationSeconds, audio: final.audio.mode});
    console.log(`${id}: ${describeStoryboard(plan.storyboard)} | QA ok, ${final.storyboard.qa.warnings.length} avisos | stills ${stillsSeconds}s, trecho ${excerptSeconds}s, final ${finalSeconds}s | áudio ${final.audio.mode}`);
  }
  await writeFile(path.join(out, 'render-summary.json'), JSON.stringify(summary, null, 2));
}

/** "Antes": o motor anterior (3 overlays + cues heurísticas) no mesmo corte, para o comparativo visual. */
async function before() {
  for (const subject of Object.keys(SUBJECTS)) {
    const subjectDir = path.join(work, subject), info = JSON.parse(await readFile(path.join(subjectDir, 'words.json'), 'utf8'));
    const cut = path.join(subjectDir, 'cut-portrait.mp4'), meta = await probeVideo(cut);
    const words = info.words.map((word) => ({...word}));
    // Palavras já estão no vídeo editado: o plano legado recebe segmento único = vídeo editado inteiro.
    const segments = [{start: 0, end: meta.duration}];
    const motion = buildMotionPlan({words, wordTiming: info.wordTiming, prosody: null, segments, intensity: 'intense'});
    const {plan} = validatePlan({segments, format: 'portrait', animations: [{id: 'title', kind: 'title', text: info.title, start: 0.2, duration: 2.2}, {id: 'cta', kind: 'cta', text: 'Siga para mais', start: 0, duration: 2}], motion}, meta.duration);
    const target = path.join(out, `before-${subject}`);
    await rm(target, {recursive: true, force: true});
    await mkdir(target, {recursive: true});
    const result = await renderAnimatedVideo({inputPath: cut, outputPath: path.join(target, 'final.mp4'), metadata: {width: meta.width, height: meta.height, fps: meta.fps, durationSeconds: meta.duration, hasAudio: true}, animations: remotionAnimations(plan)});
    const frames = [];
    for (const at of [0.25, 0.4, 0.55, 0.7, 0.85, 0.97].map((f) => f * meta.duration)) { const file = path.join(target, `frame-${at.toFixed(2)}.jpg`); await frameAt(path.join(target, 'final.mp4'), at, file); frames.push(path.basename(file)); }
    await run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-pattern_type', 'glob', '-i', path.join(target, 'frame-*.jpg').replace(/\\/g, '/'), '-vf', 'scale=270:-2,tile=6x1:padding=8:margin=8:color=0x202020', '-frames:v', '1', path.join(target, 'contact-sheet.jpg')]).catch(async () => {
      await run('ffmpeg', ['-v', 'error', '-y', ...frames.flatMap((name) => ['-i', path.join(target, name)]), '-filter_complex', `${frames.map((_, i) => `[${i}:v]scale=270:-2[s${i}]`).join(';')};${frames.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${frames.length}`, '-frames:v', '1', path.join(target, 'contact-sheet.jpg')]);
    });
    await writeFile(path.join(target, 'report.json'), JSON.stringify({engine: 'legacy overlays + heuristic motion', summary: describeMotion(plan.motion), cues: plan.motion.cues.map((cue) => ({kind: cue.kind, layout: cue.layout, text: cue.text, start: cue.start, end: cue.end})), durationSeconds: result.durationSeconds, frames}, null, 2));
    console.log(`before-${subject}: ${describeMotion(plan.motion)}`);
  }
}

const phase = process.argv[2];
if (phase === 'prepare') await prepare();
else if (phase === 'render') await render(process.argv[3]);
else if (phase === 'before') await before();
else { console.error('uso: node scripts/storyboard-demo.mjs prepare|render [prefixo]|before'); process.exit(2); }
