/**
 * Provider usage limits (quota / rate limit) told apart from every other failure, ONLY from structured runtime evidence:
 *  - Claude Code CLI stream-json (verified on the installed CLI 2.1.301): `rate_limit_event.rate_limit_info.status`
 *    ('allowed' | 'allowed_warning' | 'rejected', optional `resetsAt` unix seconds, `rateLimitType`), the assistant message
 *    `error` field ('rate_limit', 'billing_error', 'authentication_failed', ...) and `result.subtype` / `api_error_status`.
 *  - Codex app-server: `turn.error.codexErrorInfo` ('usageLimitExceeded', 'rateLimitExceeded', 'sessionBudgetExceeded', ...).
 * Prose (stderr, model text, the user's message) never classifies a limit. A reset time exists only when the provider sent it.
 *
 * The wait gate (`provider_waits`) is per PROFILE + PROVIDER: while it is open the app admits no automatic production/editor
 * call to that provider (zero tokens, no probe, no timer). Only an explicit user Resume closes it, with a generation CAS so a
 * stale click never clears a newer limit. It stores no content text: deleting a content never needs to touch it.
 */
const KINDS=Object.freeze(['quota','rate-limit','billing','auth','turn-budget','session-budget','transient','generic']);
export const PROVIDER_LIMIT_KINDS=KINDS;
/** Kinds that open the wait gate: a temporary usage limit of the provider. Billing is an account problem (no wait, no reset). */
export const waitKinds=Object.freeze(['quota','rate-limit']);
const isoFromUnix=value=>Number.isSafeInteger(value)&&value>1e9&&value<1e11?new Date(value*1000).toISOString():null;
const clip=(value,n=80)=>typeof value==='string'?value.slice(0,n):undefined;

const CLAUDE_ASSISTANT_ERRORS={rate_limit:'rate-limit',billing_error:'billing',authentication_failed:'auth',oauth_org_not_allowed:'auth',account_on_hold:'auth',verification_required:'auth',cloud_credential_error:'auth',overloaded:'transient',server_error:'transient'};
const CODEX_ERRORS={usageLimitExceeded:'quota',rateLimitExceeded:'rate-limit',sessionBudgetExceeded:'session-budget',contextWindowExceeded:'generic',serverOverloaded:'transient',httpConnectionFailed:'transient',responseStreamConnectionFailed:'transient',responseStreamDisconnected:'transient',unauthorized:'auth'};

/**
 * Observer of one Claude CLI execution (fed every parsed stream-json line). `classify({succeeded})` returns null when the
 * execution succeeded (an intermediate rejected event never overrides a successful final result) or nothing structured
 * explains the failure; otherwise {kind, resetsAt, rateLimitType?, evidence}.
 */
