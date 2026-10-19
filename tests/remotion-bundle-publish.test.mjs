// Publicação atômica do bundle Remotion (scripts/build-remotion-video.mjs) com bundler FALSO: rápido, sem Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {BUNDLE_MANIFEST, bundleTreeSha256, isPathInside, pinRemotionBundle, resolveRemotionBundle} from '../editorial-remotion.mjs';
import {assertSafeBundleRoot, buildRemotionBundle, pruneRemotionBundles} from '../scripts/build-remotion-video.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
/** Bundler falso: escreve aos poucos (como o webpack) para expor leitores concorrentes a arquivos parciais. */
const fakeBundler = (label, {fail, gate, noIndex} = {}) => async ({outDir}) => {
  await mkdir(path.join(outDir, 'public'), {recursive: true});
  await writeFile(path.join(outDir, 'bundle.js'), `/* ${label} */`);
  await tick();
  if (gate) await gate;
  if (fail) throw new Error(fail);
  await writeFile(path.join(outDir, 'public', 'img.svg'), `<svg>${label}</svg>`);
  if (!noIndex) await writeFile(path.join(outDir, 'index.html'), `<html>${label}</html>`);
};
const withRoot = async (fn) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remotion-bundle-publish-'));
  try { await fn(root); } finally { await rm(root, {recursive: true, force: true}); }
};
const readAll = async (dir) => Promise.all(['index.html', 'bundle.js', 'public/img.svg'].map((rel) => readFile(path.join(dir, rel), 'utf8')));

test('build publica versão imutável + ponteiro; hash do manifesto é o hash real do conteúdo', () => withRoot(async (root) => {
  const dir = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')});
  const found = resolveRemotionBundle(root);
  assert.equal(found.layout, 'versioned');
  assert.equal(found.dir, dir);
  const manifest = JSON.parse(readFileSync(path.join(dir, BUNDLE_MANIFEST), 'utf8'));
  assert.equal(manifest.sha256, await bundleTreeSha256(dir));
  assert.equal(found.sha256, manifest.sha256);
  assert.equal(path.basename(dir), manifest.sha256.slice(0, 16));
  assert.deepEqual(await readdir(path.join(root, '.staging')), [], 'staging limpa');
  // Mesmo conteúdo = mesma versão (reaproveitada, nunca sobrescrita).
  assert.equal(await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')}), dir);
  const pinned = await pinRemotionBundle(root);
  assert.equal(pinned.sha256, manifest.sha256);
  await pinned.release();
}));

test('rebuild concorrente: render fixado continua lendo a MESMA versão completa até o fim; ponteiro troca só no fim', () => withRoot(async (root) => {
  const v1 = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')});
  const pinned = await pinRemotionBundle(root);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rebuild = buildRemotionBundle({outDir: root, bundler: fakeBundler('v2', {gate}), keep: 1});
  // Durante o bundle novo (parcial na staging), o leitor vê só v1 inteiro e o ponteiro ainda aponta v1.
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await readAll(pinned.dir), ['<html>v1</html>', '/* v1 */', '<svg>v1</svg>']);
    assert.equal(resolveRemotionBundle(root).dir, v1);
    await tick();
  }
  release();
  const v2 = await rebuild;
  assert.notEqual(v2, v1);
  assert.equal(resolveRemotionBundle(root).dir, v2);
  // keep=1, mas a lease do render protege v1: nada sumiu debaixo dele.
  assert.deepEqual(await readAll(pinned.dir), ['<html>v1</html>', '/* v1 */', '<svg>v1</svg>']);
  const next = await pinRemotionBundle(root);
  assert.deepEqual(await readAll(next.dir), ['<html>v2</html>', '/* v2 */', '<svg>v2</svg>']);
  await next.release();
  await pinned.release();
  // Sem lease, o prune agora pode remover v1.
  const pruned = await pruneRemotionBundles({outDir: root, keep: 1});
  assert.deepEqual(pruned.removed, [`versions/${path.basename(v1)}`]);
  assert.equal(existsSync(v2), true);
}));

