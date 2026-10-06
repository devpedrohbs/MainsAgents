import {createHash,randomUUID} from 'node:crypto';
import {classifyMcpAction,permittedMcpAction} from './runtime-tool-policy.mjs';
import {notionAutomaticDecision} from './notion-automation-policy.mjs';

const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const actionHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sensitive=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|client[_-]?secret)$/i.test(key)||sensitive(item));
const decode=row=>row&&({...JSON.parse(row.payload_json),id:row.id,hash:row.hash,status:row.status,error:row.error,createdAt:row.created_at,updatedAt:row.updated_at});

/** SQLite stores the review/audit. A live CLI request, never an imported approval, grants permission. */
export function createRuntimeActionApprovals(db,{getCurrentProfile,getBinding,timeoutMs=15*60_000}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS runtime_actions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
 db.prepare("UPDATE runtime_actions SET status='interrupted',error='The previous connection ended. Prepare a new action; permissions are never replayed.',updated_at=? WHERE status IN ('pending','approved','running')").run(new Date().toISOString());
 const live=new Map();let closed=false;
 const update=(id,status,error=null)=>db.prepare('UPDATE runtime_actions SET status=?,error=?,updated_at=? WHERE id=?').run(status,error,new Date().toISOString(),id);
 function cancel(id,reason){const pending=live.get(id);if(!pending)return;clearTimeout(pending.timer);live.delete(id);update(id,'interrupted',reason);pending.reply({action:'decline',content:null});}
 function receive(message,binding,reply,resolveBinding){
  if(closed){reply({action:'decline',content:null});return null;}
  const p=message.params??{},meta=p._meta??{};
  const tool=p.message?.match(/^Allow the .+ MCP server to run tool "([^"]+)"\?$/)?.[1];
  if(message.method!=='mcpServer/elicitation/request'||p.mode!=='form'||meta.codex_approval_kind!=='mcp_tool_call'||!tool||!p.serverName||!p.threadId||!p.turnId||!binding||!meta.tool_params||sensitive(meta.tool_params)||JSON.stringify(meta.tool_params).length>64000){reply({action:'decline',content:null});return null;}
  return register({requestId:message.id,threadId:p.threadId,executionId:p.turnId,server:p.serverName,tool,arguments:meta.tool_params},binding,reply,resolveBinding);
 }
 /** Provider-neutral entry: one live tool call awaiting a per-call decision. `reply` receives accept/decline. */
 function register(call,binding,reply,resolveBinding){
  if(closed||!binding||!call.server||!call.tool||!call.threadId||!call.arguments||typeof call.arguments!=='object'||sensitive(call.arguments)||JSON.stringify(call.arguments).length>64000){reply({action:'decline',content:null});return null;}
  if(getCurrentProfile&&getCurrentProfile()!==binding.profileId){reply({action:'decline',content:null});return null;}
  const old=[...live.entries()].find(([,entry])=>entry.requestId===call.requestId&&entry.threadId===call.threadId);if(old)return old[0];
  const {server,tool}=call,p={serverName:server,threadId:call.threadId,turnId:call.executionId},meta={tool_params:call.arguments},message={id:call.requestId};
  const category=classifyMcpAction(tool,meta.tool_params,p.serverName);
  const payload={threadId:p.threadId,executionId:p.turnId,sessionId:binding.sessionId,agentId:binding.agentId,agentName:binding.agentName,workspaceId:binding.workspaceId,provider:binding.agent?.providerId??'codex',server:p.serverName,tool,category,arguments:meta.tool_params,bindingHash:binding.hash};
  const id=randomUUID(),hash=actionHash(payload),now=new Date().toISOString();
  db.prepare('INSERT INTO runtime_actions VALUES (?,?,?,?,?,?,?,?)').run(id,binding.profileId,hash,'pending',JSON.stringify(payload),null,now,now);
  if(!permittedMcpAction(binding.agent,category)){update(id,'denied',`This agent does not permit ${category} MCP actions. Review its permissions before preparing a new call.`);reply({action:'decline',content:null});return id;}
  const automaticReason=notionAutomaticDecision(binding.agent,p.serverName,tool,meta.tool_params);
  if(automaticReason){
   const current=resolveBinding?resolveBinding():getBinding?.(p.threadId);
   if((resolveBinding||getBinding)&&(!current||current.profileId!==binding.profileId||current.hash!==binding.hash||!permittedMcpAction(current.agent,category)||!notionAutomaticDecision(current.agent,p.serverName,tool,meta.tool_params))){update(id,'interrupted','The Notion preference or agent changed. Prepare a new call.');reply({action:'decline',content:null});return id;}
   db.prepare('UPDATE runtime_actions SET payload_json=? WHERE id=?').run(JSON.stringify({...payload,approvalSource:'notion-preference',automaticReason}),id);
   update(id,'approved');reply({action:'accept',content:{}});return id;
  }
  const timer=setTimeout(()=>cancel(id,'Approval expired. Ask the agent to prepare the action again.'),timeoutMs);timer.unref?.();
  live.set(id,{reply,timer,requestId:message.id,threadId:p.threadId,executionId:p.turnId,binding,resolveBinding});return id;
 }
 function list(profile,sessionId){return db.prepare('SELECT * FROM runtime_actions WHERE profile_id=? ORDER BY created_at DESC LIMIT 200').all(profile).map(decode).filter(item=>!sessionId||item.sessionId===sessionId);}
 function decide(profile,id,{hash,decision}){
  const row=db.prepare('SELECT * FROM runtime_actions WHERE id=? AND profile_id=?').get(id,profile),pending=live.get(id);
  if(!row||!['approve','deny'].includes(decision)||hash!==row.hash)throw new Error('This action changed or is unavailable. Review it again.');
  if(!pending||row.status!=='pending')throw new Error('This confirmation is no longer active. No action was replayed.');
  const current=pending.resolveBinding?pending.resolveBinding():getBinding?.(pending.threadId);
  if(current&&!permittedMcpAction(current.agent,decode(row).category)){cancel(id,'The agent permissions changed.');throw new Error('The agent permissions changed. Prepare a new call.');}
  if(getCurrentProfile&&getCurrentProfile()!==profile||getBinding&&(!current||current.profileId!==profile||current.hash!==pending.binding.hash)){cancel(id,'The agent, session or profile changed.');throw new Error('The agent, session or profile changed. Prepare the action again.');}
  clearTimeout(pending.timer);live.delete(id);update(id,decision==='approve'?'approved':'denied');
  // An empty form is the official per-call approval, not a permanent permission.
  pending.reply({action:decision==='approve'?'accept':'decline',content:decision==='approve'?{}:null});return decode(db.prepare('SELECT * FROM runtime_actions WHERE id=?').get(id));
 }
 function observe(message){if(closed)return;const p=message.params??{},item=p.item??{};if(item.type!=='mcpToolCall'||!['item/started','item/completed'].includes(message.method))return;
  for(const row of db.prepare("SELECT * FROM runtime_actions WHERE status IN ('approved','running')").all()){
   const action=decode(row);if(action.threadId!==p.threadId||action.executionId!==p.turnId||action.server!==item.server||action.tool!==item.tool)continue;
   if(item.arguments&&actionHash(item.arguments)!==actionHash(action.arguments))continue;
   update(row.id,message.method==='item/started'?'running':item.error||item.result?.isError?'failed':'succeeded',item.error?String(item.error.message??item.error):null);break;
  }
 }
 /** Records the outcome reported by a provider that has no item/started stream (Claude Code). */
 function settle(id,ok,error=null){const row=db.prepare('SELECT status FROM runtime_actions WHERE id=?').get(id);if(row&&['approved','running'].includes(row.status))update(id,ok?'succeeded':'failed',ok?null:error);}
 function interrupt(executionId,reason='Execution ended before this confirmation was used.'){
  if(closed)return;
  for(const [id,pending] of live)if(!executionId||pending.executionId===executionId)cancel(id,reason);
  for(const row of db.prepare("SELECT * FROM runtime_actions WHERE status IN ('approved','running')").all())if(!executionId||decode(row).executionId===executionId)update(row.id,'interrupted','The outcome was not confirmed. Check the destination before repeating a write.');
 }
 function evidence(){const profile=getCurrentProfile?.();if(!profile)return [];return list(profile).filter(item=>item.status==='succeeded'&&item.category==='read').map(item=>({server:item.server,tool:item.tool,agentId:item.agentId,workspaceId:item.workspaceId,sessionId:item.sessionId,checkedAt:item.updatedAt}));}
 return {receive,register,settle,list,decide,observe,interrupt,evidence,profile:()=>getCurrentProfile?.(),close:()=>{if(closed)return;interrupt(undefined,'The CLI connection closed. Prepare a new action; previous permissions are not reused.');closed=true;},open:()=>{closed=false;}};
}
