// Real installed CLI + local deterministic model/MCP. No account, remote inference or real writes.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {codexLaunch} from '../codex-bridge.mjs';
import {DatabaseSync} from 'node:sqlite';
import {chatActionConfig,chatApprovalPolicy} from '../codex-action-policy.mjs';
import {createRuntimeActionApprovals} from '../runtime-action-approvals.mjs';

const home=mkdtempSync(join(tmpdir(),'mainsagents-mcp-policy-'));let writes=0,modelCalls=0;
const messages=[],requests=[];let child;
const db=new DatabaseSync(join(home,'actions.sqlite')),binding={profileId:'owner',sessionId:'chat',agentId:'editor',agentName:'Editor',workspaceId:'content',hash:'configuration'};
const actions=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',getBinding:()=>binding});
const sendJSON=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=createServer(async(req,res)=>{
 try {let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};
 if(req.url==='/mcp'){
  if(req.method==='GET'){res.statusCode=405;return res.end()}
  if(req.method==='DELETE')return res.end();
  if(input.id===undefined){res.statusCode=202;return res.end()}
  let result={};
  if(input.method==='initialize')result={protocolVersion:input.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  if(input.method==='tools/list')result={tools:[{name:'write_fixture',description:'Write a marker to an isolated test counter.',inputSchema:{type:'object',properties:{marker:{type:'string'}},required:['marker'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}}]};
  if(input.method==='tools/call'){writes++;result={content:[{type:'text',text:'TEST_WRITE_CONFIRMED'}]};}
  return sendJSON(res,{jsonrpc:'2.0',id:input.id,result});
 }
 if(req.url?.endsWith('/responses')){
  requests.push(input);modelCalls++;writeFileSync(join(home,'model-request.json'),JSON.stringify(input,null,2));
  const namespace=(input.tools??[]).find(tool=>tool.type==='namespace'&&tool.tools?.some(item=>item.name==='write_fixture'));
  let output;
  if(modelCalls===1){if(!namespace){res.statusCode=500;res.end('MCP name not found');return;}output=[{id:'fc_fixture',type:'function_call',call_id:'call_fixture',namespace:namespace.name,name:'write_fixture',arguments:JSON.stringify({marker:'isolated'})}];}
  else output=[{id:'msg_fixture',type:'message',role:'assistant',content:[{type:'output_text',text:'DONE',annotations:[]}]}];
  res.setHeader('content-type','text/event-stream');res.setHeader('cache-control','no-cache');
  let serial=0;const emit=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:serial++,...data})}\n\n`);
  const response={id:`resp_${modelCalls}`,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',model:'fixture-model',output:[],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
  emit('response.created',{response});
  for(const [index,item] of output.entries()){
    emit('response.output_item.added',{output_index:index,item:{...item,...(item.type==='function_call'?{arguments:''}:{content:[]})}});
    if(item.type==='function_call')emit('response.function_call_arguments.delta',{item_id:item.id,output_index:index,delta:item.arguments});
    else{emit('response.content_part.added',{item_id:item.id,output_index:index,content_index:0,part:{type:'output_text',text:'',annotations:[]}});emit('response.output_text.delta',{item_id:item.id,output_index:index,content_index:0,delta:'DONE'});emit('response.output_text.done',{item_id:item.id,output_index:index,content_index:0,text:'DONE'});}
    emit('response.output_item.done',{output_index:index,item});
  }
  emit('response.completed',{response:{...response,status:'completed',output}});return res.end();
 }
 res.statusCode=404;res.end();}catch(error){res.statusCode=500;res.end(String(error));}
});
const pending=new Map();let serial=0,stderr='';
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`))},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
const reply=(id,result)=>child.stdin.write(JSON.stringify({id,result})+'\n');
async function until(check){const deadline=Date.now()+20000;while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,30))}throw new Error('CLI approval contract timed out')}
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 writeFileSync(join(home,'config.toml'),`model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="${base}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[features]\napps=false\nplugins=false\n[mcp_servers.fixture]\nurl="${base}/mcp"\ndefault_tools_approval_mode="auto"\n[mcp_servers.fixture.tools.write_fixture]\napproval_mode="auto"\n`);
 const launch=codexLaunch(),env={...process.env,CODEX_HOME:home};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
 child=spawn(launch.command,launch.args,{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.on('data',chunk=>{stderr+=chunk});
 createInterface({input:child.stdout}).on('line',line=>{let value;try{value=JSON.parse(line)}catch{return}messages.push(value);actions.observe(value);if(value.method==='mcpServer/elicitation/request')actions.receive(value,binding,result=>reply(value.id,result));const call=pending.get(value.id);if(call&&(value.result!==undefined||value.error)){pending.delete(value.id);value.error?call.reject(new Error(value.error.message)):call.resolve(value.result);}});
 await request('initialize',{clientInfo:{name:'mainsagents-mcp-contract',version:'test'},capabilities:{experimentalApi:true}});child.stdin.write('{"method":"initialized"}\n');
 const started=await request('thread/start',{cwd:home,historyMode:'legacy',sandbox:'read-only',approvalPolicy:chatApprovalPolicy,config:await chatActionConfig({request})});
 const inventory=await request('mcpServerStatus/list',{threadId:started.thread.id,detail:'toolsAndAuthOnly',limit:100});assert(JSON.stringify(inventory).includes('write_fixture'));
 await request('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Call the isolated write_fixture tool once.'}],sandboxPolicy:{type:'readOnly'}});
 await until(()=>messages.some(message=>message.id!==undefined&&/requestUserInput|elicitation|requestApproval/.test(message.method??''))||messages.some(message=>message.method==='turn/completed'));
 const approval=messages.find(message=>message.id!==undefined&&/requestUserInput|elicitation|requestApproval/.test(message.method??''));
 writeFileSync(join(home,'trace.json'),JSON.stringify({messages,requests,writes,stderr},null,2));
 console.log(JSON.stringify({home,writes,approval,terminal:messages.find(message=>message.method==='turn/completed')},null,2));
 assert(approval,'MCP must request confirmation before executing');assert.equal(writes,0,'No side effect before approval');
 const denied=actions.list('owner')[0];assert.equal(denied.status,'pending');actions.decide('owner',denied.id,{hash:denied.hash,decision:'deny'});
 await until(()=>messages.some(message=>message.method==='turn/completed'));assert.equal(writes,0);
 modelCalls=0;const before=messages.length;await request('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Call write_fixture once, await approval.'}],approvalPolicy:chatApprovalPolicy,sandboxPolicy:{type:'readOnly'}});
 await until(()=>actions.list('owner').some(action=>action.status==='pending'));assert.equal(writes,0);
 const approved=actions.list('owner').find(action=>action.status==='pending');assert.throws(()=>actions.decide('owner',approved.id,{hash:'stale',decision:'approve'}));assert.equal(writes,0);actions.decide('owner',approved.id,{hash:approved.hash,decision:'approve'});assert.throws(()=>actions.decide('owner',approved.id,{hash:approved.hash,decision:'approve'}));
 await until(()=>messages.slice(before).some(message=>message.method==='turn/completed'));assert.equal(writes,1);assert.equal(actions.list('owner').find(action=>action.id===approved.id).status,'succeeded');
 console.log('PASS: real CLI with pre-existing automatic grants: zero writes before approval/after denial; exactly one approved write; stale and reused decisions blocked. Local fixtures, no paid inference.');
} finally {writeFileSync(join(home,'trace.json'),JSON.stringify({messages,requests,writes,stderr},null,2));actions.close();child?.kill();server.close();db.close();for(const call of pending.values())call.reject(new Error('Contract test stopped'));}
