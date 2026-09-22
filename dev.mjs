import { createServer } from 'vite';
import { startCodexBridge } from './codex-bridge.mjs';

const bridge = await startCodexBridge();
const vite = await createServer({ server: { open: '/app.html' } });
await vite.listen();
vite.printUrls();

const close = async () => { await vite.close(); await bridge.close(); process.exit(); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
