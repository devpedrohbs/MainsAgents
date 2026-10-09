// Amostra SINTÉTICA dos motions explicativos + enquadramento (nenhum vídeo/voz real; nada é baixado):
// vídeo desenhado pelo FFmpeg (fundo com grade + bloco claro no lugar do rosto), transcrição com tempos por palavra
// escrita aqui (não há reconhecimento de voz nesta amostra), plano gerado por buildMotionPlan (explicativos detectados
// só nas palavras), foco MANUAL marcado sobre o bloco, imagem do "usuário" gerada localmente -> bundle Remotion próprio
// em pasta temporária -> render real em 16:9 (30 fps), 9:16 (25 fps, faixa de legenda protegida) e 1:1 (30 fps)
// -> frames PNG + planos + relatório. Uso: node scripts/render-explainer-sample.mjs [pastaDeSaída]
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildMotionPlan, describeMotion, motionDensity, normalizeMotion, verifyExplainersAgainstTranscript} from '../editorial-motion-plan.mjs';
import {manualReframe} from '../editorial-reframe.mjs';
import {probeVideo, renderAnimatedVideo} from '../editorial-remotion.mjs';
import {buildRemotionBundle} from './build-remotion-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'analysis', 'editing-explainer-frames'));
const run = (cmd, args) => { const result = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(`${cmd} falhou: ${result.stderr?.slice(-600)}`); return result.stdout; };

/** Palavras com tempos determinísticos (0,3 s por palavra, pausa de 0,35 s após ponto). Texto escrito para a amostra. */
const say = (text, start = 0.8) => {
  let t = start;
  return text.split(/\s+/).filter(Boolean).map((word) => { const item = {start: +t.toFixed(3), end: +(t + 0.3).toFixed(3), text: word}; t += 0.38 + (/[.!?]$/.test(word) ? 0.35 : 0); return item; });
};
const FILLER = 'Olá pessoal, hoje a conversa é sobre editar vídeos curtos com calma.';
const variants = [
  {name: 'landscape-compare-steps', width: 960, height: 540, fps: 30, intensity: 'intense',
    text: `${FILLER} Antes eu gastava três horas editando cada vídeo. Agora faço tudo em vinte minutos. Isso mudou a minha rotina de trabalho e de gravação. Vou mostrar o método completo com calma para você. ${FILLER} ${FILLER} ${FILLER} Primeiro, grave o áudio limpo. Segundo, corte os silêncios longos. Terceiro, publique o vídeo curto. É isso pessoal. ${FILLER} ${FILLER}`,
    face: {x: 0.68, y: 0.36}},
  {name: 'portrait-stat-captions', width: 540, height: 960, fps: 25, intensity: 'balanced', protect: {captionBand: {top: 0.7, bottom: 0.8}},
    text: `${FILLER} ${FILLER} Neste mês as vendas subiram 30% e os custos caíram 12%. Foi o melhor resultado do ano para a equipe toda. ${FILLER}`,
    face: {x: 0.5, y: 0.3}},
  {name: 'square-process-image', width: 540, height: 540, fps: 30, intensity: 'intense',
    text: `${FILLER} Primeiro você grava. Depois o app transcreve. Em seguida corta os silêncios. Por fim exporta o vídeo. ${FILLER} Agora veja o material que eu preparei para vocês hoje. ${FILLER}`,
    face: {x: 0.3, y: 0.38}, image: true}
];

