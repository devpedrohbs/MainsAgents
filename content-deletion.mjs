import {createHash} from 'node:crypto';
import {linkedStateKeys,sanitizeLinkedValue,stripDeletedEditorial} from './content-deletion-model.mjs';

/**
 * Local, durable deletion of ONE content (EditorialContent) and everything MainsAgents keeps for it: chats in every agent,
 * productions, specialist work, SRT documents, jobs, receipts, drafts, pointers and editorial records. Nothing on disk is
 * removed (raw recordings, chosen files, renders and exports stay), and nothing external is mutated: Notion/Paper, accounts,
 * agents, backups and posts/schedules already sent to a provider are never touched.
 *
 * Anti-resurrection: a tombstone (IDs only, no titles or text) fences the content and its linked IDs. SQLite triggers refuse
 * any later INSERT/UPDATE that would bring the content back (late callbacks, stale renderer writes, restarted workers), and
 * the state store strips fenced chats/pointers from every linked key. Links are always real IDs, never titles.
 */
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const json=value=>{try{return JSON.parse(value);}catch{return undefined;}};
const idText=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const failure=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
const activeStages=['writing','notion','planning-edit','editing','preparing-package','generating-cover','scheduling'];
const productionOwned=item=>typeof item?.id==='string'&&(item.id.startsWith('production:')||item.id.startsWith('delegation-'));
export {linkedStateKeys,sanitizeLinkedValue,stripDeletedEditorial};

export function ensureContentFences(db){
 db.exec(`CREATE TABLE IF NOT EXISTS content_tombstones(profile_id TEXT NOT NULL,content_id TEXT NOT NULL,workspace_id TEXT NOT NULL,status TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,PRIMARY KEY(profile_id,content_id));
 CREATE TABLE IF NOT EXISTS content_tombstone_ids(profile_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,content_id TEXT NOT NULL,PRIMARY KEY(profile_id,kind,id));
 CREATE TABLE IF NOT EXISTS content_deletion_requests(profile_id TEXT NOT NULL,request_id TEXT NOT NULL,content_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(profile_id,request_id));
 CREATE TABLE IF NOT EXISTS deleted_content_delivery_facts(profile_id TEXT NOT NULL,publication_id TEXT NOT NULL,data_json TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(profile_id,publication_id));`);
}

/** Purges running in THIS process (request ids): a host recovery never drops the fence of a deletion that is still alive. */
const livePurges=new Set();

/**
 * Host startup only (single instance proven, before workers admit new jobs): a 'purging' fence left by a process that died
 * between the fence and the commit is removed, so the content can be reviewed and deleted again. Nothing else changes:
 * local data stays (the commit never ran), 'deleted' tombstones stay, work already canceled stays canceled and the purge is
 * never completed automatically. Fences of purges alive in this process are kept. Returns ids only.
 */
export function recoverAbandonedDeletions(db){
 ensureContentFences(db);
 const recovered=[];
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of db.prepare("SELECT profile_id,content_id,request_id FROM content_tombstones WHERE status='purging'").all()){
   if(livePurges.has(row.request_id))continue;
   db.prepare('DELETE FROM content_tombstone_ids WHERE profile_id=? AND content_id=?').run(row.profile_id,row.content_id);
   db.prepare("DELETE FROM content_tombstones WHERE profile_id=? AND content_id=? AND status='purging'").run(row.profile_id,row.content_id);
   recovered.push({profileId:row.profile_id,contentId:row.content_id});
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return recovered;
}

/** Fence of one id: 'deleted' (gone for good), 'purging' (no new work; acknowledgments still allowed) or null. */
const fenceSql=(kind,idExpr,profileExpr)=>`(SELECT CASE WHEN i.content_id='' THEN 'deleted' ELSE t.status END FROM content_tombstone_ids i LEFT JOIN content_tombstones t ON t.profile_id=i.profile_id AND t.content_id=i.content_id WHERE i.profile_id=${profileExpr} AND i.kind='${kind}' AND i.id=${idExpr})`;
const contentFenceSql=(idExpr,profileExpr)=>`(SELECT status FROM content_tombstones WHERE profile_id=${profileExpr} AND content_id=${idExpr})`;
const tableExists=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const hasColumns=(db,table,names)=>{const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));return names.every(name=>columns.has(name));};

/**
 * Database-level guards: every writer (coordinator put, delegation queue, SRT, media/work/Notion jobs, receipts and any
 * editorial_state writer) is refused when it would recreate a deleted content or start NEW work during a purge (new rows,
 * or existing rows moved back to an active state). Other writes of existing rows pass during 'purging', so cancel
 * acknowledgments and terminal states can be recorded.
 */
