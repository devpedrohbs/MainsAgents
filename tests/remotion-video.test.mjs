import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, readdirSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkFfmpeg, createMediaServer, getRemotionCapabilities, renderAnimatedVideo, resolveAnimations, resolveBrowser, RemotionError, validateMetadata
} from '../editorial-remotion.mjs';
import {assertSmoke, hasFfmpeg, makeSyntheticVideo, runSmoke, sha256, SMOKE, SMOKE_ANIMATIONS} from '../scripts/test-remotion-video.mjs';

const metadata = {width: 320, height: 180, fps: 15, durationSeconds: 6, hasAudio: true};
const codeOf = (code) => (error) => error instanceof RemotionError && error.code === code;

function request(port, {pathname, headers = {}, method = 'GET', host}) {
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port, path: pathname, method, headers: {...(host ? {Host: host} : {}), ...headers}}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    req.end();
  });
}

test('resolveAnimations produz linha do tempo determinística alinhada ao frame e limitada à duração', () => {
  const resolved = resolveAnimations({title: {text: '  Olá   mundo '}, lowerThird: {name: 'Ana', role: 'Dev'}, cta: {text: 'Siga'}}, metadata);
  assert.deepEqual(resolved, resolveAnimations({title: {text: 'Olá mundo'}, lowerThird: {name: 'Ana', role: 'Dev'}, cta: {text: 'Siga'}}, metadata));
  assert.equal(resolved.title.text, 'Olá mundo');
  assert.deepEqual([resolved.title.from, resolved.title.to], [0.333, 3.333]);
  assert.deepEqual([resolved.lowerThird.from, resolved.lowerThird.to], [1.2, 5.2]);
  assert.deepEqual([resolved.cta.from, resolved.cta.to], [3, 6]);
  assert.equal(resolved.theme, 'dark');
  // vídeo curto: janelas nunca passam da duração
  const short = resolveAnimations({title: {text: 'a', durationSeconds: 10}, cta: {text: 'b', durationSeconds: 10}}, {...metadata, durationSeconds: 1});
  for (const window of [short.title, short.cta]) assert.ok(window.from >= 0 && window.to <= 1 + 1e-9 && window.to > window.from);
});

test('resolveAnimations rejeita campos desconhecidos, HTML/JS implícito, controle, tamanho e cores inválidas', () => {
  const bad = (spec, fragment) => assert.throws(() => resolveAnimations(spec, metadata), (error) => error.code === 'invalid_animations' && (!fragment || error.message.includes(fragment)));
  bad({}, 'ao menos');
  bad({title: {text: 'x', html: '<b>'}}, 'html');
  bad({title: {text: 'x'}, script: 'alert(1)'}, 'script');
  bad({title: {text: 'x'.repeat(81)}}, '80');
  bad({title: {text: 'a\u0000b'}}, 'controle');
  bad({title: {text: 'a‮b'}}, 'controle');
  bad({title: {text: 42}}, 'texto');
  bad({title: {text: 'x'}, accent: 'red'}, 'accent');
  bad({title: {text: 'x'}, theme: 'neon'}, 'theme');
  bad({title: {text: 'x', startSeconds: -1}}, 'startSeconds');
  bad({lowerThird: {role: 'só cargo'}}, 'name');
  assert.throws(() => validateMetadata({...metadata, width: 0}), codeOf('invalid_metadata'));
  assert.throws(() => validateMetadata({...metadata, hasAudio: 'sim'}), codeOf('invalid_metadata'));
});

test('texto é tratado como texto simples: marcações permanecem literais (React escapa na composição)', () => {
  const resolved = resolveAnimations({title: {text: '<img src=x onerror=alert(1)> & "aspas"'}}, metadata);
  assert.equal(resolved.title.text, '<img src=x onerror=alert(1)> & "aspas"');
});

