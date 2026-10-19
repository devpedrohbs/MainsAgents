import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyThreadError,threadErrorStatus,probeCodexExecutor} from '../codex-executor-readiness.mjs';
import {startCodexBridge} from '../codex-bridge.mjs';

// Exact wording returned by the real Codex CLI 0.162.1 app-server (scripts/codex-executor-real-probe.mjs, 2026-10-11).
const real={
 resumeUnknown:'no rollout found for thread id b7e52098-57af-4c45-8bdf-b3d70979df7f',
 readUnknown:'thread not loaded: c076fa61-9cad-4410-818d-29e151a9b248',
 invalidId:'invalid session id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1',
};

test('only a proven absence is thread-missing; not-loaded, invalid id, auth, network and sandbox errors are not expiry',()=>{
 assert.equal(classifyThreadError(new Error(real.resumeUnknown)),'thread-missing');
 assert.equal(classifyThreadError(new Error(real.readUnknown)),'thread-not-loaded');
 assert.equal(classifyThreadError(new Error(real.invalidId)),'invalid-thread-id');
 assert.equal(classifyThreadError(new Error('Invalid Codex thread identifier.')),'invalid-thread-id');
 for(const message of ['exec failed: windows sandbox: helper_unknown_error: setup refresh had errors','401 Unauthorized: login required','fetch failed: ECONNRESET','thread/start failed: model gpt-x not found','This execution is not loaded. Reconcile its saved thread.','Codex CLI not found. Install @openai/codex or set CODEX_CLI_PATH.'])
  assert.equal(classifyThreadError(new Error(message)),null,message);
 assert.deepEqual({...threadErrorStatus},{'thread-missing':410,'thread-not-loaded':409,'invalid-thread-id':400});
});

test('executor probe runs under the session sandbox policy so its write root is part of the setup check',async()=>{
 const calls=[],policy={type:'workspaceWrite',writableRoots:['C:\\Videos\\Out'],networkAccess:false};
 await probeCodexExecutor({request:async(method,params)=>{calls.push(params);return {exitCode:0};}},{cwd:'C:\\Videos\\Out',file:'C:\\Skills\\corte.md',sandboxPolicy:policy,platform:'win32'});
 assert.deepEqual(calls[0].sandboxPolicy,policy);
 assert.match(calls[0].command.join(' '),/Get-Content -Raw/);
});

const fixture=t=>{const root=mkdtempSync(join(tmpdir(),'mains-thread-errors-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return root;};

test('bridge maps real CLI thread errors to the HTTP contract and settles "not loaded" with a resume',async t=>{
 const root=fixture(t),shared=join(root,'shared'),cli=join(root,'fake-codex.mjs'),log=join(root,'requests.jsonl');
 mkdirSync(shared);
 const missing='11111111-1111-4111-8111-111111111111',broken='22222222-2222-4222-8222-222222222222',notLoaded='33333333-3333-4333-8333-333333333333';
 writeFileSync(cli,`import{createInterface}from'node:readline';import{appendFileSync}from'node:fs';const R=${JSON.stringify(real)};const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;appendFileSync(${JSON.stringify(log)},JSON.stringify({method:m.method,params:m.params})+'\\n');const id=m.params?.threadId;const fail=message=>send({id:m.id,error:{message}});
 if(m.method==='command/exec')return send({id:m.id,result:{exitCode:0,stdout:'ok',stderr:''}});
 if(m.method==='thread/resume'){if(id==='not-a-thread')return fail(R.invalidId);if(id===${JSON.stringify(broken)})return fail('exec failed: windows sandbox: helper_unknown_error: setup refresh had errors');return fail(R.resumeUnknown.replace(/[0-9a-f-]{36}$/,id));}
 if(m.method==='thread/read'&&id===${JSON.stringify(notLoaded)})return fail('thread not loaded: '+id);
 if(m.method==='config/read')return send({id:m.id,result:{config:{}}});
 send({id:m.id,result:{}});});`);
 const previous=process.env.MAINSAGENTS_CODEX_CLI_PATH;process.env.MAINSAGENTS_CODEX_CLI_PATH=cli;
 let bridge;
 try{
  bridge=await startCodexBridge({port:0,cwd:root,runtimeHome:join(root,'runtime'),sharedHome:shared});
  const base=`http://127.0.0.1:${bridge.port}`,headers={'x-mainsagents-bridge-token':bridge.token,'content-type':'application/json'};
  const open=threadId=>fetch(`${base}/api/codex/sessions`,{method:'POST',headers,body:JSON.stringify({threadId,config:{agentName:'Editor'}})});
  const gone=await open(missing);
  assert.equal(gone.status,410);assert.deepEqual(await gone.json(),{error:`no rollout found for thread id ${missing}`,code:'thread-missing'});
  const invalid=await open('not-a-thread');
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'invalid-thread-id');
  const setup=await open(broken);
  assert.equal(setup.status,500);assert.equal((await setup.json()).code,undefined,'a sandbox setup failure is never reported as an expired thread');
  const send=await fetch(`${base}/api/codex/executions`,{method:'POST',headers,body:JSON.stringify({threadId:missing,content:'hi'})});
  assert.equal(send.status,409);assert.equal((await send.json()).code,'thread-not-loaded');
  const images=await fetch(`${base}/api/codex/sessions/${notLoaded}/images`,{headers});
  assert.equal(images.status,410);assert.equal((await images.json()).code,'thread-missing');
  const requests=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.params?.threadId===notLoaded).map(r=>r.method);
  assert.deepEqual(requests,['thread/read','thread/resume'],'"thread not loaded" is only concluded missing after a resume');
  assert(!readFileSync(log,'utf8').includes('"turn/start"'));
  await assert.rejects(bridge.chatRuntime.connect({id:'s1',codexThreadId:missing},{}),error=>error.code==='thread-missing'&&error.status===410);
 }finally{if(bridge)await bridge.close();if(previous===undefined)delete process.env.MAINSAGENTS_CODEX_CLI_PATH;else process.env.MAINSAGENTS_CODEX_CLI_PATH=previous;}
});

test('a slow first sandboxed command is "slow", not a failure, and is never reported to the agent as broken',async()=>{
 const slow=await probeCodexExecutor({request:async(method,params,timeout)=>{assert.equal(timeout,50);throw new Error('Codex command/exec timed out');}},{cwd:'.',platform:'win32',timeoutMs:50});
 assert.equal(slow.state,'slow');assert.equal(slow.ready,false);assert.equal(slow.diagnosis,undefined);
 const failed=await probeCodexExecutor({request:async()=>{throw new Error('exec failed: windows sandbox: helper_unknown_error: setup refresh had errors');}},{cwd:'.',platform:'win32'});
 assert.equal(failed.state,'failed');
 const exited=await probeCodexExecutor({request:async()=>({exitCode:1,stderr:'Access denied'})},{cwd:'.',platform:'win32'});
 assert.equal(exited.state,'failed');assert.match(exited.error,/Access denied/);
});
