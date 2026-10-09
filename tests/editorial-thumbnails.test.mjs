import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CONCEPTS, ThumbnailError, checkThumbnailSelection, contrastRatio, createThumbnailSelection, cropFor, extractFramePreview, getThumbnailCapabilities,
  hashFile, layoutConcept, listThumbnailFormats, parseFontMetrics, planThumbnailSet, renderThumbnailSet, resolveFont, selectionKey,
  suggestCandidateFrames, validateThumbnailRequest, verifyThumbnailSelectionFile
} from '../editorial-thumbnails.mjs';

const codeOf = (code) => (error) => error instanceof ThumbnailError && error.code === code;
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-hide_banner', '-version'], {stdio: 'ignore'}); execFileSync('ffprobe', ['-hide_banner', '-version'], {stdio: 'ignore'}); return true; } catch { return false; } })();
const font = await resolveFont().catch(() => null);
const SHA = 'a'.repeat(64);
const source = (file = path.join(os.tmpdir(), 'video.mp4'), sha256 = SHA) => ({path: file, assetId: 'asset-1', versionId: 'version-1', sha256});
const concepts = (overrides = {}) => [
  {concept: 'product', timestampSeconds: 0.8, title: 'O fone que cancela ruído de verdade', kicker: 'Review honesto', framing: {focusX: 0.4, focusY: 0.5, zoom: 1.2}, ...overrides.product},
  {concept: 'person', timestampSeconds: 2.5, title: 'Eu não esperava essa reação', framing: {focusX: 0.3, focusY: 0.35, zoom: 1.4}, ...overrides.person},
  {concept: 'benefit', timestampSeconds: 4.6, title: 'Economize 3 horas por semana com automação', kicker: 'Passo a passo', ...overrides.benefit}
];
const request = (extra = {}) => ({source: source(), format: 'youtube-thumbnail', concepts: concepts(), ...extra});
const inside = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('formatos por destino têm dimensões próprias, áreas seguras e status de orientação não verificada', () => {
  const formats = listThumbnailFormats();
  assert.deepEqual(formats.map((item) => item.id), ['youtube-thumbnail', 'instagram-reels-cover', 'tiktok-cover', 'instagram-feed-4x5']);
  assert.deepEqual(formats.map((item) => `${item.width}x${item.height}`), ['1280x720', '1080x1920', '1080x1920', '1080x1350']);
  for (const format of formats) {
    assert.equal(format.status, 'guidance-unverified');
    assert.match(format.guidance, /onfira|aproximad/);
    const {x, y, w, h} = format.safeArea;
    assert.ok(x >= 0 && y >= 0 && x + w <= 1 && y + h <= 1);
  }
  assert.equal(formats[0].maxBytes, 2 * 1024 * 1024);
  assert.ok(formats.find((item) => item.id === 'tiktok-cover').reservedZones.length >= 2);
});

