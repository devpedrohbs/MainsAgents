import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {createClaudeLimitObserver,classifyCodexTurnError,limitFailure,eventLimit,createProviderWaits,waitLine} from '../provider-limits.mjs';
import {createClaudeCodeBridge} from '../claude-code-bridge.mjs';

/**
 * Usage limits are told apart ONLY from structured runtime evidence (formats verified on the installed Claude Code CLI
 * 2.1.301 stream-json and the Codex app-server codexErrorInfo enum). Prose never classifies: not stderr, not model text.
 */
const rejected=(extra={})=>({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'five_hour',resetsAt:1792170000,...extra},uuid:'u',session_id:'s'});

test('Claude observer: a rejected rate_limit_event is a limit with the reset the provider sent', () => {
 const observer=createClaudeLimitObserver(()=>'2026-10-16T12:00:00.000Z');
 observer.observe(rejected());observer.observe({type:'result',is_error:true,subtype:'success'});
 const limit=observer.classify({succeeded:false});
 assert.equal(limit.kind,'rate-limit');assert.equal(limit.resetsAt,new Date(1792170000*1000).toISOString());
 assert.deepEqual(limit.evidence,{source:'rate_limit_event',value:'rejected',at:'2026-10-16T12:00:00.000Z'});
 const weekly=createClaudeLimitObserver();weekly.observe(rejected({rateLimitType:'seven_day',resetsAt:undefined}));
 assert.equal(weekly.classify().kind,'quota');assert.equal(weekly.classify().resetsAt,null,'no reset sent = unknown, never invented');
});

test('Claude observer: warnings, a later admission and a successful result never open a wait', () => {
 const warning=createClaudeLimitObserver();warning.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed_warning',utilization:0.97}});
 assert.equal(warning.classify({succeeded:false}),null);
 const recovered=createClaudeLimitObserver();recovered.observe(rejected());recovered.observe({type:'rate_limit_event',rate_limit_info:{status:'allowed'}});
 assert.equal(recovered.classify({succeeded:false}),null,'allowed after rejected: the rejection is no longer the last word');
 const success=createClaudeLimitObserver();success.observe(rejected());
 assert.equal(success.classify({succeeded:true}),null,'an intermediate event never overrides a successful final result');
});

test('Claude observer: billing, auth and turn budget are separate kinds; prose is ignored', () => {
 const kind=(...messages)=>{const o=createClaudeLimitObserver();for(const m of messages)o.observe(m);return o.classify()?.kind??null;};
 assert.equal(kind({type:'assistant',error:'billing_error',message:{content:[]}}),'billing');
 assert.equal(kind({type:'assistant',error:'authentication_failed',message:{content:[]}}),'auth');
 assert.equal(kind({type:'assistant',error:'rate_limit',message:{content:[]}}),'rate-limit');
 assert.equal(kind({type:'assistant',error:'overloaded',message:{content:[]}}),'transient');
 assert.equal(kind({type:'result',subtype:'error_max_turns',is_error:true}),'turn-budget');
 assert.equal(kind({type:'assistant',error:'rate_limit',historical:true,message:{content:[]}}),null,'replayed history is not live evidence');
 assert.equal(kind({type:'assistant',message:{content:[{type:'text',text:'You have hit your usage limit · resets 3pm. Rate limit reached.'}]}},{type:'result',is_error:true,result:'Claude AI usage limit reached|1792170000'}),null,'text never classifies a limit');
 assert.equal(limitFailure({kind:'billing',resetsAt:null,evidence:{}},'Claude Code').code,'provider_billing');
 assert.equal(limitFailure({kind:'turn-budget',resetsAt:null,evidence:{}},'Claude Code'),null,'turn budget keeps its own path (editor_turn_limit)');
 assert.equal(limitFailure({kind:'auth',resetsAt:null,evidence:{}},'Claude Code').code,'login_required');
});

