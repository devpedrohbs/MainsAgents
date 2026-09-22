import { useAgents } from '../features/agents/AgentsProvider';
import { useChat } from '../features/chat/ChatProvider';
import { Icon } from '../components/common/Icon';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';

interface SessionsProps {
  activeAgentId?: string;
  onActivateAgent: (agentId: string) => void;
  onToast: (message: string) => void;
}

export function Sessions({activeAgentId,onActivateAgent,onToast}:SessionsProps) {
  const {agents,getAgentById}=useAgents();
  const {currentWorkspaceId}=useWorkspaces();
  const {sessions,createSession,openSession}=useChat();
  const {locale,t}=useLanguage();
  const workspaceAgents=agents.filter((agent)=>agent.workspaceId===currentWorkspaceId);
  const agentIds=new Set(workspaceAgents.map((agent)=>agent.id));
  const ordered=sessions.filter((session)=>agentIds.has(session.agentId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const startSession=()=>{const agentId=activeAgentId??workspaceAgents[0]?.id;if(!agentId)return;const session=createSession(agentId);onActivateAgent(agentId);onToast(`${session.title} created`)};
  const open=(agentId:string,sessionId:string,title:string)=>{openSession(agentId,sessionId);onActivateAgent(agentId);onToast(`${title} opened`)};
  return <div className="page"><div className="page-head"><div><p className="eyebrow">{t('Agent history')}</p><h1>{t('Sessions')}</h1><p>{t('Each conversation keeps its own messages, agent, and working context.')}</p></div><button className="primary-button" onClick={startSession}><Icon name="plus"/>{t('New session')}</button></div><div className="sessions-list">{ordered.map((session)=>{const agent=getAgentById(session.agentId);return <button className="session-row" key={session.id} onClick={()=>open(session.agentId,session.id,session.title)}><span className="session-main"><b>{session.title}</b><span>{session.messages.length} {t('items')}</span></span><span className="session-agent">{agent?.name??t('Deleted agent')}</span><span className="session-context">{t('Independent session')}</span><span className="time">{formatUpdated(session.updatedAt,locale)}</span></button>})}</div></div>;
}

function formatUpdated(value:string,locale:string):string {
  return new Intl.DateTimeFormat(locale,{month:'short',day:'numeric'}).format(new Date(value));
}
