import {sanitizeUsage,modelName} from './production-budget.mjs';

/**
 * Usage reported by the Claude Code CLI in `--output-format stream-json`.
 * Fields used (official docs: Agent SDK `SDKResultMessage`, "Track cost and usage"; verified 2026-10-08):
 *   system/init        → `model`
 *   assistant          → `message.model`
 *   result             → `subtype`, `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`,
 *                        `usage{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`,
 *                        `modelUsage{<model>:{inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens,costUSD}}`
 * Per the docs: per-step assistant `output_tokens` is only a placeholder (never read here); `usage` leaves out
 * subagents while `modelUsage` includes them (preferred); `total_cost_usd`/`costUSD` are client-side estimates, not
 * billing; an error result after a crash may be zeroed. Nothing is estimated and nothing missing becomes 0.
 */
const int=value=>Number.isSafeInteger(value)&&value>=0?value:undefined;
const put=(target,key,value)=>{if(value!==undefined)target[key]=value;return target;};

export function usageFromResult(message,{model}={}){
 const base={model};
 const usage=message?.usage&&typeof message.usage==='object'?message.usage:{};
 const models=Object.entries(message?.modelUsage&&typeof message.modelUsage==='object'?message.modelUsage:{}).filter(([name])=>modelName(name)!==undefined).slice(0,4).map(([name,item])=>{
  const entry={model:name};
  put(entry,'input',int(item?.inputTokens));put(entry,'output',int(item?.outputTokens));put(entry,'cacheRead',int(item?.cacheReadInputTokens));put(entry,'cacheCreation',int(item?.cacheCreationInputTokens));
  if(typeof item?.costUSD==='number')entry.reportedCostUsd=item.costUSD;
  return entry;
 });
 const fromModels=key=>{const values=models.map(item=>item[key]).filter(value=>value!==undefined);return values.length?values.reduce((a,b)=>a+b,0):undefined;};
 // modelUsage covers subagents and compaction too, so it wins when present; `usage` is the main loop only.
 const tokens={};
 put(tokens,'input',fromModels('input')??int(usage.input_tokens));put(tokens,'output',fromModels('output')??int(usage.output_tokens));
 put(tokens,'cacheRead',fromModels('cacheRead')??int(usage.cache_read_input_tokens));put(tokens,'cacheCreation',fromModels('cacheCreation')??int(usage.cache_creation_input_tokens));
 const isError=message?.is_error===true||(typeof message?.subtype==='string'&&message.subtype!=='success');
 const allZero=Object.values(tokens).length>0&&Object.values(tokens).every(value=>value===0)&&(typeof message?.total_cost_usd!=='number'||message.total_cost_usd===0);
 const actual=models.length===1?models[0].model:model;
 const record={provider:'claude',status:'reported',tokens,models,model:actual,durationMs:message?.duration_ms,apiDurationMs:message?.duration_api_ms,numTurns:message?.num_turns};
 if(typeof message?.total_cost_usd==='number')record.reportedCostUsd=message.total_cost_usd;
 if(isError&&allZero)return sanitizeUsage({...base,provider:'claude',status:'unavailable',reason:'zeroed-error',durationMs:message?.duration_ms}); // crash results may be zeroed: unknown, not zero
 if(isError){record.status='partial';record.reason='error-result';}
 return sanitizeUsage(record)??{version:1,status:'unavailable',reason:'not-reported',provider:'claude'};
}

/** Missing result (killed, timed out, cancelled, crashed): usage is unknown, never 0. */
export const usageUnavailable=(reason,{model,durationMs}={})=>sanitizeUsage({provider:'claude',status:'unavailable',reason,model,durationMs});

/** Per-execution collector; `finish()` yields exactly one report no matter how often it is called. */
export function createUsageCollector(now=Date.now){
 const startedAt=now();let model,result,finished;
 return {
  observe(message){
   if(message?.type==='system'&&message.subtype==='init'&&typeof message.model==='string')model=message.model;
   else if(message?.type==='assistant'&&typeof message.message?.model==='string'&&!model)model=message.message.model;
   else if(message?.type==='result')result=message;
  },
  finish({cancelled=false,timedOut=false}={}){
   if(finished)return undefined;
   finished=true;
   if(result)return usageFromResult(result,{model});
   return usageUnavailable(cancelled?'cancelled':timedOut?'timeout':'no-result',{model,durationMs:now()-startedAt});
  },
 };
}
