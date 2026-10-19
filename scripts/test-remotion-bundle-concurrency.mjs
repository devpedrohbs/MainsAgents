// Repro REAL do defeito "rebuild do bundle durante render": @remotion/bundler + Chromium local + vídeo SINTÉTICO.
// Tudo em pasta temporária própria (dist/remotion não é tocado). Nenhum modelo/IA envolvido.
//   legado: o build antigo fazia rmSync(raiz) + bundle na MESMA pasta -> stills em andamento perdem assets.
//   novo:   buildRemotionBundle publica versão nova + troca ponteiro + prune keep=1; a lease protege a versão fixada.
// Uso: node scripts/test-remotion-bundle-concurrency.mjs [--skip-legacy]   (exit 1 se o modo novo falhar; 2 se faltar dependência)
import {bundle} from '@remotion/bundler';
import {existsSync, rmSync} from 'node:fs';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeVideo, renderStoryboardStills, resolveBrowser, resolveRemotionBundle} from '../editorial-remotion.mjs';
import {buildRemotionBundle} from './build-remotion-video.mjs';
import {SMOKE_ANIMATIONS, hasFfmpeg, makeSyntheticVideo} from './test-remotion-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = path.join(root, 'remotion-video', 'index.ts');
const FRAMES = Array.from({length: 40}, (_, i) => (i * 2) % 90);

const waitFor = async (check, timeoutMs = 180000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout esperando o render começar');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const stillsStarted = (dir) => async () => (await readdir(dir).catch(() => [])).filter((name) => name.startsWith('still-')).length >= 2;

async function stillsDuringRebuild({label, input, metadata, bundleDir, outDir, rebuild}) {
  const started = Date.now();
  const render = renderStoryboardStills({inputPath: input, outDir, bundleDir, metadata, animations: SMOKE_ANIMATIONS, frames: FRAMES, maxImages: 60, scale: 0.5})
    .then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
  await waitFor(async () => (await stillsStarted(outDir)()) || existsSync(path.join(outDir, 'stills.json')));
  const rebuildResult = await rebuild().then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
  const result = await render;
  const stills = result.ok ? result.value.stills.length : (await readdir(outDir).catch(() => [])).filter((name) => name.startsWith('still-')).length;
  const line = {modo: label, render: result.ok ? 'ok' : `FALHOU: ${String(result.error?.code ?? '')} ${String(result.error?.message ?? result.error).slice(0, 220)}`,
    stills: `${stills}/${FRAMES.length}`, rebuild: rebuildResult.ok ? 'ok' : `falhou: ${rebuildResult.error?.message}`, bundle: result.ok ? result.value.bundle : null, segundos: Math.round((Date.now() - started) / 100) / 10};
  console.log(JSON.stringify(line));
  return {...line, ok: result.ok && stills === FRAMES.length && rebuildResult.ok};
}

async function main() {
  if (!(await hasFfmpeg()) || resolveBrowser().status !== 'ready') { console.error('ffmpeg/navegador ausente'); process.exit(2); }
  const work = await mkdtemp(path.join(os.tmpdir(), 'remotion-bundle-concurrency-'));
  try {
    const input = path.join(work, 'cut.mp4');
    await makeSyntheticVideo(input);
    const probe = await probeVideo(input);
    const metadata = {width: probe.width, height: probe.height, fps: probe.fps, durationSeconds: probe.durationSeconds, hasAudio: probe.hasAudio};
    const results = [];
    if (!process.argv.includes('--skip-legacy')) {
      const legacyRoot = path.join(work, 'legacy');
      await bundle({entryPoint, outDir: legacyRoot, enableCaching: false});
      results.push(await stillsDuringRebuild({label: 'legado (rmSync + bundle na mesma pasta)', input, metadata, bundleDir: legacyRoot, outDir: path.join(work, 'stills-legacy'),
        rebuild: async () => { rmSync(legacyRoot, {recursive: true, force: true}); await bundle({entryPoint, outDir: legacyRoot, enableCaching: false}); }}));
    }
    const versionedRoot = path.join(work, 'versioned');
    const v1 = await buildRemotionBundle({outDir: versionedRoot});
    // Rebuild com conteúdo diferente (marcador na staging) para forçar versão nova, troca de ponteiro e prune keep=1.
    const marked = async (options) => { await bundle(options); await writeFile(path.join(options.outDir, 'rebuild-marker.txt'), String(Date.now())); };
    const fresh = await stillsDuringRebuild({label: 'novo (staging + versão + ponteiro, keep=1)', input, metadata, bundleDir: versionedRoot, outDir: path.join(work, 'stills-versioned'),
      rebuild: () => buildRemotionBundle({outDir: versionedRoot, bundler: marked, keep: 1})});
    const now = resolveRemotionBundle(versionedRoot);
    const pinnedOld = fresh.bundle?.version === path.basename(v1);
    console.log(JSON.stringify({ponteiroAgora: now.version, renderUsou: fresh.bundle?.version, versaoAntigaFixada: pinnedOld, versoes: await readdir(path.join(versionedRoot, 'versions'))}));
    // Falha de build preserva a versão publicada.
    const before = resolveRemotionBundle(versionedRoot).version;
    const failed = await buildRemotionBundle({outDir: versionedRoot, bundler: async () => { throw new Error('falha simulada'); }}).then(() => false, () => true);
    const preserved = failed && resolveRemotionBundle(versionedRoot).version === before && existsSync(path.join(resolveRemotionBundle(versionedRoot).dir, 'index.html'));
    console.log(JSON.stringify({falhaPreservaAnterior: preserved}));
    if (!fresh.ok || !pinnedOld || now.version === fresh.bundle?.version || !preserved) process.exit(1);
  } finally {
    await rm(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
