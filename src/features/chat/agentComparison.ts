import type {Agent} from '../agents/model/Agent';
import type {AgentSession,ChatContextReference} from './model/Chat';

/** One explicit opt-in comparison: the same briefing sent independently to one Codex and one Claude agent. */
export interface AgentComparison {id:string;workspaceId:string;title:string;briefing:string;codexAgentId:string;claudeAgentId:string;codexSessionId:string;claudeSessionId:string;createdAt:string}
export interface AgentComparisonInput {codexAgentId:string;claudeAgentId:string;briefing:string;context?:ChatContextReference[]}
/** Pairing metadata saved on both sessions, so backups and restarts keep the comparison without replaying it. */
export type SessionComparison=AgentComparison&{role:'codex'|'claude'};

const MAX_BRIEFING=20000,MAX_CONTEXT=20;
const titleFrom=(text:string)=>text.length>42?`${text.slice(0,42).trim()}…`:text;
const providerOf=(agent:Pick<Agent,'providerId'>)=>agent.providerId??'codex';

export function validateComparison(input:AgentComparisonInput,agents:readonly Agent[],registeredProviders:readonly string[]){
 const briefing=typeof input?.briefing==='string'?input.briefing.trim():'';
 if(!briefing)throw new Error('Write the briefing to compare.');
 if(briefing.length>MAX_BRIEFING)throw new Error(`The briefing must have at most ${MAX_BRIEFING} characters.`);
 if(input.codexAgentId===input.claudeAgentId)throw new Error('Choose two different agents.');
 const codex=agents.find(agent=>agent.id===input.codexAgentId),claude=agents.find(agent=>agent.id===input.claudeAgentId);
 if(!codex||!claude)throw new Error('Choose existing agents.');
 if(codex.workspaceId!==claude.workspaceId)throw new Error('Choose two agents from the same workspace.');
 if(providerOf(codex)!=='codex'||providerOf(claude)!=='claude')throw new Error('Choose one Codex agent and one Claude agent.');
 for(const id of ['codex','claude'])if(!registeredProviders.includes(id))throw new Error(`The ${id==='codex'?'Codex':'Claude'} provider is not available in this app.`);
 const context=input.context??[];
 if(!Array.isArray(context)||context.length>MAX_CONTEXT||context.some(item=>!item||typeof item.nodeId!=='string'||typeof item.label!=='string'||typeof item.kind!=='string'||item.content!==undefined&&typeof item.content!=='string'))throw new Error('The selected context is invalid.');
 return {codex,claude,briefing,context:context.map(item=>({...item}))};
}

/** Builds both sessions with each agent's own provider and model; no connection, so no automatic fan-out. */
export function comparisonSessions(valid:ReturnType<typeof validateComparison>,{id,codexSessionId,claudeSessionId,now,defaultCodexModelId}:{id:string;codexSessionId:string;claudeSessionId:string;now:string;defaultCodexModelId?:string}){
 const {codex,claude,briefing}=valid,title=titleFrom(briefing);
 const comparison:AgentComparison={id,workspaceId:codex.workspaceId,title,briefing,codexAgentId:codex.id,claudeAgentId:claude.id,codexSessionId,claudeSessionId,createdAt:now};
 const base={authMode:'unknown' as const,title,messages:[],createdAt:now,updatedAt:now};
 const codexSession:AgentSession={...base,id:codexSessionId,agentId:codex.id,providerId:'codex',modelId:codex.modelId??(defaultCodexModelId||undefined),comparison:{...comparison,role:'codex'}};
 const claudeSession:AgentSession={...base,id:claudeSessionId,agentId:claude.id,providerId:'claude',modelId:claude.modelId,comparison:{...comparison,role:'claude'}};
 return {comparison,sessions:[codexSession,claudeSession] as const};
}

/** Only complete, consistent pairs whose agents still live in the recorded workspace are listed. */
export function deriveComparisons(sessions:readonly AgentSession[],agents:readonly Pick<Agent,'id'|'workspaceId'|'providerId'>[]):AgentComparison[]{
 const byId=new Map(sessions.map(session=>[session.id,session])),result:AgentComparison[]=[];
 for(const session of sessions){
  const meta=session.comparison;if(!meta||meta.role!=='codex'||session.id!==meta.codexSessionId)continue;
  const sibling=byId.get(meta.claudeSessionId),other=sibling?.comparison;
  const keys:(keyof AgentComparison)[]=['id','workspaceId','title','briefing','codexAgentId','claudeAgentId','codexSessionId','claudeSessionId','createdAt'];
  if(!sibling||!other||other.role!=='claude'||keys.some(key=>typeof meta[key]!=='string'||other[key]!==meta[key]))continue;
  if(session.agentId!==meta.codexAgentId||sibling.agentId!==meta.claudeAgentId||session.providerId!=='codex'||sibling.providerId!=='claude')continue;
  const codex=agents.find(agent=>agent.id===meta.codexAgentId),claude=agents.find(agent=>agent.id===meta.claudeAgentId);
  if(!codex||!claude||codex.workspaceId!==meta.workspaceId||claude.workspaceId!==meta.workspaceId)continue;
  result.push(Object.fromEntries(keys.map(key=>[key,meta[key]])) as unknown as AgentComparison);
 }
 return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export interface ComparisonLauncherDeps {
 agents:()=>readonly Agent[];registeredProviders:()=>readonly string[];now:()=>string;makeId:(prefix:string)=>string;defaultCodexModelId:()=>string|undefined;
 /** Must add both sessions to durable state and resolve only after they are saved. */
 persist:(sessions:readonly AgentSession[])=>Promise<void>;
 /** The existing per-session execution; it records its own failure in that session. */
 execute:(agent:Agent,content:string,context:ChatContextReference[],session:AgentSession)=>Promise<unknown>;
}
/** Starts both executions independently after persistence. Repeated identical requests reuse the same launch. */
export function createComparisonLauncher(deps:ComparisonLauncherDeps){
 const launches=new Map<string,Promise<AgentComparison>>();
 return function start(input:AgentComparisonInput):Promise<AgentComparison>{
  let valid;try{valid=validateComparison(input,deps.agents(),deps.registeredProviders());}catch(error){return Promise.reject(error);}
  const fingerprint=JSON.stringify({codex:valid.codex.id,claude:valid.claude.id,briefing:valid.briefing,context:valid.context});
  const existing=launches.get(fingerprint);if(existing)return existing;
  const launch=(async()=>{
   const {comparison,sessions}=comparisonSessions(valid,{id:deps.makeId('comparison'),codexSessionId:deps.makeId('session'),claudeSessionId:deps.makeId('session'),now:deps.now(),defaultCodexModelId:deps.defaultCodexModelId()});
   await deps.persist(sessions);
   const runs=[[valid.codex,sessions[0]],[valid.claude,sessions[1]]] as const;
   // Independent starts: one failure never cancels or blocks the sibling.
   const settled=Promise.allSettled(runs.map(([agent,session])=>{try{return deps.execute(agent,valid.briefing,valid.context.map(item=>({...item})),session);}catch(error){return Promise.reject(error);}}));
   void settled.finally(()=>launches.delete(fingerprint));
   return comparison;
  })();
  launches.set(fingerprint,launch);launch.catch(()=>launches.delete(fingerprint));
  return launch;
 };
}
