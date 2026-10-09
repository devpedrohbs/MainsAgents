/** Per-production AI call budget. Every dispatch is reserved durably before it is sent; reservations are never refunded. */
export const DEFAULT_PRODUCTION_BUDGET=Object.freeze({maxCalls:8,maxAttemptsPerStep:2});
export const PRODUCTION_BUDGET_RANGE=Object.freeze({maxCalls:Object.freeze({min:1,max:40}),maxAttemptsPerStep:Object.freeze({min:1,max:5})});
const statuses=['reserved','sent','completed','failed','uncertain'];
const transitions={reserved:['sent','failed','uncertain'],sent:['completed','failed','uncertain'],uncertain:['completed'],completed:[],failed:[]};

export class ProductionBudgetError extends Error{constructor(message,stop){super(message);this.budgetStop=stop;}}

export function validateBudgetLimits(input){
 const value=input??{},result={};
 for(const key of ['maxCalls','maxAttemptsPerStep']){const n=value[key],{min,max}=PRODUCTION_BUDGET_RANGE[key];if(!Number.isInteger(n)||n<min||n>max)throw Error(key==='maxCalls'?`Escolha de ${min} a ${max} chamadas de IA por produção.`:`Escolha de ${min} a ${max} tentativas por etapa.`);result[key]=n;}
 return result;
}
export const initialBudget=(limits,at)=>({version:1,...validateBudgetLimits(limits??DEFAULT_PRODUCTION_BUDGET),legacy:false,measuredSince:at,calls:[]});
/** Productions created before budgets existed: earlier usage was not measured and is never invented. */
export function ensureBudget(p,at){p.budget??={version:1,...DEFAULT_PRODUCTION_BUDGET,legacy:true,measuredSince:at,calls:[]};return p.budget;}
const open=call=>call.status==='reserved'||call.status==='sent';
const attemptsFor=(budget,key)=>budget.calls.filter(call=>call.key===key).length;

export function reserveCall(p,{key,stage,attempt},at){
 const budget=ensureBudget(p,at),used=budget.calls.length,attempts=attemptsFor(budget,key);
 if(used>=budget.maxCalls)throw new ProductionBudgetError(`Limite de chamadas de IA desta produção atingido (${used}/${budget.maxCalls}). Nada foi enviado. Revise o uso e aumente o limite para continuar.`,{kind:'calls',limit:budget.maxCalls,used,stage,key,at});
 if(attempts>=budget.maxAttemptsPerStep)throw new ProductionBudgetError(`Limite de tentativas desta etapa atingido (${attempts}/${budget.maxAttemptsPerStep}). Nada foi reenviado. Revise o resultado e aumente o limite de tentativas para continuar.`,{kind:'attempts',limit:budget.maxAttemptsPerStep,used:attempts,stage,key,at});
 const entry={id:`call-${used+1}-${Date.parse(at)||0}`,key,stage,attempt,status:'reserved',at,updatedAt:at};budget.calls.push(entry);return entry;
}
export function markCall(p,id,status,at){
 const entry=p.budget?.calls.find(call=>call.id===id);
 if(entry&&transitions[entry.status]?.includes(status)){entry.status=status;entry.updatedAt=at;}
 return entry;
}
export function budgetStopApplies(p){
 const stop=p.budgetStop,budget=p.budget;if(!stop||!budget)return false;
 return stop.kind==='calls'?budget.calls.length>=budget.maxCalls:attemptsFor(budget,stop.key)>=budget.maxAttemptsPerStep;
}

/**
 * CLI-reported usage (never estimated here). Trust boundary: only these allowlisted, bounded fields are stored.
 * A missing field stays absent (unavailable), never 0. `reportedCostUsd` is the CLI's own client-side estimate,
 * not a bill or a balance, and is never derived from a price table in this app.
 */
export const USAGE_STATUSES=['reported','partial','unavailable'];
const usageProviders=['claude','codex'];
const tokenKeys=['input','output','cacheRead','cacheCreation'];
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1e10?value:undefined;
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e6?value:undefined;
const duration=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=7*24*3600*1000?Math.round(value):undefined;
export const modelName=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:\-\[\]]{1,120}$/.test(value)?value:undefined;
const reasons=['no-result','cancelled','not-reported','zeroed-error','error-result','provider-no-usage','timeout'];
export function sanitizeUsage(value){
 if(!value||typeof value!=='object')return undefined;
 const status=USAGE_STATUSES.includes(value.status)?value.status:undefined;if(!status)return undefined;
 const out={version:1,status};
 if(reasons.includes(value.reason))out.reason=value.reason;
 if(usageProviders.includes(value.provider))out.provider=value.provider;
 if(status!=='unavailable'){
  const tokens={};for(const key of tokenKeys){const n=count(value.tokens?.[key]);if(n!==undefined)tokens[key]=n;}
  if(Object.keys(tokens).length)out.tokens=tokens;
  const models=(Array.isArray(value.models)?value.models:[]).slice(0,4).map(item=>{const model=modelName(item?.model);if(!model)return undefined;const entry={model};for(const key of tokenKeys){const n=count(item[key]);if(n!==undefined)entry[key]=n;}const cost=money(item.reportedCostUsd);if(cost!==undefined)entry.reportedCostUsd=cost;return entry;}).filter(Boolean);
  if(models.length)out.models=models;
  const cost=money(value.reportedCostUsd);if(cost!==undefined)out.reportedCostUsd=cost;
  const api=duration(value.apiDurationMs);if(api!==undefined)out.apiDurationMs=api;
  const turns=count(value.numTurns);if(turns!==undefined&&turns<=10000)out.numTurns=turns;
  // Nothing usable survived: it is unavailable, not a zero.
  if(!out.tokens&&!out.models&&out.reportedCostUsd===undefined)return {version:1,status:'unavailable',reason:'not-reported',...(out.provider?{provider:out.provider}:{})};
 }
 const model=modelName(value.model);if(model)out.model=model;
 const ms=duration(value.durationMs);if(ms!==undefined)out.durationMs=ms;
 return out;
}
/**
 * Attaches one usage report to the call that produced it. Idempotent: a call keeps its first report, so a replayed
 * or duplicated event can never double-count. Does not change the call status, counts or limits.
 */
