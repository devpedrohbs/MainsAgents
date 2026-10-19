import type {AgentSession} from './model/Chat';
import type {EditorialArtifact,EditorialContent} from '../content/model';
import {productionStageLabel,type ProductionRun} from '../production/model.ts';
import {contentBinding} from './contentSessions.ts';

/**
 * Content spaces: every chat belongs to exactly one scope of its workspace. A content scope is an existing
 * EditorialContent, identified by its id (never by title or agent); 'general' holds unlinked brainstorming chats and
 * 'recovery' shows chats whose saved link is no longer valid (deleted content, another workspace, another content's run)
 * instead of hiding them. Selection is saved per profile (the persistent store is profile-isolated) and per workspace;
 * the shown chat is saved per workspace + agent + scope, so switching agents never lands in an unrelated chat.
 */
export type ScopeKey='general'|'recovery'|`content:${string}`;
export interface ContentScopeState {schemaVersion:1;selected:Record<string,ScopeKey>;active:Record<string,string>}
/** pending: saved contents/productions are still loading; links are taken as saved instead of being reported invalid. */
export interface ScopeContext {workspaceId:string;contents:readonly EditorialContent[];runs:readonly ProductionRun[];pending?:boolean}
export type ContentLink=Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>;

export const contentScopesKey='content-scopes';
export const emptyContentScopes=():ContentScopeState=>({schemaVersion:1,selected:{},active:{}});
export const contentScopeKey=(contentId:string):ScopeKey=>`content:${contentId}`;
export const scopeContentId=(scope:ScopeKey|undefined)=>scope?.startsWith('content:')?scope.slice(8):undefined;
/** Scope read from the saved link alone (no validation): what a chat claims to belong to. */
export const rawScope=(session:Pick<AgentSession,'contentId'>):ScopeKey=>session.contentId?contentScopeKey(session.contentId):'general';
/** Collision-free identity of a shown-chat slot: a JSON tuple, never a delimited string (ids may contain any character). */
export const activeScopeKey=(workspaceId:string,agentId:string,scope:ScopeKey)=>JSON.stringify([workspaceId,agentId,scope]);
export const contentLink=(content:Pick<EditorialContent,'id'|'topicId'|'title'>):ContentLink&{contentId:string}=>({contentId:content.id,topicId:content.topicId,contentTitle:content.title});
/** Link a new chat copies from the chat it is requested from (comparison, provider choice): the SAME saved identity, or none. */
export const linkOf=(session:Pick<AgentSession,'contentId'|'topicId'|'contentTitle'>|undefined):(ContentLink&{contentId:string})|undefined=>session?.contentId?{contentId:session.contentId,topicId:session.topicId,...(session.contentTitle?{contentTitle:session.contentTitle}:{})}:undefined;

/** Validated scope: a link that no longer resolves in this workspace goes to the recovery bucket. */
export function scopeOfSession(session:AgentSession,ctx:ScopeContext):ScopeKey{
 if(ctx.pending)return rawScope(session);
 const binding=contentBinding(session,ctx);
 return binding.kind==='generic'?'general':binding.kind==='content'?contentScopeKey(binding.content.id):'recovery';
}

/** Scope shown for a workspace: the saved choice, else the legacy fallback; a deleted/foreign content shows the recovery bucket. */
export function effectiveScope(state:ContentScopeState,ctx:ScopeContext,fallback?:ScopeKey):ScopeKey{
 const saved=state.selected[ctx.workspaceId]??fallback??'general',id=scopeContentId(saved);
 if(id&&!ctx.pending&&!ctx.contents.some(content=>content.id===id&&content.workspaceId===ctx.workspaceId))return 'recovery';
 return saved;
}