export function ensureContentFenceTriggers(db){
 ensureContentFences(db);
 const guard=(table,name,condition,event='INSERT')=>{if(!tableExists(db,table)||!hasColumns(db,table,[...condition.matchAll(/NEW\.([a-z_]+)/g)].map(match=>match[1])))return;db.exec(`DROP TRIGGER IF EXISTS ${name}; CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW WHEN ${condition} BEGIN SELECT RAISE(ABORT,'This content was deleted locally; its work cannot be recreated.'); END;`);};
 /**
  * During 'purging' only rows that already exist may be written (cancel acknowledgments, terminal states, progress of work
  * already being stopped); a row going from idle/terminal back to active (retry, resume, re-queue) is new work and refused,
  * whether it comes as INSERT OR REPLACE or as UPDATE.
  */
 const fencedTable=(table,name,fences,key,active)=>{
  const row=`SELECT 1 FROM ${table} o WHERE ${key('o')}`;
  for(const [index,fence] of fences.entries()){
   guard(table,`${name}${index?`_${index}`:''}`,`(${fence}='deleted' OR (${fence}='purging' AND (NOT EXISTS(${row}) OR (${active('NEW')} AND NOT EXISTS(${row} AND ${active('o')})))))`);
   guard(table,`${name}${index?`_${index}`:''}_update`,`(${fence}='purging' AND ${active('NEW')} AND NOT (${active('OLD')}))`,'UPDATE');
  }
 };
 const queued=row=>`${row}.status IN ('queued','running')`;
 const byId=row=>`${row}.id=NEW.id`;
 fencedTable('production_runs','fence_production_runs',[contentFenceSql('NEW.content_id','NEW.profile_id'),fenceSql('run','NEW.id','NEW.profile_id')],byId,row=>`json_extract(${row}.data_json,'$.stage') IN (${activeStages.map(stage=>`'${stage}'`).join(',')})`);
 // Shadows have no status: during the purge, existing ones still record acknowledgments; new ones are refused.
 fencedTable('agent_delegation_sessions','fence_delegation_sessions',[fenceSql('session','NEW.id','NEW.profile_id'),contentFenceSql("json_extract(NEW.data_json,'$.contentId')",'NEW.profile_id')],byId,()=>'0');
 fencedTable('agent_delegation_jobs','fence_delegation_jobs',[fenceSql('session',"json_extract(NEW.data_json,'$.sourceSessionId')",'NEW.profile_id'),fenceSql('session',"json_extract(NEW.data_json,'$.targetSessionId')",'NEW.profile_id')],byId,queued);
 // Chat edit requests (chat-edit-requests.mjs): a deleted chat/content never gets a new admission row or an admission back to active.
 fencedTable('chat_edit_requests','fence_chat_edit_requests',[fenceSql('session','NEW.session_id','NEW.profile_id'),contentFenceSql('NEW.content_id','NEW.profile_id')],row=>`${row}.profile_id=NEW.profile_id AND ${row}.key=NEW.key`,row=>`${row}.status='admitted'`);
 // Camera + screen pair of a content (source-pairs.mjs): never recreated for a deleted content.
 fencedTable('content_source_pairs','fence_source_pairs',[contentFenceSql('NEW.content_id','NEW.profile_id')],row=>`${row}.profile_id=NEW.profile_id AND ${row}.content_id=NEW.content_id`,()=>'0');
 fencedTable('content_srt_documents','fence_srt_documents',[contentFenceSql('NEW.content_id','NEW.profile_id')],row=>`${row}.profile_id=NEW.profile_id AND ${row}.id=NEW.id`,row=>`json_extract(${row}.data_json,'$.job.status')='running'`);
 fencedTable('editorial_media_jobs','fence_media_jobs',[contentFenceSql("json_extract(NEW.data_json,'$.contentId')",'NEW.profile_id')],byId,queued);
 fencedTable('workflow_work','fence_workflow_work',[contentFenceSql("json_extract(NEW.data_json,'$.contentId')",'NEW.profile_id')],byId,queued);
 fencedTable('editorial_jobs','fence_editorial_jobs',[contentFenceSql('NEW.content_id','NEW.profile_id')],byId,queued);
 guard('delivery_receipts','fence_delivery_receipts',`${contentFenceSql("json_extract(NEW.data_json,'$.contentId')",'NEW.profile_id')}='deleted' OR ${fenceSql('session',"json_extract(NEW.data_json,'$.sessionId')",'NEW.profile_id')}='deleted' OR ${fenceSql('run',"json_extract(NEW.data_json,'$.source.id')",'NEW.profile_id')}='deleted'`);
 if(tableExists(db,'editorial_state')){
  const refers=(path,field)=>`EXISTS(SELECT 1 FROM json_each(NEW.state_json,'$.${path}') j JOIN content_tombstones t ON t.profile_id=NEW.profile_id AND t.status='deleted' AND t.content_id=json_extract(j.value,'$.${field}'))`;
  const condition=`EXISTS(SELECT 1 FROM content_tombstones WHERE profile_id=NEW.profile_id AND status='deleted') AND (${refers('contents','id')} OR ${refers('artifacts','contentId')} OR ${refers('approvals','contentId')} OR ${refers('runs','contentId')} OR ${refers('assets','contentId')} OR ${refers('publications','contentId')})`;
  for(const event of ['INSERT','UPDATE'])db.exec(`DROP TRIGGER IF EXISTS fence_editorial_state_${event.toLowerCase()}; CREATE TRIGGER fence_editorial_state_${event.toLowerCase()} BEFORE ${event} ON editorial_state FOR EACH ROW WHEN ${condition} BEGIN SELECT RAISE(ABORT,'This content was deleted locally; its records cannot be recreated.'); END;`);
 }
}

