// Exercise the Electron main process and an embedded browser with the launcher's
// stdout/stderr deliberately closed. Uses an isolated profile and local page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve('.mainsagents-workspaces');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'desktop-pipe-test-'));
await mkdir(join(directory, 'profile'));
await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'mainsagents-browser-smoke', version: '1.0.0', type: 'module', main: 'boot.cjs' }));
const resultPath = join(directory, 'result.json');
const closedPath = join(directory, 'terminal-closed');
const diagnosticModule = new URL('../desktop-diagnostics.mjs', import.meta.url).href;
const fixture = `
import { setDesktopDiagnosticWriter } from ${JSON.stringify(diagnosticModule)};
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';
const diagnostics = [];
setDesktopDiagnosticWriter(message => diagnostics.push(message));
app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
await app.whenReady();
console.log('ready-to-close-pipes');
await new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = setInterval(() => {
    if (existsSync(${JSON.stringify(closedPath)})) { clearInterval(poll); resolve(); }
    else if (Date.now() - started > 8000) { clearInterval(poll); reject(new Error('Launcher did not close pipes')); }
  }, 25);
});
let frameLoaded = false;
const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html');
  if (request.url === '/frame') { frameLoaded = true; response.end('<h1>Canvas browser loaded</h1>'); }
  else response.end('<iframe src="/frame" sandbox="allow-forms allow-scripts allow-popups" referrerpolicy="no-referrer"></iframe>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
await window.loadURL('http://127.0.0.1:' + server.address().port);
// Reproduce the warning path from the reported stack, after the terminal exits.
process.emitWarning('Canvas browser smoke test');
console.error('browser diagnostic'.repeat(8000));
console.log('browser diagnostic'.repeat(8000));
await new Promise(resolve => setTimeout(resolve, 200));
writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ frameLoaded, alive: !window.isDestroyed(), diagnostics }));
window.destroy();
await new Promise(resolve => server.close(resolve));
app.quit();
`;
const fixturePath = join(directory, 'fixture.mjs');
await writeFile(fixturePath, fixture);
await writeFile(join(directory, 'boot.cjs'), `
const { app } = require('electron');
const { writeFileSync } = require('node:fs');
function fail(error) { writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: error.stack || String(error) })); app.exit(1); }
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
import('./fixture.mjs').catch(fail);
`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [directory], {
  env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let errorOutput = '';
let closed = false;
child.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
  if (!closed && output.includes('ready-to-close-pipes')) {
    closed = true;
    child.stdout.destroy();
    child.stderr.destroy();
    void writeFile(closedPath, 'closed');
  }
});
const timeout = setTimeout(() => child.kill(), 20000);
let exitCode;
try {
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
} finally { clearTimeout(timeout); }
const result = JSON.parse(await readFile(resultPath, 'utf8'));
assert.equal(exitCode, 0, `Electron should exit cleanly. ${result.error ?? ''} ${output} ${errorOutput}`);
assert.equal(result.frameLoaded, true);
assert.equal(result.alive, true);
assert.ok(result.diagnostics.some(entry => entry.includes('EPIPE')));
assert.ok(result.diagnostics.some(entry => entry.includes('Canvas browser smoke test')));
console.log('Electron: browser loaded and process survived closed terminal pipes.');
console.log('Diagnostics:', pathToFileURL(resultPath).pathname);
