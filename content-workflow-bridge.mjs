import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const emptyState = () => ({ schemaVersion: 1, topics: [], contents: [], runs: [], artifacts: [], approvals: [] });
const profilePattern = /^[a-zA-Z0-9_-]{1,120}$/;

function send(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8_000_000) throw new Error('Content workspace exceeds the 8 MB request limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createContentWorkflowBridge({ dbPath }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS editorial_state (profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const read = db.prepare('SELECT revision, state_json FROM editorial_state WHERE profile_id = ?');
  const insert = db.prepare('INSERT INTO editorial_state (profile_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?)');
  const update = db.prepare('UPDATE editorial_state SET revision = ?, state_json = ?, updated_at = ? WHERE profile_id = ? AND revision = ?');

  async function handle(request, response, url) {
    if (url.pathname !== '/api/content/state') return false;
    const profileId = url.searchParams.get('profile') || 'default';
    if (!profilePattern.test(profileId)) { send(response, 400, { error: 'Invalid local profile.' }); return true; }
    try {
      if (request.method === 'GET') {
        const row = read.get(profileId);
        send(response, 200, row ? { revision: row.revision, state: JSON.parse(row.state_json) } : { revision: 0, state: emptyState() });
        return true;
      }
      if (request.method === 'PUT') {
        const input = await readBody(request);
        const state = input.state;
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || state?.schemaVersion !== 1 || !['topics', 'contents', 'runs', 'artifacts', 'approvals'].every((key) => Array.isArray(state[key]))) {
          send(response, 400, { error: 'Invalid editorial state.' }); return true;
        }
        const current = read.get(profileId);
        if ((current?.revision ?? 0) !== input.revision) { send(response, 409, { error: 'Editorial data changed in another window. Reload before editing.' }); return true; }
        const next = input.revision + 1;
        const json = JSON.stringify(state);
        const at = new Date().toISOString();
        if (current) update.run(next, json, at, profileId, input.revision);
        else insert.run(profileId, next, json, at);
        send(response, 200, { revision: next });
        return true;
      }
      send(response, 405, { error: 'Method not allowed.' });
      return true;
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : 'Editorial storage failed.' });
      return true;
    }
  }

  return { handle, close: () => db.close() };
}