/** IDs that are gone for good in a profile (deleted contents and their linked ids, plus individually deleted chats). */
export function deletedIds(db,profile){
 if(!tableExists(db,'content_tombstones'))return {contents:new Set(),sessions:new Set(),runs:new Set(),artifacts:new Set()};
 const contents=new Set(db.prepare("SELECT content_id FROM content_tombstones WHERE profile_id=? AND status='deleted'").all(profile).map(row=>row.content_id));
 const rows=db.prepare("SELECT i.kind,i.id FROM content_tombstone_ids i LEFT JOIN content_tombstones t ON t.profile_id=i.profile_id AND t.content_id=i.content_id WHERE i.profile_id=? AND (i.content_id='' OR t.status='deleted')").all(profile);
 const of=kind=>new Set(rows.filter(row=>row.kind===kind).map(row=>row.id));
 return {contents,sessions:of('session'),runs:of('run'),artifacts:of('artifact')};
}
/**
 * A backup made before a local deletion still holds that content. Restoring it keeps everything else and leaves out only
 * what was deleted on this computer (the tombstones stay; a restore never brings deleted contents/chats back). Returns the
 * cleaned copies and what was left out, so the person is told.
 */
export function stripDeletedFromRestore(db,profile,{values={},editorial,execution}={}){
 const ids=deletedIds(db,profile);
 const omitted={contents:0,sessions:0};
 if(!ids.contents.size&&!ids.sessions.size)return {values,editorial,execution,omitted};
 const cleanValues=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,linkedStateKeys.includes(key)?sanitizeLinkedValue(key,value,ids):value]));
 if(Array.isArray(values.sessions)&&Array.isArray(cleanValues.sessions))omitted.sessions=values.sessions.length-cleanValues.sessions.length;
 const cleanEditorial=stripDeletedEditorial(editorial,ids);
 if(Array.isArray(editorial?.contents)&&Array.isArray(cleanEditorial?.contents))omitted.contents=editorial.contents.length-cleanEditorial.contents.length;
 let cleanExecution=execution;
 if(execution?.state&&typeof execution.state==='object'){
  const state=execution.state,data=row=>json(row?.data_json)??{};
  const goneSession=id=>typeof id==='string'&&ids.sessions.has(id),goneContent=id=>typeof id==='string'&&ids.contents.has(id);
  const keep=(list,test)=>Array.isArray(list)?list.filter(row=>!test(row)):list;
  cleanExecution={...execution,state:{...state,
   jobs:keep(state.jobs,row=>goneContent(row.content_id)),
   actions:keep(state.actions,row=>goneSession(json(row.payload_json)?.sessionId)),
   delegations:keep(state.delegations,row=>goneSession(data(row).sourceSessionId)||goneSession(data(row).targetSessionId)),
   delegationSessions:keep(state.delegationSessions,row=>goneSession(row.id)||goneContent(data(row).contentId)),
   mediaJobs:keep(state.mediaJobs,row=>goneContent(data(row).contentId)),
   productions:keep(state.productions,row=>goneContent(row.content_id)||ids.runs.has(row.id)),
   work:keep(state.work,row=>goneContent(data(row).contentId))}};
 }
 return {values:cleanValues,editorial:cleanEditorial,execution:cleanExecution,omitted};
}

/** True when a chat is fenced (deleted, or part of a content being purged): no new work may start for it. */
export function isSessionFenced(db,profile,id){if(!tableExists(db,'content_tombstone_ids')||typeof id!=='string')return false;const row=db.prepare("SELECT CASE WHEN i.content_id='' THEN 'deleted' ELSE t.status END AS fence FROM content_tombstone_ids i LEFT JOIN content_tombstones t ON t.profile_id=i.profile_id AND t.content_id=i.content_id WHERE i.profile_id=? AND i.kind='session' AND i.id=?").get(profile,id);return Boolean(row?.fence);}
export function isContentFenced(db,profile,id){return tableExists(db,'content_tombstones')&&Boolean(db.prepare('SELECT 1 FROM content_tombstones WHERE profile_id=? AND content_id=?').get(profile,id));}

/**
 * @param db the bridge connection (same SQLite file as the desktop state store: one atomic transaction covers both).
 */