export function scopeSessions(sessions:readonly AgentSession[],agentId:string|undefined,scope:ScopeKey,ctx:ScopeContext){
 return sessions.filter(session=>(!agentId||session.agentId===agentId)&&scopeOfSession(session,ctx)===scope).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Chat shown for an agent in a scope: its saved pointer when still valid for the SAME agent and scope, else that agent's most
 * recent chat of the same scope, else none (empty state). Never a chat of another content or of General. The panel saves the
 * chat it resolved (pinVisible), so a newer background sibling arriving later never replaces what the user was looking at.
 * Migration: before any scoped pointer exists, the legacy per-agent active chat (`active-sessions`) is used ONLY when it is this
 * agent's chat in this same validated scope, so the exact chat the user had open comes back (not merely the newest one).
 */
export function resolveScopeSession(sessions:readonly AgentSession[],state:ContentScopeState,agentId:string,scope:ScopeKey,ctx:ScopeContext,legacySessionId?:string):AgentSession|undefined{
 const list=scopeSessions(sessions,agentId,scope,ctx);
 const pointers=[state.active[activeScopeKey(ctx.workspaceId,agentId,scope)]];
 // The recovery bucket is reached by opening an invalid chat: its pointer is saved under the chat's raw scope.
 if(scope==='recovery'){const selected=state.selected[ctx.workspaceId];if(selected)pointers.push(state.active[activeScopeKey(ctx.workspaceId,agentId,selected)]);}
 if(legacySessionId)pointers.push(legacySessionId);
 return pointers.map(id=>id&&list.find(session=>session.id===id)).find(Boolean)||list[0];
}

export const withSelected=(state:ContentScopeState,workspaceId:string,scope:ScopeKey):ContentScopeState=>state.selected[workspaceId]===scope?state:{...state,selected:{...state.selected,[workspaceId]:scope}};
export const withActive=(state:ContentScopeState,workspaceId:string,agentId:string,scope:ScopeKey,sessionId:string):ContentScopeState=>{
 const key=activeScopeKey(workspaceId,agentId,scope);return state.active[key]===sessionId?state:{...state,active:{...state.active,[key]:sessionId}};
};
/** Opening a chat makes it the active chat of its own scope; `select` also moves the workspace selection to that scope. */
export function withOpened(state:ContentScopeState,workspaceId:string,session:Pick<AgentSession,'id'|'agentId'|'contentId'>,select=true){
 const scope=rawScope(session),next=withActive(state,workspaceId,session.agentId,scope,session.id);
 return select?withSelected(next,workspaceId,scope):next;
}
/**
 * The chat the panel actually shows becomes the saved pointer of its slot. When the workspace has no saved selection yet (first
 * run after the legacy single-pointer era), the shown scope becomes the selection, so switching agents keeps that content instead
 * of following another agent's legacy chat. An existing selection is never changed here.
 */
export const withVisible=(state:ContentScopeState,workspaceId:string,agentId:string,scope:ScopeKey,sessionId:string)=>{
 const selected=state.selected[workspaceId]?state:withSelected(state,workspaceId,scope);
 return withActive(selected,workspaceId,agentId,scope,sessionId);
};
export function withoutSession(state:ContentScopeState,sessionId:string):ContentScopeState{
 if(!Object.values(state.active).includes(sessionId))return state;
 return {...state,active:Object.fromEntries(Object.entries(state.active).filter(([,id])=>id!==sessionId))};
}

const scopePattern=/^(general|recovery|content:[\w.:-]{1,200})$/;
const isRecord=(item:unknown):item is Record<string,unknown>=>typeof item==='object'&&item!==null&&!Array.isArray(item);
/** Slot key as [workspaceId, agentId, scope]: the JSON tuple, or the pre-release `ws|agent|scope` form (migrated on read). */
function slotOf(key:string):[string,string,ScopeKey]|undefined{
 let tuple:unknown;
 if(key.startsWith('[')){try{tuple=JSON.parse(key);}catch{return undefined;}}
 else{const parts=key.split('|');tuple=parts.length===3?parts:undefined;}
 if(!Array.isArray(tuple)||tuple.length!==3||!tuple.every(part=>typeof part==='string'&&part.length>0&&part.length<=300)||!scopePattern.test(tuple[2]))return undefined;
 return tuple as [string,string,ScopeKey];
}
export function validateContentScopes(value:unknown):value is ContentScopeState{
 if(!isRecord(value))return false;
 return value.schemaVersion===1&&isRecord(value.selected)&&isRecord(value.active)&&Object.keys(value).every(key=>['schemaVersion','selected','active'].includes(key))
  &&Object.entries(value.selected).every(([key,item])=>key.length>0&&key.length<=300&&typeof item==='string'&&scopePattern.test(item))
  &&Object.entries(value.active).every(([key,item])=>typeof item==='string'&&item.length>0&&item.length<=300&&!!slotOf(key));
}
/** Valid saved state in the current key contract (old delimited slot keys are rewritten as tuples, none is dropped). */
export function normalizeContentScopes(value:unknown):ContentScopeState{
 if(!validateContentScopes(value))return emptyContentScopes();
 if(Object.keys(value.active).every(key=>key.startsWith('[')))return value;
 return {...value,active:Object.fromEntries(Object.entries(value.active).map(([key,id])=>{const [workspaceId,agentId,scope]=slotOf(key)!;return [activeScopeKey(workspaceId,agentId,scope),id];}))};
}
/** Backup merge: the local choices win; imported pointers only fill missing slots. */
export function mergeContentScopes(current:unknown,incoming:unknown):ContentScopeState{
 const local=normalizeContentScopes(current),other=normalizeContentScopes(incoming);
 return {schemaVersion:1,selected:{...other.selected,...local.selected},active:{...other.active,...local.active}};
}

/** Content box shown in the chat selector and on the Sessions page. */
export interface ContentSpace {
 scope:ScopeKey;kind:'general'|'content'|'recovery';title:string;stage?:string;content?:EditorialContent;archived?:boolean;
 chats:number;agents:Array<{agentId:string;chats:number}>;lastActivity?:string;
}
export function contentSpaces(sessions:readonly AgentSession[],agentIds:readonly string[],ctx:ScopeContext,pt=true):ContentSpace[]{
 const own=sessions.filter(session=>agentIds.includes(session.agentId)),byScope=new Map<ScopeKey,AgentSession[]>();
 for(const session of own){const scope=scopeOfSession(session,ctx);byScope.set(scope,[...(byScope.get(scope)??[]),session]);}
 const describe=(scope:ScopeKey,list:AgentSession[]=[])=>{
  const counts=new Map<string,number>();for(const session of list)counts.set(session.agentId,(counts.get(session.agentId)??0)+1);
  return {scope,chats:list.length,agents:[...counts].map(([agentId,chats])=>({agentId,chats})),lastActivity:list.map(session=>session.updatedAt).sort().at(-1)};
 };
 // An archived content stays reachable while it holds saved chats (labelled "Arquivado"); without chats it stays out of the way.
 const contents=ctx.contents.filter(content=>content.workspaceId===ctx.workspaceId&&(content.productionStage!=='archived'||byScope.get(contentScopeKey(content.id))?.length)).map(content=>{
  const run=ctx.runs.filter(item=>item.workspaceId===ctx.workspaceId&&item.contentId===content.id).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''))[0];
  const space=describe(contentScopeKey(content.id),byScope.get(contentScopeKey(content.id))),archived=content.productionStage==='archived';
  return {...space,kind:'content' as const,title:content.title,content,archived,stage:archived?(pt?'Arquivado':'Archived'):run?productionStageLabel(run.stage,pt):pt?'Sem produção':'No production',lastActivity:[space.lastActivity,run?.updatedAt].filter(Boolean).sort().at(-1)??content.updatedAt};
 }).sort((a,b)=>Number(a.archived)-Number(b.archived)||Number(b.chats>0)-Number(a.chats>0)||(b.lastActivity??'').localeCompare(a.lastActivity??''));
 const general={...describe('general',byScope.get('general')),kind:'general' as const,title:pt?'Geral':'General'};
 const recovery=byScope.get('recovery')?.length?[{...describe('recovery',byScope.get('recovery')),kind:'recovery' as const,title:pt?'Precisa de atenção':'Needs attention'}]:[];
 return [general,...contents,...recovery];
}

