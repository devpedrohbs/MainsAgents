import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { homedir } from 'node:os';
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
import {createContentSrt} from './content-srt.mjs';
import {createPublicationStatusRefresh} from './publication-status-refresh.mjs';
import {createInspirationAnalysis} from './editor-inspiration-analysis.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';
import {createDeliveryReceipts} from './delivery-receipts.mjs';
import {createVerifiedImageIndex,createPaperAssetLedger} from './paper-image-assets.mjs';
import {createChatPublishing} from './chat-publishing.mjs';
import {setPaperAssetVerifier} from './paper-design.mjs';
import {createChatEditRequests} from './chat-edit-requests.mjs';
import {createContentDeletion,ensureContentFenceTriggers,deletedIds,isSessionFenced,stripDeletedEditorial,recoverAbandonedDeletions} from './content-deletion.mjs';

/** The workspace's video editor: the agent of a flow's editing box, or an agent created as the video editor. */
export const isVideoEditorAgent=(flows,agent)=>Boolean(agent)&&((flows??[]).some(flow=>flow.workspaceId===agent.workspaceId&&flow.nodes?.some(node=>node.kind==='video-agent'&&node.agentId===agent.id))||/editor[-_ ]?de[-_ ]?v[ií]deo|video[-_ ]?editor/i.test(`${agent.id} ${agent.name??''} ${agent.role??''}`));

const providers=new Set(['codex','claude']);
/**
 * The agent as one saved session runs it. The provider comes from the host-saved session (the chat's provider chooser),
 * falling back to the agent default for sessions saved before the choice existed; never from a request copy.
 * Everything else (permissions, Paper, Notion, files, skills) stays the saved agent's own configuration.
 */
export function effectiveSessionAgent(agent,session){
  if(!agent||!session||session.agentId!==agent.id)return null;
  const fallback=agent.providerId??'codex',providerId=session.providerId??fallback;
  if(!providers.has(providerId))return null;
  const modelId=typeof session.modelId==='string'&&session.modelId?session.modelId:providerId===fallback?agent.modelId:undefined;
  const {modelId:_model,...rest}=agent;void _model;
  return {...rest,providerId,...(modelId?{modelId}:{})};
}

/** The canonical file source for scheduling: only the latest verified Paper export of the chat, in its export order. */
export const latestExportBatch=(paperAssets,profile,sessionId)=>{const latest=paperAssets.exports(profile,{sessionId}).latest;return (latest?.files??[]).map(file=>({path:file.path,sha256:file.sha256,order:Number(file.source.step),nodeId:file.assetId,fileId:latest.fileId,callId:latest.callId,receiptId:file.id}));};

const emptyState = () =>({ schemaVersion: 1, topics: [], contents: [], runs: [], artifacts: [], approvals: [] });
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

