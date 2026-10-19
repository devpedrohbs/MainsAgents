// Minimal stdio MCP server started by the Claude Code CLI for one MainsAgents execution.
// Default role: Claude Code's --permission-prompt-tool. Claude asks it before running a tool that is not
// pre-allowed (in practice, MCP tools); it forwards the request to the MainsAgents bridge and waits for the
// per-call decision.
// Editor role (MAINSAGENTS_MCP_ROLE=editor): exposes the bound editor-authoring tools; every call is
// forwarded to the bridge, which executes it against the production it was bound to.
// Publishing role (MAINSAGENTS_MCP_ROLE=publishing): exposes the bounded scheduling tool; the bridge resolves the
// saved session and checks the user's request and saved preference before anything is sent.
// The bridge URL and token come from the environment of this execution only. Self-contained (no imports
// from the app) because packaged builds start it as a plain unpacked script.
import {createInterface} from 'node:readline';

const role=['editor','publishing'].includes(process.env.MAINSAGENTS_MCP_ROLE)?process.env.MAINSAGENTS_MCP_ROLE:'permission';
const endpoint={editor:process.env.MAINSAGENTS_EDITOR_URL,publishing:process.env.MAINSAGENTS_PUBLISHING_URL}[role]??process.env.MAINSAGENTS_PERMISSION_URL;
const token={editor:process.env.MAINSAGENTS_EDITOR_TOKEN,publishing:process.env.MAINSAGENTS_PUBLISHING_TOKEN}[role]??process.env.MAINSAGENTS_PERMISSION_TOKEN;
const write=message=>process.stdout.write(`${JSON.stringify(message)}\n`);
const tool={name:'approve',description:'MainsAgents permission gate. Used by the host to confirm tool calls; never call it directly.',inputSchema:{type:'object',properties:{tool_name:{type:'string'},input:{type:'object'},tool_use_id:{type:'string'}},required:['tool_name','input']}};
const deny=message=>({behavior:'deny',message});
let editorTools=[];
try{const parsed=JSON.parse((role==='publishing'?process.env.MAINSAGENTS_PUBLISHING_TOOLS:process.env.MAINSAGENTS_EDITOR_TOOLS)??'[]');if(Array.isArray(parsed))editorTools=parsed;}catch{}
const service=role==='publishing'?'The MainsAgents scheduling service':'The MainsAgents editor';
const editorFailure=message=>({content:[{type:'text',text:message}],isError:true});

async function decide(args){
 if(!endpoint||!token)return deny('MainsAgents approvals are unavailable. The tool call was not run.');
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({toolName:args?.tool_name,input:args?.input??{},toolUseId:args?.tool_use_id})});
  const result=await response.json().catch(()=>({}));
  if(response.ok&&result.behavior==='allow')return {behavior:'allow',updatedInput:args?.input??{}};
  return deny(typeof result.message==='string'&&result.message?result.message:'The person using MainsAgents did not approve this tool call.');
 }catch{return deny('MainsAgents could not confirm this tool call. It was not run.');}
}

async function editorCall(name,args){
 if(!endpoint||!token)return editorFailure(`${service} is not bound to this execution. Nothing was done.`);
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({name,arguments:args??{}})});
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result||!Array.isArray(result.content))return editorFailure(`${service} refused or could not run this action. Nothing was applied.`);
  return result;
 }catch{return editorFailure(`${service} is unreachable. Nothing was applied.`);}
}

createInterface({input:process.stdin}).on('line',async line=>{
 let message;try{message=JSON.parse(line)}catch{return}
 const {id,method,params}=message;
 if(id===undefined)return;
 if(method==='initialize')return write({jsonrpc:'2.0',id,result:{protocolVersion:params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:{editor:'mainsagents_editor',publishing:'mainsagents_publishing'}[role]??'mainsagents',version:'1.2.0'}}});
 if(method==='tools/list')return write({jsonrpc:'2.0',id,result:{tools:role==='permission'?[tool]:editorTools}});
 if(method==='tools/call'&&role==='permission'&&params?.name==='approve'){const result=await decide(params.arguments);return write({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});}
 if(method==='tools/call'&&role!=='permission'&&editorTools.some(item=>item.name===params?.name))return write({jsonrpc:'2.0',id,result:await editorCall(params.name,params.arguments)});
 if(method==='ping')return write({jsonrpc:'2.0',id,result:{}});
 write({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
