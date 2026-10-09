import type {Agent} from '../agents/model/Agent';
import type {AgentSession,ChatContextReference} from './model/Chat';

/**
 * One explicit opt-in comparison: the same briefing sent independently to a Codex and a Claude session.
 * Legacy mode pairs two agents (one per provider). `same-agent` mode runs one agent's instructions, tools and skills
 * on both providers in fresh sessions, with a model per side; the agent's saved configuration is never changed.
 */
export interface AgentComparison {id:string;workspaceId:string;title:string;briefing:string;codexAgentId:string;claudeAgentId:string;codexSessionId:string;claudeSessionId:string;createdAt:string;
 /** Absent on two-agent comparisons, including every comparison saved before same-agent mode existed. */
 mode?:'same-agent';
 /** Same-agent mode only: the model sent on each side; '' means the provider's own default. */
 codexModelId?:string;claudeModelId?:string}
/** Legacy two-agent input; `mode` may be omitted for compatibility. */
export interface AgentPairComparisonInput {mode?:'agents';codexAgentId:string;claudeAgentId:string;briefing:string;context?:ChatContextReference[]}
/** One source agent on both providers. Per side: 'model-id' = that model; '' = the provider default (Codex: the app's configured default Codex model, else the CLI default); omitted = the agent's saved model on its own provider, provider default on the other. */
export interface SameAgentComparisonInput {mode:'same-agent';agentId:string;codexModelId?:string;claudeModelId?:string;briefing:string;context?:ChatContextReference[]}
export type AgentComparisonInput=AgentPairComparisonInput|SameAgentComparisonInput;
/** Pairing metadata saved on both sessions, so backups and restarts keep the comparison without replaying it. */
export type SessionComparison=AgentComparison&{role:'codex'|'claude'};
/** Optional model catalogs per provider; when a list is given, the chosen model must be in it. */
export type ComparisonModelCatalog=Partial<Record<'codex'|'claude',readonly string[]>>;

const MAX_BRIEFING=20000,MAX_CONTEXT=20,MODEL=/^[a-zA-Z0-9_.:[\]-]{1,120}$/;
const titleFrom=(text:string)=>text.length>42?`${text.slice(0,42).trim()}…`:text;
const providerOf=(agent:Pick<Agent,'providerId'>)=>agent.providerId??'codex';
const providerName=(id:'codex'|'claude')=>id==='codex'?'Codex':'Claude';

interface ValidComparisonBase {briefing:string;context:ChatContextReference[]}
export type ValidComparison=ValidComparisonBase&({mode:'agents';codex:Agent;claude:Agent}|{mode:'same-agent';codex:Agent;claude:Agent;agent:Agent;codexModelId?:string;claudeModelId?:string});

/**
 * Model per side: a non-empty string is that exact model; '' is an explicit provider default (never the agent's saved
 * model, e.g. when that model is stale or unconfirmed); omitted keeps the agent's saved model on its own provider only.
 */
function chooseModel(side:'codex'|'claude',agent:Agent,requested:unknown,catalog:ComparisonModelCatalog|undefined){
 if(requested==='')return undefined;
 if(requested!==undefined&&(typeof requested!=='string'||!MODEL.test(requested)))throw new Error(`Choose a valid ${providerName(side)} model.`);
 // The agent's saved model only belongs to its own provider; the other side never inherits it.
 const model=(requested as string|undefined)??(providerOf(agent)===side?agent.modelId||undefined:undefined);
 const known=catalog?.[side];if(model&&known&&!known.includes(model))throw new Error(`The ${providerName(side)} model "${model}" is not available for ${providerName(side)}.`);
 return model;
}