test('validação rejeita conceitos incompletos, texto inseguro, caminhos de rede, hash e cores inválidos', () => {
  const bad = (raw, code, fragment) => assert.throws(() => validateThumbnailRequest(raw), (error) => codeOf(code)(error) && (!fragment || error.message.includes(fragment)));
  bad(request({concepts: concepts().slice(0, 2)}), 'invalid_concepts', 'três');
  bad(request({concepts: [concepts()[0], concepts()[0], concepts()[2]]}), 'invalid_concepts', 'uma vez');
  bad(request({concepts: concepts({product: {concept: 'face-detect'}})}), 'invalid_concepts');
  bad(request({concepts: concepts({product: {title: 'a\u0000b'}})}), 'invalid_text', 'controle');
  bad(request({concepts: concepts({product: {title: 'a‮b'}})}), 'invalid_text', 'controle');
  bad(request({concepts: concepts({product: {title: 'x'.repeat(71)}})}), 'invalid_text', '70');
  bad(request({concepts: concepts({product: {title: '   '}})}), 'invalid_text');
  bad(request({concepts: concepts({person: {framing: {focusX: 2}}})}), 'invalid_concepts', 'focusX');
  bad(request({concepts: concepts({person: {framing: {zoom: 9}}})}), 'invalid_concepts', 'zoom');
  bad(request({concepts: concepts({person: {timestampSeconds: -1}})}), 'invalid_concepts');
  bad(request({concepts: concepts({person: {autoDetect: true}})}), 'invalid_input', 'autoDetect');
  bad(request({source: {...source(), path: '\\\\server\\share\\v.mp4'}}), 'invalid_source');
  bad(request({source: {...source(), path: 'relative.mp4'}}), 'invalid_source');
  bad(request({source: {...source(), path: path.join(os.tmpdir(), 'x.exe')}}), 'invalid_source');
  bad(request({source: {...source(), sha256: 'abc'}}), 'invalid_source', 'sha256');
  bad(request({format: 'any-network'}), 'invalid_format');
  bad(request({fileType: 'gif'}), 'invalid_format');
  bad(request({brand: {accent: 'red'}}), 'invalid_input', 'accent');
  bad(request({brand: {theme: 'neon'}}), 'invalid_input', 'theme');
  bad(request({brand: {logoPath: path.join(os.tmpdir(), 'logo.svg')}}), 'invalid_logo');
  bad(request({brand: {logoSha256: SHA}}), 'invalid_logo');
  const ok = validateThumbnailRequest(request({concepts: concepts().reverse()}));
  assert.deepEqual(ok.concepts.map((item) => item.concept), CONCEPTS);
  assert.equal(ok.fileType, 'jpg');
  assert.equal(ok.concepts[2].framing.zoom, 1);
});

test('métricas de fonte medem texto, recusam .ttc e reconhecem glifos ausentes', {skip: !font && 'sem fonte local'}, async () => {
  const metrics = parseFontMetrics(await readFile(font.path));
  assert.ok(metrics.unitsPerEm > 0 && metrics.capHeight > 0);
  assert.ok(metrics.measure('WWWW') > metrics.measure('iiii'));
  assert.equal(metrics.measure('ab'), metrics.measure('a') + metrics.measure('b'));
  assert.ok(metrics.hasGlyph('ç') && metrics.hasGlyph('ã'));
  assert.throws(() => parseFontMetrics(Buffer.from('ttcf000000000000')), codeOf('invalid_font'));
  assert.throws(() => parseFontMetrics(Buffer.alloc(4)), codeOf('invalid_font'));
});

test('layout de cada conceito em cada formato fica na área segura, fora das zonas reservadas e com contraste ≥ 4.5', {skip: !font && 'sem fonte local'}, () => {
  const logo = {width: 400, height: 120, sha256: SHA};
  const titles = ['Curto', 'O fone que cancela ruído de verdade', 'Economize três horas por semana com uma automação simples'];
  for (const format of listThumbnailFormats()) {
    for (const concept of CONCEPTS) {
      for (const [index, title] of titles.entries()) {
        for (const theme of ['dark', 'light']) {
          const framing = {focusX: index === 1 ? 0.8 : 0.2, focusY: index === 1 ? 0.8 : 0.3, zoom: 1};
          const layout = layoutConcept({format: format.id, concept, title, kicker: index ? 'Novo teste' : undefined, framing, theme, accent: '#2f6bff', font, logo: index === 2 ? null : logo});
          const rects = [layout.title.rect, layout.kicker?.rect, layout.logo, layout.accent?.rect].filter(Boolean);
          for (const rect of rects) {
            assert.ok(inside(rect, layout.safeArea), `${format.id}/${concept}: fora da área segura`);
            for (const zone of layout.reservedZones) assert.ok(!overlaps(rect, zone), `${format.id}/${concept}: invade ${zone.id}`);
          }
          if (layout.logo) assert.ok(!overlaps(layout.logo, layout.title.rect));
          assert.ok(layout.contrast.title >= 4.5);
          assert.ok(layout.title.size >= Math.round(Math.min(format.width, format.height) * 0.06) - 1, 'título abaixo do piso de legibilidade');
          assert.equal(layout.title.lines.join(' ').length > 0, true);
          assert.equal(layout.title.lines.map((line) => line.text).join(' '), title, 'nenhuma palavra é cortada');
        }
      }
    }
  }
  // Pessoa na horizontal: o texto vai para o lado oposto ao foco escolhido pelo usuário.
  const left = layoutConcept({format: 'youtube-thumbnail', concept: 'person', title: 'Reação', framing: {focusX: 0.8, focusY: 0.5, zoom: 1}, theme: 'dark', accent: '#2f6bff', font});
  const right = layoutConcept({format: 'youtube-thumbnail', concept: 'person', title: 'Reação', framing: {focusX: 0.2, focusY: 0.5, zoom: 1}, theme: 'dark', accent: '#2f6bff', font});
  assert.equal(left.side, 'left');
  assert.equal(right.side, 'right');
  assert.ok(right.title.rect.x >= 600 && left.title.rect.x + left.title.rect.w <= 680);
});