export function createContentWorkflowBridge({ dbPath, getConnector, getPublicationConnector, getCalendarConnector, secureStorage, suggestConnection = () => '',getRuntime,getChatRuntime,getProviderStatus,getAgents,getFlows,getSessions,getCurrentProfile,inspect,timeoutMs,mediaOptions,paperAssetOptions,deletionOptions,hostExclusive=false }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS editorial_state (profile_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
  // Only the desktop host, after its single-instance lock and before any worker below recovers or admits jobs: a purge fence
  // left by a process that died mid-deletion is released (data kept; nothing completed or relaunched). Other connections never do this.
  if(hostExclusive)recoverAbandonedDeletions(db);
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
  const receipts=createDeliveryReceipts(db,{inspect:inspect??inspectLocalAsset,getCurrentProfile});
  const media=createEditorialMedia(db,{directory:join(dirname(dbPath),'media'),getCurrentProfile,receipts,...mediaOptions});
  const analyses=createInspirationAnalysis(db,{media,getRuntime,getChatRuntime,getProviderStatus,getAgents,getCurrentProfile,inspect:inspect??inspectLocalAsset,...(mediaOptions?.thumbnails?{thumbnails:mediaOptions.thumbnails}:{})});
  production=createProductionCoordinator(db,{getBriefings:(profile,topicId,options)=>analyses.briefingsFor(profile,topicId,options),getRuntime,getChatRuntime,getProviderStatus,getAgents,getFlows,getSessions,getCurrentProfile,getNotion:getConnector,jobs,media,publications,publishing,directory:join(dirname(dbPath),'production-media'),inspect,receipts,...mediaOptions});
  // SRT editável separado do MP4 (CapCut): versões, exportação idempotente por hash; nunca renderiza nem toca vídeos.
  const srt=createContentSrt(db,{directory:join(dirname(dbPath),'srt'),inspect:inspect??inspectLocalAsset,media,getCurrentProfile});
  const binding=(threadId,sessionId,provider='codex')=>{
    if(!getAgents||!getSessions||!getCurrentProfile)return null;
    const profileId=getCurrentProfile(),session=[...(getSessions(profileId)??[]),...delegations.shadows(profileId)].find(item=>sessionId?item.id===sessionId:item.codexThreadId===threadId||item.remoteSessionId===threadId);
    // A deleted chat (or one of a content being deleted) never gets a binding: no tool call, schedule or delegation runs for it.
    if(session&&isSessionFenced(db,profileId,session.id))return null;
    const saved=session&&(getAgents(profileId)??[]).find(item=>item.id===session.agentId);
    const agent=saved&&effectiveSessionAgent(saved,session);
    if(!agent||agent.providerId!==provider)return null;
    const shadow=delegations.shadows(profileId).find(item=>item.id===session.id);
    return {profileId,sessionId:session.id,agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,providerId:agent.providerId,hash:actionHash({agent,sessionId:session.id}),agent,session:{...session,delegationAncestors:shadow?.delegationAncestors??session.delegationAncestors}};
  };
  const delegations=createNativeAgentDelegations(db,{getCurrentProfile,getAgents,getSessions,getRuntime:getChatRuntime,inspect,timeoutMs,production,isVideoEditor:(profile,agent)=>isVideoEditorAgent(getFlows?.(profile)?.flows,agent)});
  // Native images the host saved (content-addressed) and the native tool's own output folders; Paper exports as receipts.
  const imageIndex=createVerifiedImageIndex({imagesDirectory:paperAssetOptions?.imagesDirectory??join(homedir(),'.mainsagents','storage','images'),generatedRoots:paperAssetOptions?.generatedRoots??[]});
  const paperAssets=createPaperAssetLedger({receipts,getCurrentProfile,index:imageIndex});
  // The Paper grant auto-approves a local image only when this host verified it as its own generated image.
  setPaperAssetVerifier(path=>imageIndex.verify(path));
  const actions=createRuntimeActionApprovals(db,{getCurrentProfile,getBinding:threadId=>binding(threadId)});
  // Edit requests typed in any chat start the real local edit engine (host-decided; see chat-edit-requests.mjs).
  const chatEdits=createChatEditRequests(db,{getCurrentProfile,getAgents,getSessions,production,media,inspect:inspect??inspectLocalAsset,isVideoEditor:(profile,agent)=>isVideoEditorAgent(getFlows?.(profile)?.flows,agent),flowEditors:(profile,workspaceId)=>(getFlows?.(profile)?.flows??[]).filter(flow=>flow.workspaceId===workspaceId).flatMap(flow=>(flow.nodes??[]).filter(node=>node.kind==='video-agent'&&node.agentId).map(node=>node.agentId))});
  // Local deletion of a whole content; triggers fence every table above against late writers (see content-deletion.mjs).
  const deletion=createContentDeletion(db,{getCurrentProfile,getAgents,production,delegations,media,work,jobs,srt,actions,...deletionOptions});
  ensureContentFenceTriggers(db);
  // Verified Paper exports of the chat count as material shown to the user (host receipts, re-checked by hash).
  const chatPublishing=createChatPublishing(db,{getCurrentProfile,getAgents,getSessions,execution:publishing,publications,...(inspect?{inspect}:{}),sessionExports:(profile,sessionId)=>latestExportBatch(paperAssets,profile,sessionId)});
  /** Binding of a saved session by id, with the provider that session runs on (for app-side decisions). */
  const sessionBinding=sessionId=>{
    if(!getSessions||!getCurrentProfile||typeof sessionId!=='string'||!sessionId)return null;
    const session=(getSessions(getCurrentProfile())??[]).find(item=>item.id===sessionId);
    const agent=session&&(getAgents?.(getCurrentProfile())??[]).find(item=>item.id===session.agentId);
    const effective=agent&&effectiveSessionAgent(agent,session);
    return effective?binding(undefined,sessionId,effective.providerId):null;
  };

  async function handle(request, response, url) {
    if (!url.pathname.startsWith('/api/content/')) return false;
    const profileId = url.searchParams.get('profile') || 'default';
    if (!profilePattern.test(profileId)) { send(response, 400, { error: 'Invalid local profile.' }); return true; }
    try {
      if(getCurrentProfile&&getCurrentProfile()!==profileId){send(response,409,{error:'The active profile changed. Reopen the workspace.'});return true;}
      if(url.pathname==='/api/content/productions'){if(request.method==='GET'){send(response,200,{productions:production.list(profileId)});return true;}if(request.method==='POST'){send(response,200,{production:production.start(profileId,await readBody(request))});return true;}}
      if(url.pathname==='/api/content/productions/import-card'&&request.method==='POST'){try{send(response,200,{card:await production.readImportCard(profileId,await readBody(request))});}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      if(url.pathname==='/api/content/productions/preflight'&&request.method==='POST'){const input=await readBody(request);send(response,200,{preflight:await production.preflight(profileId,input,{probeMedia:input.probeMedia===true})});return true;}
      if(url.pathname==='/api/content/chat-edits'){try{if(request.method==='GET'){send(response,200,{requests:chatEdits.list(profileId,url.searchParams.get('session')??'')});return true;}if(request.method==='POST'){send(response,200,{request:await chatEdits.admit(profileId,await readBody(request))});return true;}}catch(error){send(response,error.status??500,{error:error.message,...(error.reason?{reason:error.reason}:{}),...(error.patchOptions?{options:error.patchOptions}:{})});return true;}}
      if(url.pathname==='/api/content/chat-edits/cancel'&&request.method==='POST'){try{send(response,200,{request:chatEdits.cancelMeasurement(profileId,await readBody(request))});}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      // Short CHECK preview of a camera+screen pair at an offset (side by side, both audios); never the edit or an authority.
      if(url.pathname==='/api/content/chat-edits/sync-preview'&&request.method==='GET'){try{const file=await chatEdits.syncPreview(profileId,{sessionId:url.searchParams.get('session')??'',messageId:url.searchParams.get('message')??'',offsetSeconds:Number(url.searchParams.get('offset'))});const bytes=await readFile(file.path);response.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'none'});response.end(bytes);}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      // Open usage-limit waits of this profile (provider, since, reset only when the provider sent it). Read-only.
      if(url.pathname==='/api/content/provider-waits'&&request.method==='GET'){send(response,200,{waits:production.providerWaits(profileId)});return true;}
      const adjustPreviewRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/adjust-preview$/);
      if(adjustPreviewRoute&&request.method==='GET'){try{const file=await production.adjustPreviewFile(profileId,decodeURIComponent(adjustPreviewRoute[1]),url.searchParams.get('sha256')??'');response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','accept-ranges':'none'});response.end(file.bytes);}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      const coverRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/cover$/);
      if(coverRoute&&request.method==='GET'){try{const file=await production.coverFile(profileId,decodeURIComponent(coverRoute[1]),url.searchParams.get('assetId')??'',url.searchParams.get('versionId')??'');response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(file.bytes);}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      const captionPreviewRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/caption-preview$/);
      if(captionPreviewRoute&&request.method==='GET'){const abort=new AbortController();response.on('close',()=>{if(!response.writableFinished)abort.abort();});try{const file=await production.captionPreview(profileId,decodeURIComponent(captionPreviewRoute[1]),{version:url.searchParams.get('version'),hash:url.searchParams.get('hash')??'',style:url.searchParams.get('style')??'',start:url.searchParams.get('start')},abort.signal);if(abort.signal.aborted)return true;response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-caption-preview':JSON.stringify({version:file.version,hash:file.hash,style:file.style,start:file.start,duration:file.duration,cached:!!file.cached,font:file.font,visible:file.visible})});response.end(file.bytes);}catch(error){if(!response.headersSent&&!abort.signal.aborted)send(response,error.status??500,{error:error.message});else if(!response.writableEnded)response.end();}return true;}
      if(url.pathname==='/api/content/srt'){try{if(request.method==='GET'){send(response,200,{documents:srt.list(profileId,url.searchParams.get('contentId')??'')});return true;}if(request.method==='POST'){send(response,200,await srt.command(profileId,await readBody(request)));return true;}}catch(error){send(response,error.status??500,{error:error.message});return true;}}
      if(url.pathname==='/api/content/srt/file'&&request.method==='GET'){try{const file=await srt.file(profileId,{contentId:url.searchParams.get('contentId')??'',docId:url.searchParams.get('docId')??'',sha256:url.searchParams.get('sha256')??''});response.writeHead(200,{'content-type':'application/x-subrip; charset=utf-8','content-length':file.bytes.length,'content-disposition':`attachment; filename="${file.name.replace(/[^\w.-]/g,'_')}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(file.bytes);}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      if(url.pathname==='/api/content/productions/captions-capabilities'&&request.method==='GET'){send(response,200,await production.captionCapabilities());return true;}
      const framesRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/frames$/);
      if(framesRoute&&request.method==='GET'){try{send(response,200,await production.coverCandidates(profileId,decodeURIComponent(framesRoute[1])));}catch(error){send(response,error.status??500,{error:error.message});}return true;}
      const frameRoute=url.pathname.match(/^\/api\/content\/productions\/([^/]+)\/frame$/);
      if(frameRoute&&request.method==='GET'){const abort=new AbortController();response.on('close',()=>{if(!response.writableFinished)abort.abort();});try{const file=await production.coverFrame(profileId,decodeURIComponent(frameRoute[1]),{timestampSeconds:url.searchParams.get('t'),versionId:url.searchParams.get('versionId')??'',sha256:url.searchParams.get('sha256')??''},abort.signal);if(abort.signal.aborted)return true;response.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-timestamp':String(file.timestampSeconds)});response.end(file.bytes);}catch(error){if(!response.headersSent&&!abort.signal.aborted)send(response,error.status??500,{error:error.message});}return true;}
      // Who directs edits/motion in a workspace (default Claude Code); never changes agents or existing runs.
      if(url.pathname==='/api/content/productions/edit-director'){try{if(request.method==='GET'){send(response,200,{director:production.editDirector(profileId,url.searchParams.get('workspace')??'')});return true;}if(request.method==='POST'){send(response,200,{director:production.setEditDirector(profileId,await readBody(request))});return true;}}catch(error){send(response,error.status??500,{error:error.message});return true;}}
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
      // Verified Paper exports of one chat (host receipts from the export tool's actual result), in export order.
      if(url.pathname==='/api/content/paper-exports'&&request.method==='GET'){send(response,200,paperAssets.exports(profileId,{sessionId:url.searchParams.get('session')??''}));return true;}
      // Chat scheduling requests and the app's single confirmation for a schedule without the saved preference.
      if(url.pathname==='/api/content/chat-publishing'&&request.method==='GET'){send(response,200,{requests:chatPublishing.list(profileId,url.searchParams.get('session')||undefined)});return true;}
      const chatPublishingRoute=url.pathname.match(/^\/api\/content\/chat-publishing\/([^/]+)\/decision$/);
      if(chatPublishingRoute&&request.method==='POST'){const input=await readBody(request),requestId=decodeURIComponent(chatPublishingRoute[1]),saved=chatPublishing.list(profileId).find(item=>item.id===requestId),bound=saved&&sessionBinding(saved.sessionId);
        if(!bound){send(response,409,{error:'This scheduling request is no longer bound to a saved chat.'});return true;}
        try{send(response,200,await chatPublishing.decide(bound,{requestId,hash:input.hash,decision:input.decision}));}catch(error){send(response,error.status??409,{error:error.message});}return true;}
      // Host delivery receipts: re-verified on request; only ids of this profile resolve.
      const receiptRoute=url.pathname.match(/^\/api\/content\/receipts\/([^/]+)$/);
      if(receiptRoute&&request.method==='GET'){try{send(response,200,await receipts.check(profileId,decodeURIComponent(receiptRoute[1])));}catch(error){send(response,error.status??500,{error:error.message});}return true;}
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
        let state = input.state;
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || state?.schemaVersion !== 1 || !['topics', 'contents', 'runs', 'artifacts', 'approvals'].every((key) => Array.isArray(state[key])) || !validateEditorialAssets(state)||!validatePublications(state)||!validateInspirationState(state)) {
          send(response, 400, { error: 'Invalid editorial state.' }); return true;
        }
        const current = read.get(profileId);
        if ((current?.revision ?? 0) !== input.revision) { send(response, 409, { error: 'Editorial data changed in another window. Reload before editing.' }); return true; }
        const previous=current?JSON.parse(current.state_json):{};
        // A stale window may still hold a content deleted locally: its records (and the topic's pointer) are dropped before
        // the provider check below, so a confirmed delivery of that content is not taken for an edit of provider operations.
        const cleaned=stripDeletedEditorial(state,deletedIds(db,profileId)),stripped=cleaned!==state;if(stripped)state=cleaned;
        const protectedFields=item=>JSON.stringify({operation:item?.operation,receipt:item?.receipt});
        if((state.publications??[]).some(item=>protectedFields(item)!==protectedFields(previous.publications?.find(old=>old.id===item.id)))||(previous.publications??[]).some(item=>item.operation&&!state.publications?.some(next=>next.id===item.id&&JSON.stringify(next)===JSON.stringify(item)))){send(response,409,{error:'Provider operations can only change through the publishing service. Reconcile before editing.'});return true;}
        const next = input.revision + 1;
        const json = JSON.stringify(state);
        const at = new Date().toISOString();
        if (current) update.run(next, json, at, profileId, input.revision);
        else insert.run(profileId, next, json, at);
        send(response, 200, { revision: next, ...(stripped?{stripped:true}:{}) });
        return true;
      }
      send(response, 405, { error: 'Method not allowed.' });
      return true;
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : 'Editorial storage failed.' });
      return true;
    }
  }

  return { handle, deletion, production,chatEdits,receipts,paperAssets,chatPublishing,sessionBinding,jobs, work, deliveries, publications,publishing,statusRefresh,analyses,calendar,calendarCredentials,media,actions,binding,claudeBinding:remoteSessionId=>binding(remoteSessionId,undefined,'claude'),delegations,agents:()=>getAgents?.(getCurrentProfile?.())??[], srt, close: async () => {srt.close();await statusRefresh.close();await analyses.close();await production.close();actions.close();await calendar.close();await publishing.close();await media.close();await delegations.close();await work.close();await jobs.close();db.close();} };
}
