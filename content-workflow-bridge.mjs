import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { createEditorialJobs } from './editorial-jobs.mjs';
import {validateEditorialAssets} from './editorial-assets-validation.mjs';
import {validateInspirationState} from './editorial-inspiration.mjs';
import {createEditorialWorkflowQueue} from './editorial-workflow-queue.mjs';
import {createChatDeliveries} from './editorial-chat-deliveries.mjs';
import {createRuntimeActionApprovals,actionHash} from './runtime-action-approvals.mjs';
import {createNativeAgentDelegations} from './native-agent-delegations.mjs';
import {createEditorialPublications,validatePublications} from './editorial-publications.mjs';
import {createEditorialMedia} from './editorial-media.mjs';
import {createPublicationExecution} from './editorial-publication-execution.mjs';
import {createPublicationCalendar} from './editorial-publication-calendar.mjs';
import {createCalendarCredentials} from './publication-calendar-credentials.mjs';
import {createProductionCoordinator} from './production-coordinator.mjs';
import {createPublicationStatusRefresh} from './publication-status-refresh.mjs';
import {createInspirationAnalysis} from './editor-inspiration-analysis.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';

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

export function createContentWorkflowBridge({ dbPath, getConnector, getPublicationConnector, getCalendarConnector, secureStorage, suggestConnection = () => '',getRuntime,getChatRuntime,getProviderStatus,getAgents,getFlows,getSessions,getCurrentProfile,inspect,timeoutMs,mediaOptions }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS editorial_state (profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const read = db.prepare('SELECT revision, state_json FROM editorial_state WHERE profile_id = ?');
  const insert = db.prepare('INSERT INTO editorial_state (profile_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?)');
  const update = db.prepare('UPDATE editorial_state SET revision = ?, state_json = ?, updated_at = ? WHERE profile_id = ? AND revision = ?');
  let production;
  const jobs=createEditorialJobs(db,{getConnector,authorizeDraft:row=>production?.authorizeDraft(row)===true});
  const work=createEditorialWorkflowQueue(db,{getRuntime,getAgents,getCurrentProfile,inspect,timeoutMs});
  const deliveries=createChatDeliveries(db,{getSessions,getAgents,getCurrentProfile,inspect});
  const publications=createEditorialPublications(db);
  const publishing=createPublicationExecution(db,{getConnector:getPublicationConnector,getCurrentProfile});
  const calendar=createPublicationCalendar(db,{getConnector:getCalendarConnector,getCurrentProfile});
  const statusRefresh=createPublicationStatusRefresh(db,{publishing,getCurrentProfile});
  const calendarCredentials=createCalendarCredentials(db,secureStorage);
  const media=createEditorialMedia(db,{directory:join(dirname(dbPath),'media'),getCurrentProfile,...mediaOptions});
  const analyses=createInspirationAnalysis(db,{media,getRuntime,getChatRuntime,getProviderStatus,getAgents,getCurrentProfile,inspect:inspect??inspectLocalAsset,...(mediaOptions?.thumbnails?{thumbnails:mediaOptions.thumbnails}:{})});
  production=createProductionCoordinator(db,{getBriefings:(profile,topicId,options)=>analyses.briefingsFor(profile,topicId,options),getRuntime,getChatRuntime,getProviderStatus,getAgents,getFlows,getSessions,getCurrentProfile,getNotion:getConnector,jobs,media,publications,publishing,directory:join(dirname(dbPath),'production-media'),inspect,...mediaOptions});
  const binding=(threadId,sessionId,provider='codex')=>{
    if(!getAgents||!getSessions||!getCurrentProfile)return null;
    const profileId=getCurrentProfile(),session=[...(getSessions(profileId)??[]),...delegations.shadows(profileId)].find(item=>sessionId?item.id===sessionId:item.codexThreadId===threadId||item.remoteSessionId===threadId);
    const agent=session&&(getAgents(profileId)??[]).find(item=>item.id===session.agentId);
    if(!agent||!session||(agent.providerId??'codex')!==provider)return null;
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
      if(url.pathname==='/api/content/productions'){if(request.method==='GET'){send(response,200,{productions:production.list(profileId)});return true;}if(request.method==='POST'){send(response,200,{production:production.start(profileId,await readBody(request))});return true;}}
      if(url.pathname==='/api/content/productions/import-card'&&request.method==='POST'){try{send(response,200,{card:await production.readImportCard(profileId,await readBody(request))});}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      if(url.pathname==='/api/content/productions/preflight'&&request.method==='POST'){const input=await readBody(request);send(response,200,{preflight:await production.preflight(profileId,input,{probeMedia:input.probeMedia===true})});return true;}
      const coverRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/cover$/);
      if(coverRoute&&request.method==='GET'){try{const file=await production.coverFile(profileId,decodeURIComponent(coverRoute[1]),url.searchParams.get('assetId')??'',url.searchParams.get('versionId')??'');response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(file.bytes);}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      if(url.pathname==='/api/content/productions/captions-capabilities'&&request.method==='GET'){send(response,200,await production.captionCapabilities());return true;}
      const framesRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/frames$/);
      if(framesRoute&&request.method==='GET'){try{send(response,200,await production.coverCandidates(profileId,decodeURIComponent(framesRoute[1])));}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      const frameRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/frame$/);
      if(frameRoute&&request.method==='GET'){const abort=new AbortController();response.on('close',()=>{if(!response.writableFinished)abort.abort();});try{const file=await production.coverFrame(profileId,decodeURIComponent(frameRoute[1]),{timestampSeconds:url.searchParams.get('t'),versionId:url.searchParams.get('versionId')??'',sha256:url.searchParams.get('sha256')??''},abort.signal);if(abort.signal.aborted)return true;response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-timestamp':String(file.timestampSeconds)});response.end(file.bytes);}catch(error){if(!response.headersSent&&!abort.signal.aborted)send(response,error.status??500,{error:error.message});}return true;}
      const productionRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)$/);
      if(productionRoute&&request.method==='POST'){send(response,200,{production:await production.command(profileId,{...await readBody(request),id:decodeURIComponent(productionRoute[1])})});return true;}
      if(url.pathname==='/api/content/calendar'&&request.method==='GET'){send(response,200,calendar.snapshot(profileId,url.searchParams.get('workspace')));return true;}
      if(url.pathname==='/api/content/calendar/refresh'&&request.method==='POST'){send(response,200,calendar.configureRefresh(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/calendar/accounts'&&request.method==='POST'){const input=await readBody(request);send(response,200,await calendar.accounts(profileId,input.workspaceId,input.provider));return true;}
      if(url.pathname==='/api/content/calendar/sync'&&request.method==='POST'){try{send(response,200,await calendar.sync(profileId,await readBody(request)))}catch{send(response,502,{error:'Calendar query failed. Previous data was preserved. Check MCP authentication and supported tools.'})}return true;}
      // B10: read-only status refresh (open/manual/auto) and its local, bounded settings.
      // B09: analyses of accessible references (server-owned; one authorized AI turn each) and briefing links.
      if(url.pathname==='/api/content/inspiration/analyses'&&request.method==='GET'){send(response,200,{analyses:analyses.list(profileId)});return true;}
      if(url.pathname==='/api/content/inspiration/analyses'&&request.method==='POST'){const {action:verb,...rest}=await readBody(request);if(!['analyze','cancel','link','unlink'].includes(verb)){send(response,400,{error:'Ação de análise desconhecida.'});return true;}send(response,200,{analysis:await analyses[verb](profileId,rest),analyses:analyses.list(profileId)});return true;}
      if(url.pathname==='/api/content/publishing/status'&&request.method==='GET'){send(response,200,statusRefresh.snapshot(profileId));return true;}
      if(url.pathname==='/api/content/publishing/status'&&request.method==='POST'){const input=await readBody(request);send(response,200,await statusRefresh.refresh(profileId,{reason:input.reason}));return true;}
      if(url.pathname==='/api/content/publishing/status/settings'&&request.method==='POST'){send(response,200,statusRefresh.configure(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/publishing/status/dismiss'&&request.method==='POST'){send(response,200,statusRefresh.dismiss(profileId));return true;}
      if(url.pathname==='/api/content/publishing/accounts'&&request.method==='POST'){send(response,200,await publishing.accounts(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/publishing/options'&&request.method==='POST'){send(response,200,await publishing.options(profileId,await readBody(request)));return true;}
      const publishingRoute=url.pathname.match(/^\/api\/content\/publishing\/(prepare|execute|reconcile|cancel|prepareChange|change|continue)$/);
      if(publishingRoute&&request.method==='POST'){
        const input=await readBody(request),result=await publishing[publishingRoute[1]](profileId,input);
        const delivery=result.state?.publications?.find(item=>item.id===input.id);
        if(delivery?.operation?.phase==='confirmed'){
          try{const source=calendar.snapshot(profileId,delivery.workspaceId).sources.find(item=>item.provider===delivery.operation.provider);
            if(source?.accountIds.includes(delivery.operation.accountId))await calendar.sync(profileId,{workspaceId:delivery.workspaceId,provider:source.provider,accountIds:source.accountIds});
          }catch{/* A calendar failure must not undo or hide a confirmed provider receipt. */}
        }
        send(response,200,result);return true;
      }
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
      if(url.pathname==='/api/content/media/analyze'&&request.method==='POST'){send(response,200,await media.analyze(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/file'&&['GET','HEAD'].includes(request.method)){try{await media.streamVideo(profileId,url,request,response);}catch(error){if(!response.headersSent)send(response,error.status??404,{error:error.message});else response.destroy();}return true;}
      if(url.pathname==='/api/content/media/review'&&request.method==='POST'){send(response,200,await media.review(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/subtitles'&&request.method==='POST'){send(response,200,await media.subtitles(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/transcribe'&&request.method==='POST'){send(response,200,await media.transcribe(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/plan'&&request.method==='POST'){send(response,200,await media.plan(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/motion'&&request.method==='POST'){send(response,200,await media.motion(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/snap'&&request.method==='POST'){send(response,200,await media.snap(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/audio'&&request.method==='POST'){send(response,200,await media.audio(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/preview'&&request.method==='POST'){send(response,200,await media.preview(profileId,await readBody(request)));return true;}
      if(url.pathname==='/api/content/media/preview-cancel'&&request.method==='POST'){send(response,200,media.cancelPreview());return true;}
      if(url.pathname==='/api/content/media/preview-file'&&['GET','HEAD'].includes(request.method)){try{await media.streamPreview(profileId,url,request,response);}catch(error){if(!response.headersSent)send(response,error.status??404,{error:error.message});else response.destroy();}return true;}
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
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || state?.schemaVersion !== 1 || !['topics', 'contents', 'runs', 'artifacts', 'approvals'].every((key) => Array.isArray(state[key])) || !validateEditorialAssets(state)||!validatePublications(state)||!validateInspirationState(state)) {
          send(response, 400, { error: 'Invalid editorial state.' }); return true;
        }
        const current = read.get(profileId);
        if ((current?.revision ?? 0) !== input.revision) { send(response, 409, { error: 'Editorial data changed in another window. Reload before editing.' }); return true; }
        const previous=current?JSON.parse(current.state_json):{};
        const protectedFields=item=>JSON.stringify({operation:item?.operation,receipt:item?.receipt});
        if((state.publications??[]).some(item=>protectedFields(item)!==protectedFields(previous.publications?.find(old=>old.id===item.id)))||(previous.publications??[]).some(item=>item.operation&&!state.publications?.some(next=>next.id===item.id&&JSON.stringify(next)===JSON.stringify(item)))){send(response,409,{error:'Provider operations can only change through the publishing service. Reconcile before editing.'});return true;}
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

  return { handle, production,jobs, work, deliveries, publications,publishing,statusRefresh,analyses,calendar,calendarCredentials,media,actions,binding,claudeBinding:remoteSessionId=>binding(remoteSessionId,undefined,'claude'),delegations,agents:()=>getAgents?.(getCurrentProfile?.())??[], close: async () => {await statusRefresh.close();await analyses.close();await production.close();actions.close();await calendar.close();await publishing.close();await media.close();await delegations.close();await work.close();await jobs.close();db.close();} };
}