test('servidor de mídia loopback: token, allowlist, ranges, sem traversal e Host validado', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-media-test-'));
  const allowed = path.join(dir, 'allowed.mp4');
  const secret = path.join(dir, 'secret.txt');
  const payload = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  await writeFile(allowed, payload);
  await writeFile(secret, 'segredo');
  const server = await createMediaServer({video: allowed});
  try {
    const url = new URL(server.url('video'));
    assert.equal(url.hostname, '127.0.0.1');
    const full = await request(server.port, {pathname: url.pathname});
    assert.equal(full.status, 200);
    assert.deepEqual(full.body, payload);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['content-type'], 'video/mp4');
    const partial = await request(server.port, {pathname: url.pathname, headers: {Range: 'bytes=5-9'}});
    assert.equal(partial.status, 206);
    assert.equal(partial.body.toString(), '56789');
    assert.equal(partial.headers['content-range'], `bytes 5-9/${payload.length}`);
    assert.equal((await request(server.port, {pathname: url.pathname, headers: {Range: 'bytes=30-'}})).body.toString(), 'uvwxyz');
    assert.equal((await request(server.port, {pathname: url.pathname, headers: {Range: 'bytes=-4'}})).body.toString(), 'wxyz');
    assert.equal((await request(server.port, {pathname: url.pathname, headers: {Range: 'bytes=99-120'}})).status, 416);
    assert.equal((await request(server.port, {pathname: url.pathname, headers: {Range: 'bytes=9-2'}})).status, 416);
    assert.equal((await request(server.port, {pathname: url.pathname, method: 'HEAD'})).body.length, 0);
    assert.equal((await request(server.port, {pathname: url.pathname, method: 'POST'})).status, 405);
    // token errado, caminhos arbitrários e traversal nunca chegam ao disco
    const token = url.pathname.split('/').pop();
    for (const pathname of ['/media/' + 'A'.repeat(32), '/media/', '/', '/secret.txt', `/media/${token}/x`, `/media/..%2f${path.basename(secret)}`,
      `/media/${encodeURIComponent(secret)}`, `/media/../${path.basename(secret)}`, `/media/%2e%2e/${path.basename(secret)}`, `/${allowed}`]) {
      const response = await request(server.port, {pathname});
      assert.equal(response.status, 404, pathname);
      assert.ok(!response.body.toString().includes('segredo'));
    }
    // Host forjado (DNS rebinding) é recusado
    assert.equal((await request(server.port, {pathname: url.pathname, host: 'evil.example'})).status, 403);
    // arquivo alterado após a verificação deixa de ser servido
    await writeFile(allowed, Buffer.from('trocado!'));
    assert.equal((await request(server.port, {pathname: url.pathname})).status, 409);
  } finally {
    await server.close();
    await rm(dir, {recursive: true, force: true});
  }
  await assert.rejects(() => request(server.port, {pathname: '/'}), /ECONNREFUSED/);
});

test('createMediaServer recusa diretórios e arquivos inexistentes', async () => {
  await assert.rejects(() => createMediaServer({video: os.tmpdir()}), codeOf('invalid_input'));
  await assert.rejects(() => createMediaServer({video: path.join(os.tmpdir(), 'nao-existe-remotion.mp4')}));
});

