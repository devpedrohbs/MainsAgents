import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { createServer } from 'vite';
import { startCodexBridge } from './codex-bridge.mjs';
import { createChatImageArtifacts } from './chat-image-artifacts.mjs';
import { createClaudeCodeBridge } from './claude-code-bridge.mjs';
import { createCanvasRuntimeBridge } from './canvas-runtime-bridge.mjs';
import { createContentWorkflowBridge } from './content-workflow-bridge.mjs';
import { createNotionEditorialConnector } from './notion-editorial-connector.mjs';
import {createCalendarConnector} from './publication-calendar-connector.mjs';
import {createPublicationConnector} from './publication-connector.mjs';

const claudeBridge = createClaudeCodeBridge();
const canvasRuntimeBridge = createCanvasRuntimeBridge({ cwdRoot: join(process.cwd(), '.mainsagents-workspaces') });
const contentWorkflowBridge = createContentWorkflowBridge({ dbPath: join(process.cwd(), '.mainsagents-workspaces', 'editorial.sqlite'),getConnector:()=>bridge?.isAlive()?createNotionEditorialConnector(()=>bridge.notionMcp):null,getRuntime:()=>bridge?.isAlive()?bridge.workflow:null,getPublicationConnector:()=>bridge?.isAlive()?createPublicationConnector(()=>bridge.publicationMcp):null,getCalendarConnector:provider=>bridge?.isAlive()?createCalendarConnector(()=>bridge.publicationMcp,provider):null });
const codexOptions = { port: 0, runtimeHome: join(process.cwd(), '.mainsagents-workspaces', 'codex-runtime'), imagesDirectory:join(process.cwd(),'.mainsagents-workspaces','images') };
const images=createChatImageArtifacts(codexOptions.imagesDirectory);

let bridge = await startCodexBridge(codexOptions).catch((error) => {
  console.warn(`[MainsAgents] Codex unavailable; local UI will still run: ${error.message}`);
  return null;
});
let reconnecting;
contentWorkflowBridge.jobs.kick();
contentWorkflowBridge.work.kick();

async function reconnectBridge() {
  if (bridge?.isAlive()) return bridge;
  if (reconnecting) return reconnecting;
  reconnecting = (async () => {
    if (bridge) await bridge.close().catch(() => {});
    bridge = await startCodexBridge(codexOptions);
    return bridge;
  })();
  try { return await reconnecting; }
  finally { reconnecting = undefined; }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const bridgePlugin = {
  name: 'mainsagents-codex-bridge',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if(images.handle(request,response,new URL(request.url??'/','http://127.0.0.1')))return;
      if (pathname.startsWith('/api/content/')) {
        const address = server.httpServer.address();
        const port = address && typeof address === 'object' ? address.port : 0;
        const origin = String(request.headers.origin ?? '');
        if (request.method !== 'GET' && !new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin)) return json(response, 403, { error: 'Editorial changes must come from MainsAgents.' });
        void contentWorkflowBridge.handle(request, response, new URL(request.url ?? '/', 'http://127.0.0.1')).catch((error) => json(response, 500, { error: String(error) }));
        return;
      }
      if (pathname.startsWith('/api/providers/claude/')) {
        void claudeBridge.handle(request, response, new URL(request.url ?? '/', 'http://127.0.0.1'))
          .then((handled) => { if (!handled && !response.writableEnded) next(); })
          .catch((error) => json(response, 500, { error: error instanceof Error ? error.message : 'Claude Code CLI bridge failed.' }));
        return;
      }
      if (pathname.startsWith('/api/canvas/')) {
        const address = server.httpServer.address();
        const port = address && typeof address === 'object' ? address.port : 0;
        const origin = String(request.headers.origin ?? '');
        const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
        if ((request.method === 'POST' && !origin) || (origin && !allowedOrigins.has(origin))) {
          json(response, 403, { error: 'Canvas terminal requests must come from MainsAgents.' });
          return;
        }
        void canvasRuntimeBridge.handle(request, response, new URL(request.url ?? '/', 'http://127.0.0.1'))
          .then((handled) => { if (!handled && !response.writableEnded) next(); })
          .catch((error) => json(response, 500, { error: error instanceof Error ? error.message : 'Canvas terminal failed.' }));
        return;
      }
      if (pathname.startsWith('/api/providers/')) return next();
      if (pathname === '/api/codex/reconnect' && request.method === 'POST') {
        void reconnectBridge()
          .then(() => json(response, 200, { ready: true }))
          .catch((error) => json(response, 503, { ready: false, error: error instanceof Error ? error.message : String(error) }));
        return;
      }
      if (!pathname.startsWith('/api/codex/')) return next();
      if (!bridge?.isAlive()) return json(response, 503, { error: 'Codex bridge is unavailable. Select Reconnect to start it again.' });

      const upstream = httpRequest({
        hostname: '127.0.0.1',
        port: bridge.port,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${bridge.port}`, 'x-mainsagents-bridge-token': bridge.token },
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', (error) => {
        if (!response.headersSent) json(response, 502, { error: `Could not reach Codex: ${error.message}` });
        else response.destroy(error);
      });
      request.pipe(upstream);
    });
  },
};

const vite = await createServer({ plugins: [bridgePlugin], server: { host: '127.0.0.1', port: Number(process.env.MAINSAGENTS_PORT)||5173, strictPort: true, open: '/app.html' } });
await vite.listen();
vite.printUrls();

const close = async () => {
  await vite.close();
  if (bridge) await bridge.close();
  await contentWorkflowBridge.close();
  process.exit();
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
