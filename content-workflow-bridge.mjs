import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { createEditorialJobs } from './editorial-jobs.mjs';
import {validateEditorialAssets} from './editorial-assets-validation.mjs';
import {createEditorialWorkflowQueue} from './editorial-workflow-queue.mjs';
import {createChatDeliveries} from './editorial-chat-deliveries.mjs';
import {createRuntimeActionApprovals,actionHash} from './runtime-action-approvals.mjs';
import {createNativeAgentDelegations} from './native-agent-delegations.mjs';
import {createEditorialPublications,validatePublications} from './editorial-publications.mjs';
import {createEditorialMedia} from './editorial-media.mjs';

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

export function createContentWorkflowBridge({ dbPath, getConnector, suggestConnection = () => '',getRuntime,getChatRuntime,getAgents,getSessions,getCurrentProfile,inspect,timeoutMs,mediaOptions }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS editorial_state (profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const read = db.prepare('SELECT revision, state_json FROM editorial_state WHERE profile_id = ?');
  const insert = db.prepare('INSERT INTO editorial_state (profile_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?)');
  const update = db.prepare('UPDATE editorial_state SET revision = ?, state_json = ?, updated_at = ? WHERE profile_id = ? AND revision = ?');
  const jobs=createEditorialJobs(db,{getConnector});
  const work=createEditorialWorkflowQueue(db,{getRuntime,getAgents,getCurrentProfile,inspect,timeoutMs});
  const deliveries=createChatDeliveries(db,{getSessions,getAgents,getCurrentProfile,inspect});
  const publications=createEditorialPublications(db);
  const media=createEditorialMedia(db,{directory:join(dirname(dbPath),'media'),getCurrentProfile,...mediaOptions});
  const binding=(threadId,sessionId)=>{
    if(!getAgents||!getSessions||!getCurrentProfile)return null;
    const profileId=getCurrentProfile(),session=[...(getSessions(profileId)??[]),...delegations.shadows(profileId)].find(item=>sessionId?item.id===sessionId:item.codexThreadId===threadId||item.remoteSessionId===threadId);
    const agent=session&&(getAgents(profileId)??[]).find(item=>item.id===session.agentId);
    if(!agent||!session||(agent.providerId??'codex')!=='codex')return null;
    const shadow=delegations.shadows(profileId).find(item=>item.id===session.id);
    return {profileId,sessionId:session.id,agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,hash:actionHash({agent,sessionId:session.id}),agent,session:{...session,delegationAncestors:shadow?.delegationAncestors??session.delegationAncestors}};
  };
  const delegations=createNativeAgentDelegations(db,{getCurrentProfile,getAgents,getSessions,getRuntime:getChatRuntime,inspect,timeoutMs});
  const actions=createRuntimeActionApprovals(db,{getCurrentProfile,getBinding:threadId=>binding(threadId)});

  async function handle(request, response, url) {
    if (!url.pathname.startsWith('/api/content/')) return false;
    const profileId = url.searchParams.get('profile') || 'default';
    if (!profilePattern.test(profileId)) { send(response, 400, { error: 'Invalid local profile.' }); return true; }
    try {
      if(getCurrentProfile&&getCurrentProfile()!==profileId){send(response,409,{error:'The active profile changed. Reopen the workspace.'});return true;}
      if(url.pathname==='/api/content/delegations'&&request.method==='GET'){send(response,200,{...delegations.snapshot(profileId),handoffs:delegations.handoffs(profileId)});return true;}
      if(url.pathname==='/api/content/delegations'&&request.method==='POST'){send(response,200,delegations.manual(profileId,await readBody(request)));return true;}
      const delegationSessionRoute=url.pathname.match(/^\/api\/content\/delegations\/sessions\/([^/]+)$/);
      if(delegationSessionRoute&&request.method==='DELETE'){delegations.forgetSession(profileId,decodeURIComponent(delegationSessionRoute[1]));send(response,200,{});return true;}
      const delegationRoute=url.pathname.match(/^\/api\/content\/delegations\/([^/]+)\/(retry|cancel)$/);
      if(delegationRoute&&request.method==='POST'){send(response,200,await delegations[delegationRoute[2]](profileId,decodeURIComponent(delegationRoute[1]),...(delegationRoute[2]==='retry'?[await readBody(request)]:[])));return true;}
      if(url.pathname==='/api/content/actions'&&request.method==='GET'){send(response,200,{actions:actions.list(profileId,url.searchParams.get('session'))});return true;}
      const actionRoute=url.pathname.match(/^\/api\/content\/actions\/([^/]+)$/);
      if(actionRoute&&request.method==='POST'){send(response,200,actions.decide(profileId,decodeURIComponent(actionRoute[1]),await readBody(request)));return true;}
      if(url.pathname==='/api/content/chat-deliveries'&&request.method==='POST'){send(response,200,await deliveries.capture(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/file-review'&&request.method==='POST'){send(response,200,await deliveries.reviewFiles(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/review'&&request.method==='POST'){send(response,200,deliveries.review(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/publications'&&request.method==='POST'){send(response,200,publications.command(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/capabilities'&&request.method==='GET'){send(response,200,await media.capabilities());return true;}
      if(url.pathname==='/api/content/media/inspect'&&request.method==='POST'){send(response,200,await media.inspect(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media'&&request.method==='POST'){send(response,200,media.enqueue(profileId,await readBody(request)));return true;}
      const mediaRoute=url.pathname.match(/^\/api\/content\/media\/([^/]+)\/(retry|cancel)$/);
      if(mediaRoute&&request.method==='POST'){send(response,200,await media[mediaRoute[2]](profileId,decodeURIComponent(mediaRoute[1])));return true;}
      if(url.pathname==='/api/content/work'){
        if(request.method==='GET'){send(response,200,{jobs:work.list(profileId),mediaJobs:media.list(profileId),worker:work.status()});return true;}
        if(request.method==='POST'){send(response,200,work.enqueue(profileId,await readBody(request)));return true;}
      }
      const workRoute=url.pathname.match(/^\/api\/content\/work\/([^/]+)(?:\/(retry|cancel))?$/);
      if(workRoute){const id=decodeURIComponent(workRoute[1]);if(request.method==='GET'&&!workRoute[2]){send(response,200,work.detail(profileId,id));return true;}if(request.method==='POST'&&workRoute[2]){send(response,200,await work[workRoute[2]](profileId,id,await readBody(request)));return true;}}
      if(url.pathname==='/api/content/jobs'&&request.method==='GET'){send(response,200,{jobs:jobs.list(profileId)});return true;}
      if(url.pathname==='/api/content/connection'){
        const workspaceId=url.searchParams.get('workspace')||'';
        if(request.method==='GET'){const config=jobs.connection(profileId,workspaceId);send(response,200,{...config,suggestedDataSourceId:suggestConnection(profileId,workspaceId)});return true;}
        if(request.method==='PUT'){send(response,200,jobs.configure(profileId,workspaceId,await readBody(request)));return true;}
      }
      if(url.pathname==='/api/content/approve'&&request.method==='POST'){send(response,200,jobs.approve(profileId,await readBody(request)));return true;}
      const action=url.pathname.match(/^\/api\/content\/jobs\/([^/]+)\/(retry|cancel)$/);
      if(action&&request.method==='POST'){jobs[action[2]](profileId,decodeURIComponent(action[1]));send(response,200,{});return true;}
      if(url.pathname!=='/api/content/state'){send(response,404,{error:'Editorial operation not found.'});return true;}
      if (request.method === 'GET') {
        const row = read.get(profileId);
        send(response, 200, row ? { revision: row.revision, state: JSON.parse(row.state_json) } : { revision: 0, state: emptyState() });
        return true;
      }
      if (request.method === 'PUT') {
        const input = await readBody(request);
        const state = input.state;
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || state?.schemaVersion !== 1 || !['topics', 'contents', 'runs', 'artifacts', 'approvals'].every((key) => Array.isArray(state[key])) || !validateEditorialAssets(state)||!validatePublications(state)) {
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

  return { handle, jobs, work, deliveries, publications,media,actions,binding,delegations,agents:()=>getAgents?.(getCurrentProfile?.())??[], close: async () => {actions.close();await media.close();await delegations.close();await work.close();await jobs.close();db.close();} };
}
