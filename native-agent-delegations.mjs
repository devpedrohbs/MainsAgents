import {randomUUID} from 'node:crypto';
import {actionHash} from './runtime-action-approvals.mjs';
import {inspectLocalAsset} from './editorial-local-files.mjs';

const terminal=['completed','error','cancelled','interrupted'];
const decode=row=>row&&JSON.parse(row.data_json);
const now=()=>new Date().toISOString();
const message=(id,role,content,state)=>({id,type:'message',role,content,createdAt:now(),...(state?{deliveryState:state}:{})});
/** This queue owns execution; React only mirrors its messages into the local UI store. */
export function createNativeAgentDelegations(db,{getCurrentProfile,getAgents,getSessions,getRuntime,inspect=inspectLocalAsset,timeoutMs=29*60_000}={}){
 db.exec('CREATE TABLE IF NOT EXISTS agent_delegation_jobs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL,data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_delegation_sessions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,data_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_delegation_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,pid INTEGER NOT NULL,expires INTEGER NOT NULL);');
 const owner=randomUUID();let recoveredLease=false;
 const owns=()=>db.prepare('SELECT owner FROM agent_delegation_lease WHERE id=1').get()?.owner===owner;
 function acquire(){const row=db.prepare('SELECT * FROM agent_delegation_lease WHERE id=1').get();if(row&&row.owner!==owner&&row.expires>Date.now()){try{process.kill(row.pid,0);return false;}catch{/* A crashed worker cannot keep a lease. */}}
  const expires=Date.now()+30000;db.exec('BEGIN IMMEDIATE');try{const locked=db.prepare('SELECT * FROM agent_delegation_lease WHERE id=1').get();if(locked&&locked.owner!==row?.owner&&locked.owner!==owner){db.exec('COMMIT');return false;}db.prepare('INSERT OR REPLACE INTO agent_delegation_lease VALUES (1,?,?,?)').run(owner,process.pid,expires);db.exec('COMMIT');return true;}catch(error){db.exec('ROLLBACK');throw error;}}
 const active=new Map(),waiters=new Map(),tasks=new Set(),parentOutputs=new Map();let closed=false;
 const write=job=>db.prepare('INSERT OR REPLACE INTO agent_delegation_jobs VALUES (?,?,?,?,?)').run(job.id,job.profileId,job.requestKey,job.status,JSON.stringify(job));
 const read=id=>decode(db.prepare('SELECT * FROM agent_delegation_jobs WHERE id=?').get(id));
 const list=profile=>db.prepare('SELECT * FROM agent_delegation_jobs WHERE profile_id=? ORDER BY rowid').all(profile).map(decode);
 const shadows=profile=>db.prepare('SELECT * FROM agent_delegation_sessions WHERE profile_id=? ORDER BY rowid').all(profile).map(decode);
 const session=(profile,id)=>{const shadow=shadows(profile).find(item=>item.id===id),core=(getSessions?.(profile)??[]).find(item=>item.id===id);return core?{...core,delegationAncestors:shadow?.delegationAncestors,delegationRoot:shadow?.delegationRoot,codexThreadId:shadow?.codexThreadId??core.codexThreadId,remoteSessionId:shadow?.remoteSessionId??core.remoteSessionId}:shadow;};
 const saveSession=(profile,value)=>db.prepare('INSERT OR REPLACE INTO agent_delegation_sessions VALUES (?,?,?)').run(value.id,profile,JSON.stringify(value));
 function patchSession(profile,id,change){const value=shadows(profile).find(item=>item.id===id)??session(profile,id);if(value)saveSession(profile,change(value));}
 function finish(job,status,error){job.status=status;job.error=error;job.updatedAt=now();write(job);
  if(job.manual&&status==='completed'){const resultId=`delegation-result-${job.id}`;patchSession(job.profileId,job.sourceSessionId,value=>({...value,updatedAt:job.updatedAt,nativeMessageIds:[...new Set([...(value.nativeMessageIds??[]),resultId])],messages:[...value.messages.filter(item=>item.id!==resultId),{...message(resultId,'agent',job.result,'completed'),handoffId:job.id,sourceAgentName:(getAgents(job.profileId)??[]).find(agent=>agent.id===job.targetAgentId)?.name}]}));}
  patchSession(job.profileId,job.targetSessionId,value=>({...value,updatedAt:job.updatedAt,messages:value.messages.map(item=>item.id===`codex-${job.executionId}`?{...item,deliveryState:status==='completed'?'completed':'interrupted'}:item)}));
  const settle=waiters.get(job.id);waiters.delete(job.id);settle?.({success:status==='completed',content:status==='completed'?job.result:error||'The specialist did not complete the task.'});
 }
 // Startup restores facts, not permission to resend a potentially performed operation.
 function recoverLease(){if(recoveredLease)return;recoveredLease=true;for(const row of db.prepare("SELECT * FROM agent_delegation_jobs WHERE status IN ('queued','running')").all()){const job=decode(row);finish(job,'interrupted','The app closed. Review the saved specialist chat before explicitly recovering this work.');}}
 if(acquire())recoverLease();
 const leaseTimer=setInterval(()=>{if(closed)return;if(owns())db.prepare('UPDATE agent_delegation_lease SET expires=? WHERE owner=?').run(Date.now()+30000,owner);else if(acquire()){recoverLease();kick();}for(const [id,settle] of waiters){const job=read(id);if(job&&terminal.includes(job.status)){waiters.delete(id);settle({success:job.status==='completed',content:job.result??job.error});}}},1000);leaseTimer.unref?.();
 function validate(job){
  if(getCurrentProfile?.()!==job.profileId)throw new Error('The active profile changed.');
  const agents=getAgents?.(job.profileId)??[],source=agents.find(item=>item.id===job.sourceAgentId),target=agents.find(item=>item.id===job.targetAgentId);
  if(!source||!target||source.workspaceId!==target.workspaceId||source.workspaceId!==job.workspaceId||!source.tools?.includes('subagents')||actionHash(target)!==job.targetHash||actionHash(source)!==job.sourceHash)throw new Error('The agent configuration or workspace changed. Prepare a new briefing.');
  if(!['codex','claude'].includes(target.providerId??'codex'))throw new Error('Durable delegation requires a supported CLI provider (Codex or Claude).');
  const sourceSession=session(job.profileId,job.sourceSessionId),connection=sourceSession?.agentConnection;
  if(!sourceSession||!job.manual&&connection&&(!connection.enabled||connection.targetAgentId!==target.id))throw new Error('The source session or connected agent changed.');
  return target;
 }
 function snapshot(profile){return {jobs:list(profile),sessions:shadows(profile)};}
 function manual(profile,input){
  if(getCurrentProfile?.()!==profile||typeof input.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId))throw new Error('Invalid local handoff request.');
  const source=(getAgents(profile)??[]).find(agent=>agent.id===input.sourceAgentId),origin=session(profile,input.sourceSessionId),request=input.request;
  if(!source||origin?.agentId!==source.id||!request||typeof request.instructions!=='string'||!request.instructions.trim()||request.instructions.length>32000||typeof request.title!=='string'||!request.title.trim()||request.title.length>120||!Array.isArray(request.files)||request.files.length>20||request.files.some(path=>typeof path!=='string'||path.length>4096||!/^(?:[a-z]:[\\/]|\/[^/])[^\r\n\0]*$/i.test(path))||request.sessionMode&&!['continue','new'].includes(request.sessionMode))throw new Error('Provide a valid specialist briefing and absolute local files.');
  const context=input.context??[];if(!Array.isArray(context)||context.length>30||context.some(item=>!item||typeof item.label!=='string'||typeof item.kind!=='string'||typeof item.nodeId!=='string'||item.content!==undefined&&typeof item.content!=='string')||JSON.stringify(context).length>120000)throw new Error('Invalid Canvas context.');
  const key=`${profile}:manual:${input.sourceSessionId}:${input.requestId}:manual-call`,prior=list(profile).find(job=>job.requestKey===key);
  const hash=actionHash({request,context});if(prior){if(prior.manualHash!==hash)throw new Error('This handoff request changed. Prepare a new request.');return prior;}
  const safe={...request,instructions:request.instructions+(context.length?'\n\nCanvas context:\n'+context.map(item=>`[${item.kind}] ${item.label}\n${item.content??''}`).join('\n\n'):'')};
  if(safe.instructions.length>32000)throw new Error('Briefing and context exceed 32,000 characters.');
  // dispatch writes synchronously before returning its completion promise.
  void dispatch({profileId:profile,agentId:source.id,sessionId:origin.id},{threadId:`manual:${origin.id}`,turnId:input.requestId,callId:'manual-call',arguments:safe,manual:true,manualHash:hash},{targets:(getAgents(profile)??[]).filter(agent=>agent.workspaceId===source.workspaceId&&agent.id!==source.id).map(agent=>({id:agent.id}))});
  return list(profile).find(job=>job.requestKey===key);
 }
 function dispatch(binding,p,config){
  if(closed||!binding)throw new Error('Native delegation is unavailable for this session.');
  const input=p.arguments,profile=binding.profileId,agents=getAgents?.(profile)??[],source=agents.find(item=>item.id===binding.agentId),target=agents.find(item=>item.id===input.targetAgentId),sourceSession=session(profile,binding.sessionId);
  const ancestors=sourceSession?.delegationAncestors??[],depth=ancestors.length,root=sourceSession?.delegationRoot??`${p.threadId}:${p.turnId}`;
  if(!source||!target||!sourceSession||source.workspaceId!==target.workspaceId||source.id===target.id||ancestors.includes(target.id)||depth>=2||!source.tools?.includes('subagents')||!config?.targets?.some(item=>item.id===target.id))throw new Error('Agent delegation is disabled, cyclic or outside this workspace.');
  const requestKey=`${profile}:${p.threadId}:${p.turnId}:${p.callId}`,old=decode(db.prepare('SELECT * FROM agent_delegation_jobs WHERE request_key=?').get(requestKey));
  if(old){if(terminal.includes(old.status))return Promise.resolve({success:old.status==='completed',content:old.result||old.error});return new Promise(resolve=>{const previous=waiters.get(old.id);waiters.set(old.id,result=>{previous?.(result);resolve(result);});});}
  if(list(profile).filter(job=>job.root===root).length>=4)throw new Error('At most four specialist calls are allowed per root response.');
  if(!['codex','claude'].includes(target.providerId??'codex'))throw new Error('Persistent delegation requires a supported CLI provider (Codex or Claude).');
  const connected=sourceSession.agentConnection?.enabled&&sourceSession.agentConnection.targetAgentId===target.id;
  const last=list(profile).slice().reverse().find(job=>job.sourceSessionId===sourceSession.id&&job.targetAgentId===target.id&&job.targetHash===actionHash(target))?.targetSessionId;
  const reused=input.sessionMode!=='new'&&((connected?session(profile,sourceSession.agentConnection.targetSessionId):undefined)??last);
  const child=typeof reused==='string'?session(profile,reused):reused;
  const id=randomUUID(),at=now(),targetSession=child??{id:`delegated-${randomUUID()}`,agentId:target.id,providerId:target.providerId??'codex',contentId:sourceSession.contentId,topicId:sourceSession.topicId,modelId:target.modelId,title:input.title,messages:[],createdAt:at,updatedAt:at,originHandoffId:id};
  if(targetSession.agentId!==target.id)throw new Error('The linked session belongs to another agent.');
  const briefing=`Task from ${source.name} (${source.role}): ${input.title}\n\n${input.instructions}${input.files.length?'\n\nLocal file references:\n'+input.files.join('\n'):''}\n\nFollow your configured role, instructions and associated skills. Return the actual result. Respect user approval requirements. Report missing files and unavailable editing tools honestly. Do not claim an edited video without a real output file.`;
  const job={id,manual:p.manual===true,manualHash:p.manualHash,providerId:target.providerId??'codex',profileId:profile,requestKey,root,depth,sourceAgentId:source.id,sourceSessionId:sourceSession.id,sourceThreadId:p.threadId,sourceExecutionId:p.turnId,targetAgentId:target.id,targetSessionId:targetSession.id,workspaceId:source.workspaceId,title:input.title,instructions:input.instructions,files:input.files,context:[],sessionMode:input.sessionMode??'continue',status:'queued',sourceHash:actionHash(source),targetHash:actionHash(target),briefing,createdAt:at,updatedAt:at,attempts:0};
  db.exec('BEGIN IMMEDIATE');try{write(job);if(!shadows(profile).some(item=>item.id===sourceSession.id))saveSession(profile,{...sourceSession,nativeMessageIds:[]});saveSession(profile,{...targetSession,delegationAncestors:[...ancestors,source.id],delegationRoot:root,updatedAt:at});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  const completion=new Promise(resolve=>waiters.set(id,resolve));queueMicrotask(kick);return completion;
 }
 async function run(job){
  const controller=new AbortController();active.set(job.id,{controller,depth:job.depth,sessionId:job.targetSessionId});
  job.status='running';job.attempts++;job.updatedAt=now();write(job);
  let runtime;const timer=setTimeout(()=>void cancel(job.profileId,job.id,'Specialist exceeded the 29-minute limit. Partial output is saved.'),timeoutMs);timer.unref?.();
  try{
   const target=validate(job);runtime=getRuntime?.(target.providerId??'codex');if(!runtime)throw new Error('The selected CLI provider is unavailable.');
   if(!owns())throw new Error('This worker no longer owns the queue.');
   for(const path of job.files){if(!target.tools?.includes('files'))throw new Error('The target agent does not have file access enabled.');const file=await inspect(path);if(file.status!=='available')throw new Error(`File unavailable: ${path}`);}
   let child=session(job.profileId,job.targetSessionId),threadId=child.codexThreadId??child.remoteSessionId;
   if((target.providerId??'codex')==='codex'&&job.sending&&threadId&&job.inputMarker){const saved=await runtime.readThread(threadId);const found=(saved.turns??[]).find(turn=>(turn.items??[]).some(item=>item.type==='userMessage'&&(item.content??[]).some(part=>typeof part.text==='string'&&part.text.startsWith(job.inputMarker))));if(found){job.executionId=found.id;job.sending=false;write(job);patchSession(job.profileId,child.id,value=>({...value,nativeMessageIds:[...new Set([...(value.nativeMessageIds??[]),`codex-${found.id}`])]}));}}
   if(job.executionId){if((target.providerId??'codex')==='claude'&&!job.resend)throw new Error('Claude reconciliation is unavailable. Inspect the saved specialist response before confirming another send.');const thread=(target.providerId??'codex')==='claude'?{turns:[]}:await runtime.readThread(threadId);const turn=(thread.turns??[]).find(turn=>turn.id===job.executionId);if(turn?.status==='completed'){job.result=(turn.items??[]).filter(item=>item.type==='agentMessage').map(item=>item.text??'').join('\n');if(!job.result.trim())throw new Error('The recovered turn has no response.');patchSession(job.profileId,child.id,value=>({...value,messages:[...value.messages.filter(item=>item.id!==`codex-${job.executionId}`),message(`codex-${job.executionId}`,'agent',job.result,'completed')]}));finish(job,'completed');return;}if(turn?.status==='inProgress'||thread.status?.type==='active')throw new Error('The saved CLI turn is still active. Wait; no second message was sent.');if(!job.resend)throw new Error('The previous turn outcome is uncertain. Review the saved chat before confirming another send.');}
   else if(job.sending&&!job.resend)throw new Error('A previous send was not confirmed. Inspect its saved thread before authorizing another send.');
   const marker=`[MainsAgents delegation ${job.id} attempt ${job.attempts}]\n`;
   if(controller.signal.aborted)throw new Error('Delegation canceled.');
   try{threadId=await runtime.connect(child,target);}catch(error){if(!job.sending&&!job.executionId&&/no persisted rollout|no rollout found for thread id|not materialized yet/i.test(error.message))threadId=await runtime.connect({...child,codexThreadId:undefined,remoteSessionId:undefined},target);else throw error;}
   const firstMessage=!child.remoteSessionId&&!child.codexThreadId;patchSession(job.profileId,child.id,value=>({...value,codexThreadId:(target.providerId??'codex')==='codex'?threadId:undefined,remoteSessionId:threadId}));job.threadId=threadId;write(job);
   validate(job);if(!owns())throw new Error('This worker no longer owns the queue.');if(controller.signal.aborted)throw new Error('Delegation canceled.');
   const userId=`delegation-input-${job.id}-${job.attempts}`;patchSession(job.profileId,child.id,value=>({...value,updatedAt:now(),messages:[...value.messages,message(userId,'user',job.briefing)],nativeUserMessageIds:[...(value.nativeUserMessageIds??[]),userId]}));
   job.inputMarker=marker;job.sending=true;write(job);const execution=await runtime.send(threadId,marker+job.briefing,{...target,modelId:child.modelId??target.modelId,reasoningEffort:child.reasoningEffort??'medium',runtimeFirstMessage:firstMessage});job.executionId=execution.executionId;job.sending=false;write(job);patchSession(job.profileId,child.id,value=>({...value,nativeMessageIds:[...new Set([...(value.nativeMessageIds??[]),`codex-${job.executionId}`])]}));
   if(controller.signal.aborted){await runtime.cancel(threadId,job.executionId);throw new Error('Delegation canceled.');}
   let result='',completed=false;
   for await(const event of runtime.events(job.executionId,controller.signal)){
    if(!owns())throw new Error('Another local worker owns this execution. No additional message was sent.');
    if(controller.signal.aborted)throw new Error('Delegation canceled.');
    if(event.type==='message.delta')result+=event.delta;if(event.type==='message.completed')result=event.content;
    if(event.type==='message.delta'||event.type==='message.completed'){job.partialOutput=result;write(job);patchSession(job.profileId,child.id,value=>({...value,updatedAt:now(),messages:[...value.messages.filter(item=>item.id!==`codex-${job.executionId}`),message(`codex-${job.executionId}`,'agent',result,'streaming')]}));}
    if(event.type==='execution.failed')throw new Error(event.message);if(event.type==='execution.cancelled')throw new Error('Delegation canceled.');if(event.type==='execution.completed')completed=true;
   }
   if(!completed||!result.trim())throw new Error('The specialist stream did not confirm a complete response.');
   validate(job);if(controller.signal.aborted)throw new Error('Delegation canceled.');job.result=result;finish(job,'completed');
  }catch(error){if(owns()&&!['cancelled','interrupted'].includes(read(job.id)?.status))finish(job,closed?'interrupted':controller.signal.aborted?'cancelled':'error',error.message);}
  finally{clearTimeout(timer);active.delete(job.id);if(!closed)queueMicrotask(kick);}
 }
 function kick(){if(closed||!owns())return;const profile=getCurrentProfile?.();if(!profile)return;for(const job of list(profile))if(job.status==='queued'&&![...active.values()].some(item=>item.depth===job.depth||item.sessionId===job.targetSessionId)){const task=run(job);tasks.add(task);void task.finally(()=>tasks.delete(task));}}
 async function cancel(profile,id,reason='Canceled by the user.'){const job=read(id);if(!job||job.profileId!==profile)throw new Error('Delegation not found.');if(terminal.includes(job.status))return;active.get(id)?.controller.abort();if(job.executionId&&job.threadId)await getRuntime?.(job.providerId??'codex')?.cancel(job.threadId,job.executionId).catch(()=>{});finish(read(id),'cancelled',reason);for(const nested of list(profile))if(nested.sourceSessionId===job.targetSessionId&&!terminal.includes(nested.status))await cancel(profile,nested.id,reason);}
 function cancelSource(executionId){if(closed)return;for(const job of db.prepare("SELECT * FROM agent_delegation_jobs WHERE status IN ('queued','running')").all().map(decode))if(job.sourceExecutionId===executionId)void cancel(job.profileId,job.id);}
 function retry(profile,id,{resend=false}={}){if(typeof resend!=='boolean')throw new Error('Explicit resend confirmation must be a boolean.');const job=read(id);if(!job||job.profileId!==profile||!['error','interrupted'].includes(job.status)||job.attempts>=3)throw new Error('This work cannot be retried. Prepare a new briefing.');validate(job);job.status='queued';job.error=undefined;job.resend=resend;write(job);queueMicrotask(kick);return job;}
 function handoffs(profile){return list(profile).map(job=>({...job,status:job.status==='queued'?'running':job.status}));}
 function observeParent(m){if(closed)return;const p=m.params??{},turn=p.turnId??p.turn?.id;const jobs=db.prepare('SELECT * FROM agent_delegation_jobs').all().map(decode).filter(job=>job.sourceExecutionId===turn&&job.sourceThreadId===p.threadId);if(!jobs.length)return;
  if(m.method==='item/agentMessage/delta')parentOutputs.set(turn,(parentOutputs.get(turn)??'')+(p.delta??''));
  if(m.method==='item/completed'&&p.item?.type==='agentMessage')parentOutputs.set(turn,p.item.text??'');
  if(m.method==='turn/completed'){const text=parentOutputs.get(turn);parentOutputs.delete(turn);if(!text)return;const job=jobs[0],id=`codex-${turn}`;patchSession(job.profileId,job.sourceSessionId,value=>({...value,updatedAt:now(),nativeMessageIds:[...new Set([...(value.nativeMessageIds??[]),id])],messages:[...value.messages.filter(item=>item.id!==id),message(id,'agent',text,p.turn?.status==='completed'?'completed':'interrupted')]}));}
 }
 function forgetSession(profile,id){if(list(profile).some(job=>[job.sourceSessionId,job.targetSessionId].includes(id)&&['queued','running'].includes(job.status)))throw new Error('Finish or cancel the specialist work before deleting this session.');db.prepare('DELETE FROM agent_delegation_sessions WHERE id=? AND profile_id=?').run(id,profile);}
 return {dispatch,manual,snapshot,session,shadows,handoffs,cancel,cancelSource,retry,kick,observeParent,forgetSession,close:async()=>{if(closed)return;closed=true;clearInterval(leaseTimer);for(const [id,entry] of active){entry.controller.abort();const job=read(id);if(job.executionId&&job.threadId)await getRuntime?.(job.providerId??'codex')?.cancel(job.threadId,job.executionId).catch(()=>{});if(owns())finish(job,'interrupted','The app closed. Inspect the saved session before recovering.');}if(owns())for(const row of db.prepare("SELECT * FROM agent_delegation_jobs WHERE status='queued'").all())finish(decode(row),'interrupted','The app closed before execution.');await Promise.allSettled([...tasks]);db.prepare('DELETE FROM agent_delegation_lease WHERE owner=?').run(owner);}};
}