test('falha no build (erro ou sem index.html) preserva ponteiro e bundle anterior; staging removida', () => withRoot(async (root) => {
  const v1 = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')});
  const pointer = readFileSync(path.join(root, 'current.json'), 'utf8');
  await assert.rejects(buildRemotionBundle({outDir: root, bundler: fakeBundler('v2', {fail: 'webpack quebrou'})}), /webpack quebrou/);
  await assert.rejects(buildRemotionBundle({outDir: root, bundler: fakeBundler('v3', {noIndex: true})}), /sem index.html/);
  assert.equal(readFileSync(path.join(root, 'current.json'), 'utf8'), pointer);
  assert.deepEqual(await readAll(v1), ['<html>v1</html>', '/* v1 */', '<svg>v1</svg>']);
  assert.deepEqual(await readdir(path.join(root, 'versions')), [path.basename(v1)]);
  assert.deepEqual(await readdir(path.join(root, '.staging')), []);
}));

test('versão adulterada após publicar não é usada (hash real != manifesto)', () => withRoot(async (root) => {
  const dir = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')});
  await writeFile(path.join(dir, 'bundle.js'), '/* trocado */');
  await assert.rejects(pinRemotionBundle(root), (error) => error.code === 'bundle_missing' && /não confere/.test(error.message));
  assert.deepEqual(await readdir(path.join(root, '.leases')), [], 'lease liberada na falha');
}));

test('prune: mantém atual + keep, respeita lease; --release remove só o layout plano legado conhecido', () => withRoot(async (root) => {
  // Layout plano legado + arquivo alheio na raiz.
  await writeFile(path.join(root, 'index.html'), 'legado');
  await writeFile(path.join(root, 'bundle.js'), 'legado');
  await writeFile(path.join(root, '12.bundle.js.map'), 'legado');
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'notas.txt'), 'do usuário');
  assert.equal(resolveRemotionBundle(root).layout, 'flat');
  const v1 = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v1')});
  const v2 = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v2')});
  const v3 = await buildRemotionBundle({outDir: root, bundler: fakeBundler('v3')}); // keep=2 padrão: v1 sai
  assert.equal(existsSync(v1), false);
  assert.equal(existsSync(v2) && existsSync(v3), true);
  assert.equal(existsSync(path.join(root, 'index.html')), true, 'legado intacto sem --release');
  const pinned = await pinRemotionBundle(root);
  const result = await pruneRemotionBundles({outDir: root, keep: 1, pruneLegacy: true});
  assert.deepEqual(result.removed.sort(), ['12.bundle.js.map', 'bundle.js', 'index.html', 'public', `versions/${path.basename(v2)}`].sort());
  assert.equal(existsSync(path.join(root, 'notas.txt')), true, 'arquivo alheio nunca é removido');
  assert.equal(existsSync(v3), true);
  await pinned.release();
}));

test('raiz insegura é recusada antes de criar/remover qualquer coisa', () => {
  assert.throws(() => assertSafeBundleRoot('relativo/dist'), /absoluto/);
  assert.throws(() => assertSafeBundleRoot(path.parse(process.cwd()).root), /inseguro/);
  assert.throws(() => assertSafeBundleRoot(os.homedir()), /inseguro|fora/);
  assert.throws(() => assertSafeBundleRoot(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')), /fora/);
  assert.equal(isPathInside('/a/b', '/a/b'), false);
  assert.equal(isPathInside('/a/b', '/a/b/../c'), false);
  assert.equal(isPathInside('/a/b', '/a/b/c'), true);
});

test('ponteiro inválido/forjado não aponta para fora da raiz', () => withRoot(async (root) => {
  await writeFile(path.join(root, 'current.json'), JSON.stringify({schema: 'mainsagents.remotion-bundle/1', version: '../../x', sha256: 'a'.repeat(64)}));
  assert.equal(resolveRemotionBundle(root).ready, false);
  await writeFile(path.join(root, 'current.json'), '{');
  assert.equal(resolveRemotionBundle(root).ready, false);
}));
