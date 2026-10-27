import type { Agent } from '../../features/agents/model/Agent';
import { AgentAvatar } from './AgentAvatar';
import type { CSSProperties } from 'react';
import { useChat } from '../../features/chat/ChatProvider';
import { defaultMascot } from '../../features/agents/mascot';
import { useLanguage } from '../../app/LanguageProvider';
import { Icon } from '../common/Icon';
import { agentToolDetails } from '../../features/agents/model/Agent';

interface AgentRowProps { agent:Agent; compact?:boolean; selected?:boolean; onSelect:(agentId:string)=>void; onChat?:(agentId:string)=>void; onConfigure?:(agentId:string)=>void }

const busyStates=['thinking','searching','using-tool'];

export function AgentRow({agent,compact=false,selected=false,onSelect,onChat,onConfigure}:AgentRowProps) {
  const {t,locale}=useLanguage();
  const {sessions,getRunState}=useChat();
  if(compact) return <button className="nav-item agent-nav" title={agent.name} aria-label={agent.name} onClick={()=>onSelect(agent.id)}><AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role}/><span>{agent.name}</span><small className="sidebar-agent-provider">{agent.providerId==='claude'?'Claude':agent.providerId==='gemini'?'Gemini':'Codex'}</small></button>;
  const pt=locale==='pt-BR';
  const provider=agent.providerId==='claude'?'Claude Code CLI':agent.providerId==='gemini'?'Gemini API':'Codex CLI';
  // Big mascot card: identity, what the agent is doing now, its footprint (scopes, chats, skills) and the two actions.
  const own=sessions.filter(session=>session.agentId===agent.id);
  const busy=agent.status==='working'||own.some(session=>busyStates.includes(getRunState(session.id)));
  const scopes=new Set(own.map(session=>session.contentId).filter(Boolean)).size;
  const last=own.map(session=>session.updatedAt).sort().at(-1);
  const color=(agent.avatarMascot??defaultMascot({name:agent.name,role:agent.role})).color;
  const line=busy?(pt?'Pensando…':'Thinking…'):agent.status==='review'?t('Needs review'):last?(pt?'Livre · ativo em ':'Free · active ')+new Intl.DateTimeFormat(locale,{day:'numeric',month:'short'}).format(new Date(last)):(pt?'Livre':'Free');
  return <article className={`specialist-tile ${selected?'selected':''} ${busy?'busy':''} ${agent.status==='review'?'review':''}`} data-od-id={'agent-row-'+agent.id} style={{'--agent-color':color} as CSSProperties}>
    <button className="specialist-open" onClick={()=>onSelect(agent.id)} aria-expanded={selected} aria-label={`${pt?'Ver detalhes de':'View details for'} ${agent.name}`}>
      <div className="specialist-identity"><AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={busy}/><div><h2>{agent.name}<small title={provider}>{agent.providerId==='claude'?'Claude':agent.providerId==='gemini'?'Gemini':'Codex'}</small></h2><span className="specialist-role">{agent.role}</span><span className="specialist-state"><i/><span className={busy?'ov-shimmer':''}>{line}</span></span></div></div>
      <span className="specialist-stats"><span><b>{scopes}</b>{pt?'escopos':'scopes'}</span><span><b>{own.length}</b>{pt?'conversas':'chats'}</span><span><b>{agent.skills?.length??0}</b>skills</span></span>
      <span className="specialist-chips">{agent.tools.slice(0,4).map(tool=><span key={tool}>{t(agentToolDetails[tool].label)}</span>)}</span>
    </button>
    <div className="precision-agent-actions">{onChat&&<button className="specialist-chat" onClick={()=>onChat(agent.id)} aria-label={`${pt?'Conversar com':'Chat with'} ${agent.name}`}><Icon name="message"/><span>{pt?'Conversar':'Chat'}</span></button>}<button className="soft-button specialist-configure" onClick={()=> (onConfigure??onSelect)(agent.id)} aria-label={`${pt?'Configurar':'Configure'} ${agent.name}`}>{pt?'Configurar':'Configure'}</button></div>
  </article>;
}
