// Minimal stdio MCP server used as Claude Code's --permission-prompt-tool.
// Claude asks it before running a tool that is not pre-allowed (in practice, MCP tools);
// it forwards the request to the MainsAgents bridge and waits for the per-call decision.
// The bridge URL and token come from the environment of this execution only.
import {createInterface} from 'node:readline';

const endpoint=process.env.MAINSAGENTS_PERMISSION_URL,token=process.env.MAINSAGENTS_PERMISSION_TOKEN;
const write=message=>process.stdout.write(`${JSON.stringify(message)}\n`);
const tool={name:'approve',description:'MainsAgents permission gate. Used by the host to confirm tool calls; never call it directly.',inputSchema:{type:'object',properties:{tool_name:{type:'string'},input:{type:'object'},tool_use_id:{type:'string'}},required:['tool_name','input']}};
const deny=message=>({behavior:'deny',message});

async function decide(args){
 if(!endpoint||!token)return deny('MainsAgents approvals are unavailable. The tool call was not run.');
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({toolName:args?.tool_name,input:args?.input??{},toolUseId:args?.tool_use_id})});
  const result=await response.json().catch(()=>({}));
  if(response.ok&&result.behavior==='allow')return {behavior:'allow',updatedInput:args?.input??{}};
  return deny(typeof result.message==='string'&&result.message?result.message:'The person using MainsAgents did not approve this tool call.');
 }catch{return deny('MainsAgents could not confirm this tool call. It was not run.');}
}

createInterface({input:process.stdin}).on('line',async line=>{
 let message;try{message=JSON.parse(line)}catch{return}
 const {id,method,params}=message;
 if(id===undefined)return;
 if(method==='initialize')return write({jsonrpc:'2.0',id,result:{protocolVersion:params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'mainsagents',version:'1.0.0'}}});
 if(method==='tools/list')return write({jsonrpc:'2.0',id,result:{tools:[tool]}});
 if(method==='tools/call'&&params?.name==='approve'){const result=await decide(params.arguments);return write({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});}
 if(method==='ping')return write({jsonrpc:'2.0',id,result:{}});
 write({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