export function createClaudeLimitObserver(now=()=>new Date().toISOString()){
 let rejected=null,assistantError=null,subtype=null,apiStatus=null;
 return {
  observe(message){
   if(!message||typeof message!=='object')return;
   if(message.type==='rate_limit_event'){const info=message.rate_limit_info;if(info&&typeof info==='object'&&['allowed','allowed_warning','rejected'].includes(info.status)){
    // allowed/allowed_warning after a rejection means the provider admitted again: the rejection is no longer the last word.
    rejected=info.status==='rejected'?{resetsAt:isoFromUnix(info.resetsAt),rateLimitType:clip(info.rateLimitType,40),at:now()}:null;}}
   else if(message.type==='assistant'&&typeof message.error==='string'&&!message.historical)assistantError={value:message.error.slice(0,60),at:now()};
   else if(message.type==='result'){if(typeof message.subtype==='string')subtype=message.subtype.slice(0,60);if(Number.isSafeInteger(message.api_error_status))apiStatus=message.api_error_status;}
  },
  classify({succeeded=false}={}){
   if(succeeded)return null;
   // A concrete terminal failure (billing, auth, turn budget, HTTP 401/403) is never masked by an earlier rejection event.
   const terminal=assistantError&&['billing','auth'].includes(CLAUDE_ASSISTANT_ERRORS[assistantError.value])?{kind:CLAUDE_ASSISTANT_ERRORS[assistantError.value],resetsAt:null,evidence:{source:'assistant.error',value:assistantError.value,at:assistantError.at}}
    :subtype==='error_max_turns'?{kind:'turn-budget',resetsAt:null,evidence:{source:'result.subtype',value:subtype,at:now()}}
    :apiStatus===401||apiStatus===403?{kind:'auth',resetsAt:null,evidence:{source:'result.api_error_status',value:String(apiStatus),at:now()}}:null;
   if(terminal)return terminal;
   if(rejected)return {kind:rejected.rateLimitType&&/^seven_day|overage/.test(rejected.rateLimitType)?'quota':'rate-limit',resetsAt:rejected.resetsAt,...(rejected.rateLimitType?{rateLimitType:rejected.rateLimitType}:{}),evidence:{source:'rate_limit_event',value:'rejected',at:rejected.at}};
   if(assistantError&&CLAUDE_ASSISTANT_ERRORS[assistantError.value]){const kind=CLAUDE_ASSISTANT_ERRORS[assistantError.value];return {kind,resetsAt:null,evidence:{source:'assistant.error',value:assistantError.value,at:assistantError.at}};}
   if(subtype==='error_max_turns')return {kind:'turn-budget',resetsAt:null,evidence:{source:'result.subtype',value:subtype,at:now()}};
   if(apiStatus===429)return {kind:'rate-limit',resetsAt:null,evidence:{source:'result.api_error_status',value:'429',at:now()}};
   if(apiStatus===401||apiStatus===403)return {kind:'auth',resetsAt:null,evidence:{source:'result.api_error_status',value:String(apiStatus),at:now()}};
   return null;
  },
 };
}

/** Codex turn error (app-server `turn.error`): codexErrorInfo is a string variant or a one-key object variant. */
export function classifyCodexTurnError(error,now=()=>new Date().toISOString()){
 const info=error?.codexErrorInfo;const name=typeof info==='string'?info:info&&typeof info==='object'?Object.keys(info)[0]:null;
 if(!name||!CODEX_ERRORS[name])return null;
 const nested=info&&typeof info==='object'?info[name]:null,resetsAt=nested&&typeof nested==='object'?isoFromUnix(nested.resetsAt):null;
 return {kind:CODEX_ERRORS[name],resetsAt,evidence:{source:'codexErrorInfo',value:name.slice(0,60),at:now()}};
}

/** Execution-failed fields the bridges publish for a classified failure (the message is the app's own, never the provider's prose). */
export function limitFailure(limit,providerLabel){
 if(!limit||!KINDS.includes(limit.kind))return null;
 const label=providerLabel;
 const text={quota:`${label} atingiu o limite de uso da conta.`,'rate-limit':`${label} recusou por limite de uso temporário.`,billing:`${label} recusou por problema de cobrança/plano da conta. Confira a conta no ${label}; isto não é uma espera temporária.`,auth:`${label} recusou a autenticação. Entre de novo na conta do ${label}.`,'turn-budget':`${label} atingiu o limite de turnos desta execução.`,'session-budget':`${label} atingiu o orçamento desta sessão.`,transient:`${label} está temporariamente indisponível (sobrecarga ou conexão).`,generic:`${label} não concluiu esta resposta.`}[limit.kind];
 const code=waitKinds.includes(limit.kind)?'provider_limit':limit.kind==='billing'?'provider_billing':limit.kind==='auth'?'login_required':null;
 return code?{code,message:text,retryable:false,limit:{kind:limit.kind,resetsAt:limit.resetsAt??null,...(limit.rateLimitType?{rateLimitType:limit.rateLimitType}:{}),evidence:limit.evidence}}:null;
}

