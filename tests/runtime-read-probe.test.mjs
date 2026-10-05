import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {probeMcpAccounts} from '../runtime-read-probe.mjs';
import {createRuntimeActionApprovals} from '../runtime-action-approvals.mjs';
import {classifyMcpAction,permittedMcpAction} from '../runtime-tool-policy.mjs';
import {declaredSkillRequirements,skillRequirementStatus} from '../runtime-capabilities.mjs';
test('publishing intent and unknown tools never become a read permission',()=>{assert.equal(classifyMcpAction('posts_create',{}),'schedule');assert.equal(classifyMcpAction('posts_create',{is_draft:true}),'write');assert.equal(classifyMcpAction('posts_create',{publish_now:true}),'publish');assert.equal(classifyMcpAction('execute_code'),'unknown');assert.equal(classifyMcpAction('accounts_list'),'read');assert.equal(classifyMcpAction('posts_delete'),'delete');});
test('requirements are explicit, bounded and checked against exact server/tool discovery',()=>{const requirements=declaredSkillRequirements('```mainsagents-requirements\n{"mcp":[{"server":"zernio","tools":["accounts_list"]}],"commands":["ffmpeg"]}\n```');assert.equal(requirements.mcp[0].server,'zernio');assert.equal(declaredSkillRequirements('Mentioning Zernio is not declaring it'),null);assert.equal(skillRequirementStatus(requirements,[{name:'zernio',status:'discovered',tools:[]}])[0].status,'missing-tools');assert.equal(declaredSkillRequirements('```mainsagents-requirements\n{"commands":["rm"]}\n```').invalid,true);assert.deepEqual(declaredSkillRequirements('```mainsagents-requirements\n{"mcp":[]}\n```'),{mcp:[],commands:[]});});
async function fixture(decision,permissions=['read']){
 const db=new DatabaseSync(':memory:');let agent={id:'a',name:'Editor',workspaceId:'w',mcpPermissions:permissions},calls=[];const actions=createRuntimeActionApprovals(db,{getCurrentProfile:()=> 'owner',getBinding:()=>null});
 const client={request:async(method,p)=>{calls.push({method,p});if(method==='config/read')return {config:{mcp_servers:{zernio:{url:'https://mock.invalid/mcp',enabled:true}}}};if(method==='thread/start')return {thread:{id:'probe'}};if(method==='mcpServerStatus/list')return {data:[{name:'zernio',tools:{accounts_list:{}}}]};if(method==='mcpServer/tool/call')return {content:[],isError:false};throw new Error('Unexpected method '+method);}};
 const pending=probeMcpAccounts(client,{actions,getAgents:()=>[agent],getProfile:()=> 'owner',cwd:'.',agentId:'a',server:'zernio'});
 pending.catch(()=>{});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls.filter(call=>call.method==='mcpServer/tool/call').length,0);
 const row=actions.list('owner')[0];if(row.status==='pending'){if(decision==='drift')agent={...agent,name:'Changed'};assert.doesNotThrow(()=>{try{actions.decide('owner',row.id,{hash:row.hash,decision:decision==='deny'?'deny':'approve'});}catch(e){if(decision!=='drift')throw e;}});}
 return {db,actions,pending,calls};
}
test('business read requires one exact approval, makes no AI turn and records real access evidence',async()=>{const f=await fixture('approve');try{assert.equal((await f.pending).status,'succeeded');assert.equal(f.calls.filter(call=>call.method==='mcpServer/tool/call').length,1);assert(!f.calls.some(call=>call.method==='turn/start'));assert.equal(f.actions.evidence()[0].tool,'accounts_list');}finally{f.actions.close();f.db.close();}});
test('denial, disabled read permission and agent drift prevent any business access',async()=>{for(const [decision,permissions] of [['deny',['read']],['approve',[]],['drift',['read']]]){const f=await fixture(decision,permissions);try{await assert.rejects(f.pending);assert.equal(f.calls.filter(call=>call.method==='mcpServer/tool/call').length,0);assert.equal(f.actions.evidence().length,0);}finally{f.actions.close();f.db.close();}}});

test('restricted permissions cannot grant generic execution that can hide a publish',()=>{assert.equal(permittedMcpAction({mcpPermissions:['read','unknown']},'unknown'),false);assert.equal(permittedMcpAction({mcpPermissions:['read']},'read'),true);assert.equal(permittedMcpAction({mcpPermissions:['read']},'schedule'),false);});
