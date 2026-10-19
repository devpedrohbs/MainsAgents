// Gera o bundle PRÉ-COMPILADO da composição local (remotion-video/**) em dist/remotion.
// Nunca empacota projeto arbitrário do usuário: o entry point é fixo.
//
// Publicação atômica (render em andamento nunca perde arquivo):
//   1. bundle em <raiz>/.staging/<id>/ (pasta nova, dentro da raiz);
//   2. hash REAL do conteúdo -> versão <sha16>; manifesto bundle-manifest.json na própria versão;
//   3. rename da staging para <raiz>/versions/<sha16>/ (imutável; se já existe com o mesmo hash, é reaproveitada);
//   4. troca do ponteiro <raiz>/current.json por rename de arquivo temporário.
// Falha em qualquer passo só remove a própria staging: ponteiro e versões anteriores ficam intactos.
// O prune remove só versões antigas (fora das `keep` mais novas) sem lease de render ativa; o layout plano
// legado (index.html/bundle.js na raiz) só sai com --release. Todo delete confere caminho resolvido dentro da raiz.
import {bundle} from '@remotion/bundler';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {lstat, mkdir, readdir, rename, rm, stat, unlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BUNDLE_LEASE_TTL_MS, BUNDLE_MANIFEST, BUNDLE_POINTER, BUNDLE_SCHEMA, BUNDLE_VERSION_PATTERN, REMOTION_VERSION, bundleTreeSha256, isPathInside, resolveRemotionBundle} from '../editorial-remotion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const remotionBundleDir = path.join(root, 'dist', 'remotion');
/** Entradas do layout plano legado na raiz (pré-versionamento). */
const LEGACY_ENTRY = /^(index\.html|favicon\.ico|public|(\d+\.)?bundle\.js(\.map)?)$/;
const STALE_STAGING_MS = 6 * 60 * 60 * 1000;

/** Raiz aceita: dentro do workspace (nunca o próprio workspace) ou dentro do temp do SO; nunca raiz de disco/home. */
export function assertSafeBundleRoot(outDir) {
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) throw new Error('outDir do bundle deve ser caminho absoluto.');
  const resolved = path.resolve(outDir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) throw new Error(`outDir do bundle inseguro: ${resolved}`);
  if (!isPathInside(root, resolved) && !isPathInside(path.resolve(os.tmpdir()), resolved)) throw new Error(`outDir do bundle fora do workspace/temp: ${resolved}`);
  return resolved;
}