test('título que não cabe legível ou glifo inexistente falham explicitamente (sem cortar em silêncio)', {skip: !font && 'sem fonte local'}, () => {
  const base = {format: 'youtube-thumbnail', concept: 'product', framing: {focusX: 0.5, focusY: 0.5, zoom: 1}, theme: 'dark', accent: '#2f6bff', font};
  assert.throws(() => layoutConcept({...base, title: 'Pneumoultramicroscopicossilicovulcanoconiótico'}), codeOf('layout_overflow'));
  assert.throws(() => layoutConcept({...base, title: 'WWWWWWWWW '.repeat(7).trim()}), codeOf('layout_overflow'));
  assert.throws(() => layoutConcept({...base, title: 'Capa 🚀'}), codeOf('unsupported_glyph'));
});

test('recorte respeita aspecto da região, foco e zoom dentro da imagem e avisa ampliação', () => {
  const crop = cropFor({sourceWidth: 1920, sourceHeight: 1080, region: {w: 1080, h: 1920}, framing: {focusX: 1, focusY: 0, zoom: 1}});
  assert.equal(crop.h, 1080);
  assert.ok(Math.abs(crop.w / crop.h - 1080 / 1920) < 0.01);
  assert.equal(crop.x + crop.w, 1920);
  assert.equal(crop.y, 0);
  const zoomed = cropFor({sourceWidth: 640, sourceHeight: 360, region: {w: 1280, h: 720}, framing: {focusX: 0.5, focusY: 0.5, zoom: 2}});
  assert.ok(zoomed.upscale >= 4);
});

test('plano é determinístico e o specHash muda com versão do vídeo, texto ou frame', {skip: !font && 'sem fonte local'}, () => {
  const facts = {sourceMetadata: {width: 1920, height: 1080, fps: 30, durationSeconds: 6}, font, logo: null};
  const a = planThumbnailSet(request(), facts);
  assert.equal(a.specHash, planThumbnailSet(request({concepts: concepts().reverse()}), facts).specHash);
  assert.notEqual(a.specHash, planThumbnailSet(request({source: {...source(), versionId: 'version-2'}}), facts).specHash);
  assert.notEqual(a.specHash, planThumbnailSet(request({concepts: concepts({person: {timestampSeconds: 2.6}})}), facts).specHash);
  assert.notEqual(a.specHash, planThumbnailSet(request({concepts: concepts({benefit: {title: 'Outro benefício'}})}), facts).specHash);
  assert.equal(a.batchId, `thumbs-${a.specHash.slice(0, 16)}`);
  assert.throws(() => planThumbnailSet(request({concepts: concepts({person: {timestampSeconds: 6}})}), facts), codeOf('invalid_concepts'));
});