test('Codex: codexErrorInfo variants map to kinds; message text alone never does', () => {
 assert.equal(classifyCodexTurnError({message:'x',codexErrorInfo:'usageLimitExceeded'}).kind,'quota');
 assert.equal(classifyCodexTurnError({message:'x',codexErrorInfo:'rateLimitExceeded'}).kind,'rate-limit');
 assert.equal(classifyCodexTurnError({message:'x',codexErrorInfo:'sessionBudgetExceeded'}).kind,'session-budget');
 assert.equal(classifyCodexTurnError({message:'x',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:502}}}).kind,'transient');
 assert.equal(classifyCodexTurnError({message:'You exceeded your usage limit (rate limit 429)'}),null);
 assert.equal(limitFailure(classifyCodexTurnError({codexErrorInfo:'sessionBudgetExceeded'}),'Codex'),null,'session budget is not a provider wait');
 const event={type:'execution.failed',...limitFailure(classifyCodexTurnError({codexErrorInfo:'usageLimitExceeded'}),'Codex')};
 assert.equal(event.code,'provider_limit');assert.equal(eventLimit(event).kind,'quota');assert.equal(eventLimit(event).resetsAt,null);
 assert.equal(eventLimit({type:'execution.failed',code:'claude_cli_error',limit:{kind:'quota'}}),null,'only a provider_limit code carries a wait');
});

test('wait gate: per profile+provider, generation CAS, no content text, explicit release only', () => {
 const db=new DatabaseSync(':memory:'),waits=createProviderWaits(db,{now:()=>'2026-10-16T12:00:00.000Z'});
 const first=waits.open('owner','claude',{kind:'rate-limit',resetsAt:null,evidence:{source:'rate_limit_event',value:'rejected',at:'t'}});
 assert.equal(first.generation,1);assert.equal(waits.get('owner','codex'),null);assert.equal(waits.get('other','claude'),null);
 const second=waits.open('owner','claude',{kind:'quota',resetsAt:'2026-10-16T15:00:00.000Z',evidence:{source:'rate_limit_event',value:'rejected',at:'t2'}});
 assert.equal(second.generation,2);assert.equal(second.since,first.since,'the wait keeps its start');
 assert.deepEqual(waits.release('owner','claude',1),{released:false,reason:'newer-limit',wait:{...waits.get('owner','claude')}});
 assert.equal(waits.get('owner','claude').status,'waiting');
 assert.equal(waits.release('owner','claude',2).released,true);assert.equal(waits.get('owner','claude'),null);
 assert.equal(waits.release('owner','claude',2).released,false,'a replayed resume releases nothing');
 const row=db.prepare('SELECT data_json FROM provider_waits').get().data_json;assert.doesNotMatch(row,/content|session|message/i);
 assert.match(waitLine(first,'Claude Code'),/horário de liberação desconhecido/);
 assert.match(waitLine({...second,since:second.since},'Claude Code'),/reset informado pelo provedor/);
});