test('renderAnimatedVideo valida entradas antes de abrir navegador ou servidor', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-validate-test-'));
  try {
    const input = path.join(dir, 'in.mp4');
    const output = path.join(dir, 'out.mp4');
    await writeFile(input, 'não é vídeo');
    const base = {inputPath: input, outputPath: output, metadata, animations: {title: {text: 'x'}}};
    await assert.rejects(() => renderAnimatedVideo({...base, inputPath: 'relativo.mp4'}), codeOf('invalid_input'));
    await assert.rejects(() => renderAnimatedVideo({...base, inputPath: 'https://exemplo.com/v.mp4'}), codeOf('invalid_input'));
    await assert.rejects(() => renderAnimatedVideo({...base, inputPath: path.join(dir, 'in.exe')}), codeOf('invalid_input'));
    await assert.rejects(() => renderAnimatedVideo({...base, outputPath: path.join(dir, 'out.mov')}), codeOf('invalid_output'));
    await assert.rejects(() => renderAnimatedVideo({...base, outputPath: input}), codeOf('invalid_output'));
    await assert.rejects(() => renderAnimatedVideo({...base, animations: {title: {text: 'x'}, extra: 1}}), codeOf('invalid_animations'));
    await assert.rejects(() => renderAnimatedVideo({...base, metadata: {...metadata, fps: 0}}), codeOf('invalid_metadata'));
    await assert.rejects(() => renderAnimatedVideo({...base, inputPath: path.join(dir, 'ausente.mp4')}), codeOf('invalid_input'));
    await writeFile(output, 'já existe');
    await assert.rejects(() => renderAnimatedVideo(base), codeOf('output_exists'));
    await rm(output);
    await assert.rejects(() => renderAnimatedVideo({...base, bundleDir: path.join(dir, 'sem-bundle')}), codeOf('bundle_missing'));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => renderAnimatedVideo({...base, signal: controller.signal}), codeOf('cancelled'));
    assert.deepEqual(readdirSync(dir).sort(), ['in.mp4']);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('capacidades diagnosticam bundle, navegador e licença sem baixar nada', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-caps-test-'));
  try {
    const caps = await getRemotionCapabilities({bundleDir: dir, browserExecutable: path.join(dir, 'chrome-inexistente.exe')});
    assert.equal(caps.available, false);
    assert.equal(caps.bundle.ready, false);
    assert.equal(caps.browser.status, 'missing');
    assert.ok(caps.reasons.some((reason) => reason.includes('Bundle')));
    assert.ok(caps.reasons.some((reason) => reason.includes('browserExecutable')));
    assert.equal(caps.license.requiresReview, true);
    assert.match(caps.license.url, /remotion-dev\/remotion/);
    assert.deepEqual(caps.template.overlays, ['title', 'lowerThird', 'cta', 'motion']);
    assert.equal(caps.versions.remotion, '4.0.534');
    assert.equal(caps.versions['@remotion/renderer'], '4.0.534');
    assert.equal(resolveBrowser({browserExecutable: path.join(dir, 'x.exe')}).status, 'missing');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('FFmpeg ausente ou inválido: capacidades indisponíveis e render falha antes de criar saída', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-ffmpeg-test-'));
  try {
    const missing = path.join(dir, 'ffmpeg-inexistente.exe');
    const invalid = path.join(dir, 'nao-e-ffmpeg.exe');
    await writeFile(invalid, 'lixo');
    for (const ffmpegPath of [missing, invalid]) {
      const status = await checkFfmpeg({ffmpegPath});
      assert.equal(status.ready, false);
      assert.equal(status.source, 'explicit');
      assert.match(status.reason, /ffmpegPath/);
      const caps = await getRemotionCapabilities({ffmpegPath});
      assert.equal(caps.available, false);
      assert.equal(caps.ffmpeg.ready, false);
      assert.ok(caps.reasons.some((reason) => reason.includes('ffmpegPath')));
      assert.ok(caps.ffprobe && caps.license && caps.bundle && caps.browser, 'demais campos preservados');
    }
    const input = path.join(dir, 'in.mp4');
    const outDir = path.join(dir, 'out');
    await writeFile(input, 'x');
    // render com áudio falha cedo (ffprobe/ffmpeg inválidos não chegam a criar saída)
    await assert.rejects(() => renderAnimatedVideo({inputPath: input, outputPath: path.join(outDir, 'o.mp4'), metadata, animations: {title: {text: 'x'}}, ffmpegPath: missing, ffprobePath: missing}), (error) => error instanceof RemotionError);
    assert.equal(existsSync(outDir), false);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

// ---- render REAL (Chromium local + FFmpeg). Pula com aviso se dependência faltar, salvo REMOTION_SMOKE=required.
const required = process.env.REMOTION_SMOKE === 'required';
const ffmpegReady = await hasFfmpeg();
const capabilities = await getRemotionCapabilities();
const realSkip = !ffmpegReady ? 'ffmpeg ausente no PATH' : (!capabilities.browser || capabilities.browser.status !== 'ready' ? 'navegador local ausente' : false);
if (required && realSkip) throw new Error(`REMOTION_SMOKE=required, mas: ${realSkip}`);

const sourceCases = [
  {name: 'stereo AAC', source: {channels: 2, audio: 'aac'}, mode: 'copy', channels: 2},
  {name: 'mono AAC', source: {channels: 1, audio: 'aac'}, mode: 'copy', channels: 1},
  {name: 'MP3 (re-encode limitado a AAC)', source: {channels: 2, audio: 'mp3'}, mode: 'encode', channels: 2},
  {name: 'sem áudio', source: {audio: 'none'}, mode: 'none', channels: undefined}
];
for (const item of sourceCases) {
  test(`render real (${item.name}): overlays, áudio original preservado, origem intacta`, {skip: realSkip, timeout: 240000}, async () => {
    const metrics = await runSmoke({source: item.source});
    assertSmoke(metrics);
    assert.equal(metrics.result.audio.mode, item.mode);
    assert.equal(metrics.result.audio.channels, item.channels);
    assert.equal(metrics.result.hasAudio, item.mode !== 'none');
    assert.equal(metrics.sourceIntact, true);
    assert.equal(metrics.result.width, SMOKE.width);
    assert.ok(metrics.progress.includes('render') && metrics.progress.includes('verify'));
    assert.deepEqual(metrics.result.animations.cta, {text: SMOKE_ANIMATIONS.cta.text, from: 4, to: 6});
  });
}

test('render real: ffmpeg inválido com fonte com áudio falha antes de criar saída', {skip: realSkip, timeout: 120000}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-ffmpeg-real-'));
  try {
    const input = path.join(dir, 'in.mp4');
    await makeSyntheticVideo(input);
    const outDir = path.join(dir, 'out');
    await assert.rejects(() => renderAnimatedVideo({inputPath: input, outputPath: path.join(outDir, 'o.mp4'), metadata, animations: {cta: {text: 'x'}}, ffmpegPath: path.join(dir, 'nao-existe.exe')}), codeOf('dependency_missing'));
    assert.equal(existsSync(outDir), false);
    const caps = await getRemotionCapabilities();
    assert.equal(caps.ffmpeg.ready, true);
    assert.equal(caps.ffmpeg.source, 'path');
    assert.equal(caps.ffmpeg.path, 'PATH');
    assert.match(caps.ffmpeg.version, /^[0-9]/);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('render real: cancelar antes do remux de áudio não deixa saída nem temporários e preserva a origem', {skip: realSkip, timeout: 240000}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-remux-cancel-'));
  try {
    const input = path.join(dir, 'in.mp4');
    await makeSyntheticVideo(input);
    const before = await sha256(input);
    const outDir = path.join(dir, 'out');
    const controller = new AbortController();
    await assert.rejects(() => renderAnimatedVideo({
      inputPath: input, outputPath: path.join(outDir, 'c.mp4'), metadata, animations: {cta: {text: 'x'}}, signal: controller.signal,
      // 'verify' progress 0 é emitido imediatamente antes do remux
      onProgress: ({phase, progress}) => { if (phase === 'verify' && progress === 0) controller.abort(); }
    }), codeOf('cancelled'));
    assert.deepEqual(readdirSync(outDir), []);
    assert.equal(await sha256(input), before);
    // origem alterada durante o render: nada é entregue
    const other = path.join(dir, 'other.mp4');
    await makeSyntheticVideo(other);
    await assert.rejects(() => renderAnimatedVideo({
      inputPath: other, outputPath: path.join(outDir, 'd.mp4'), metadata, animations: {cta: {text: 'x'}},
      onProgress: ({phase, progress}) => { if (phase === 'verify' && progress === 0) appendFileSync(other, Buffer.from([0])); }
    }), codeOf('input_changed'));
    assert.deepEqual(readdirSync(outDir), []);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test('render real: metadata divergente e cancelamento não deixam saída nem temporários; render não abre rede', {skip: realSkip, timeout: 240000}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'remotion-cancel-test-'));
  try {
    const input = path.join(dir, 'in.mp4');
    await makeSyntheticVideo(input);
    const outDir = path.join(dir, 'out');
    const animations = {title: {text: 'Cancelar'}};
    await assert.rejects(() => renderAnimatedVideo({inputPath: input, outputPath: path.join(outDir, 'a.mp4'), metadata: {...metadata, width: 640}, animations}), codeOf('metadata_mismatch'));
    await assert.rejects(() => renderAnimatedVideo({inputPath: input, outputPath: path.join(outDir, 'a.mp4'), metadata: {...metadata, hasAudio: false}, animations}), codeOf('metadata_mismatch'));

    const controller = new AbortController();
    let listeners = null;
    const outcome = renderAnimatedVideo({
      inputPath: input, outputPath: path.join(outDir, 'b.mp4'), metadata, animations, signal: controller.signal,
      onProgress: ({phase, progress}) => {
        if (phase !== 'render' || progress <= 0 || controller.signal.aborted) return;
        if (process.platform === 'win32' && !listeners) {
          const lines = execFileSync('netstat', ['-ano', '-p', 'tcp'], {encoding: 'utf8'}).split(/\r?\n/);
          listeners = lines.filter((line) => /LISTENING/.test(line) && line.trim().endsWith(String(process.pid)));
        }
        controller.abort();
      }
    });
    await assert.rejects(() => outcome, codeOf('cancelled'));
    if (process.platform === 'win32') assert.ok(listeners, 'netstat não foi consultado durante o render');
    if (listeners) {
      assert.ok(listeners.length > 0, 'esperava servidor do Remotion escutando durante o render');
      for (const line of listeners) assert.match(line, /\s127\.0\.0\.1:\d+\s/, `escuta fora do loopback: ${line}`);
    }
    assert.equal(existsSync(path.join(outDir, 'b.mp4')), false);
    assert.deepEqual(readdirSync(outDir), [], 'nenhum temporário deixado');
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