test('seleção por versão: chave conteúdo|vídeo|versão|formato, fica stale quando a versão ou o arquivo muda', () => {
  const manifest = {schema: 'mainsagents.thumbnails/1', batchId: 'thumbs-1', specHash: SHA, source: {assetId: 'asset-1', versionId: 'version-1', sha256: SHA}, format: {id: 'youtube-thumbnail'},
    items: [{concept: 'person', export: {path: '/x/person.jpg', sha256: 'b'.repeat(64), size: 10, width: 1280, height: 720, mime: 'image/jpeg'}}]};
  const selection = createThumbnailSelection(manifest, 'person', {contentId: 'content-1', selectedAt: '2026-10-07T00:00:00.000Z'});
  assert.equal(selection.key, selectionKey({contentId: 'content-1', assetId: 'asset-1', versionId: 'version-1', format: 'youtube-thumbnail'}));
  assert.equal(checkThumbnailSelection(selection, {currentSource: manifest.source}).status, 'current');
  assert.equal(checkThumbnailSelection(selection, {currentSource: {...manifest.source, versionId: 'version-2'}}).status, 'stale');
  assert.equal(checkThumbnailSelection(selection, {currentSource: {...manifest.source, sha256: 'c'.repeat(64)}}).status, 'stale');
  assert.equal(checkThumbnailSelection(selection, {currentSource: manifest.source, file: {sha256: 'd'.repeat(64), size: 10}}).status, 'stale');
  assert.equal(checkThumbnailSelection(selection, {}).status, 'stale');
  assert.equal(checkThumbnailSelection({...selection, format: 'tiktok-cover'}, {currentSource: manifest.source}).status, 'invalid');
  assert.throws(() => createThumbnailSelection(manifest, 'product', {contentId: 'content-1'}), codeOf('invalid_input'));
  assert.throws(() => createThumbnailSelection(manifest, 'person', {}), codeOf('invalid_input'));
});

test('contraste WCAG calculado corretamente', () => {
  assert.equal(Math.round(contrastRatio([1, 1, 1], [0, 0, 0])), 21);
  assert.equal(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
});

// ------------------------------------------------------------ FFmpeg real com vídeo sintético

async function fixtures() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'thumbs-test-'));
  const video = path.join(dir, 'source.mp4');
  const portrait = path.join(dir, 'portrait.mp4');
  const logo = path.join(dir, 'logo.png');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2', '-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'smptehdbars=size=1280x720:rate=30:duration=2',
    '-filter_complex', '[1]trim=duration=2,setpts=PTS-STARTPTS[m];[0][m][2]concat=n=3:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', '-g', '15', video]);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', video, '-vf', 'crop=404:720,scale=1080:1920', '-c:v', 'libx264', '-g', '15', portrait]);
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=360x120,format=rgba', '-f', 'lavfi', '-i', 'color=c=0xff9f0a:s=120x120', '-filter_complex', '[0][1]overlay=0:0,format=rgba', '-frames:v', '1', logo]);
  return {dir, video, portrait, logo, sha: await hashFile(video), portraitSha: await hashFile(portrait)};
}

const ffmpegTest = (name, fn) => test(name, {skip: (!hasFfmpeg && 'FFmpeg ausente') || (!font && 'sem fonte local'), timeout: 120_000}, async () => {
  const fx = await fixtures();
  try { await fn(fx); } finally { await rm(fx.dir, {recursive: true, force: true}); }
});

const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]).toString()).streams[0];

ffmpegTest('capacidades reais: FFmpeg com drawtext/geq e fonte local, sem IA nem rede', async () => {
  const caps = await getThumbnailCapabilities();
  assert.equal(caps.available, true, caps.reasons.join('; '));
  assert.equal(caps.requiresAi, false);
  assert.equal(caps.network, false);
  assert.equal(caps.ffmpeg.filters.drawtextBaseline, true);
});