export function createContentDeletion(db,{getCurrentProfile,getAgents,production,delegations,media,work,jobs,srt,actions,pollMs=150,stopTimeoutMs=15_000}={}){
 ensureContentFences(db);
 const has=name=>tableExists(db,name);
 const all=(name,sql,...args)=>has(name)?db.prepare(sql).all(...args):[];
 const profileCheck=profile=>{if(getCurrentProfile&&getCurrentProfile()!==profile)throw failure(409,'O perfil ativo mudou. Reabra o espaço de trabalho.');};
 const stateValue=(profile,key)=>{if(!has('state'))return {raw:undefined,value:undefined};const raw=db.prepare('SELECT value FROM state WHERE profile=? AND key=?').get(profile,key)?.value;return {raw,value:raw===undefined?undefined:json(raw)};};
 const editorial=profile=>{const row=has('editorial_state')?db.prepare('SELECT revision,state_json FROM editorial_state WHERE profile_id=?').get(profile):undefined;return row?{revision:row.revision,state:JSON.parse(row.state_json)}:null;};
 const tombstone=(profile,contentId)=>db.prepare('SELECT * FROM content_tombstones WHERE profile_id=? AND content_id=?').get(profile,contentId);
 const runRows=(profile,contentId)=>all('production_runs','SELECT id,workspace_id,data_json FROM production_runs WHERE profile_id=? AND content_id=?',profile,contentId).map(row=>({...JSON.parse(row.data_json),id:row.id,workspaceId:row.workspace_id}));

 /** Everything linked to the content by real ids, what is busy, and what blocks a local deletion. Never mutates. */
 function collect(profile,contentId,workspaceId){
  const current=editorial(profile),state=current?.state;
  const content=state?.contents?.find(item=>item.id===contentId);
  if(!content||content.workspaceId!==workspaceId)throw failure(404,'Este conteúdo não existe mais neste espaço de trabalho.');
  const workspaceAgents=new Set((getAgents?.(profile)??[]).filter(agent=>agent.workspaceId===workspaceId).map(agent=>agent.id));
  const sessions=Array.isArray(stateValue(profile,'sessions').value)?stateValue(profile,'sessions').value:[];
  const blockers=[],busy=[];
  const runs=runRows(profile,contentId);
  for(const run of runs)if(run.workspaceId!==workspaceId)blockers.push({kind:'shared',message:'Uma produção deste conteúdo pertence a outro espaço de trabalho; nada foi apagado.'});
  const sessionIds=new Set(sessions.filter(session=>session.contentId===contentId).map(session=>session.id));
  // Role chats of the content's productions: deleted with it unless they hold another content or a General conversation of their own.
  for(const run of runs)for(const role of [run.sourceSession,run.editorSession,run.publisherSession]){
   if(!role?.id)continue;const saved=sessions.find(session=>session.id===role.id);
   if(saved?.contentId&&saved.contentId!==contentId){blockers.push({kind:'shared',message:`A conversa “${saved.title}” pertence a outro conteúdo e também é usada por esta produção; nada foi apagado.`});continue;}
   if(saved&&!saved.contentId&&(saved.messages??[]).some(item=>item?.type==='message'&&!productionOwned(item))){blockers.push({kind:'shared',message:`A conversa geral “${saved.title}” tem histórico próprio e também é usada por esta produção. Organize ou exclua essa conversa antes; nada foi apagado.`});continue;}
   sessionIds.add(role.id);
  }
  const shadows=all('agent_delegation_sessions','SELECT id,data_json FROM agent_delegation_sessions WHERE profile_id=?',profile).map(row=>({...JSON.parse(row.data_json),id:row.id}));
  for(const shadow of shadows)if(shadow.contentId===contentId)sessionIds.add(shadow.id);
  const delegationJobs=all('agent_delegation_jobs','SELECT id,status,data_json FROM agent_delegation_jobs WHERE profile_id=?',profile).map(row=>({...JSON.parse(row.data_json),id:row.id,status:row.status})).filter(job=>sessionIds.has(job.sourceSessionId)||sessionIds.has(job.targetSessionId));
  const runIds=new Set(runs.map(run=>run.id));
  const artifacts=(state.artifacts??[]).filter(item=>item.contentId===contentId),artifactIds=new Set(artifacts.map(item=>item.id));
  const approvals=(state.approvals??[]).filter(item=>item.contentId===contentId||artifactIds.has(item.artifactId));
  const editorialRuns=(state.runs??[]).filter(item=>item.contentId===contentId);
  const assets=(state.assets??[]).filter(item=>item.contentId===contentId);
  const publications=(state.publications??[]).filter(item=>item.contentId===contentId);
  const topics=(state.topics??[]).filter(item=>item.contentId===contentId);
  const srtDocs=all('content_srt_documents','SELECT id,data_json FROM content_srt_documents WHERE profile_id=? AND content_id=?',profile,contentId).map(row=>({...JSON.parse(row.data_json),id:row.id}));
  const notionJobs=all('editorial_jobs','SELECT id,status FROM editorial_jobs WHERE profile_id=? AND content_id=?',profile,contentId);
  const workJobs=all('workflow_work','SELECT id,status,data_json FROM workflow_work WHERE profile_id=?',profile).filter(row=>json(row.data_json)?.contentId===contentId);
  const mediaJobs=all('editorial_media_jobs','SELECT id,status,data_json FROM editorial_media_jobs WHERE profile_id=?',profile).filter(row=>json(row.data_json)?.contentId===contentId);
  const runtimeActions=all('runtime_actions','SELECT id,status,payload_json FROM runtime_actions WHERE profile_id=?',profile).filter(row=>sessionIds.has(json(row.payload_json)?.sessionId));
  const publishRequests=all('chat_publication_requests','SELECT id,status,data_json FROM chat_publication_requests WHERE profile_id=?',profile).filter(row=>{const data=json(row.data_json);return sessionIds.has(data?.sessionId)||data?.contentId===contentId;});
  const chatEdits=all('chat_edit_requests','SELECT key,session_id,content_id FROM chat_edit_requests WHERE profile_id=?',profile).filter(row=>sessionIds.has(row.session_id)||row.content_id===contentId);
  const publishIntents=all('chat_publication_intents','SELECT session_id,message_id FROM chat_publication_intents WHERE profile_id=?',profile).filter(row=>sessionIds.has(row.session_id));
  const jobIds=new Set(delegationJobs.map(job=>job.id));
  const receipts=all('delivery_receipts','SELECT id,data_json FROM delivery_receipts WHERE profile_id=?',profile).filter(row=>{const data=json(row.data_json);return data?.contentId===contentId||sessionIds.has(data?.sessionId)||runIds.has(data?.source?.id)||jobIds.has(data?.source?.id);});
  // Cached transcripts/silences/audio of this content's video versions, unless another content uses the same version.
  const otherVersions=new Set((state.assets??[]).filter(item=>item.contentId!==contentId).flatMap(item=>(item.versions??[]).map(version=>version.id)));
  const versionIds=[...new Set(assets.flatMap(item=>(item.versions??[]).map(version=>version.id)))].filter(id=>!otherVersions.has(id));
  const mediaCache=['editorial_transcripts','editorial_silences','editorial_audio'].map(name=>({name,count:versionIds.length&&has(name)?db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE profile_id=? AND version_id IN (${versionIds.map(()=>'?').join(',')})`).get(profile,...versionIds).n:0}));
  // Busy local work (stoppable on request) and external operations (never canceled or published from here).
  for(const run of runs){
   if(run.stage==='scheduling')blockers.push({kind:'external',message:`A produção “${run.name??run.id}” está enviando agendamentos ao provedor. Aguarde terminar; nada foi apagado.`});
   else if(activeStages.includes(run.stage)||production?.activity?.(profile,run.id))busy.push({kind:'production',id:run.id,label:run.name??'Produção',stage:run.stage});
  }
  for(const job of delegationJobs)if(['queued','running'].includes(job.status)||delegations?.isActive?.(job.id))busy.push({kind:'delegation',id:job.id,label:job.title??'Trabalho de especialista'});
  for(const row of mediaJobs)if(['queued','running'].includes(row.status))busy.push({kind:'media',id:row.id,label:'Exportação de vídeo'});
  for(const row of workJobs)if(['queued','running'].includes(row.status))busy.push({kind:'work',id:row.id,label:'Trabalho de pesquisa/roteiro'});
  for(const row of notionJobs)if(['queued','running'].includes(row.status))busy.push({kind:'notion',id:row.id,label:'Sincronização com Notion'});
  for(const doc of srtDocs)if(doc.job?.status==='running'||srt?.isRunning?.(doc.id))busy.push({kind:'srt',id:doc.id,label:'Transcrição do SRT'});
  for(const row of runtimeActions)if(['pending','approved','running'].includes(row.status))busy.push({kind:'action',id:row.id,label:'Ação de ferramenta aguardando'});
  for(const item of editorialRuns)if(item.state==='running')busy.push({kind:'editorial-run',id:item.id,label:'Etapa editorial em andamento'});
  for(const row of publishRequests)if(['running','uncertain'].includes(row.status))blockers.push({kind:'external',message:'Um agendamento pedido pelo chat está em envio ou com resultado incerto no provedor. Reconcilie antes; nada foi apagado.'});
  const facts=[];
  for(const item of publications){
   const phase=item.operation?.phase;
   if(['requesting','uncertain'].includes(phase)||item.status==='sending')blockers.push({kind:'external',message:`A entrega para ${item.platform} está em envio ou com resultado incerto no provedor. Reconcilie antes; nada foi apagado.`});
   else if(phase==='confirmed'||item.receipt?.id)facts.push(item);
  }
  // Same title in another content never matters: everything above is matched by id.
  const byAgent={};for(const id of sessionIds){const session=sessions.find(item=>item.id===id)??shadows.find(item=>item.id===id)??runs.flatMap(run=>[run.sourceSession,run.editorSession,run.publisherSession]).find(item=>item?.id===id);if(!session)continue;const agentId=session.agentId??'unknown';byAgent[agentId]=(byAgent[agentId]??0)+1;}
  for(const agentId of Object.keys(byAgent))if(agentId!=='unknown'&&workspaceAgents.size&&!workspaceAgents.has(agentId)&&sessions.some(item=>item.id&&sessionIds.has(item.id)&&item.agentId===agentId&&item.contentId!==contentId))blockers.push({kind:'shared',message:'Uma conversa ligada pertence a um agente de outro espaço de trabalho; nada foi apagado.'});
  const visibleChats=sessions.filter(session=>sessionIds.has(session.id)).length;
  const counts={chats:visibleChats,chatsByAgent:byAgent,productions:runs.length,specialistWork:delegationJobs.length,srtDocuments:srtDocs.length,artifacts:artifacts.length+approvals.length+editorialRuns.length,assets:assets.length,publications:publications.length-facts.length,deliveryFactsKept:facts.length,jobs:notionJobs.length+workJobs.length+mediaJobs.length,receipts:receipts.length,toolActions:runtimeActions.length+publishRequests.length};
  const fingerprint=hash(JSON.stringify({contentId,workspaceId,sessions:[...sessionIds].sort(),runs:[...runIds].sort(),jobs:[...jobIds].sort(),srt:srtDocs.map(doc=>doc.id).sort(),artifacts:[...artifactIds].sort(),assets:assets.map(item=>item.id).sort(),publications:publications.map(item=>item.id).sort(),
   // Work created after the review (never shown in the dialog) makes it stale instead of being stopped without consent.
   work:[...notionJobs,...workJobs,...mediaJobs,...runtimeActions,...publishRequests].map(row=>row.id).sort()}));
  return {content,state:current,sessionIds,runIds,jobIds,artifactIds,runs,artifacts,approvals,editorialRuns,assets,publications,facts,topics,srtDocs,notionJobs,workJobs,mediaJobs,runtimeActions,publishRequests,publishIntents,chatEdits,receipts,versionIds,mediaCache,busy,blockers,counts,fingerprint};
 }
 const view=(profile,plan)=>({contentId:plan.content.id,workspaceId:plan.content.workspaceId,title:plan.content.title,counts:plan.counts,busy:plan.busy,blockers:plan.blockers,fingerprint:plan.fingerprint,
  sessionIds:[...plan.sessionIds],keeps:'local-only'});

 function preview(profile,input={}){
  profileCheck(profile);
  if(!idText(input.contentId)||!idText(input.workspaceId))throw failure(400,'Conteúdo inválido.');
  const stone=tombstone(profile,input.contentId);
  if(stone?.status==='deleted')return {contentId:input.contentId,alreadyDeleted:true};
  if(stone?.status==='purging')throw failure(409,'A exclusão deste conteúdo já está em andamento.');
  return view(profile,collect(profile,input.contentId,input.workspaceId));
 }

 const fence=(profile,plan,requestId)=>{
  db.exec('BEGIN IMMEDIATE');
  try{
   if(tombstone(profile,plan.content.id))throw failure(409,'A exclusão deste conteúdo já está em andamento.');
   db.prepare('INSERT INTO content_tombstones VALUES(?,?,?,?,?,?,NULL)').run(profile,plan.content.id,plan.content.workspaceId,'purging',requestId,now());
   const add=db.prepare('INSERT OR IGNORE INTO content_tombstone_ids VALUES(?,?,?,?)');
   for(const id of plan.sessionIds)add.run(profile,'session',id,plan.content.id);
   for(const id of plan.runIds)add.run(profile,'run',id,plan.content.id);
   for(const id of plan.artifactIds)add.run(profile,'artifact',id,plan.content.id);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 };
 const unfence=(profile,contentId,requestId)=>{
  db.exec('BEGIN IMMEDIATE');
  try{if(tombstone(profile,contentId)?.request_id===requestId&&tombstone(profile,contentId)?.status==='purging'){db.prepare('DELETE FROM content_tombstone_ids WHERE profile_id=? AND content_id=?').run(profile,contentId);db.prepare('DELETE FROM content_tombstones WHERE profile_id=? AND content_id=?').run(profile,contentId);}db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
 };
 /** Asks every LOCAL worker to stop through its own cancel path. Nothing is killed; external operations are not here. */
 async function stopLocal(profile,plan){
  const attempts=[];
  for(const item of plan.busy){
   try{
    if(item.kind==='production'){const run=production?.get?.(profile,item.id);if(run&&!['complete','canceled'].includes(run.stage))await production.command(profile,{id:run.id,revision:run.revision,action:'cancel',requestId:`content-delete-${plan.content.id}-${run.id}-${run.revision}`});}
    else if(item.kind==='delegation')await delegations?.cancel(profile,item.id,'A conversa foi excluída junto com o conteúdo.');
    else if(item.kind==='media')await media?.cancel(profile,item.id);
    else if(item.kind==='work')await work?.cancel(profile,item.id,{});
    else if(item.kind==='notion')jobs?.cancel(profile,item.id);
    else if(item.kind==='srt'){const doc=plan.srtDocs.find(entry=>entry.id===item.id);if(doc)await srt?.command(profile,{action:'cancel',contentId:doc.contentId,docId:doc.id});}
    else if(item.kind==='action'){const row=plan.runtimeActions.find(entry=>entry.id===item.id),payload=json(row?.payload_json);if(row?.status==='pending'&&payload?.executionId)actions?.interrupt?.(payload.executionId,'A conversa foi excluída junto com o conteúdo.');}
   }catch(error){attempts.push({...item,error:error.message});}
  }
  return attempts;
 }

 /** Atomic purge of everything collected (one transaction on the shared database), then the tombstone becomes final. */
 function commit(profile,plan,requestId,fingerprint){
  const contentId=plan.content.id,removed={sessions:plan.sessionIds,contents:new Set([contentId]),runs:plan.runIds,artifacts:plan.artifactIds};
  const stateChanges={};
  db.exec('BEGIN IMMEDIATE');
  try{
   const latest=editorial(profile);
   if(!latest?.state.contents?.some(item=>item.id===contentId&&item.workspaceId===plan.content.workspaceId))throw failure(409,'O conteúdo mudou durante a exclusão; nada foi apagado.');
   const state=latest.state,keep=item=>item.contentId!==contentId;
   const factIds=new Set(plan.facts.map(item=>item.id)),removedPublications=(state.publications??[]).filter(item=>item.contentId===contentId).map(item=>item.id);
   const next={...state,contents:state.contents.filter(item=>item.id!==contentId),artifacts:state.artifacts.filter(item=>keep(item)&&!plan.artifactIds.has(item.id)),approvals:state.approvals.filter(item=>keep(item)&&!plan.artifactIds.has(item.artifactId)),runs:state.runs.filter(keep),
    topics:state.topics.map(topic=>topic.contentId===contentId?(({contentId:_c,...rest})=>({...rest,updatedAt:now()}))(topic):topic),
    ...(state.assets?{assets:state.assets.filter(keep)}:{}),...(state.publications?{publications:state.publications.filter(keep)}:{})};
   // External deliveries keep only the minimal fact for deduplication/reconciliation: no text, transcript or draft.
   for(const item of (state.publications??[]).filter(entry=>factIds.has(entry.id))){
    const op=item.operation;
    db.prepare('INSERT OR REPLACE INTO deleted_content_delivery_facts VALUES(?,?,?,?)').run(profile,item.id,JSON.stringify({publicationId:item.id,workspaceId:item.workspaceId,deletedContentId:contentId,platform:item.platform,status:item.status,version:item.version,plannedAt:item.plannedAt,timeZone:item.timeZone,
     receipt:item.receipt?{id:item.receipt.id,provider:item.receipt.provider,status:item.receipt.status,scheduledAt:item.receipt.scheduledAt,platformPostId:item.receipt.platformPostId,checkedAt:item.receipt.checkedAt}:undefined,
     operation:op?{id:op.id,provider:op.provider,phase:op.phase,mode:op.mode,accountId:op.accountId,externalId:op.externalId,payloadHash:op.payloadHash,idempotencyKey:op.arguments?.idempotencyKey,createdAt:op.createdAt}:undefined}),now());
   }
   db.prepare('UPDATE editorial_state SET revision=?,state_json=?,updated_at=? WHERE profile_id=? AND revision=?').run(latest.revision+1,JSON.stringify(next),now(),profile,latest.revision);
   const del=(table,sql,...args)=>{if(has(table))db.prepare(sql).run(...args);};
   const each=(table,column,ids,extra='')=>{for(const id of ids)del(table,`DELETE FROM ${table} WHERE profile_id=? AND ${column}=?${extra}`,profile,id);};
   each('production_runs','id',plan.runIds);each('production_commands','run_id',plan.runIds);each('production_authority','run_id',plan.runIds);each('production_delegation_links','run_id',plan.runIds);
   each('agent_delegation_sessions','id',plan.sessionIds);each('agent_delegation_jobs','id',plan.jobIds);
   del('content_srt_documents','DELETE FROM content_srt_documents WHERE profile_id=? AND content_id=?',profile,contentId);
   // The pair link only (role/offset/voice/layout); the camera and screen files themselves are never deleted here.
   del('content_source_pairs','DELETE FROM content_source_pairs WHERE profile_id=? AND content_id=?',profile,contentId);
   for(const row of plan.notionJobs){del('editorial_jobs','DELETE FROM editorial_jobs WHERE profile_id=? AND id=?',profile,row.id);del('editorial_job_events','DELETE FROM editorial_job_events WHERE job_id=?',row.id);}
   for(const row of plan.workJobs){del('workflow_work','DELETE FROM workflow_work WHERE profile_id=? AND id=?',profile,row.id);del('workflow_events','DELETE FROM workflow_events WHERE job_id=?',row.id);}
   each('editorial_media_jobs','id',plan.mediaJobs.map(row=>row.id));
   each('runtime_actions','id',plan.runtimeActions.map(row=>row.id));
   each('chat_publication_requests','id',plan.publishRequests.map(row=>row.id));
   for(const row of plan.chatEdits??[])del('chat_edit_requests','DELETE FROM chat_edit_requests WHERE profile_id=? AND key=?',profile,row.key);
   for(const row of plan.publishIntents)del('chat_publication_intents','DELETE FROM chat_publication_intents WHERE profile_id=? AND session_id=? AND message_id=?',profile,row.session_id,row.message_id);
   each('delivery_receipts','id',plan.receipts.map(row=>row.id));
   for(const id of removedPublications){del('publication_intents','DELETE FROM publication_intents WHERE profile=? AND id=?',profile,id);del('publication_changes','DELETE FROM publication_changes WHERE profile=? AND delivery_id=?',profile,id);}
   for(const {name} of plan.mediaCache)for(const id of plan.versionIds)del(name,`DELETE FROM ${name} WHERE profile_id=? AND version_id=?`,profile,id);
   // Renderer keys in the same transaction; the IPC hands the new revisions to the preload's CAS map.
   if(has('state'))for(const key of linkedStateKeys){
    const {raw,value}=stateValue(profile,key);if(raw===undefined)continue;
    const cleaned=sanitizeLinkedValue(key,value,removed);if(cleaned===value)continue;
    const serialized=JSON.stringify(cleaned);db.prepare('UPDATE state SET value=? WHERE profile=? AND key=?').run(serialized,profile,key);
    stateChanges[key]={value:cleaned,from:hash(raw),revision:hash(serialized)};
   }
   db.prepare("UPDATE content_tombstones SET status='deleted',deleted_at=? WHERE profile_id=? AND content_id=?").run(now(),profile,contentId);
   const result={deleted:true,contentId,workspaceId:plan.content.workspaceId,counts:plan.counts,sessionIds:[...plan.sessionIds],runIds:[...plan.runIds],editorialRevision:latest.revision+1};
   db.prepare('INSERT INTO content_deletion_requests VALUES(?,?,?,?,?,?)').run(profile,requestId,contentId,fingerprint,JSON.stringify(result),now());
   db.exec('COMMIT');
   return {...result,state:stateChanges};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }

 async function remove(profile,input={}){
  profileCheck(profile);
  const {contentId,workspaceId,fingerprint,requestId,stopLocalWork=false,rendererBusy=[]}=input;
  if(!idText(contentId)||!idText(workspaceId)||typeof fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(fingerprint)||typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId)||typeof stopLocalWork!=='boolean'||!Array.isArray(rendererBusy))throw failure(400,'Pedido de exclusão inválido.');
  const prior=db.prepare('SELECT content_id,result_json FROM content_deletion_requests WHERE profile_id=? AND request_id=?').get(profile,requestId);
  if(prior){if(prior.content_id!==contentId)throw failure(409,'Este pedido já foi usado para outro conteúdo.');return {...JSON.parse(prior.result_json),replayed:true,state:{}};}
  const stone=tombstone(profile,contentId);
  if(stone?.status==='deleted')return {deleted:true,alreadyDeleted:true,contentId,state:{}};
  if(stone)throw failure(409,'A exclusão deste conteúdo já está em andamento.');
  let plan=collect(profile,contentId,workspaceId);
  if(plan.fingerprint!==fingerprint)throw failure(409,'O conteúdo mudou desde a revisão (conversas, produções ou arquivos). Revise a exclusão de novo; nada foi apagado.',{code:'stale'});
  if(plan.blockers.length)throw failure(409,plan.blockers[0].message,{code:'blocked',blockers:plan.blockers});
  if(rendererBusy.length)throw failure(409,'Uma conversa deste conteúdo ainda está respondendo. Pare a resposta antes; nada foi apagado.',{code:'busy',busy:rendererBusy});
  if(plan.busy.length&&!stopLocalWork)throw failure(409,'Há trabalho local em andamento neste conteúdo. Pare os trabalhos locais e tente de novo; nada foi apagado.',{code:'busy',busy:plan.busy});
  fence(profile,plan,requestId);livePurges.add(requestId);
  let committed=false;
  try{
   if(plan.busy.length){
    const failures=await stopLocal(profile,plan);profileCheck(profile);
    const deadline=Date.now()+stopTimeoutMs;
    for(;;){plan=collect(profile,contentId,workspaceId);if(!plan.busy.length||Date.now()>deadline)break;await new Promise(resolve=>setTimeout(resolve,pollMs));profileCheck(profile);}
    if(plan.busy.length)throw failure(409,`Não foi possível confirmar a parada de: ${plan.busy.map(item=>item.label).join(', ')}. Nada foi apagado; os dados continuam salvos.`,{code:'busy',busy:plan.busy,stopErrors:failures});
   }
   profileCheck(profile);
   // Revalidated after every await: same ids (new work was fenced), no new blocker, still nothing running.
   plan=collect(profile,contentId,workspaceId);
   if(plan.fingerprint!==fingerprint)throw failure(409,'O conteúdo mudou durante a exclusão; nada foi apagado.',{code:'stale'});
   if(plan.blockers.length)throw failure(409,plan.blockers[0].message,{code:'blocked',blockers:plan.blockers});
   if(plan.busy.length)throw failure(409,'Um trabalho local voltou a rodar; nada foi apagado.',{code:'busy',busy:plan.busy});
   const result=commit(profile,plan,requestId,fingerprint);committed=true;return result;
  }finally{livePurges.delete(requestId);if(!committed)unfence(profile,contentId,requestId);}
 }

 /**
  * One ordinary chat: removed with a durable fence (late native/specialist writes cannot bring it back). A chat that conducts
  * a production is refused with the content to delete instead, so the UI never shows a removal that comes back.
  */
 function removeSession(profile,input={}){
  profileCheck(profile);
  const {sessionId}=input;
  if(!idText(sessionId))throw failure(400,'Conversa inválida.');
  const role=has('production_runs')?db.prepare('SELECT id,content_id,workspace_id,data_json FROM production_runs WHERE profile_id=?').all(profile).find(row=>{const run=JSON.parse(row.data_json);return [run.sourceSession?.id,run.editorSession?.id,run.publisherSession?.id].includes(sessionId);}):undefined;
  if(role)throw failure(409,'Esta conversa conduz uma produção. Exclua o conteúdo inteiro para removê-la.',{code:'production-role',contentId:role.content_id,workspaceId:role.workspace_id});
  if(all('agent_delegation_jobs',"SELECT data_json FROM agent_delegation_jobs WHERE profile_id=? AND status IN ('queued','running')",profile).some(row=>{const job=JSON.parse(row.data_json);return job.sourceSessionId===sessionId||job.targetSessionId===sessionId;}))throw failure(409,'Termine ou cancele o trabalho do especialista antes de excluir esta conversa.',{code:'busy'});
  if(all('runtime_actions',"SELECT payload_json FROM runtime_actions WHERE profile_id=? AND status IN ('approved','running')",profile).some(row=>json(row.payload_json)?.sessionId===sessionId))throw failure(409,'Uma ação de ferramenta desta conversa ainda está rodando. Aguarde antes de excluir.',{code:'busy'});
  const stateChanges={};
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("INSERT OR IGNORE INTO content_tombstone_ids VALUES(?,'session',?,'')").run(profile,sessionId);
   if(has('agent_delegation_sessions'))db.prepare('DELETE FROM agent_delegation_sessions WHERE profile_id=? AND id=?').run(profile,sessionId);
   if(has('state'))for(const key of ['sessions','active-sessions','content-scopes','chat-drafts','production-flows']){
    const {raw,value}=stateValue(profile,key);if(raw===undefined)continue;
    const cleaned=sanitizeLinkedValue(key,value,{sessions:new Set([sessionId])});if(cleaned===value)continue;
    const serialized=JSON.stringify(cleaned);db.prepare('UPDATE state SET value=? WHERE profile=? AND key=?').run(serialized,profile,key);
    stateChanges[key]={value:cleaned,from:hash(raw),revision:hash(serialized)};
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {deleted:true,sessionId,state:stateChanges};
 }

 return {preview,delete:remove,removeSession,deletedIds:profile=>deletedIds(db,profile),collect};
}
