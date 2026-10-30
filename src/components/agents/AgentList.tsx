import type { Agent } from '../../features/agents/model/Agent';
import { agentStatusLabels } from '../../features/agents/model/Agent';
import { useLanguage } from '../../app/LanguageProvider';
import { AgentRow } from './AgentRow';
import { StatusIcon } from '../common/StatusIcon';
import { useChat } from '../../features/chat/ChatProvider';

interface AgentListProps { agents:readonly Agent[]; compact?:boolean; selectedId?:string; onSelect:(agentId:string)=>void; onChat?:(agentId:string)=>void; onConfigure?:(agentId:string)=>void }
export function AgentList({agents,compact=false,selectedId,onSelect,onChat,onConfigure}:AgentListProps) {
  const {t,locale}=useLanguage(),pt=locale==='pt-BR';
  const {sessions,getRunState}=useChat();
  const statusOf=(agent:Agent)=>agent.status==='working'||sessions.some(session=>session.agentId===agent.id&&['thinking','searching','using-tool'].includes(getRunState(session.id)))?'working':agent.status;
  const row=(agent:Agent)=><AgentRow key={agent.id} agent={agent} compact={compact} selected={selectedId===agent.id} onSelect={onSelect} onChat={onChat} onConfigure={onConfigure}/>;
  if(compact) return <div>{agents.map(row)}</div>;
  return <div className="agents-list v2-list">
    <div className="agent-table-head"><span>{pt?'Agente / Agora':'Agent / Now'}</span><span>{pt?'Modelo':'Model'}</span><span>{pt?'Escopos / Conversas / Skills':'Scopes / Chats / Skills'}</span><span>{pt?'Ações':'Actions'}</span></div>
    {(['working','review','idle'] as const).map(status=>{
      const group=agents.filter(agent=>statusOf(agent)===status);
      return group.length>0&&<section className="agent-table-group" key={status} aria-label={t(agentStatusLabels[status])}>
        <div className="agent-group-head"><StatusIcon size={12} state={status==='working'?'running':status==='review'?'waiting':'queued'}/><b>{t(agentStatusLabels[status])}</b><span className="v2-mono">{group.length}</span></div>
        {group.map(row)}
      </section>;
    })}
  </div>;
}
