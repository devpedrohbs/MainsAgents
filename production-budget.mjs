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
export function budgetUsage(p){
 const budget=p.budget,calls=budget?.calls??[],count=status=>calls.filter(call=>call.status===status).length;
 const maxCalls=budget?.maxCalls??DEFAULT_PRODUCTION_BUDGET.maxCalls,maxAttemptsPerStep=budget?.maxAttemptsPerStep??DEFAULT_PRODUCTION_BUDGET.maxAttemptsPerStep,stepKey=p.step?.budgetKey;
 return {measured:Boolean(budget),legacy:!budget||budget.legacy===true,measuredSince:budget?.measuredSince,maxCalls,maxAttemptsPerStep,used:calls.length,remaining:Math.max(0,maxCalls-calls.length),
  // A reserved/sent call that is not the step currently being dispatched has no confirmed outcome: counted as uncertain.
  completed:count('completed'),failed:count('failed'),inFlight:calls.filter(call=>open(call)&&call.id===p.step?.callId).length,uncertain:count('uncertain')+calls.filter(call=>open(call)&&call.id!==p.step?.callId).length,
  stepAttempts:stepKey&&budget?attemptsFor(budget,stepKey):0,stop:p.budgetStop&&budgetStopApplies(p)?p.budgetStop:undefined,tokens:'unavailable'};
}
/** Backup restore keeps only a well-formed ledger; anything else is shown as unmeasured. */
export function sanitizeBudget(value){
 try{if(!value||value.version!==1||!Array.isArray(value.calls)||value.calls.length>200||typeof value.measuredSince!=='string')return undefined;const limits=validateBudgetLimits(value);
  if(value.calls.some(call=>!call||typeof call.id!=='string'||typeof call.key!=='string'||typeof call.stage!=='string'||!statuses.includes(call.status)||typeof call.at!=='string'))return undefined;
  return {version:1,...limits,legacy:value.legacy===true,measuredSince:value.measuredSince,calls:value.calls.map(({id,key,stage,attempt,status,at,updatedAt})=>({id,key,stage,attempt:Number.isInteger(attempt)?attempt:1,status,at,updatedAt:typeof updatedAt==='string'?updatedAt:at}))};
 }catch{return undefined;}
}