/**
 * Continue target of a connection: only the connected agent's chat in the SAME workspace, content AND topic, with the native
 * runtime's identity (native-agent-delegations sameDelegationContent): a missing value equals only a missing value, so a
 * General chat continues only in a General chat and a chat without topic never "continues" in one with a topic.
 */
export type TargetProblem='missing'|'other-agent'|'other-workspace'|'other-content';
export function continueTargetProblem(source:Pick<AgentSession,'contentId'|'topicId'|'agentId'>,target:Pick<AgentSession,'contentId'|'topicId'|'agentId'>|undefined,targetAgentId:string,agents:readonly {id:string;workspaceId:string}[]):TargetProblem|undefined{
 if(!target)return 'missing';
 if(target.agentId!==targetAgentId)return 'other-agent';
 const workspace=(id:string)=>agents.find(agent=>agent.id===id)?.workspaceId;
 if(!workspace(source.agentId)||workspace(source.agentId)!==workspace(target.agentId))return 'other-workspace';
 if((source.contentId??null)!==(target.contentId??null)||(source.topicId??null)!==(target.topicId??null))return 'other-content';
 return undefined;
}

/** Specialist work queued/running for a chat, on EITHER side (a manual handoff returns at once while the job still works). */
export const delegationBusy=(jobs:readonly {sourceSessionId:string;targetSessionId:string;status:string}[],sessionId:string)=>jobs.some(job=>['queued','running'].includes(job.status)&&(job.sourceSessionId===sessionId||job.targetSessionId===sessionId));

