import type {AgentSession,ChatItem} from './model/Chat.ts';
import type {AgentHandoff} from './agentHandoff.ts';
export interface NativeDelegationSnapshot {sessions:(AgentSession&{nativeMessageIds?:string[];nativeUserMessageIds?:string[]})[];handoffs:AgentHandoff[];jobs:(AgentHandoff&{profileId:string;executionId?:string})[]}
/** Import only runtime-owned messages/links. User titles, model choices and other messages win. */
export function mergeNativeDelegations(current:AgentSession[],snapshot:NativeDelegationSnapshot,allowedAgents:readonly string[]):AgentSession[]{
 const result=current.slice();
 for(const shadow of snapshot.sessions){if(!allowedAgents.includes(shadow.agentId))continue;
  const index=result.findIndex(item=>item.id===shadow.id);if(index<0){result.push(shadow);continue;}
  const existing=result[index];if(existing.agentId!==shadow.agentId)continue;
  const ids=new Set([...(shadow.nativeMessageIds??[]),...(shadow.nativeUserMessageIds??[])]),incoming=shadow.messages.filter(item=>ids.has(item.id));
  const byId=new Map<string,ChatItem>(existing.messages.map(item=>[item.id,item]));for(const item of incoming){const old=byId.get(item.id);if(old?.type==='message'&&old.deliveryState==='completed'&&item.type==='message'&&item.deliveryState==='streaming')continue;byId.set(item.id,item);}
  result[index]={...existing,remoteSessionId:shadow.remoteSessionId??existing.remoteSessionId,codexThreadId:shadow.codexThreadId??existing.codexThreadId,originHandoffId:shadow.originHandoffId??existing.originHandoffId,messages:[...byId.values()],updatedAt:existing.updatedAt>shadow.updatedAt?existing.updatedAt:shadow.updatedAt};
 }
 for(const handoff of snapshot.handoffs){const index=result.findIndex(item=>item.id===handoff.sourceSessionId);if(index<0)continue;const source=result[index];if(source.agentId!==handoff.sourceAgentId)continue;
  const previous=source.handoffs?.find(item=>item.id===handoff.id),handoffs=[...(source.handoffs??[]).filter(item=>item.id!==handoff.id),handoff];
  const connection=source.agentConnection?.enabled&&source.agentConnection.targetAgentId===handoff.targetAgentId?{...source.agentConnection,...(!previous?{targetSessionId:handoff.targetSessionId}:{})}:source.agentConnection;
  result[index]={...source,handoffs,agentConnection:connection};
 }
 return JSON.stringify(current)===JSON.stringify(result)?current:result;
}
