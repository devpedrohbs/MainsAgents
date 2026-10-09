import type { AgentSession } from './model/Chat';
import type { Agent } from '../agents/model/Agent';

export interface ChatInboxState { seen: Record<string,string[]>; muted: boolean; initialized: boolean; notified?:string[] }
export interface ChatInboxItem { id:string; sessionId:string; agentId:string; workspaceId:string; title:string; detail:string; at:string; kind:'delivery'|'blocked'|'approval' }
export const emptyChatInbox = ():ChatInboxState => ({seen:{},muted:true,initialized:false});
export function sessionInboxEvents(session:AgentSession):ChatInboxItem[] {
  const rows:ChatInboxItem[]=[];
  for(const item of session.messages) {
    if(item.type==='message'&&item.role==='agent'&&item.content.trim()&&item.deliveryState!=='streaming') rows.push({id:`message:${item.id}`,sessionId:session.id,agentId:session.agentId,workspaceId:'',title:session.title,detail:item.content.slice(0,180),at:item.createdAt,kind:item.deliveryState==='interrupted'?'blocked':'delivery'});
    if(item.type==='activity'&&item.kind!=='run'&&item.status==='error') rows.push({id:`error:${item.id}`,sessionId:session.id,agentId:session.agentId,workspaceId:'',title:session.title,detail:item.label,at:session.updatedAt,kind:'blocked'});
  }
  for(const handoff of session.handoffs??[]) if(['error','interrupted'].includes(handoff.status)) rows.push({id:`handoff:${handoff.id}:${handoff.updatedAt}`,sessionId:session.id,agentId:session.agentId,workspaceId:handoff.workspaceId,title:handoff.title,detail:handoff.error??'',at:handoff.updatedAt,kind:'blocked'});
  return rows;
}
export function seenChatSession(state:ChatInboxState,session:AgentSession):ChatInboxState {
  const ids=[...new Set([...(state.seen[session.id]??[]),...sessionInboxEvents(session).map(item=>item.id)])];
  return JSON.stringify(ids)===JSON.stringify(state.seen[session.id])?state:{...state,seen:{...state.seen,[session.id]:ids}};
}
export function collectChatInbox(sessions:readonly AgentSession[],agents:readonly Agent[],state:ChatInboxState,workspaceId:string):ChatInboxItem[] {
  return sessions.flatMap(session=>{
    const agent=agents.find(item=>item.id===session.agentId&&item.workspaceId===workspaceId);
    return agent?sessionInboxEvents(session).filter(item=>!(state.seen[session.id]??[]).includes(item.id)).map(item=>({...item,workspaceId:agent.workspaceId,title:`${agent.name} · ${item.title}`})):[];
  }).sort((a,b)=>(a.kind==='blocked'?0:1)-(b.kind==='blocked'?0:1)||b.at.localeCompare(a.at));
}