async function withServer(bridge,run){const server=createServer((request,response)=>{void bridge.handle(request,response,new URL(request.url??'/','http://127.0.0.1'));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await run(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}}

test('Claude CLI bridge publishes provider_limit only from structured events (real bridge, fake CLI process)', async () => {
 const root=mkdtempSync(join(tmpdir(),'mainsagents-limit-'));
 const cli=`
const args=process.argv.slice(2);
if(args[0]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true}));}
else{let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 const w=m=>process.stdout.write(JSON.stringify(m)+'\\n');
 if(input.includes('CASE-LIMIT')){w({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'five_hour',resetsAt:1792170000}});w({type:'assistant',error:'rate_limit',message:{content:[{type:'text',text:'limit'}]}});w({type:'result',subtype:'success',is_error:true,result:'x'});process.exitCode=1;}
 else if(input.includes('CASE-BILLING')){w({type:'assistant',error:'billing_error',message:{content:[]}});w({type:'result',subtype:'success',is_error:true});process.exitCode=1;}
 else if(input.includes('CASE-PROSE')){process.stderr.write('Error: rate limit reached, usage limit exceeded');w({type:'result',subtype:'success',is_error:true,result:'Claude AI usage limit reached'});process.exitCode=1;}
 else if(input.includes('CASE-RECOVER')){w({type:'rate_limit_event',rate_limit_info:{status:'rejected',rateLimitType:'five_hour'}});w({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'ok'}}});w({type:'result',is_error:false,result:'ok'});}
});}`;
 const path=join(root,'fake.cjs');writeFileSync(path,cli);
 const bridge=createClaudeCodeBridge({cwdRoot:root,resolveCli:()=>({command:process.execPath,prefixArgs:[path]})});
 try{await withServer(bridge,async base=>{
  const run=async text=>{const session=await fetch(`${base}/api/providers/claude/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentName:'A',workspaceId:'w',instructions:'i'})}).then(r=>r.json());
   const execution=await fetch(`${base}/api/providers/claude/executions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({remoteSessionId:session.remoteSessionId,content:text,instructions:'i',agentName:'A',workspaceId:'w',firstMessage:true})}).then(r=>r.json());
   return (await fetch(`${base}/api/providers/claude/executions/${execution.executionId}/events`).then(r=>r.text())).trim().split('\n').map(line=>JSON.parse(line)).find(event=>['execution.failed','execution.completed'].includes(event.type));};
  const limit=await run('CASE-LIMIT');
  assert.equal(limit.type,'execution.failed');assert.equal(limit.code,'provider_limit');assert.equal(limit.retryable,false);
  assert.equal(limit.limit.kind,'rate-limit');assert.equal(limit.limit.resetsAt,new Date(1792170000*1000).toISOString());assert.equal(limit.limit.evidence.source,'rate_limit_event');
  const billing=await run('CASE-BILLING');assert.equal(billing.code,'provider_billing');assert.equal(eventLimit(billing),null,'billing never opens a wait');
  const prose=await run('CASE-PROSE');assert.equal(prose.code,'claude_cli_error','stderr/result prose is not evidence of a limit');
  const recovered=await run('CASE-RECOVER');assert.equal(recovered.type,'execution.completed','success after an intermediate rejection stays a success');
 });}finally{rmSync(root,{recursive:true,force:true});}
});

test('an older rejection never masks a concrete terminal failure; rejected alone and a final rate_limit still wait', () => {
 const classify=(...messages)=>{const o=createClaudeLimitObserver();for(const m of messages)o.observe(m);return o.classify({succeeded:false});};
 const fail={type:'result',subtype:'success',is_error:true};
 assert.equal(classify(rejected(),{type:'assistant',error:'billing_error',message:{content:[]}},fail).kind,'billing');
 assert.equal(classify(rejected(),{type:'assistant',error:'authentication_failed',message:{content:[]}},fail).kind,'auth');
 assert.equal(classify(rejected(),{type:'result',subtype:'error_max_turns',is_error:true}).kind,'turn-budget');
 assert.equal(classify(rejected(),{...fail,api_error_status:401}).kind,'auth');
 assert.equal(classify(rejected(),{...fail,api_error_status:403}).kind,'auth');
 assert.equal(limitFailure(classify(rejected(),{type:'assistant',error:'billing_error',message:{content:[]}},fail),'Claude Code').code,'provider_billing','billing never becomes a wait');
 assert.equal(classify(rejected(),fail).kind,'rate-limit','rejected alone waits');
 assert.equal(classify({type:'assistant',error:'rate_limit',message:{content:[]}},fail).kind,'rate-limit','a final rate_limit waits');
 assert.equal(classify(rejected(),{type:'assistant',error:'rate_limit',message:{content:[]}},{...fail,api_error_status:429}).evidence.source,'rate_limit_event');
 const ok=createClaudeLimitObserver();ok.observe(rejected());ok.observe({type:'assistant',error:'billing_error',message:{content:[]}});assert.equal(ok.classify({succeeded:true}),null,'a final success always wins');
});