ffmpegTest('render real: três capas + prévias com guias, dimensões do destino, manifest com hashes e fonte preservada', async (fx) => {
  const out = path.join(fx.dir, 'out');
  await (await import('node:fs/promises')).mkdir(out);
  const before = await stat(fx.video);
  const phases = [];
  const manifest = await renderThumbnailSet({source: source(fx.video, fx.sha), format: 'youtube-thumbnail', outputDirectory: out, brand: {accent: '#ff9f0a', logoPath: fx.logo}, concepts: concepts(), onProgress: (p) => phases.push(p.phase)});
  assert.deepEqual([...new Set(phases)], ['validate', 'render', 'verify', 'commit']);
  assert.deepEqual(await readdir(out), [manifest.batchId], 'nenhum temporário sobra');
  const files = (await readdir(path.join(out, manifest.batchId))).sort();
  assert.equal(files.length, 7);
  assert.deepEqual(manifest.items.map((item) => item.concept), CONCEPTS);
  for (const item of manifest.items) {
    for (const kind of ['export', 'preview']) {
      const file = item[kind];
      assert.equal(await hashFile(file.path), file.sha256);
      const info = probe(file.path);
      assert.equal(`${info.width}x${info.height}`, '1280x720');
      assert.equal(info.codec_name, kind === 'export' ? 'mjpeg' : 'png');
    }
    assert.equal(item.export.kind, 'thumbnail');
    assert.equal(item.preview.kind, 'safe-area-preview');
    assert.ok(item.export.size <= 2 * 1024 * 1024);
    assert.ok(item.layout.contrast.title >= 4.5);
  }
  const saved = JSON.parse(await readFile(path.join(out, manifest.batchId, 'manifest.json'), 'utf8'));
  assert.equal(saved.specHash, manifest.specHash);
  assert.equal(saved.requiresAi, false);
  assert.equal(saved.format.status, 'guidance-unverified');
  assert.equal(await hashFile(fx.video), fx.sha);
  const after = await stat(fx.video);
  assert.equal(after.mtimeMs, before.mtimeMs);
  // Frames diferentes por conceito: as capas não são a mesma imagem.
  assert.equal(new Set(manifest.items.map((item) => item.export.sha256)).size, 3);
  // Mesma especificação de novo: lote já existe, nada é sobrescrito.
  await assert.rejects(renderThumbnailSet({source: source(fx.video, fx.sha), format: 'youtube-thumbnail', outputDirectory: out, brand: {accent: '#ff9f0a', logoPath: fx.logo}, concepts: concepts()}), codeOf('output_exists'));
  const selection = createThumbnailSelection(manifest, 'benefit', {contentId: 'content-1'});
  assert.equal((await verifyThumbnailSelectionFile(selection, {currentSource: {assetId: 'asset-1', versionId: 'version-1', sha256: fx.sha}})).status, 'current');
  await writeFile(selection.file.path, 'replaced');
  assert.equal((await verifyThumbnailSelectionFile(selection, {currentSource: {assetId: 'asset-1', versionId: 'version-1', sha256: fx.sha}})).status, 'stale');
});

ffmpegTest('render real vertical em PNG com tema claro e TikTok', async (fx) => {
  const out = path.join(fx.dir, 'out');
  await (await import('node:fs/promises')).mkdir(out);
  const manifest = await renderThumbnailSet({source: source(fx.portrait, fx.portraitSha), format: 'tiktok-cover', fileType: 'png', safeAreaPreview: false, outputDirectory: out, brand: {theme: 'light', logoPath: fx.logo}, concepts: concepts()});
  for (const item of manifest.items) {
    const info = probe(item.export.path);
    assert.equal(`${info.width}x${info.height}`, '1080x1920');
    assert.equal(info.codec_name, 'png');
    assert.equal(item.preview, undefined);
  }
  assert.equal((await readdir(path.join(out, manifest.batchId))).length, 4);
});

ffmpegTest('fonte alterada desde a revisão bloqueia a geração sem criar arquivos', async (fx) => {
  const out = path.join(fx.dir, 'out');
  await (await import('node:fs/promises')).mkdir(out);
  await assert.rejects(renderThumbnailSet({source: source(fx.video, 'f'.repeat(64)), format: 'youtube-thumbnail', outputDirectory: out, concepts: concepts()}), codeOf('source_changed'));
  await assert.rejects(renderThumbnailSet({source: source(fx.video, fx.sha), format: 'youtube-thumbnail', outputDirectory: out, brand: {logoPath: fx.logo, logoSha256: 'e'.repeat(64)}, concepts: concepts()}), codeOf('invalid_logo'));
  await assert.rejects(renderThumbnailSet({source: source(fx.video, fx.sha), format: 'youtube-thumbnail', outputDirectory: path.join(fx.dir, 'missing'), concepts: concepts()}), codeOf('invalid_output'));
  assert.deepEqual(await readdir(out), []);
});

