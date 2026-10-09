import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {usageFromResult,usageUnavailable,createUsageCollector} from '../claude-usage.mjs';
import {createClaudeCodeBridge} from '../claude-code-bridge.mjs';

// Shapes follow the official Agent SDK docs (SDKResultMessage / modelUsage); values are synthetic.
const success=(extra={})=>({type:'result',subtype:'success',is_error:false,duration_ms:5200,duration_api_ms:4100,num_turns:2,result:'ok',total_cost_usd:0.0123,
 usage:{input_tokens:120,output_tokens:340,cache_creation_input_tokens:50,cache_read_input_tokens:900},
 modelUsage:{'claude-sonnet-5-5':{inputTokens:120,outputTokens:340,cacheReadInputTokens:900,cacheCreationInputTokens:50,costUSD:0.0123,costBasis:'list'}},...extra});

test('success result: allowlisted tokens, actual model, time and the CLI-reported estimate',()=>{
 const usage=usageFromResult(success(),{model:'init-model'});
 assert.equal(usage.status,'reported');
 assert.deepEqual(usage.tokens,{input:120,output:340,cacheRead:900,cacheCreation:50});
 assert.equal(usage.model,'claude-sonnet-5-5','actual model comes from modelUsage, not the requested alias');
 assert.equal(usage.durationMs,5200);assert.equal(usage.apiDurationMs,4100);assert.equal(usage.numTurns,2);assert.equal(usage.reportedCostUsd,0.0123);
 assert.equal(usage.provider,'claude');
});

test('modelUsage (whole tree incl. subagents) wins over main-loop usage; usage is the fallback',()=>{
 const tree=usageFromResult(success({modelUsage:{a:{inputTokens:10,outputTokens:20,cacheReadInputTokens:0,cacheCreationInputTokens:0,costUSD:0.1},b:{inputTokens:5,outputTokens:7,cacheReadInputTokens:1,cacheCreationInputTokens:2,costUSD:0.2}}}));
 assert.deepEqual(tree.tokens,{input:15,output:27,cacheRead:1,cacheCreation:2});assert.equal(tree.models.length,2);assert.equal(tree.model,undefined,'several models: no single actual model is invented');
 const fallback=usageFromResult(success({modelUsage:undefined}),{model:'init-model'});
 assert.deepEqual(fallback.tokens,{input:120,output:340,cacheRead:900,cacheCreation:50});assert.equal(fallback.model,'init-model');
});

test('missing fields stay absent (unavailable), never 0',()=>{
 const partial=usageFromResult({type:'result',subtype:'success',is_error:false,usage:{input_tokens:7}});
 assert.deepEqual(partial.tokens,{input:7});assert.equal('output' in partial.tokens,false);assert.equal(partial.reportedCostUsd,undefined);
 const none=usageFromResult({type:'result',subtype:'success',is_error:false,result:'x'});
 assert.equal(none.status,'unavailable');assert.equal(none.reason,'not-reported');assert.equal(none.tokens,undefined);
});

test('error results: partial, and a zeroed crash result is unknown rather than 0',()=>{
 const budget=usageFromResult(success({subtype:'error_max_budget_usd',is_error:true,errors:['limit']}));
 assert.equal(budget.status,'partial');assert.equal(budget.reason,'error-result');
 const crash=usageFromResult(success({subtype:'error_during_execution',is_error:true,total_cost_usd:0,usage:{input_tokens:0,output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0},modelUsage:{}}));
 assert.equal(crash.status,'unavailable');assert.equal(crash.reason,'zeroed-error');assert.equal(crash.tokens,undefined);
});

