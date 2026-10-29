import type {CodexUsage,UsageWindow} from '../chat/codexUsage';

/**
 * Local ledger of chat turns as the providers reported them (Claude `usage.reported` from the CLI result, Codex summed
 * `thread/tokenUsage/updated`). One entry per execution, first report wins. Nothing is estimated: a missing token count stays
 * absent and the cost exists only when the Claude CLI sent its own client-side estimate (it is not a bill).
 */
export type UsageProvider='claude'|'codex';
export interface UsageTokens {input?:number;output?:number;cacheRead?:number;cacheCreation?:number}
export interface UsageEntry {
 id:string;at:string;provider:UsageProvider;agentId:string;workspaceId?:string;sessionId:string;contentId?:string;
 model?:string;tokens?:UsageTokens;costUsd?:number;
}
export const usageLedgerKey='usage-ledger';
/** Window event (detail: provider) fired when a chat reply reports usage. */
export const usageReportedEvent='mainsagents:usage-reported';
const MAX_ENTRIES=4000,MAX_AGE_DAYS=120;
const tokenKeys=['input','output','cacheRead','cacheCreation'] as const;
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1e10?value:undefined;

/** Reported usage (already sanitized by the host) turned into a ledger entry; undefined when nothing usable was reported. */
export function usageEntry(input:{executionId:string;provider:UsageProvider;agentId:string;workspaceId?:string;sessionId:string;contentId?:string;usage:unknown;at?:string}):UsageEntry|undefined{
 const usage=input.usage as {status?:string;model?:unknown;tokens?:Record<string,unknown>;reportedCostUsd?:unknown}|undefined;
 if(!usage||usage.status==='unavailable')return undefined;
 const tokens:UsageTokens={};for(const key of tokenKeys){const n=count(usage.tokens?.[key]);if(n!==undefined)tokens[key]=n;}
 const cost=typeof usage.reportedCostUsd==='number'&&Number.isFinite(usage.reportedCostUsd)&&usage.reportedCostUsd>=0?usage.reportedCostUsd:undefined;
 if(!Object.keys(tokens).length&&cost===undefined)return undefined;
 return {id:input.executionId,at:input.at??new Date().toISOString(),provider:input.provider,agentId:input.agentId,sessionId:input.sessionId,
  ...(input.workspaceId?{workspaceId:input.workspaceId}:{}),...(input.contentId?{contentId:input.contentId}:{}),
  ...(typeof usage.model==='string'&&usage.model.length<=120?{model:usage.model}:{}),...(Object.keys(tokens).length?{tokens}:{}),...(cost!==undefined?{costUsd:cost}:{})};
}

export function withUsageEntry(ledger:readonly UsageEntry[]|undefined,entry:UsageEntry,now=Date.now()):UsageEntry[]{
 const list=Array.isArray(ledger)?ledger:[];
 if(list.some(item=>item.id===entry.id&&item.provider===entry.provider))return list as UsageEntry[];
 const oldest=now-MAX_AGE_DAYS*86_400_000;
 return [...list.filter(item=>Date.parse(item.at)>=oldest),entry].slice(-MAX_ENTRIES);
}

export const totalTokens=(tokens?:UsageTokens)=>tokens?tokenKeys.reduce((sum,key)=>sum+(tokens[key]??0),0):0;
export interface UsageTotals {turns:number;tokens:Required<UsageTokens>;total:number;cost?:number}
export function usageTotals(entries:readonly UsageEntry[]):UsageTotals{
 const tokens={input:0,output:0,cacheRead:0,cacheCreation:0};let cost:number|undefined;
 for(const entry of entries){for(const key of tokenKeys)tokens[key]+=entry.tokens?.[key]??0;if(entry.costUsd!==undefined)cost=(cost??0)+entry.costUsd;}
 return {turns:entries.length,tokens,total:tokenKeys.reduce((sum,key)=>sum+tokens[key],0),cost};
}

const dayKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
/** One bucket per local calendar day of the period, oldest first; days without turns are zero, not missing. */
export function usageByDay(entries:readonly UsageEntry[],days:number,now=new Date()){
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(days-1));
 const buckets=Array.from({length:days},(_,index)=>{const date=new Date(start.getFullYear(),start.getMonth(),start.getDate()+index);return {key:dayKey(date),date,entries:[] as UsageEntry[]};});
 const byKey=new Map(buckets.map(bucket=>[bucket.key,bucket]));
 for(const entry of entries)byKey.get(dayKey(new Date(entry.at)))?.entries.push(entry);
 return buckets.map(bucket=>({key:bucket.key,date:bucket.date,...usageTotals(bucket.entries)}));
}
export function inPeriod(entries:readonly UsageEntry[],days:number,now=new Date()){
 const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(days-1)).getTime();
 return entries.filter(entry=>Date.parse(entry.at)>=start);
}
export function usageGroups(entries:readonly UsageEntry[],keyOf:(entry:UsageEntry)=>string){
 const groups=new Map<string,UsageEntry[]>();
 for(const entry of entries){const key=keyOf(entry);groups.set(key,[...(groups.get(key)??[]),entry]);}
 return [...groups].map(([key,list])=>({key,...usageTotals(list)}));
}

export type ClaudeAccountLimits=CodexUsage&{observedAt:string|null;source?:'account';stale?:boolean;error?:string};
export async function readClaudeUsage(signal:AbortSignal,refresh=false):Promise<ClaudeAccountLimits>{
 const response=await fetch(`/api/providers/claude/usage${refresh?'?refresh=1':''}`,{signal,cache:'no-store'});
 if(!response.ok)throw new Error('Claude usage unavailable');
 const data=await response.json() as Partial<ClaudeAccountLimits>;
 const window=(value?:UsageWindow|null)=>value&&typeof value.usedPercent==='number'?{usedPercent:Math.max(0,Math.min(100,value.usedPercent)),resetsAt:typeof value.resetsAt==='number'?value.resetsAt:null}:null;
 return {fiveHours:window(data.fiveHours),weekly:window(data.weekly),plan:data.plan??null,fetchedAt:data.fetchedAt??new Date().toISOString(),observedAt:data.observedAt??null,source:data.source,stale:data.stale,error:data.error};
}
