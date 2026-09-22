import type { Agent } from '../../features/agents/model/Agent';
import { getAgentInitials } from '../../features/agents/model/Agent';
import { AgentStatus } from './AgentStatus';
import { useLanguage } from '../../app/LanguageProvider';

interface AgentRowProps { agent:Agent; compact?:boolean; onSelect:(agentId:string)=>void }

export function AgentRow({agent,compact=false,onSelect}:AgentRowProps) {
  const {t}=useLanguage();
  if(compact) return <button className="nav-item agent-nav" onClick={()=>onSelect(agent.id)}><i className={`agent-dot ${agent.status==='idle'?'idle':agent.status==='review'?'review':''}`}/><span>{agent.name}</span></button>;
  return <button className="agent-row-large" onClick={()=>onSelect(agent.id)}><span className="agent-monogram">{getAgentInitials(agent)}</span><span className="agent-main"><b>{agent.name}</b><span>{agent.role}</span></span><span className="agent-purpose">{agent.description}</span><AgentStatus status={agent.status}/><span className="time">{agent.tools.length} {t('tools')}</span></button>;
}