test('hostile or malformed values are dropped, not stored',()=>{
 const usage=usageFromResult({type:'result',subtype:'success',is_error:false,total_cost_usd:-1,duration_ms:'x',usage:{input_tokens:-5,output_tokens:1.5,cache_read_input_tokens:'9',cache_creation_input_tokens:3},
  modelUsage:{'bad model <script>':{inputTokens:1},secret:{apiKey:'sk-ant-x'}}});
 assert.deepEqual(usage.tokens,{cacheCreation:3},'negative, fractional and string counts are dropped');
 assert.equal(JSON.stringify(usage).includes('sk-ant'),false);assert.equal(JSON.stringify(usage).includes('script'),false);
 assert.equal(usage.reportedCostUsd,undefined);assert.equal(usage.durationMs,undefined);
});

test('collector: one report per execution; no result means unavailable, never 0',()=>{
 const done=createUsageCollector();done.observe({type:'system',subtype:'init',model:'claude-sonnet-5-5'});done.observe(success({modelUsage:undefined}));
 const first=done.finish();assert.equal(first.status,'reported');assert.equal(first.model,'claude-sonnet-5-5');assert.equal(done.finish(),undefined);
 const killed=createUsageCollector();killed.observe({type:'assistant',message:{model:'claude-haiku-5-5',usage:{input_tokens:1,output_tokens:1}}});
 const lost=killed.finish({cancelled:true});assert.equal(lost.status,'unavailable');assert.equal(lost.reason,'cancelled');assert.equal(lost.tokens,undefined,'per-step usage is a placeholder and is never read');
 assert.equal(createUsageCollector().finish().reason,'no-result');assert.equal(createUsageCollector().finish({timedOut:true}).reason,'timeout');
 assert.equal(usageUnavailable('bogus').reason,undefined);
});

async function run(cliBody){
 const root=mkdtempSync(join(tmpdir(),'mainsagents-usage-test-')),cli=join(root,'fake.cjs');
 writeFileSync(cli,`const args=process.argv.slice(2);if(args[0]==='auth'){process.stdout.write(JSON.stringify({loggedIn:true}));}else{let i='';process.stdin.on('data',c=>i+=c);process.stdin.on('end',()=>{${cliBody}});}`);
 const bridge=createClaudeCodeBridge({cwdRoot:root,resolveCli:()=>({command:process.execPath,prefixArgs:[cli]})});
 const server=createServer((q,r)=>void bridge.handle(q,r,new URL(q.url??'/','http://127.0.0.1')));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,post=(path,body)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
 try{
  const session=await post('/api/providers/claude/sessions',{agentName:'A',workspaceId:'w',instructions:'x'});
  const execution=await post('/api/providers/claude/executions',{remoteSessionId:session.remoteSessionId,content:'hi',agentName:'A',workspaceId:'w'});
  const text=await fetch(`${base}/api/providers/claude/executions/${execution.executionId}/events`).then(r=>r.text());
  return text.trim().split('\n').map(line=>JSON.parse(line));
 }finally{await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
}

test('bridge publishes exactly one usage.reported before the terminal event, from the real stream shape',async()=>{
 const events=await run(`
  const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
  out({type:'system',subtype:'init',model:'claude-sonnet-5-5'});
  out({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'ok'}}});
  out(${JSON.stringify(success())});`);
 const usage=events.filter(event=>event.type==='usage.reported'),terminal=events.findIndex(event=>event.type==='execution.completed');
 assert.equal(usage.length,1);assert.ok(terminal>=0&&events.indexOf(usage[0])<terminal,'usage arrives before execution.completed');
 assert.deepEqual(usage[0].usage.tokens,{input:120,output:340,cacheRead:900,cacheCreation:50});assert.equal(usage[0].usage.model,'claude-sonnet-5-5');
 assert.equal('result' in usage[0].usage,false,'usage never carries message output');
});

test('bridge: CLI that dies without a result reports unavailable, not zero',async()=>{
 const events=await run(`process.stdout.write(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'half'}}})+'\\n');process.exit(1);`);
 const usage=events.filter(event=>event.type==='usage.reported');
 assert.equal(usage.length,1);assert.equal(usage[0].usage.status,'unavailable');assert.equal(usage[0].usage.reason,'no-result');assert.equal(usage[0].usage.tokens,undefined);
 assert.ok(events.some(event=>event.type==='execution.failed'));
});
