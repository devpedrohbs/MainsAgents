import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import { agentStatusLabels, agentToolDetails, getAgentInitials } from '../../features/agents/model/Agent';
import { useChat } from '../../features/chat/ChatProvider';
import type { ChatRunState } from '../../features/chat/model/Chat';
import { Icon } from '../common/Icon';
import { useCanvas } from '../canvas/CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';

type ChatTab = 'chat' | 'sessions' | 'context';
const stateLabels: Record<ChatRunState, string> = { idle: 'Idle', thinking: 'Thinking', searching: 'Searching', 'using-tool': 'Tool usage', finished: 'Finished', error: 'Error' };
const tabLabels:Record<ChatTab,string>={chat:'Chat',sessions:'Sessions',context:'Context'};

interface ChatPanelProps {
  agent: Agent;
  onNavigateHistory: () => void;
  onNavigateSettings: () => void;
  onOpenCanvas: () => void;
  onToast: (message: string) => void;
}

export function ChatPanel({ agent, onNavigateHistory, onNavigateSettings, onOpenCanvas, onToast }: ChatPanelProps) {
  const {getWorkspaceById}=useWorkspaces();
  const {locale,t}=useLanguage();
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<ChatTab>('chat');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { getAgentSessions, getActiveSession, getRunState, createSession, openSession, renameSession, deleteSession, sendMessage, cancelExecution } = useChat();
  const {addAgentResponse,hasMessageNode,getAgentContext,removeNodeFromAgentContext,clearAgentContext}=useCanvas();
  const agentSessions = getAgentSessions(agent.id);
  const activeSession = getActiveSession(agent.id);
  const contextNodes=getAgentContext(agent.id);
  const runState = getRunState(activeSession?.id);
  const busy = runState === 'thinking' || runState === 'searching' || runState === 'using-tool';

  useEffect(() => {
    setEditingSessionId(null);
    setConfirmDeleteId(null);
  }, [agent.id]);

  useEffect(() => {
    if (tab === 'chat') requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }));
  }, [activeSession?.id, activeSession?.messages.length, tab]);

  useEffect(()=>{if(contextNodes.length){setTab('chat');requestAnimationFrame(()=>composerRef.current?.focus())}},[contextNodes.length]);

  const startSession = () => {
    createSession(agent.id);
    setTab('chat');
    setMessage('');
    onToast(`New ${agent.name} session`);
  };

  const send = () => {
    if (!message.trim() || busy) return;
    sendMessage(agent, message, contextNodes);
    clearAgentContext(agent.id);
    setMessage('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const beginRename = (sessionId: string, title: string) => {
    setEditingSessionId(sessionId);
    setRenameValue(title);
    setConfirmDeleteId(null);
  };

  const finishRename = () => {
    if (editingSessionId && renameValue.trim()) renameSession(editingSessionId, renameValue);
    setEditingSessionId(null);
  };

  return <div className="chat-panel">
    <div className="chat-top">
      <header className="chat-head">
        <span className="agent-monogram">{getAgentInitials(agent)}</span>
        <div className="chat-identity"><b>{agent.name}</b><span><i className={agent.status}/>{agent.role} · {t(agentStatusLabels[agent.status])}</span></div>
        <div className="chat-head-actions"><button className="icon-button" aria-label="New session" onClick={startSession}><Icon name="plus"/></button><button className="icon-button" aria-label="Open all sessions" onClick={onNavigateHistory}><Icon name="history"/></button><button className="icon-button" aria-label="Agent settings" onClick={onNavigateSettings}><Icon name="more"/></button></div>
      </header>
      <nav className="chat-tabs" aria-label={`${agent.name} panel`}>
        {(['chat','sessions','context'] as ChatTab[]).map((item)=><button key={item} className={tab===item?'active':''} aria-selected={tab===item} onClick={()=>setTab(item)}>{t(tabLabels[item])}</button>)}
        <span className={`run-state ${runState}`}><i/>{t(stateLabels[runState])}</span>
      </nav>
    </div>

    {tab==='chat'&&<div className="chat-body" ref={bodyRef}>
      {activeSession&&<div className="active-session-bar"><span>{activeSession.title}</span><button onClick={()=>setTab('sessions')}>{t('All sessions')}</button></div>}
      {(!activeSession||activeSession.messages.length===0)&&<div className="chat-empty"><span className="agent-monogram">{getAgentInitials(agent)}</span><h3>{locale==='pt-BR'?`Inicie uma sessão com ${agent.name}`:`Start a session with ${agent.name}`}</h3><p>{agent.description}</p></div>}
      {activeSession?.messages.map((item)=>item.type==='activity'?<div className={`tool-activity ${item.status}`} key={item.id}><i/>{item.label}{item.status==='done'&&<span>✓</span>}</div>:<article className={`chat-message ${item.role==='user'?'user':''}`} key={item.id}><div className="message-meta"><b>{item.role==='user'?t('You'):agent.name}</b><span>{formatTime(item.createdAt,locale)}</span></div><p>{item.content}</p>{item.contextNodes&&item.contextNodes.length>0&&<div className="message-context-used"><span>{locale==='pt-BR'?'Contexto usado':'Used context'}</span><div>{item.contextNodes.map((context)=><i key={context.nodeId}>{context.label}</i>)}</div></div>}{item.role==='agent'&&<div className="message-actions"><button disabled={hasMessageNode(item.id)} onClick={()=>{const result=addAgentResponse(item,agent);onOpenCanvas();onToast(`${result.label} added to Canvas`)}}>{t(hasMessageNode(item.id)?'Added to Canvas':'Add to Canvas')}</button><button>{t('Copy')}</button></div>}</article>)}
      {runState==='thinking'&&<div className="thinking-row"><span/><span/><span/> {t('Thinking')}...</div>}
      {runState==='error'&&<div className="chat-error"><b>Could not finish this response.</b><span>This is a simulated error state. Send another message to retry.</span></div>}
    </div>}

    {tab==='sessions'&&<div className="chat-body chat-tab-body">
      <div className="chat-tab-heading sessions-heading"><div><b>{t('Sessions')}</b><span>{agentSessions.length} {locale==='pt-BR'?'conversas independentes':'independent conversations'}</span></div><button className="soft-button" onClick={startSession}><Icon name="plus"/>{t('New')}</button></div>
      <div className="panel-sessions">{agentSessions.map((session)=><article className={`panel-session ${activeSession?.id===session.id?'active':''}`} key={session.id}>
        {editingSessionId===session.id?<input className="session-rename" autoFocus value={renameValue} onChange={(event)=>setRenameValue(event.target.value)} onBlur={finishRename} onKeyDown={(event)=>{if(event.key==='Enter')finishRename();if(event.key==='Escape')setEditingSessionId(null)}}/>:<button className="panel-session-main" onClick={()=>{openSession(agent.id,session.id);setTab('chat')}}><span><b>{session.title}</b><small>{countMessages(session.messages.length,locale)} · {formatSessionDate(session.updatedAt,locale)}</small></span>{activeSession?.id===session.id&&<i>{t('Active')}</i>}</button>}
        {editingSessionId!==session.id&&<div className="session-actions">{confirmDeleteId===session.id?<><button onClick={()=>setConfirmDeleteId(null)}>{t('Cancel')}</button><button className="danger" onClick={()=>{deleteSession(session.id);setConfirmDeleteId(null)}}>{t('Confirm')}</button></>:<><button aria-label={`${t('Rename')} ${session.title}`} onClick={()=>beginRename(session.id,session.title)}>{t('Rename')}</button><button aria-label={`${t('Delete')} ${session.title}`} onClick={()=>{setConfirmDeleteId(session.id);setEditingSessionId(null)}}>{t('Delete')}</button></>}</div>}
      </article>)}</div>
    </div>}

    {tab==='context'&&<div className="chat-body chat-tab-body"><div className="chat-tab-heading"><b>{t('Agent context')}</b><span>{t('Local agent configuration')}</span></div><div className="context-block"><span>{t('Instructions')}</span><p>{agent.instructions}</p></div><div className="context-block"><span>{t('Workspace')}</span><p>{getWorkspaceById(agent.workspaceId)?.name ?? agent.workspaceId}</p></div><div className="context-block"><span>{t('Tools')}</span><div className="context-tools">{agent.tools.map((tool)=><i key={tool}>{t(agentToolDetails[tool].label)}</i>)}</div></div>{agent.skillsDirectory&&<div className="context-block"><span>{t('Skills')}</span><p>{agent.skillsDirectory}</p><div className="context-tools">{(agent.skills??[]).map((skill)=><i key={skill}>{skill}</i>)}</div></div>}<div className="context-note"><Icon name="link"/>{t('Canvas context will include selected objects when Codex is connected.')}</div></div>}

    {tab==='chat'&&<footer className="chat-compose"><div className="composer">{contextNodes.length>0&&<div className="composer-context"><span>{t('Context')}</span><div>{contextNodes.map((context)=><button key={context.nodeId} aria-label={`Remove ${context.label} from context`} onClick={()=>removeNodeFromAgentContext(agent.id,context.nodeId)}>{context.label}<b aria-hidden="true">×</b></button>)}</div></div>}<textarea ref={composerRef} value={message} disabled={busy} onChange={(event)=>setMessage(event.target.value)} onKeyDown={onKeyDown} aria-label={`Ask ${agent.name}`} placeholder={busy?`${agent.name} is working…`:locale==='pt-BR'?`Pergunte algo para ${agent.name}…`:`Ask ${agent.name} something…`}/><div className="composer-bar"><button className="composer-tool">＋</button><button className="composer-tool">{t('Web')}</button><button className="composer-tool">{t('Context')}</button>{busy?<button className="send-button stop" onClick={()=>cancelExecution(activeSession?.id)} aria-label={t('Cancel execution')}>■</button>:<button className="send-button" disabled={!message.trim()} onClick={send} aria-label={t('Send')}>↑</button>}</div></div></footer>}
  </div>;
}

function countMessages(count: number,locale:string): string { return `${count} ${locale==='pt-BR'?(count===1?'item':'itens'):(count===1?'item':'items')}`; }
function formatTime(value: string,locale:string): string { return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function formatSessionDate(value: string,locale:string): string { return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value)); }
