import {useEffect,useMemo,useState} from 'react';
import type {Agent} from '../agents/model/Agent';
import type {AgentSession} from './model/Chat';
import {collectChatInbox,seenChatSession,type ChatInboxItem} from './chatInbox';
import {useChatInboxState} from './chatInboxState';
import {storageProfile} from '../../data/IndexedDbStateStore';
import {useLanguage} from '../../app/LanguageProvider';

export function useChatInbox(sessions:readonly AgentSession[],agents:readonly Agent[],workspaceId:string){
  const [preferences,setPreferences]=useChatInboxState(),[approvals,setApprovals]=useState<ChatInboxItem[]>([]);
  const {locale}=useLanguage(),pt=locale==='pt-BR';
  useEffect(()=>{if(!preferences.initialized)setPreferences(current=>sessions.reduce(seenChatSession,{...current,initialized:true}));},[preferences.initialized,sessions,setPreferences]);
  useEffect(()=>{if(!window.mainsAgentsDesktop?.state)return;let alive=true,busy=false;
    const refresh=async()=>{if(busy)return;busy=true;try{const response=await fetch(`/api/content/actions?profile=${encodeURIComponent(storageProfile())}`,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(alive)setApprovals((data.actions??[]).filter((action:{status:string})=>action.status==='pending').map((action:{id:string;sessionId:string;agentId:string;workspaceId:string;agentName:string;server:string;tool:string;createdAt:string})=>({id:`approval:${action.id}`,kind:'approval',sessionId:action.sessionId,agentId:action.agentId,workspaceId:action.workspaceId,title:action.agentName,detail:`${action.server} · ${action.tool}`,at:action.createdAt})));}catch{/* The approval card remains available in its chat. */}finally{busy=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),1800);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const items=useMemo(()=>[...approvals.filter(item=>item.workspaceId===workspaceId&&sessions.some(session=>session.id===item.sessionId)&&agents.some(agent=>agent.id===item.agentId)),...(preferences.initialized?collectChatInbox(sessions,agents,preferences,workspaceId):[])],[approvals,agents,preferences,sessions,workspaceId]);
  useEffect(()=>{
    if(!preferences.initialized)return;
    const pending=items.filter(item=>!(preferences.notified??[]).includes(item.id));if(!pending.length)return;
    setPreferences(current=>({...current,notified:[...new Set([...(current.notified??[]),...pending.map(item=>item.id)])]}));
    if(preferences.muted)return;
    const title=pt?'MainsAgents: seu trabalho precisa de atenção':'MainsAgents: your work needs attention';
    if(window.mainsAgentsDesktop?.notify)void window.mainsAgentsDesktop.notify(title,pending.length===1?pending[0].title:(pt?`${pending.length} novas respostas ou decisões.`:`${pending.length} new responses or decisions.`)).catch(()=>{});
    else window.dispatchEvent(new CustomEvent('mainsagents:notify',{detail:pending.length===1?pending[0].title:title}));
  },[items,preferences.initialized,preferences.muted,preferences.notified,setPreferences,pt]);
  return items;
}