export function validateComparison(input:AgentComparisonInput,agents:readonly Agent[],registeredProviders:readonly string[],catalog?:ComparisonModelCatalog):ValidComparison{
 const raw=(input??{}) as unknown as Record<string,unknown>;
 const briefing=typeof raw.briefing==='string'?raw.briefing.trim():'';
 const sameAgent=raw.mode==='same-agent';
 if(raw.mode!==undefined&&raw.mode!=='agents'&&!sameAgent)throw new Error('Choose a valid comparison mode.');
 // A payload must describe exactly one mode: never guess between one agent and two agents.
 if(sameAgent?('codexAgentId' in raw||'claudeAgentId' in raw):('agentId' in raw||'codexModelId' in raw||'claudeModelId' in raw))throw new Error('The comparison request is ambiguous. Choose either one agent on both providers or two agents.');
 if(!briefing)throw new Error('Write the briefing to compare.');
 if(briefing.length>MAX_BRIEFING)throw new Error(`The briefing must have at most ${MAX_BRIEFING} characters.`);
 for(const id of ['codex','claude'] as const)if(!registeredProviders.includes(id))throw new Error(`The ${providerName(id)} provider is not available in this app.`);
 const context=raw.context??[];
 if(!Array.isArray(context)||context.length>MAX_CONTEXT||context.some(item=>!item||typeof item.nodeId!=='string'||typeof item.label!=='string'||typeof item.kind!=='string'||item.content!==undefined&&typeof item.content!=='string'))throw new Error('The selected context is invalid.');
 const copy=(context as ChatContextReference[]).map(item=>({...item}));
 if(sameAgent){
  const agent=agents.find(item=>item.id===raw.agentId);
  if(typeof raw.agentId!=='string'||!agent)throw new Error('Choose an existing agent.');
  if(!agent.workspaceId)throw new Error('Choose an agent from a workspace.');
  if(!['codex','claude'].includes(providerOf(agent)))throw new Error('Choose a Codex or Claude agent to run on both providers.');
  const codexModelId=chooseModel('codex',agent,raw.codexModelId,catalog),claudeModelId=chooseModel('claude',agent,raw.claudeModelId,catalog);
  return {mode:'same-agent',agent,codex:agent,claude:agent,codexModelId,claudeModelId,briefing,context:copy};
 }
 if(raw.codexAgentId===raw.claudeAgentId)throw new Error('Choose two different agents.');
 const codex=agents.find(agent=>agent.id===raw.codexAgentId),claude=agents.find(agent=>agent.id===raw.claudeAgentId);
 if(!codex||!claude)throw new Error('Choose existing agents.');
 if(codex.workspaceId!==claude.workspaceId)throw new Error('Choose two agents from the same workspace.');
 if(providerOf(codex)!=='codex'||providerOf(claude)!=='claude')throw new Error('Choose one Codex agent and one Claude agent.');
 return {mode:'agents',codex,claude,briefing,context:copy};
}

/** Builds both sessions with each side's provider and model; no connection, so no automatic fan-out. */
export function comparisonSessions(valid:ValidComparison,{id,codexSessionId,claudeSessionId,now,defaultCodexModelId}:{id:string;codexSessionId:string;claudeSessionId:string;now:string;defaultCodexModelId?:string}){
 const {codex,claude,briefing}=valid,title=titleFrom(briefing);
 if(codexSessionId===claudeSessionId)throw new Error('Each comparison side needs its own session.');
 const codexModel=valid.mode==='same-agent'?valid.codexModelId??(defaultCodexModelId||undefined):codex.modelId??(defaultCodexModelId||undefined);
 const claudeModel=valid.mode==='same-agent'?valid.claudeModelId:claude.modelId;
 const comparison:AgentComparison={id,workspaceId:codex.workspaceId,title,briefing,codexAgentId:codex.id,claudeAgentId:claude.id,codexSessionId,claudeSessionId,createdAt:now,...(valid.mode==='same-agent'?{mode:'same-agent' as const,codexModelId:codexModel??'',claudeModelId:claudeModel??''}:{})};
 const base={authMode:'unknown' as const,title,messages:[],createdAt:now,updatedAt:now};
 const codexSession:AgentSession={...base,id:codexSessionId,agentId:codex.id,providerId:'codex',modelId:codexModel,comparison:{...comparison,role:'codex'}};
 const claudeSession:AgentSession={...base,id:claudeSessionId,agentId:claude.id,providerId:'claude',modelId:claudeModel,comparison:{...comparison,role:'claude'}};
 return {comparison,sessions:[codexSession,claudeSession] as const};
}

