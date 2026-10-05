import {randomUUID} from 'node:crypto';
import {actionHash} from './runtime-action-approvals.mjs';
/** Only this explicit read contract is callable. Never starts a model turn. */
export async function probeMcpAccounts(client,{actions,getAgents,getProfile,cwd,agentId,server}){
 const candidates=server==='zernio'?['accounts_list_accounts','accounts_list']:server==='publora'?['list_connections']:null;if(!candidates)throw new Error('A verified account read contract is configured only for Zernio and Publora.');
 const profileId=getProfile(),agent=getAgents().find(item=>item.id===agentId&&(item.providerId??'codex')==='codex');if(!agent||!actions)throw new Error('Choose an existing Codex agent.');
 const {config={}}=await client.request('config/read',{includeLayers:false}),setting=config.mcp_servers?.[server];if(!setting||setting.enabled===false)throw new Error('Enable this MCP server in the CLI first.');
 const clean=value=>Array.isArray(value)?value.filter(item=>item!==null).map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==null).map(([key,item])=>[key,clean(item)])):value;
 const servers=Object.fromEntries(Object.entries(config.mcp_servers??{}).map(([name,value])=>[name,{...clean(value),enabled:name===server, ...(name===server?{enabled_tools:candidates,default_tools_approval_mode:'auto',tools:{}}:{})}]));
 const thread=(await client.request('thread/start',{cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:'never',config:{mcp_servers:servers,features:{apps:false,plugins:false,multi_agent:false}},serviceName:'mainsagents-read-probe'})).thread.id;
 try{
 const inventory={data:[]};let cursor;do{const page=await client.request('mcpServerStatus/list',{threadId:thread,detail:'full',limit:100,...(cursor?{cursor}:{})});inventory.data.push(...page.data??[]);cursor=page.nextCursor;}while(cursor);
 const tool=candidates.find(tool=>inventory.data.some(item=>item.name===server&&Object.hasOwn(item.tools??{},tool)));if(!tool)throw new Error('The provider account-list tool is unavailable. Check MCP authentication.');
 const executionId=randomUUID(),binding={profileId,sessionId:`diagnostics-${agent.id}`,agentId:agent.id,agentName:agent.name,workspaceId:agent.workspaceId,hash:actionHash(agent),agent};
 const current=()=>{const live=getAgents().find(item=>item.id===agent.id);return live?{...binding,agent:live,hash:actionHash(live)}:null;};
 const decision=await new Promise(resolve=>actions.receive({id:randomUUID(),method:'mcpServer/elicitation/request',params:{threadId:thread,turnId:executionId,serverName:server,mode:'form',message:`Allow the ${server} MCP server to run tool "${tool}"?`,_meta:{codex_approval_kind:'mcp_tool_call',tool_params:{}},requestedSchema:{type:'object',properties:{}}}},binding,resolve,current));
 if(decision.action!=='accept')throw new Error('The read test was declined, expired or blocked by agent permissions.');
 const item={id:executionId,type:'mcpToolCall',server,tool,arguments:{}};
 actions.observe({method:'item/started',params:{threadId:thread,turnId:executionId,item}});
 try{
  if(getProfile()!==profileId||current()?.hash!==binding.hash)throw new Error('The profile or agent changed.');
  const result=await client.request('mcpServer/tool/call',{threadId:thread,server,tool,arguments:{}});
  if(result.isError||result.result?.isError)throw new Error('The provider rejected the read. Check its authentication and connected accounts.');
  const raw=result.result??result;let value=raw.structuredContent;if(!value)try{value=JSON.parse(raw.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'')}catch{}
  if(typeof value?.result==='string')try{value=JSON.parse(value.result)}catch{}
  const rows=server==='publora'?value?.connections:value?.accounts;
  if(!Array.isArray(rows)||rows.length>2000||value?.success===false)throw new Error('The provider returned no verifiable account data. A summary is not a confirmed read.');
  actions.observe({method:'item/completed',params:{threadId:thread,turnId:executionId,item:{...item,result}}});
  return {server,tool,status:'succeeded',checkedAt:new Date().toISOString()};
 }catch(error){actions.observe({method:'item/completed',params:{threadId:thread,turnId:executionId,item:{...item,error:{message:'Read test failed. No confirmed access receipt.'}}}});throw error;}
 }finally{await client.request('thread/archive',{threadId:thread}).catch(()=>{});}
}