for (const [label, trigger] of [['entre renders', (p) => p.phase === 'render' && p.completed === 2], ['com FFmpeg em execução', (p) => p.phase === 'render' && p.completed === 1 && p.process === 'running' && 'running'], ['antes do commit', (p) => p.phase === 'commit' && p.completed === 0]]) {
  ffmpegTest(`cancelamento ${label} remove temporários e não entrega lote parcial`, async (fx) => {
    const out = path.join(fx.dir, 'out');
    await (await import('node:fs/promises')).mkdir(out);
    const controller = new AbortController();
    let aborted = null;
    const onProgress = (p) => {
      // Abort synchronously at the observed point: for 'running' the FFmpeg child has been spawned and cannot have exited yet.
      if (!aborted && trigger(p)) { aborted = p; controller.abort(); }
    };
    await assert.rejects(renderThumbnailSet({source: source(fx.video, fx.sha), format: 'youtube-thumbnail', outputDirectory: out, brand: {logoPath: fx.logo}, concepts: concepts(), signal: controller.signal, onProgress}), codeOf('cancelled'));
    assert.ok(aborted, 'the cancellation point was reached');
    assert.deepEqual(await readdir(out), []);
    assert.equal(await hashFile(fx.video), fx.sha);
  });
}

ffmpegTest('pontos candidatos honestos: mudanças de cena reais + espaçados, sem detecção de produto/rosto; prévia de frame', async (fx) => {
  const result = await suggestCandidateFrames({source: source(fx.video, fx.sha), count: 5});
  assert.equal(result.candidates.length, 5);
  assert.ok(result.candidates.every((item) => ['scene-change', 'evenly-spaced'].includes(item.reason)));
  const scenes = result.candidates.filter((item) => item.reason === 'scene-change').map((item) => item.timestampSeconds);
  assert.ok(scenes.some((time) => Math.abs(time - 2) < 0.6) || scenes.some((time) => Math.abs(time - 4) < 0.6), `cortes em 2s/4s não detectados: ${JSON.stringify(result.candidates)}`);
  assert.match(result.note, /nenhum reconhecimento/);
  const frame = path.join(fx.dir, 'frame.jpg');
  const preview = await extractFramePreview({source: source(fx.video, fx.sha), timestampSeconds: 2.5, outputPath: frame, maxWidth: 320});
  assert.equal(probe(frame).width, 320);
  assert.equal(preview.kind, 'frame-preview');
  await assert.rejects(extractFramePreview({source: source(fx.video, fx.sha), timestampSeconds: 2.5, outputPath: frame}), codeOf('output_exists'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(suggestCandidateFrames({source: source(fx.video, fx.sha), signal: controller.signal}), codeOf('cancelled'));
});

// ------------------------------------------------------------ entradas típicas de celular (fixtures sintéticas)

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', ...args]);
/** RGB de um pixel da imagem decodificada pelo FFmpeg. */
const pixel = (file, x, y) => [...ff(['-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'])];
const near = (rgb, target, label) => assert.ok(rgb.every((value, index) => Math.abs(value - target[index]) <= 40), `${label}: ${rgb} ≠ ${target}`);
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const LIME = [0, 255, 0];

async function mobileFixtures() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'thumbs-mobile-'));
  const file = (name) => path.join(dir, name);
  // Quadro armazenado 640×360: metade de cima vermelha, de baixo azul, marcador verde no canto superior esquerdo.
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=2', '-vf', 'drawbox=x=0:y=180:w=640:h=180:color=blue:t=fill,drawbox=x=0:y=0:w=80:h=80:color=lime:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('base.mp4')]);
  for (const rotation of [90, 270]) ff(['-display_rotation:v:0', String(rotation), '-i', file('base.mp4'), '-c', 'copy', file(`rot${rotation}.mp4`)]);
  // Pixels não quadrados: 640×360 armazenado com SAR 4:3 (exibido 852×360); fronteira vermelho|azul na coluna 480.
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=2', '-vf', 'drawbox=x=480:y=0:w=160:h=360:color=blue:t=fill,setsar=4/3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('sar.mp4')]);
  // VFR real: 2 s a 30 fps (vermelho), 2 s a 5 fps (verde), 2 s a 24 fps (azul).
  ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=lime:s=320x240:r=5:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=24:d=2',
    '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-fps_mode', 'passthrough', '-c:v', 'libx264', file('vfr.mp4')]);
  const out = file('out');
  await (await import('node:fs/promises')).mkdir(out);
  return {dir, file, out};
}

