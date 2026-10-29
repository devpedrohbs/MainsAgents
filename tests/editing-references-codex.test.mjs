import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startCodexBridge} from '../codex-bridge.mjs';
import {createCodexWorkflowRuntime} from '../codex-workflow-runtime.mjs';
import {analyzeReferenceFrames} from '../editing-reference-analysis.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const agent={id:'video',name:'Video',role:'Editor',workspaceId:'w',providerId:'codex',instructions:'Analyze only',tools:[]};
function fixture(t){const root=mkdtempSync(join(tmpdir(),'mains-reference-codex-'));t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));const path=join(root,'frame.png');writeFileSync(path,image);return {root,frame:{id:'frame-one',time:0.5,path,sha256:sha(image)}};}

test('reference analysis reaches native Codex localImage transport with read-only sandbox and disabled MCP',async t=>{
 const {root,frame}=fixture(t),cli=join(root,'fake-cli.mjs'),log=join(root,'requests.jsonl'),shared=join(root,'shared');mkdirSync(shared);
 const findings={observations:[{start:0,end:1,text:'Synthetic image inspected',adaptation:'Review before approving',frameIds:[frame.id],limitations:[]}],examinedFrameIds:[frame.id],limitations:['Synthetic transport fixture, no real inference']};
 writeFileSync(cli,`import{createInterface}from'node:readline';import{appendFileSync}from'node:fs';
 const send=m=>process.stdout.write(JSON.stringify(m)+String.fromCharCode(10));const thread={id:'11111111-1111-4111-8111-111111111111',status:{type:'idle'},turns:[]};
 createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+String.fromCharCode(10));let result={};
 if(m.method==='config/read')result={config:{mcp_servers:{untrusted:{command:'MUST_NOT_START',tool_timeout_sec:null}}}};
 if(m.method==='command/exec')result={exitCode:0,stdout:'probe',stderr:''};
 if(m.method==='thread/start'||m.method==='thread/resume'||m.method==='thread/read')result={thread};
 if(m.method==='mcpServerStatus/list')result={data:[],nextCursor:null};
 if(m.method==='turn/start'){const turn={id:'fixture-turn',status:'inProgress',items:[]};thread.turns.push(turn);result={turn};setTimeout(()=>{const item={type:'agentMessage',text:${JSON.stringify(JSON.stringify(findings))}};turn.items.push(item);turn.status='completed';send({method:'item/completed',params:{threadId:thread.id,turnId:turn.id,item}});send({method:'turn/completed',params:{threadId:thread.id,turnId:turn.id,turn}})},20)}send({id:m.id,result})});`);
 const old=process.env.MAINSAGENTS_CODEX_CLI_PATH;process.env.MAINSAGENTS_CODEX_CLI_PATH=cli;let bridge;
 try{
  bridge=await startCodexBridge({port:0,cwd:root,runtimeHome:join(root,'runtime'),sharedHome:shared});let examined;
  const result=await analyzeReferenceFrames({runtime:bridge.workflow,agent,analysis:{id:'analysis',start:0,end:1},frames:[frame],frameRoot:root,focus:{notes:'Data only'},signal:new AbortController().signal,guard:()=>{},onExamined:keys=>{examined=keys;}});
  assert.deepEqual(examined,[frame.id]);assert.equal(result.observations[0].text,findings.observations[0].text);assert.match(result.limitations[0],/not exhaustive/);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),start=calls.find(c=>c.method==='thread/start').params,turn=calls.find(c=>c.method==='turn/start').params;
  assert.equal(start.sandbox,'read-only');assert.equal(start.config.mcp_servers.untrusted.enabled,false);assert.equal(start.config['features.apps'],false);assert.equal(start.config['features.multi_agent'],false);
  assert.equal(turn.sandboxPolicy.type,'readOnly');assert.deepEqual(turn.input.filter(i=>i.type==='localImage'),[{type:'localImage',path:frame.path}]);
  assert(!calls.some(c=>c.method==='mcpServer/tool/call'));assert.match(turn.input[0].text,/frame-one/);
  const probes=calls.filter(c=>c.method==='command/exec');assert.equal(probes.length,1,'only the existing bridge startup readiness probe');assert.equal(probes[0].params.sandboxPolicy.type,'readOnly');
 }finally{await bridge?.close();if(old===undefined)delete process.env.MAINSAGENTS_CODEX_CLI_PATH;else process.env.MAINSAGENTS_CODEX_CLI_PATH=old;}
});

test('host visual grants reject modified bytes, outside roots and oversized image batches before sending',async t=>{
 const {root,frame}=fixture(t);let sent=0;
 const runtime=createCodexWorkflowRuntime({client:{request:async()=>({data:[]})},cwd:root,request:async()=>{sent++;}});
 await assert.rejects(runtime.sendVisual('t','x',agent,{root:join(root,'shared'),frames:[frame]}));
 const inner=join(root,'authorized');mkdirSync(inner);
 await assert.rejects(runtime.sendVisual('t','x',agent,{root:inner,frames:[frame]}),/escaped/);
 await assert.rejects(runtime.sendVisual('t','x',agent,{root,frames:Array(13).fill(frame)}),/Invalid/);
 writeFileSync(frame.path,Buffer.from('changed'));
 await assert.rejects(runtime.sendVisual('t','x',agent,{root,frames:[frame]}),/changed/);assert.equal(sent,0);
});

test('Codex observations require real delivered IDs and explicit inspected coverage',async t=>{
 const {root,frame}=fixture(t);let examined=0;
 const runtime={createSession:async()=> 't',sendVisual:async()=>({executionId:'e'}),cancel:async()=>{},events:async function*(){yield{type:'message.completed',content:JSON.stringify({observations:[{start:0,end:1,frameIds:['unknown']}],examinedFrameIds:[frame.id]})};yield{type:'execution.completed'};}};
 await assert.rejects(analyzeReferenceFrames({runtime,agent,analysis:{start:0,end:1},frames:[frame],frameRoot:root,signal:new AbortController().signal,guard:()=>{},onExamined:()=>examined++}),/lacks evidence/);assert.equal(examined,0);
 const signal=AbortSignal.abort();await assert.rejects(analyzeReferenceFrames({runtime,agent,analysis:{start:0,end:1},frames:[frame],frameRoot:root,signal,guard:()=>{},onExamined:()=>{}}),/abort/i);
});