const pairKeys:(keyof AgentComparison)[]=['id','workspaceId','title','briefing','codexAgentId','claudeAgentId','codexSessionId','claudeSessionId','createdAt'];
const sameAgentKeys:(keyof AgentComparison)[]=[...pairKeys,'mode','codexModelId','claudeModelId'];
/** Only complete, consistent pairs whose agents still live in the recorded workspace are listed. */
export function deriveComparisons(sessions:readonly AgentSession[],agents:readonly Pick<Agent,'id'|'workspaceId'|'providerId'>[]):AgentComparison[]{
 const byId=new Map(sessions.map(session=>[session.id,session])),result:AgentComparison[]=[];
 for(const session of sessions){
  const meta=session.comparison;if(!meta||meta.role!=='codex'||session.id!==meta.codexSessionId)continue;
  const sibling=byId.get(meta.claudeSessionId),other=sibling?.comparison;
  if(meta.mode!==undefined&&meta.mode!=='same-agent')continue;
  const same=meta.mode==='same-agent',keys=same?sameAgentKeys:pairKeys;
  if(!sibling||!other||other.role!=='claude'||sibling.id===session.id||keys.some(key=>typeof meta[key]!=='string'||other[key]!==meta[key]))continue;
  // Legacy pairs never carry same-agent fields; same-agent pairs always point both sides at one agent.
  if(!same&&(other.mode!==undefined||meta.codexAgentId===meta.claudeAgentId||'codexModelId' in meta||'claudeModelId' in meta))continue;
  if(same&&(meta.codexAgentId!==meta.claudeAgentId||(session.modelId??'')!==meta.codexModelId||(sibling.modelId??'')!==meta.claudeModelId))continue;
  if(session.agentId!==meta.codexAgentId||sibling.agentId!==meta.claudeAgentId||session.providerId!=='codex'||sibling.providerId!=='claude')continue;
  const codex=agents.find(agent=>agent.id===meta.codexAgentId),claude=agents.find(agent=>agent.id===meta.claudeAgentId);
  if(!codex||!claude||codex.workspaceId!==meta.workspaceId||claude.workspaceId!==meta.workspaceId)continue;
  result.push(Object.fromEntries(keys.map(key=>[key,meta[key]])) as unknown as AgentComparison);
 }
 return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export interface ComparisonLauncherDeps {
 agents:()=>readonly Agent[];registeredProviders:()=>readonly string[];now:()=>string;makeId:(prefix:string)=>string;defaultCodexModelId:()=>string|undefined;
 /** Optional synchronous model catalogs (for example the last listed models); omitted providers are not checked. */
 modelCatalog?:()=>ComparisonModelCatalog|undefined;
 /** Must add both sessions to durable state and resolve only after they are saved. */
 persist:(sessions:readonly AgentSession[])=>Promise<void>;
 /** The existing per-session execution; it records its own failure in that session. The provider comes from the session. */
 execute:(agent:Agent,content:string,context:ChatContextReference[],session:AgentSession)=>Promise<unknown>;
}
/** Starts exactly two executions independently after persistence. Repeated identical requests reuse the same launch. */
export function createComparisonLauncher(deps:ComparisonLauncherDeps){
 const launches=new Map<string,Promise<AgentComparison>>();
 return function start(input:AgentComparisonInput):Promise<AgentComparison>{
  let valid:ValidComparison;try{valid=validateComparison(input,deps.agents(),deps.registeredProviders(),deps.modelCatalog?.());}catch(error){return Promise.reject(error);}
  const fingerprint=JSON.stringify(valid.mode==='same-agent'?{mode:valid.mode,agent:valid.agent.id,codexModel:valid.codexModelId??null,claudeModel:valid.claudeModelId??null,briefing:valid.briefing,context:valid.context}:{codex:valid.codex.id,claude:valid.claude.id,briefing:valid.briefing,context:valid.context});
  const existing=launches.get(fingerprint);if(existing)return existing;
  const launch=(async()=>{
   const {comparison,sessions}=comparisonSessions(valid,{id:deps.makeId('comparison'),codexSessionId:deps.makeId('session'),claudeSessionId:deps.makeId('session'),now:deps.now(),defaultCodexModelId:deps.defaultCodexModelId()});
   await deps.persist(sessions);
   // Same-agent sides get detached snapshots: identical instructions/tools/skills, and nothing can write back to the saved agent.
   const agentFor=(agent:Agent)=>valid.mode==='same-agent'?structuredClone(agent):agent;
   const runs=[[agentFor(valid.codex),sessions[0]],[agentFor(valid.claude),sessions[1]]] as const;
   // Independent starts: one failure never cancels or blocks the sibling.
   const settled=Promise.allSettled(runs.map(([agent,session])=>{try{return deps.execute(agent,valid.briefing,valid.context.map(item=>({...item})),session);}catch(error){return Promise.reject(error);}}));
   void settled.finally(()=>launches.delete(fingerprint));
   return comparison;
  })();
  launches.set(fingerprint,launch);launch.catch(()=>launches.delete(fingerprint));
  return launch;
 };
}