export interface ChatFamily {members:AgentSession[];truncated:boolean;
 /** Chats linked to the family that belong to another scope: historical links, never moved nor treated as this content's chats. */
 crossScope:AgentSession[]}
/**
 * Chats explicitly connected to this one: agent connection, handoffs in both directions and comparison pair, only inside the
 * same scope. A family larger than `limit` is reported as truncated and is never partly moved.
 */
export function chatFamily(session:AgentSession,sessions:readonly AgentSession[],limit=24):ChatFamily{
 const byId=new Map(sessions.map(item=>[item.id,item])),seen=new Set([session.id]),cross=new Set<string>(),queue=[session];let truncated=false;
 while(queue.length){
  const current=queue.shift()!,links=new Set<string>();
  if(current.agentConnection?.targetSessionId)links.add(current.agentConnection.targetSessionId);
  for(const handoff of current.handoffs??[])links.add(handoff.targetSessionId);
  for(const other of sessions){
   if(other.agentConnection?.targetSessionId===current.id||other.handoffs?.some(handoff=>handoff.targetSessionId===current.id||handoff.id===current.originHandoffId))links.add(other.id);
   if(current.comparison&&other.comparison?.id===current.comparison.id)links.add(other.id);
  }
  for(const id of links){const next=byId.get(id);if(!next||seen.has(id))continue;
   if((next.contentId??null)!==(current.contentId??null)){cross.add(id);continue;}
   if(seen.size>=limit){truncated=true;continue;}
   seen.add(id);queue.push(next);}
 }
 return {members:[...seen].map(id=>byId.get(id)!).filter(Boolean),truncated,crossScope:[...cross].filter(id=>!seen.has(id)).map(id=>byId.get(id)!)};
}
export const connectedFamily=(session:AgentSession,sessions:readonly AgentSession[],limit=24)=>chatFamily(session,sessions,limit).members;

export type OrganizeProblem='busy'|'bound-other'|'other-workspace'|'production-other'|'files-other'|'shared-thread'|'missing'|'family-too-large'|'family-changed';
export interface OrganizeCheck {ok:boolean;members:Array<{session:AgentSession;problems:OrganizeProblem[];already:boolean}>;problems:OrganizeProblem[]}
export interface OrganizeContext {sessions:readonly AgentSession[];agents:readonly {id:string;workspaceId:string}[];runs:readonly ProductionRun[];artifacts:readonly EditorialArtifact[];busy:(sessionId:string)=>boolean}
/**
 * Explicit "organize into content" of General chats. Refused (with the reason) when it would mix two contents: a chat still
 * responding or with specialist work, already linked elsewhere, in another workspace, conducting another content's production,
 * holding files or receipts of another content, or sharing its provider thread with a chat outside the move.
 */
export function organizeCheck(ids:readonly string[],target:EditorialContent|undefined,{sessions,agents,runs,artifacts,busy}:OrganizeContext,groupProblems:OrganizeProblem[]=[]):OrganizeCheck{
 const moving=new Set(ids);
 const members=ids.map(id=>{
  const session=sessions.find(item=>item.id===id),problems:OrganizeProblem[]=[];
  if(!session||!target)return {session:session!,problems:['missing' as const],already:false};
  const already=session.contentId===target.id;
  if(busy(id)||session.handoffs?.some(handoff=>handoff.status==='running'))problems.push('busy');
  if(session.contentId&&!already)problems.push('bound-other');
  if(agents.find(agent=>agent.id===session.agentId)?.workspaceId!==target.workspaceId)problems.push('other-workspace');
  if(runs.some(run=>run.contentId!==target.id&&[run.sourceSession.id,run.editorSession.id,run.publisherSession?.id].includes(id)))problems.push('production-other');
  const foreignFile=artifacts.some(artifact=>artifact.source?.sessionId===id&&artifact.contentId&&artifact.contentId!==target.id)||session.messages.some(item=>item.type==='message'&&item.receipts?.some(receipt=>receipt.contentId&&receipt.contentId!==target.id));
  if(foreignFile)problems.push('files-other');
  const thread=session.remoteSessionId??session.codexThreadId;
  if(thread&&sessions.some(other=>other.id!==id&&!moving.has(other.id)&&[other.remoteSessionId,other.codexThreadId].includes(thread)))problems.push('shared-thread');
  return {session,problems,already};
 });
 return {ok:!groupProblems.length&&members.length>0&&members.every(member=>!member.problems.length)&&members.some(member=>!member.already),members,problems:groupProblems};
}

