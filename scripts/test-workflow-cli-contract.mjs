// Installed CLI contract only. Isolated home, no credentials, inference or external writes.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {codexLaunch} from '../codex-bridge.mjs';
import {createCodexWorkflowRuntime} from '../codex-workflow-runtime.mjs';
const home=mkdtempSync(join(tmpdir(),'workflow-cli-contract-'));
writeFileSync(join(home,'config.toml'),'[mcp_servers.fixture]\ncommand = "MCP_MUST_NEVER_START"\n');
const launch=codexLaunch(),env={...process.env,CODEX_HOME:home};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
const child=spawn(launch.command,launch.args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map();let serial=0,stderr='';child.stderr.on('data',chunk=>{stderr+=chunk});
createInterface({input:child.stdout}).on('line',line=>{let response;try{response=JSON.parse(line)}catch{return}const call=pending.get(response.id);if(call){pending.delete(response.id);response.error?call.reject(new Error(response.error.message)):call.resolve(response.result)}});
const client={request:(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timeout`))},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(new Error(`${method}: ${error.message}`))}});child.stdin.write(JSON.stringify({id,method,params})+'\n')})};
try{
 await client.request('initialize',{clientInfo:{name:'mainsagents-workflow-contract',version:'test'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const configuration=await client.request('config/read',{includeLayers:false});assert(configuration.config.mcp_servers?.fixture,'CLI must return configured MCP names');
 const runtime=createCodexWorkflowRuntime({client,cwd:home,request:()=>{throw new Error('Inference is forbidden in this test')},events:async function*(){}});
 const id=await runtime.createSession({id:'fixture',name:'Fixture',role:'Reader',tools:['files'],instructions:'Read only'});
 // No input was sent: there is no persisted rollout to resume yet.
 const thread=await runtime.readThread(id);assert.equal(thread.turns.length,0);await assert.rejects(runtime.resumeSession(id),/no rollout found/);assert(!/MCP_MUST_NEVER_START.*(failed|No such|not found)/i.test(stderr));
 console.log('PASS: installed CLI accepts scoped read-only config, disables fixture MCP, starts a legacy-history isolated thread and reads its empty live state. No inference.');
}finally{child.kill();for(const call of pending.values())call.reject(new Error('Contract test closed'));}
