import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { startCodexBridge } from './codex-bridge.mjs';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

let mainWindow;
let webServer;
let codexBridge;
let shuttingDown = false;

function logStartup(message) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(join(app.getPath('userData'), 'startup.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function findSkills(directory, depth = 0) {
  if (!directory || !existsSync(directory) || depth > 4) return [];
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md')) return [{ name: directory.split(/[\\/]/).filter(Boolean).at(-1) ?? 'skill', path: directory }];
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.git')).flatMap((entry) => findSkills(join(directory, entry.name), depth + 1));
  } catch { return []; }
}

function installSkill(source, cwd) {
  let executable = 'npx';
  let args = ['--yes', 'skills', 'add', source, '--agent', 'codex', '--yes'];
  if (process.platform === 'win32') {
    const npxCommand = execFileSync('where.exe', ['npx.cmd'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean);
    if (!npxCommand) throw new Error('npx was not found. Install Node.js before installing skills.');
    const nodeDirectory = dirname(npxCommand.trim());
    executable = join(nodeDirectory, 'node.exe');
    args = [join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js'), '--yes', 'skills', 'add', source, '--agent', 'codex', '--yes'];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Skill installation timed out.')); }, 120000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(output.trim() || `Skill installer exited with code ${code}`));
    });
  });
}

ipcMain.handle('skills:select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Select skills folder', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const directory = result.filePaths[0];
  return { directory, skills: findSkills(directory) };
});

ipcMain.handle('skills:install', async (_event, value) => {
  const source = String(value ?? '').trim();
  if (!/^(https?:\/\/[^\s]+|[\w.-]+\/[\w./-]+(?:@[\w.-]+)?)$/.test(source)) throw new Error('Use a GitHub URL or owner/repository identifier.');
  const projectDirectory = join(app.getPath('documents'), 'MainsAgents Skills');
  mkdirSync(projectDirectory, { recursive: true });
  await installSkill(source, projectDirectory);
  const candidates = [join(projectDirectory, '.agents', 'skills'), join(projectDirectory, '.codex', 'skills'), projectDirectory];
  const directory = candidates.find((candidate) => findSkills(candidate).length > 0) ?? projectDirectory;
  return { directory, skills: findSkills(directory) };
});

function proxyToCodex(clientRequest, clientResponse, port) {
  const proxy = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: clientRequest.url,
    method: clientRequest.method,
    headers: clientRequest.headers,
  }, (response) => {
    clientResponse.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(clientResponse);
  });
  proxy.on('error', (error) => {
    if (!clientResponse.headersSent) clientResponse.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    clientResponse.end(JSON.stringify({ error: `Codex bridge unavailable: ${error.message}` }));
  });
  clientRequest.pipe(proxy);
}

function startWebServer(rootDirectory, bridgePort, port = 47831) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/codex/')) return proxyToCodex(request, response, bridgePort);

    const requestedPath = url.pathname === '/' ? '/app.html' : decodeURIComponent(url.pathname);
    const normalizedPath = normalize(requestedPath).replace(/^([/\\])+/, '');
    let filePath = join(rootDirectory, normalizedPath);
    if (!filePath.startsWith(rootDirectory) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(rootDirectory, 'app.html');

    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(filePath).on('error', () => response.end()).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
    });
  });
}

async function createWindow() {
  logStartup('Starting desktop services');
  const workspaceDirectory = join(app.getPath('documents'), 'MainsAgents Workspace');
  mkdirSync(workspaceDirectory, { recursive: true });
  codexBridge = await startCodexBridge({ port: 0, cwd: workspaceDirectory });
  logStartup(`Codex bridge ready on ${codexBridge.port}`);
  const web = await startWebServer(join(app.getAppPath(), 'dist'), codexBridge.port);
  webServer = web.server;
  logStartup(`Web application ready on ${web.port}`);

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    show: false,
    title: 'MainsAgents',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(app.getAppPath(), 'desktop-preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  await mainWindow.loadURL(`http://127.0.0.1:${web.port}/app.html#home`);
  logStartup('Main window loaded');
}

async function closeServices() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (webServer) await new Promise((resolve) => webServer.close(resolve));
  if (codexBridge) await codexBridge.close();
}

const lock = app.requestSingleInstanceLock();
logStartup(`Application launched; single-instance lock=${lock}`);
if (!lock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow).catch((error) => {
    logStartup(`Startup failed: ${error?.stack ?? error}`);
    console.error(error);
    app.quit();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    void closeServices().finally(() => app.quit());
  });
}