/** What the user asked to organize: one chat, or that chat with its connected family (as listed when they confirmed). */
export interface OrganizeRequest {rootId:string;family:boolean;ids:readonly string[];contentId:string}
export class OrganizeRefused extends Error {problems:OrganizeProblem[];constructor(problems:OrganizeProblem[]){super(`Organize refused: ${[...new Set(problems)].join(', ')}`);this.problems=[...new Set(problems)];}}
/** Request ids re-derived from the LIVE chats: the family must be complete (not truncated) and the one the user confirmed. */
export function organizeIds(request:OrganizeRequest,sessions:readonly AgentSession[]){
 const root=sessions.find(session=>session.id===request.rootId);
 if(!root)return {ids:[request.rootId],problems:['missing' as OrganizeProblem]};
 if(!request.family)return {ids:[root.id],problems:[] as OrganizeProblem[]};
 const family=chatFamily(root,sessions),ids=family.members.map(session=>session.id),problems:OrganizeProblem[]=[];
 if(family.truncated)problems.push('family-too-large');
 if(ids.length!==request.ids.length||ids.some(id=>!request.ids.includes(id)))problems.push('family-changed');
 return {ids,problems};
}
/**
 * Atomic organize, run on the CURRENT state right before applying: the target must still exist in this workspace's saved contents,
 * and the whole guard (busy, runs, files/receipts, shared thread, family) is re-run. Any problem refuses everything; on success
 * only contentId/topicId/contentTitle change (history, titles and provider threads stay exactly as they were).
 */
export function organizeSessions(current:readonly AgentSession[],request:OrganizeRequest,{contents,...ctx}:Omit<OrganizeContext,'sessions'>&{contents:readonly EditorialContent[]}):AgentSession[]{
 const target=contents.find(content=>content.id===request.contentId);
 const {ids,problems}=organizeIds(request,current);
 const check=organizeCheck(ids,target,{...ctx,sessions:current},problems);
 if(!check.ok)throw new OrganizeRefused([...check.problems,...check.members.flatMap(member=>member.problems)]);
 const moving=new Set(check.members.filter(member=>!member.already).map(member=>member.session.id)),link=contentLink(target!);
 return current.map(session=>moving.has(session.id)?{...session,contentId:link.contentId,topicId:link.topicId,contentTitle:link.contentTitle}:session);
}

export function organizeProblemText(problem:OrganizeProblem,pt=true){
 const text:Record<OrganizeProblem,[string,string]>={
  busy:['Ainda está respondendo ou com trabalho de especialista em andamento. Espere terminar.','Still responding or with specialist work running. Wait until it finishes.'],
  'bound-other':['Já pertence a outro conteúdo. Mover misturaria os dois.','Already belongs to another content. Moving it would mix both.'],
  'other-workspace':['É de um agente de outro espaço.','Belongs to an agent in another workspace.'],
  'production-other':['Conduz a produção de outro conteúdo.','Runs another content’s production.'],
  'files-other':['Tem arquivos ou entregas de outro conteúdo.','Holds files or deliveries of another content.'],
  'shared-thread':['Divide a conversa do provedor com outro chat.','Shares its provider thread with another chat.'],
  missing:['A conversa ou o conteúdo não existe mais.','The chat or content no longer exists.'],
  'family-too-large':['Há conversas conectadas demais para mover juntas com segurança (mais de 24). Nada foi movido; organize sem levar as conectadas ou comece uma conversa nova.','Too many connected chats to move together safely (over 24). Nothing moved; organize without the connected chats or start a fresh chat.'],
  'family-changed':['As conversas conectadas mudaram desde que você abriu esta janela. Nada foi movido; revise a lista.','The connected chats changed since you opened this window. Nothing moved; review the list.'],
 };
 return text[problem][pt?0:1];
}
