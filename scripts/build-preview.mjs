import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Keep the Design Files entry point self-contained. The desktop build continues
// to use dist/app.html; the preview runs the exact same compiled application.
const output = await readFile('dist/app.html', 'utf8');
const script = output.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
const stylesheet = output.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
if (!script || !stylesheet) throw new Error('Missing compiled app assets');
const [js, css] = await Promise.all([
  readFile(path.join('dist', script[1]), 'utf8'),
  readFile(path.join('dist', stylesheet[1]), 'utf8'),
]);
// The bundle has no imports: a classic script at the end of the body also works
// in HTML preview hosts that don't execute module scripts. Keep it scoped so
// host-injected scripts cannot collide with minified top-level declarations.
if (/\bimport\.meta\b|\bexport\s*\{|\bimport\s*\(/.test(js)) {
  throw new Error('Preview requires a self-contained bundle without module dependencies');
}
const boot = `<script>(function(){\n${js.replace(/<\/script/gi, '<\\/script')}\n})();</script>`;
const html = output
  .replace(script[0], '')
  .replace(stylesheet[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace('</body>', () => `${boot}\n</body>`);
await writeFile('index.html', html);
console.log('Self-contained workspace preview: index.html');