async function makeSource(dir, v, duration) {
  const file = path.join(dir, `${v.name}.mp4`), fw = Math.round(v.width * 0.16), fh = Math.round(v.height * (v.width > v.height ? 0.3 : v.width < v.height ? 0.17 : 0.24));
  const fx = Math.round(v.face.x * v.width - fw / 2), fy = Math.round(v.face.y * v.height - fh / 2);
  run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x2b3445:s=${v.width}x${v.height}:r=${v.fps}:d=${duration}`, '-f', 'lavfi', '-i', `color=c=0xe0b090:s=${fw}x${fh}:r=${v.fps}:d=${duration}`,
    '-f', 'lavfi', '-i', `sine=f=220:d=${duration}:sample_rate=48000`,
    '-filter_complex', `[0:v]drawgrid=w=${Math.round(v.width / 8)}:h=${Math.round(v.height / 8)}:t=2:c=white@0.18[g];[g][1:v]overlay=x=${fx}:y=${fy}:shortest=1[v];[2:a]volume=0.05,aformat=channel_layouts=stereo[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-ar', '48000', '-shortest', file]);
  return {file, face: {x: v.face.x, y: v.face.y, w: fw / v.width, h: fh / v.height}};
}

async function frame(file, seconds, target) {
  run('ffmpeg', ['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', file, '-frames:v', '1', target]);
}

async function main() {
  await mkdir(out, {recursive: true});
  const work = await mkdtemp(path.join(os.tmpdir(), 'explainer-sample-'));
  const report = {fixture: 'SINTÉTICA: vídeo desenhado pelo FFmpeg (bloco claro = posição do rosto), transcrição escrita no script, foco manual. Sem voz humana, sem reconhecimento de fala, sem detecção facial.', variants: []};
  try {
    const bundleDir = path.join(work, 'bundle');
    const started = Date.now();
    await buildRemotionBundle({outDir: bundleDir});
    report.bundle = {seconds: Math.round((Date.now() - started) / 100) / 10, note: 'bundle próprio em pasta temporária (dist/remotion não foi tocado)'};
    for (const v of variants) {
      const words = say(v.text), duration = Math.ceil((words[words.length - 1].end + 1.5) * 10) / 10, segments = [{start: 0, end: duration}];
      const {file, face} = await makeSource(work, v, duration);
      const reframe = manualReframe([{t: 0, ...face}]);
      let plan = buildMotionPlan({words, wordTiming: 'words', segments, intensity: v.intensity, reframe});
      let assetFiles;
      if (v.image) {
        // "Material do usuário": PNG gerado localmente (gráfico de barras desenhado pelo FFmpeg), referenciado só por id.
        const png = path.join(work, 'material.png');
        run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xf4f5f8:s=640x400:d=1', '-vf', 'drawbox=x=80:y=240:w=90:h=120:color=0x2f6bff:t=fill,drawbox=x=230:y=160:w=90:h=200:color=0x2f6bff:t=fill,drawbox=x=380:y=90:w=90:h=270:color=0xff5a36:t=fill', '-frames:v', '1', png]);
        assetFiles = {material: png};
        const at = words.find((word) => word.text === 'material').start - 0.1, end = Math.min(duration - 0.3, at + 4);
        plan = {...plan, cues: [...plan.cues.filter((cue) => cue.end < at - 0.5), {id: 'u1', kind: 'explainer', sourceStart: at, sourceEnd: end, start: at, end, layout: 'split', strength: 0.8, source: 'user', timing: 'words',
          reason: 'Material escolhido por você', signals: [{kind: 'user', source: 'user'}], explainer: {origin: 'user', visual: {type: 'image', assetId: 'material', caption: 'Seu material (exemplo sintético)'}}}]};
      }
      const motion = normalizeMotion(plan, segments);
      const proof = verifyExplainersAgainstTranscript(motion, words);
      if (!proof.ok) throw new Error(`Explicativo sem prova na transcrição: ${JSON.stringify(proof.problems)}`);
      const meta = await probeVideo(file);
      const target = path.join(out, `${v.name}.mp4`);
      await rm(target, {force: true});
      const t0 = Date.now();
      const result = await renderAnimatedVideo({inputPath: file, outputPath: target, bundleDir, assetFiles,
        metadata: {width: meta.width, height: meta.height, fps: meta.fps, durationSeconds: meta.durationSeconds, hasAudio: meta.hasAudio},
        animations: {motion, accent: '#ff5a36', ...(v.protect ? {protect: v.protect} : {})}});
      const frames = [];
      for (const cue of motion.cues.filter((item) => item.kind === 'explainer')) {
        const shots = [['entrando', cue.start + 0.2], ...(cue.explainer.revealAt ?? []).map((t, i) => [`item${i + 1}`, Math.min(cue.end - 0.6, t + 0.6)]), ['completo', cue.end - 0.7], ['saindo', cue.end - 0.15]];
        for (const [label, t] of shots) { const png = path.join(out, `${v.name}-${cue.id}-${label}.png`); await frame(target, t, png); frames.push({file: path.basename(png), t: Math.round(t * 1000) / 1000}); }
      }
      const punch = motion.cues.find((cue) => cue.kind === 'punchIn');
      if (punch) { const png = path.join(out, `${v.name}-${punch.id}-punch.png`); await frame(target, (punch.start + punch.end) / 2, png); frames.push({file: path.basename(png), t: (punch.start + punch.end) / 2}); }
      await writeFile(path.join(out, `${v.name}-plan.json`), JSON.stringify(motion, null, 2));
      report.variants.push({name: v.name, size: `${result.width}x${result.height}`, fps: result.fps, durationSeconds: result.durationSeconds, audio: result.audio, renderSeconds: Math.round((Date.now() - t0) / 100) / 10,
        summary: describeMotion(motion), density: motionDensity(motion, duration), proof, protect: v.protect ?? null, faceBox: face,
        cues: motion.cues.map((cue) => ({id: cue.id, kind: cue.kind, layout: cue.layout, start: cue.start, end: cue.end, ...(cue.explainer ? {visual: cue.explainer.visual, origin: cue.explainer.origin, quote: cue.explainer.quote} : {}), ...(cue.text ? {text: cue.text} : {})})),
        frames});
      console.log(`${v.name}: ${describeMotion(motion)}`);
    }
    await writeFile(path.join(out, 'sample-report.json'), JSON.stringify(report, null, 2));
    console.log(`Amostra em ${out}`);
  } finally {
    await rm(work, {recursive: true, force: true});
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
