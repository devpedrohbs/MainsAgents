import type { Agent } from '../../features/agents/model/Agent';
import { AgentAvatar } from './AgentAvatar';
import { AgentStatus } from './AgentStatus';
import { useLanguage } from '../../app/LanguageProvider';
import { Icon } from '../common/Icon';
import { agentToolDetails } from '../../features/agents/model/Agent';

interface AgentRowProps { agent:Agent; compact?:boolean; selected?:boolean; onSelect:(agentId:string)=>void; onChat?:(agentId:string)=>void; onConfigure?:(agentId:string)=>void }

export function AgentRow({agent,compact=false,selected=false,onSelect,onChat,onConfigure}:AgentRowProps) {
  const {t,locale}=useLanguage();
  if(compact) return <button className="nav-item agent-nav" title={agent.name} aria-label={agent.name} onClick={()=>onSelect(agent.id)}><AgentAvatar name={agent.name} image={agent.avatarImage}/><span>{agent.name}</span><small className="sidebar-agent-provider">{agent.providerId==='claude'?'Claude':agent.providerId==='gemini'?'Gemini':'Codex'}</small></button>;
  const pt=locale==='pt-BR';
  const provider=agent.providerId==='claude'?'Claude Code CLI':agent.providerId==='gemini'?'Gemini API':'Codex CLI';
  return <article className={`specialist-tile ${selected?'selected':''}`} data-od-id={'agent-row-'+agent.id}>
    <button className="specialist-open" onClick={()=>onSelect(agent.id)} aria-expanded={selected} aria-label={`${pt?'Ver detalhes de':'View details for'} ${agent.name}`}>
      <div className="specialist-identity"><AgentAvatar name={agent.name} image={agent.avatarImage}/><div><h2>{agent.name}</h2><span className="specialist-role">{agent.role}</span></div><small>{agent.providerId==='claude'?'Claude':agent.providerId==='gemini'?'Gemini':'Codex'}</small></div>
      <p>{agent.description || (pt?'Um especialista para seu próximo projeto.':'A specialist for your next project.')}</p>
      <span className="specialist-chips">{agent.tools.slice(0,2).map(tool=><span key={tool}>{t(agentToolDetails[tool].label)}</span>)}{(agent.skills?.length??0)>0&&<span>{agent.skills!.length} skills</span>}</span>
    </button>
    <div className="precision-agent-actions"><span title={provider}><AgentStatus status={agent.status}/></span><button className="soft-button specialist-configure" onClick={()=> (onConfigure??onSelect)(agent.id)} aria-label={`${pt?'Configurar':'Configure'} ${agent.name}`}>{pt?'Configurar':'Configure'}</button>{onChat&&<button className="specialist-chat" onClick={()=>onChat(agent.id)} aria-label={`${pt?'Conversar com':'Chat with'} ${agent.name}`}><Icon name="message"/><span>{pt?'Conversar':'Chat'}</span></button>}</div>
  </article>;
}
