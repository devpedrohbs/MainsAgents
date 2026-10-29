import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClaudeAccountUsage,normalizeClaudeAccountUsage,readClaudeAccount} from '../claude-account-usage.mjs';

const body={five_hour:{utilization:0.5,resets_at:'2026-10-27T21:00:00Z'},seven_day:{utilization:37,resets_at:null}};
const ok=(data=body)=>new Response(JSON.stringify(data));
test('account usage uses percentages, not CLI fractions; missing and malformed windows stay unknown',()=>{
 const data=normalizeClaudeAccountUsage(body,'pro',1793000000000);
 assert.equal(data.fiveHours.usedPercent,0.5);
 assert.equal(data.fiveHours.resetsAt,Date.parse(body.five_hour.resets_at)/1000);
 assert.equal(data.weekly.usedPercent,37);assert.equal(data.weekly.resetsAt,null);
 assert.equal(data.plan,'pro');assert.equal(data.source,'account');
 assert.equal(normalizeClaudeAccountUsage({five_hour:{utilization:-1}},'secret').fiveHours,null);
 assert.equal(normalizeClaudeAccountUsage({},'secret').plan,null);
});
test('credential lookup respects config directory and API billing, never modifies credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'claude-account-'));
 const path=join(dir,'.credentials.json'),original=JSON.stringify({claudeAiOauth:{accessToken:'test-secret',subscriptionType:'pro'}});
 try {
  await writeFile(path,original);
  assert.deepEqual(await readClaudeAccount({CLAUDE_CONFIG_DIR:dir}),{token:'test-secret',plan:'pro'});
  assert.deepEqual(await readClaudeAccount({CLAUDE_CONFIG_DIR:dir,ANTHROPIC_API_KEY:'test-key'}),{unsupported:true});
  assert.equal((await readClaudeAccount({CLAUDE_CONFIG_DIR:dir,CLAUDE_CODE_OAUTH_TOKEN:'override'})).token,'override');
  assert.equal(await readFile(path,'utf8'),original);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('live lookup authenticates only with provider, deduplicates concurrent reads, caches, and supports bounded manual refresh',async()=>{
 let calls=0,now=1793000000000;
 const read=createClaudeAccountUsage({now:()=>now,readAccount:async()=>({token:'test-secret',plan:'pro'}),fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.anthropic.com/api/oauth/usage');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer test-secret');return ok();
 }});
 const [a,b]=await Promise.all([read(),read()]);assert.deepEqual(a,b);assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(a),/test-secret|Bearer|accessToken/);
 await read({force:true});assert.equal(calls,1);
 now+=16_000;await read();assert.equal(calls,1);
 await read({force:true});assert.equal(calls,2);
 now+=301_000;await read();assert.equal(calls,3);
});
test('429 keeps last real reading with stale feedback and respects Retry-After even for forced reads',async()=>{
 let calls=0,now=1793000000000;
 const read=createClaudeAccountUsage({now:()=>now,readAccount:async()=>({token:'t'}),fetchImpl:async()=>++calls===1?ok():new Response('',{status:429,headers:{'retry-after':'600'}})});
 await read();now+=301_000;
 const limited=await read();assert.equal(limited.stale,true);assert.equal(limited.fiveHours.usedPercent,0.5);assert.equal(limited.error,'rate-limited');
 now+=301_000;await read({force:true});assert.equal(calls,2);
 now+=300_000;await read();assert.equal(calls,3);
});
test('logout, changed account and rejected credentials never display cached account numbers',async()=>{
 let account={token:'a'},now=1793000000000,calls=0;
 const read=createClaudeAccountUsage({now:()=>now,readAccount:async()=>account,fetchImpl:async()=>++calls===1?ok():new Response('',{status:401})});
 await read();account={token:'b'};
 assert.equal((await read()).fiveHours,null);assert.equal(calls,2);
 account=null;const loggedOut=await read();assert.equal(loggedOut.error,'login-required');assert.equal(loggedOut.fiveHours,null);assert.equal(calls,2);
});
test('an in-flight previous account response cannot replace a new account snapshot',async()=>{
 let account={token:'a'},finish;
 const read=createClaudeAccountUsage({readAccount:async()=>account,fetchImpl:async(_,options)=>options.headers.Authorization==='Bearer a'?new Promise(resolve=>{finish=resolve;}):ok({...body,five_hour:{utilization:9}})});
 const old=read();while(!finish)await new Promise(resolve=>setImmediate(resolve));
 account={token:'b'};assert.equal((await read()).fiveHours.usedPercent,9);
 finish(ok());assert.equal((await old).fiveHours,null);
 assert.equal((await read()).fiveHours.usedPercent,9);
});
test('network or malformed responses expose no credentials, no guessed zeros, and back off',async()=>{
 for(const fetchImpl of [async()=>{throw Error('Bearer test-secret');},async()=>ok({})]){
  let calls=0;
  const read=createClaudeAccountUsage({readAccount:async()=>({token:'test-secret'}),fetchImpl:(...args)=>{calls++;return fetchImpl(...args);}});
  const result=await read();assert.equal(result.fiveHours,null);assert.equal(result.error,'unavailable');assert.doesNotMatch(JSON.stringify(result),/test-secret/);
  await read({force:true});assert.equal(calls,1);
 }
});
