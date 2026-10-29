import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Read-only access to the account already signed in by Claude Code. Never refresh, write or
// expose its credentials, and never run a model request to discover subscription usage.
export async function readClaudeAccount(env=process.env) {
 if(env.ANTHROPIC_API_KEY||['CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'].some(key=>env[key]==='1'))return {unsupported:true};
 const config=env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude');
 let oauth;
 try {oauth=JSON.parse(await readFile(join(config,'.credentials.json'),'utf8')).claudeAiOauth;} catch {}
 const token=env.CLAUDE_CODE_OAUTH_TOKEN||oauth?.accessToken;
 if(typeof token!=='string'||!token.trim())return null;
 return {token,plan:env.CLAUDE_CODE_OAUTH_TOKEN?null:oauth?.subscriptionType};
}

const blank=()=>({fiveHours:null,weekly:null,plan:null,observedAt:null,source:'account',stale:false});
const windowOf=value=>{
 const used=value?.utilization;
 if(typeof used!=='number'||!Number.isFinite(used)||used<0)return null;
 const reset=typeof value.resets_at==='string'?Date.parse(value.resets_at):NaN;
 // Unlike stream-json utilization (0..1), the account endpoint sends percentages (0..100).
 return {usedPercent:Math.min(100,used),resetsAt:Number.isFinite(reset)?Math.floor(reset/1000):null};
};
export function normalizeClaudeAccountUsage(data,plan,now=Date.now()) {
 return {...blank(),fiveHours:windowOf(data?.five_hour),weekly:windowOf(data?.seven_day),
  plan:['pro','max','team','enterprise'].includes(plan)?plan:null,observedAt:new Date(now).toISOString(),fetchedAt:new Date(now).toISOString()};
}

/** Shared cache for sidebar + Usage page; account changes invalidate it, 429s back off. */
export function createClaudeAccountUsage({readAccount=readClaudeAccount,fetchImpl=fetch,now=Date.now,cacheMs=300_000}={}) {
 let identity,cache,retryAt=0,lastAttempt=0,pending;
 return async ({force=false}={})=>{
  let account;
  try {account=await readAccount();} catch {}
  const key=account?.token?createHash('sha256').update(account.token).digest('hex'):null;
  if(key!==identity){identity=key;cache=undefined;retryAt=0;lastAttempt=0;pending=undefined;}
  const stamp=()=>new Date(now()).toISOString();
  if(!key)return {...blank(),fetchedAt:stamp(),error:account?.unsupported?'api-billing':'login-required'};
  if(pending){const result=await pending;return identity===key?{...result}:{...blank(),fetchedAt:stamp(),error:'account-changed'};}
  if(cache&&(now()<retryAt||now()-lastAttempt<15_000||(!force&&now()-lastAttempt<cacheMs)))return {...cache};
  lastAttempt=now();
  const request=(async()=>{
   let error='unavailable';
   try {
    const response=await fetchImpl('https://api.anthropic.com/api/oauth/usage',{
     headers:{Authorization:`Bearer ${account.token}`,'anthropic-beta':'oauth-2025-04-20'},
     redirect:'error',signal:AbortSignal.timeout(12_000),
    });
    if(response.ok){
     const next=normalizeClaudeAccountUsage(await response.json(),account.plan,now());
     if(!next.fiveHours&&!next.weekly)throw new Error('No usage windows');
     if(identity===key){cache=next;retryAt=0;}
     return next;
    }
    error=response.status===401||response.status===403?'login-required':response.status===429?'rate-limited':'unavailable';
    if(identity===key){
     const retry=response.headers.get('retry-after'),seconds=Number(retry);
     const delay=retry&&Number.isFinite(seconds)?seconds*1000:Date.parse(retry??'')-now();
     retryAt=now()+Math.max(60_000,Number.isFinite(delay)&&delay>0?Math.min(delay,86_400_000):300_000);
    }
   } catch {if(identity===key)retryAt=now()+60_000;}
   const result={...(identity===key&&cache?cache:blank()),error,stale:!!(identity===key&&cache?.observedAt),fetchedAt:stamp()};
   // An authorization failure must not continue to display the previous account's numbers.
   if(error==='login-required')Object.assign(result,blank(),{error});
   if(identity===key)cache=result;
   return result;
  })();
  pending=request;
  try {const result=await request;return identity===key?{...result}:{...blank(),fetchedAt:stamp(),error:'account-changed'};} finally {if(pending===request)pending=undefined;}
 };
}
