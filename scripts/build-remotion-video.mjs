// Gera o bundle PRÉ-COMPILADO da composição local (remotion-video/**) em dist/remotion.
// Nunca empacota projeto arbitrário do usuário: o entry point é fixo.
import {bundle} from '@remotion/bundler';
import {existsSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const remotionBundleDir = path.join(root, 'dist', 'remotion');

export async function buildRemotionBundle({outDir = remotionBundleDir, onProgress} = {}) {
  const entryPoint = path.join(root, 'remotion-video', 'index.ts');
  if (!existsSync(entryPoint)) throw new Error('remotion-video/index.ts ausente.');
  rmSync(outDir, {recursive: true, force: true});
  await bundle({entryPoint, outDir, onProgress, enableCaching: false});
  if (!existsSync(path.join(outDir, 'index.html'))) throw new Error('Bundle Remotion sem index.html.');
  return outDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : remotionBundleDir;
  buildRemotionBundle({outDir: out}).then(
    (dir) => console.log(`Bundle Remotion gerado em ${dir}`),
    (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); }
  );
}