/** Normalized limit carried by an execution.failed event (null unless it is a well-formed provider_limit). */
export function eventLimit(event){
 const limit=event?.limit;if(event?.code!=='provider_limit'||!limit||!waitKinds.includes(limit.kind))return null;
 const resetsAt=typeof limit.resetsAt==='string'&&Number.isFinite(Date.parse(limit.resetsAt))?new Date(Date.parse(limit.resetsAt)).toISOString():null;
 const evidence=limit.evidence&&typeof limit.evidence==='object'?{source:clip(limit.evidence.source,40)??'unknown',value:clip(limit.evidence.value,60)??'',at:typeof limit.evidence.at==='string'?limit.evidence.at.slice(0,40):new Date().toISOString()}:{source:'unknown',value:'',at:new Date().toISOString()};
 return {kind:limit.kind,resetsAt,...(limit.rateLimitType?{rateLimitType:clip(limit.rateLimitType,40)}:{}),evidence};
}

// ------------------------------------------------------------------ durable wait gate (per profile + provider)

export function createProviderWaits(db,{now=()=>new Date().toISOString()}={}){
 db.exec('CREATE TABLE IF NOT EXISTS provider_waits(profile_id TEXT NOT NULL,provider_id TEXT NOT NULL,generation INTEGER NOT NULL,status TEXT NOT NULL,data_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(profile_id,provider_id))');
 const read=(profile,providerId)=>{const row=db.prepare('SELECT generation,status,data_json FROM provider_waits WHERE profile_id=? AND provider_id=?').get(profile,providerId);return row?{...JSON.parse(row.data_json),generation:row.generation,status:row.status}:null;};
 return {
  /** The open wait of this provider (null when admitting). */
  get(profile,providerId){const row=read(profile,providerId);return row?.status==='waiting'?row:null;},
  list(profile){return db.prepare("SELECT provider_id FROM provider_waits WHERE profile_id=? AND status='waiting'").all(profile).map(row=>read(profile,row.provider_id));},
  /** Opens (or refreshes with newer evidence) the wait. Every open bumps the generation, so an older Resume cannot clear it. */
  open(profile,providerId,limit){
   const prior=read(profile,providerId),generation=(prior?.generation??0)+1,at=now();
   const data={providerId,kind:limit.kind,resetsAt:limit.resetsAt??null,...(limit.rateLimitType?{rateLimitType:limit.rateLimitType}:{}),evidence:limit.evidence,since:prior?.status==='waiting'?prior.since:at,lastAt:at};
   db.prepare('INSERT OR REPLACE INTO provider_waits VALUES(?,?,?,?,?,?)').run(profile,providerId,generation,'waiting',JSON.stringify(data),at);
   return {...data,generation,status:'waiting'};
  },
  /** Explicit user Resume: closes only the generation the person saw. A newer limit (higher generation) stays open. */
  release(profile,providerId,generation){
   const row=read(profile,providerId);if(!row||row.status!=='waiting')return {released:false,reason:'not-waiting'};
   if(row.generation!==generation)return {released:false,reason:'newer-limit',wait:row};
   const result=db.prepare("UPDATE provider_waits SET status='released',updated_at=? WHERE profile_id=? AND provider_id=? AND generation=? AND status='waiting'").run(now(),profile,providerId,generation);
   return {released:result.changes===1,...(result.changes===1?{}:{reason:'raced'})};
  },
 };
}

/** PT summary line of a wait (what is known, never an invented reset time). */
export function waitLine(wait,label,{locale='pt-BR',timeZone}={}){
 if(!wait)return '';
 const fmt=iso=>new Date(iso).toLocaleString(locale,{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',...(timeZone?{timeZone}:{})});
 return `Aguardando limite do ${label} desde ${fmt(wait.since)} · ${wait.resetsAt?`reset informado pelo provedor: ${fmt(wait.resetsAt)}`:'horário de liberação desconhecido (o provedor não informou)'}.`;
}