/** Remove `target` só se o caminho resolvido estiver estritamente dentro de `parent` e não for link. */
async function removeInside(parent, target) {
  const resolved = path.resolve(target);
  if (!isPathInside(parent, resolved)) throw new Error(`remoção recusada fora de ${parent}: ${resolved}`);
  const info = await lstat(resolved).catch(() => null);
  if (!info) return false;
  if (info.isSymbolicLink()) throw new Error(`remoção recusada (link): ${resolved}`);
  await rm(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  return true;
}

/** rename com retentativas (Windows: antivírus/indexador seguram handles por instantes -> EPERM/EBUSY/EACCES). */
async function renameRetry(from, to, attempts = 8) {
  for (let i = 0; ; i++) {
    try { return await rename(from, to); } catch (error) {
      if (i >= attempts - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
}

async function writePointer(rootDir, manifest) {
  const pointer = path.join(rootDir, BUNDLE_POINTER);
  const temp = path.join(rootDir, `.${BUNDLE_POINTER}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(temp, `${JSON.stringify({schema: BUNDLE_SCHEMA, version: manifest.version, sha256: manifest.sha256, publishedAt: new Date().toISOString()}, null, 2)}\n`, {flag: 'wx'});
  try { await renameRetry(temp, pointer); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

const leaseIsFresh = (info, now) => now - info.mtimeMs < BUNDLE_LEASE_TTL_MS;

/** Leases frescas por chave ('<sha16>' ou 'flat'); leases vencidas (processo morto) são apagadas. */
async function liveLeases(rootDir, now) {
  const dir = path.join(rootDir, '.leases');
  const live = new Set();
  for (const name of await readdir(dir).catch(() => [])) {
    const file = path.join(dir, name);
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || !name.endsWith('.lease')) continue;
    if (leaseIsFresh(info, now)) live.add(name.split('.')[0]);
    else await unlink(file).catch(() => {});
  }
  return live;
}

/**
 * Prune seguro: mantém a versão atual + as `keep - 1` mais novas; nunca remove versão com lease fresca.
 * Retorna {removed, kept, skipped} (nomes relativos à raiz). Erros de remoção não derrubam o build.
 */
export async function pruneRemotionBundles({outDir = remotionBundleDir, keep = 2, pruneLegacy = false, now = Date.now()} = {}) {
  const rootDir = assertSafeBundleRoot(outDir);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('keep >= 1.');
  const current = resolveRemotionBundle(rootDir);
  const live = await liveLeases(rootDir, now);
  const versionsDir = path.join(rootDir, 'versions');
  const result = {removed: [], kept: [], skipped: []};
  const versions = [];
  for (const name of await readdir(versionsDir).catch(() => [])) {
    if (!BUNDLE_VERSION_PATTERN.test(name)) continue;
    const dir = path.join(versionsDir, name);
    let builtAt = 0;
    try { builtAt = Date.parse(JSON.parse(readFileSync(path.join(dir, BUNDLE_MANIFEST), 'utf8')).builtAt) || 0; } catch { builtAt = (await stat(dir).catch(() => ({mtimeMs: 0}))).mtimeMs; }
    versions.push({name, dir, builtAt});
  }
  versions.sort((a, b) => b.builtAt - a.builtAt);
  const keepSet = new Set(current.layout === 'versioned' ? [current.version] : []);
  for (const item of versions) if (keepSet.size < keep) keepSet.add(item.name);
  for (const item of versions) {
    const rel = `versions/${item.name}`;
    if (keepSet.has(item.name)) { result.kept.push(rel); continue; }
    if (live.has(item.name)) { result.skipped.push(`${rel} (lease ativa)`); continue; }
    try { if (await removeInside(versionsDir, item.dir)) result.removed.push(rel); } catch (error) { result.skipped.push(`${rel} (${error?.code ?? error?.message})`); }
  }
  // Staging órfã de build que caiu (velha o bastante para não ser de um build concorrente).
  const stagingDir = path.join(rootDir, '.staging');
  for (const name of await readdir(stagingDir).catch(() => [])) {
    const dir = path.join(stagingDir, name);
    const info = await lstat(dir).catch(() => null);
    if (info && now - info.mtimeMs > STALE_STAGING_MS) await removeInside(stagingDir, dir).then(() => result.removed.push(`.staging/${name}`), () => result.skipped.push(`.staging/${name}`));
  }
  if (pruneLegacy && current.layout === 'versioned') {
    if (live.has('flat')) result.skipped.push('legado (lease ativa)');
    else for (const name of await readdir(rootDir).catch(() => [])) {
      if (!LEGACY_ENTRY.test(name)) continue;
      try { if (await removeInside(rootDir, path.join(rootDir, name))) result.removed.push(name); } catch (error) { result.skipped.push(`${name} (${error?.code ?? error?.message})`); }
    }
  }
  return result;
}

/**
 * Gera e publica atomicamente uma nova versão. Devolve a pasta da versão (com index.html), que também serve
 * direto como bundleDir. `bundler` existe para testes (mesma assinatura de @remotion/bundler `bundle`).
 */
export async function buildRemotionBundle({outDir = remotionBundleDir, onProgress, bundler = bundle, keep = 2, pruneLegacy = false, log = () => {}} = {}) {
  const rootDir = assertSafeBundleRoot(outDir);
  const entryPoint = path.join(root, 'remotion-video', 'index.ts');
  if (!existsSync(entryPoint)) throw new Error('remotion-video/index.ts ausente.');
  const stagingParent = path.join(rootDir, '.staging');
  const staging = path.join(stagingParent, `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`);
  if (!isPathInside(stagingParent, staging)) throw new Error('staging fora da raiz do bundle.');
  await mkdir(staging, {recursive: true});
  let target;
  try {
    await bundler({entryPoint, outDir: staging, onProgress, enableCaching: false});
    if (!existsSync(path.join(staging, 'index.html'))) throw new Error('Bundle Remotion sem index.html.');
    const sha256 = await bundleTreeSha256(staging);
    const manifest = {schema: BUNDLE_SCHEMA, sha256, version: sha256.slice(0, 16), composition: 'remotion-video/index.ts', remotion: REMOTION_VERSION, builtAt: new Date().toISOString()};
    const versionsDir = path.join(rootDir, 'versions');
    target = path.join(versionsDir, manifest.version);
    if (!isPathInside(rootDir, target)) throw new Error('versão fora da raiz do bundle.');
    await mkdir(versionsDir, {recursive: true});
    if (existsSync(target)) {
      // Mesmo conteúdo já publicado: reaproveita (nunca sobrescreve uma versão que pode estar em uso).
      if (await bundleTreeSha256(target) !== sha256) throw new Error(`versions/${manifest.version} existe com conteúdo diferente; não sobrescrevo.`);
      await removeInside(stagingParent, staging);
      log(`versão ${manifest.version} já publicada; reaproveitada`);
    } else {
      await writeFile(path.join(staging, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx'});
      await renameRetry(staging, target);
    }
    const published = JSON.parse(readFileSync(path.join(target, BUNDLE_MANIFEST), 'utf8'));
    if (published.sha256 !== sha256) throw new Error('manifesto da versão publicada não confere.');
    await writePointer(rootDir, published);
  } catch (error) {
    await removeInside(stagingParent, staging).catch(() => {});
    throw error;
  }
  const pruned = await pruneRemotionBundles({outDir: rootDir, keep, pruneLegacy}).catch((error) => ({removed: [], kept: [], skipped: [`prune: ${error?.message ?? error}`]}));
  if (pruned.removed.length || pruned.skipped.length) log(`prune: removidas ${pruned.removed.join(', ') || '-'}; mantidas ${pruned.skipped.join(', ') || '-'}`);
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Uso: node scripts/build-remotion-video.mjs [raiz] [--release]
  //   --release: antes de empacotar, mantém só a versão atual e remove o layout plano legado (respeita leases).
  const args = process.argv.slice(2);
  const release = args.includes('--release');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const out = positional[0] ? path.resolve(positional[0]) : remotionBundleDir;
  buildRemotionBundle({outDir: out, keep: release ? 1 : 2, pruneLegacy: release, log: (line) => console.log(line)}).then(
    (dir) => console.log(`Bundle Remotion publicado em ${dir} (ponteiro ${path.join(out, BUNDLE_POINTER)})`),
    (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); }
  );
}