const mobileTest = (name, fn) => test(name, {skip: (!hasFfmpeg && 'FFmpeg ausente') || (!font && 'sem fonte local'), timeout: 180_000}, async () => {
  const fx = await mobileFixtures();
  try { await fn(fx); } finally { await rm(fx.dir, {recursive: true, force: true}); }
});
const render = async (fx, name, format, overrides = {}, extra = {}) => {
  const file = fx.file(name);
  return renderThumbnailSet({source: source(file, await hashFile(file)), format, outputDirectory: fx.out, safeAreaPreview: false, concepts: concepts({
    product: {kicker: undefined, title: 'Teste', timestampSeconds: 0.5, framing: {focusX: 0.5, focusY: 0.5, zoom: 1}, ...overrides.product},
    person: {title: 'Teste', timestampSeconds: 0.5, ...overrides.person},
    benefit: {kicker: undefined, title: 'Teste', timestampSeconds: 0.5, ...overrides.benefit}}), ...extra});
};

mobileTest('rotação 90/270: ffprobe e frame decodificado concordam; orientação, foco e dimensões exatas seguem a autorrotação do FFmpeg', async (fx) => {
  // Referência: o próprio FFmpeg autorrotacionando o frame (90 → vermelho à esquerda; 270 → azul à esquerda e marcador no topo direito).
  const expected = {90: {left: RED, right: BLUE, topRight: BLUE, topLeftQuarter: RED}, 270: {left: BLUE, right: RED, topRight: LIME, topLeftQuarter: BLUE}};
  for (const rotation of [90, 270]) {
    const reference = fx.file(`ref${rotation}.png`);
    ff(['-i', fx.file(`rot${rotation}.mp4`), '-frames:v', '1', reference]);
    assert.deepEqual([probe(reference).width, probe(reference).height], [360, 640]);
    near(pixel(reference, 60, 300), expected[rotation].left, `ref ${rotation} esquerda`);
    near(pixel(reference, 340, 20), expected[rotation].topRight, `ref ${rotation} topo direito`);

    const manifest = await render(fx, `rot${rotation}.mp4`, 'instagram-reels-cover', {person: {framing: {focusX: 0, focusY: 0, zoom: 2}}});
    assert.deepEqual(manifest.source.display, {width: 360, height: 640, rotation: rotation === 90 ? 90 : -90, sampleAspectRatio: 1, consistentWithProbe: true});
    const [product, person, benefit] = manifest.items.map((item) => item.export.path);
    for (const file of [product, person, benefit]) assert.deepEqual([probe(file).width, probe(file).height], [1080, 1920]);
    near(pixel(product, 100, 600), expected[rotation].left, `produto ${rotation} esquerda`);
    near(pixel(product, 980, 600), expected[rotation].right, `produto ${rotation} direita`);
    near(pixel(product, 1040, 60), expected[rotation].topRight, `produto ${rotation} marcador`);
    // Foco (0,0) com zoom 2 mostra só o quadrante superior esquerdo do frame exibido.
    near(pixel(person, 540, 400), expected[rotation].topLeftQuarter, `pessoa ${rotation} foco`);
    near(pixel(benefit, 200, 1500), expected[rotation].left, `benefício ${rotation} esquerda`);
    near(pixel(benefit, 880, 1500), expected[rotation].right, `benefício ${rotation} direita`);
    assert.ok(manifest.items.every((item) => item.warnings.every((text) => !text.includes('diverge'))));
  }
});

mobileTest('pixels não quadrados (SAR 4:3) são normalizados antes do recorte: sem distorção horizontal', async (fx) => {
  const manifest = await render(fx, 'sar.mp4', 'youtube-thumbnail');
  assert.deepEqual(manifest.source.display, {width: 852, height: 360, rotation: 0, sampleAspectRatio: 1.3333, consistentWithProbe: true});
  const product = manifest.items[0];
  assert.equal(product.crop.w, 640);
  assert.equal(product.crop.h, 360);
  // Fronteira vermelho|azul: coluna 480 armazenada → 640 exibida → posição na capa conforme o recorte real.
  const boundary = Math.round((640 - product.crop.x) * (1280 / product.crop.w));
  assert.ok(Math.abs(boundary - 1066) <= 4, `fronteira em ${boundary}`);
  near(pixel(product.export.path, boundary - 40, 60), RED, 'antes da fronteira');
  near(pixel(product.export.path, boundary + 40, 60), BLUE, 'depois da fronteira');
  // Sem a normalização a fronteira cairia em 960 (armazenado esticado): o ponto 1026 seria azul.
  near(pixel(product.export.path, 1026, 60), RED, 'sem esticar');
  assert.deepEqual([probe(product.export.path).width, probe(product.export.path).height], [1280, 720]);
  const frame = fx.file('sar-frame.jpg');
  await extractFramePreview({source: source(fx.file('sar.mp4'), await hashFile(fx.file('sar.mp4'))), timestampSeconds: 0.5, outputPath: frame, maxWidth: 1920});
  assert.deepEqual([probe(frame).width, probe(frame).height], [852, 360]);
});