export function recordUsage(p,callId,usage,at){
 const entry=p.budget?.calls.find(call=>call.id===callId);if(!entry||entry.usage)return entry;
 const clean=sanitizeUsage(usage);if(!clean)return entry;
 entry.usage={...clean,recordedAt:at};return entry;
}
const sum=(items,pick)=>{let total,seen=0;for(const item of items){const n=pick(item);if(n!==undefined){total=(total??0)+n;seen++;}}return {total,seen};};
export function budgetUsage(p){
 const budget=p.budget,calls=budget?.calls??[],count=status=>calls.filter(call=>call.status===status).length;
 const maxCalls=budget?.maxCalls??DEFAULT_PRODUCTION_BUDGET.maxCalls,maxAttemptsPerStep=budget?.maxAttemptsPerStep??DEFAULT_PRODUCTION_BUDGET.maxAttemptsPerStep,stepKey=p.step?.budgetKey;
 return {measured:Boolean(budget),legacy:!budget||budget.legacy===true,measuredSince:budget?.measuredSince,maxCalls,maxAttemptsPerStep,used:calls.length,remaining:Math.max(0,maxCalls-calls.length),
  // A reserved/sent call that is not the step currently being dispatched has no confirmed outcome: counted as uncertain.
  completed:count('completed'),failed:count('failed'),inFlight:calls.filter(call=>open(call)&&call.id===p.step?.callId).length,uncertain:count('uncertain')+calls.filter(call=>open(call)&&call.id!==p.step?.callId).length,
  stepAttempts:stepKey&&budget?attemptsFor(budget,stepKey):0,stop:p.budgetStop&&budgetStopApplies(p)?p.budgetStop:undefined,...usageSummary(calls,p.step?.callId)};
}

/** `tokens` stays 'unavailable' until a call really reports usage; then 'reported' (every settled call) or 'partial'. */
function usageSummary(calls,activeId){
 const settled=calls.filter(call=>!(open(call)&&call.id===activeId));
 const withUsage=settled.filter(call=>call.usage&&call.usage.status!=='unavailable');
 const totals={};
 for(const key of tokenKeys){const result=sum(withUsage,call=>call.usage.tokens?.[key]);if(result.total!==undefined)totals[key]=result.total;}
 const cost=sum(withUsage,call=>call.usage.reportedCostUsd);
 const rows=calls.slice(-10).map(call=>({id:call.id,stage:call.stage,attempt:call.attempt,callStatus:call.status,usage:call.usage}));
 const unavailable=settled.length-withUsage.length,partial=withUsage.filter(call=>call.usage.status==='partial').length;
 const tokens=!withUsage.length?'unavailable':unavailable||partial?'partial':'reported';
 return {tokens,usageTotals:withUsage.length?{...totals,...(cost.total!==undefined?{reportedCostUsd:cost.total,costCalls:cost.seen}:{}),callsReported:withUsage.length,callsPartial:partial,callsUnavailable:unavailable}:undefined,usageRows:rows};
}
/** Backup restore keeps only a well-formed ledger; anything else is shown as unmeasured. */
export function sanitizeBudget(value){
 try{if(!value||value.version!==1||!Array.isArray(value.calls)||value.calls.length>200||typeof value.measuredSince!=='string')return undefined;const limits=validateBudgetLimits(value);
  if(value.calls.some(call=>!call||typeof call.id!=='string'||typeof call.key!=='string'||typeof call.stage!=='string'||!statuses.includes(call.status)||typeof call.at!=='string'))return undefined;
  return {version:1,...limits,legacy:value.legacy===true,measuredSince:value.measuredSince,calls:value.calls.map(({id,key,stage,attempt,status,at,updatedAt,usage})=>{const clean=sanitizeUsage(usage);return {id,key,stage,attempt:Number.isInteger(attempt)?attempt:1,status,at,updatedAt:typeof updatedAt==='string'?updatedAt:at,...(clean&&typeof usage.recordedAt==='string'?{usage:{...clean,recordedAt:usage.recordedAt}}:{})};})};
 }catch{return undefined;}
}