mobileTest('VFR: timestamp escolhe o frame certo de cada trecho, registra o pts exibido e recusa pontos sem frame ou não finitos', async (fx) => {
  const manifest = await render(fx, 'vfr.mp4', 'youtube-thumbnail', {product: {timestampSeconds: 1}, person: {timestampSeconds: 2.5}, benefit: {timestampSeconds: 5}});
  const [product, person, benefit] = manifest.items;
  near(pixel(product.export.path, 640, 60), RED, 'trecho 30 fps');
  near(pixel(person.export.path, 100, 360), LIME, 'trecho 5 fps');
  near(pixel(benefit.export.path, 1000, 360), BLUE, 'trecho 24 fps');
  assert.ok(Math.abs(person.frameTimestampSeconds - 2.5) <= 0.2, `pts ${person.frameTimestampSeconds}`);
  for (const item of manifest.items) assert.ok(Number.isFinite(item.frameTimestampSeconds));
  const duration = manifest.source.durationSeconds;
  await assert.rejects(render(fx, 'vfr.mp4', 'youtube-thumbnail', {benefit: {timestampSeconds: duration + 0.5}}), codeOf('invalid_concepts'));
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) await assert.rejects(render(fx, 'vfr.mp4', 'youtube-thumbnail', {benefit: {timestampSeconds: bad}}), codeOf('invalid_concepts'));
  assert.equal((await readdir(fx.out)).length, 1, 'falhas não deixam lote nem temporário');
});

const browser = await import('../editorial-remotion.mjs').then((module) => module.resolveBrowser()).catch(() => ({status: 'missing'}));
test('JPEG/PNG exportados decodificam no Chrome local (headless, file://, sem rede)', {skip: (!hasFfmpeg && 'FFmpeg ausente') || (!font && 'sem fonte local') || (browser.status !== 'ready' && 'navegador local ausente'), timeout: 180_000}, async () => {
  const fx = await mobileFixtures();
  try {
    const jpg = await render(fx, 'rot90.mp4', 'instagram-reels-cover');
    const png = await render(fx, 'sar.mp4', 'youtube-thumbnail', {}, {fileType: 'png'});
    const files = [...jpg.items, ...png.items].map((item) => item.export);
    const html = fx.file('decode.html');
    const urls = files.map((file) => new URL(`file:///${file.path.replace(/\\/g, '/')}`).href);
    // As imagens no HTML seguram o evento load: o dump-dom só sai depois que todas carregaram (ou falharam).
    await writeFile(html, `<!doctype html><meta charset="utf-8"><body>${urls.map((url) => `<img src="${url}">`).join('')}<script>
      addEventListener('load', () => { const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify([...document.images].map((img) => img.complete && img.naturalWidth ? img.naturalWidth + 'x' + img.naturalHeight : 'error')); document.body.append(pre); });
    </script>`);
    const dom = execFileSync(browser.path, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync',
      `--user-data-dir=${fx.file('profile')}`, '--virtual-time-budget=8000', '--dump-dom', new URL(`file:///${html.replace(/\\/g, '/')}`).href], {timeout: 60_000}).toString();
    const sizes = JSON.parse(/<pre id="result">([^<]*)<\/pre>/.exec(dom)?.[1] ?? 'null');
    assert.deepEqual(sizes, files.map((file) => `${file.width}x${file.height}`));
  } finally {
    await rm(fx.dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 300});
  }
});
