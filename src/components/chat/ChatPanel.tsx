import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import { agentStatusLabels, agentToolDetails, getAgentInitials } from '../../features/agents/model/Agent';
import { useChat } from '../../features/chat/ChatProvider';
import type { ChatRunState, ReasoningEffort } from '../../features/chat/model/Chat';
import { Icon } from '../common/Icon';
import { useCanvas } from '../canvas/CanvasProvider';
import { useWorkspaces } from '../../app/WorkspaceProvider';
import { useLanguage } from '../../app/LanguageProvider';
import { AgentAvatar } from '../agents/AgentAvatar';
import type { ProviderId, ProviderConnectionState } from '../../features/chat/AiProvider';
import { sessionProviderId } from '../../features/chat/AiProvider';
import { SelectMenu } from '../common/SelectMenu';
import { readChatDraft, writeChatDraft } from '../../features/chat/chatDrafts';
import { matchingSkills, slashSkillQuery, typedSkillCommand } from '../../features/chat/skillCommands';
import { useAgents } from '../../features/agents/AgentsProvider';

type ChatTab = 'chat' | 'sessions' | 'context';
const stateLabels: Record<ChatRunState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  searching: 'Searching',
  'using-tool': 'Tool usage',
  finished: 'Finished',
  error: 'Error',
};
const tabLabels: Record<ChatTab, string> = { chat: 'Chat', sessions: 'Sessions', context: 'Context' };

interface ChatPanelProps {
  onSelectAgent: (agentId: string) => void;
  agent: Agent;
  onNavigateHistory: () => void;
  onNavigateSettings: () => void;
  onProviderSettings: () => void;
  onOpenCanvas: () => void;
  onToast: (message: string) => void;
  presentation: 'side' | 'floating';
  onTogglePresentation: () => void;
  onClose: () => void;
}

export function ChatPanel({
  onSelectAgent,
  agent,
  onNavigateHistory,
  onNavigateSettings,
  onProviderSettings,
  onOpenCanvas,
  onToast,
  presentation,
  onTogglePresentation,
  onClose,
}: ChatPanelProps) {
  const { getWorkspaceById } = useWorkspaces();
  const { agents } = useAgents();
  const { locale, t, reducedMotion } = useLanguage();
  const [message, setMessage] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillsPickerOpen, setSkillsPickerOpen] = useState(false);
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const [tab, setTab] = useState<ChatTab>('chat');
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const composerOptionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setComposerOptionsOpen(false);
    setSkillsPickerOpen(false);
  }, [agent.id]);
  useEffect(() => {
    if (!composerOptionsOpen) return;
    const close = (event: PointerEvent) => {
      if (!composerOptionsRef.current?.contains(event.target as Node)) setComposerOptionsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [composerOptionsOpen]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnectionState | 'checking'>('checking');
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const followLatestRef = useRef(true);
  const {
    getAgentSessions,
    getActiveSession,
    getRunState,
    createSession,
    openSession,
    renameSession,
    deleteSession,
    sendMessage,
    cancelExecution,
    listModels,
    getProviderStatus,
    setSessionModel,
    setSessionReasoningEffort,
  } = useChat();
  const { addAgentResponse, hasMessageNode, getAgentContext, removeNodeFromAgentContext, clearAgentContext } =
    useCanvas();
  const agentSessions = getAgentSessions(agent.id);
  const activeSession = getActiveSession(agent.id);
  const lastMessage = activeSession?.messages[activeSession.messages.length - 1];
  const lastMessageContent = lastMessage?.type === 'message' ? lastMessage.content : undefined;
  const lastRunError = activeSession?.messages
    .slice()
    .reverse()
    .find((item) => item.type === 'activity' && item.status === 'error');
  const contextNodes = getAgentContext(agent.id);
  const runState = getRunState(activeSession?.id);
  const busy = runState === 'thinking' || runState === 'searching' || runState === 'using-tool';
  const providerId: ProviderId = activeSession
    ? sessionProviderId(activeSession)
    : (agent.providerId ?? 'codex');
  const selectedModelId = activeSession?.modelId ?? '';
  const selectedEffort: ReasoningEffort = activeSession?.reasoningEffort ?? 'medium';
  const slashQuery = slashSkillQuery(message);
  const skillMenuOpen = (skillsPickerOpen || slashQuery !== null) && !busy;
  const skillChoices = skillMenuOpen ? matchingSkills(agent.skills ?? [], slashQuery ?? '') : [];

  useEffect(() => {
    let mounted = true;
    setConnection('checking');
    const check = async () => {
      try {
        const status = await getProviderStatus(providerId);
        if (mounted) setConnection(status.state);
      } catch {
        if (mounted) setConnection('error');
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener('focus', check);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [getProviderStatus, providerId]);
  useEffect(() => {
    let active = true;
    setModels([]);
    setModelsLoading(true);
    void listModels(providerId)
      .then((items) => {
        if (active) setModels(items);
      })
      .catch(() => {
        if (active) setModels([]);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [agent.id, listModels, providerId]);

  useEffect(() => {
    setEditingSessionId(null);
    setConfirmDeleteId(null);
    setSkillMenuIndex(0);
    setTab('chat');
  }, [agent.id]);

  useEffect(() => {
    const draft = readChatDraft(agent.id, activeSession?.id);
    setMessage(draft.text);
    setSelectedSkill(draft.skill);
    setShowLatest(false);
    setSkillMenuIndex(0);
  }, [agent.id, activeSession?.id]);
  const updateDraft = (text: string, skill: string | null = selectedSkill) => {
    setMessage(text);
    setSelectedSkill(skill);
    writeChatDraft(agent.id, activeSession?.id, { text, skill });
  };
  const ensureSession = () => {
    if (activeSession) return activeSession;
    const session = createSession(agent.id, undefined, providerId, agent.modelId);
    writeChatDraft(agent.id, session.id, { text: message, skill: selectedSkill });
    writeChatDraft(agent.id, undefined, { text: '', skill: null });
    return session;
  };
  useEffect(() => {
    if (selectedSkill && !agent.skills?.includes(selectedSkill)) setSelectedSkill(null);
  }, [agent.skills, selectedSkill]);

  useEffect(() => {
    followLatestRef.current = true;
    if (tab === 'chat')
      requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }));
  }, [activeSession?.id]);

  useEffect(() => {
    if (tab === 'chat' && followLatestRef.current)
      requestAnimationFrame(() =>
        bodyRef.current?.scrollTo({
          top: bodyRef.current.scrollHeight,
          behavior: reducedMotion ? 'instant' : 'smooth',
        }),
      );
  }, [activeSession?.id, activeSession?.messages.length, lastMessageContent, tab, reducedMotion]);

  useEffect(() => {
    if (contextNodes.length) {
      setTab('chat');
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [contextNodes.length]);

  const startSession = () => {
    createSession(agent.id, undefined, agent.providerId ?? 'codex', agent.modelId);
    setTab('chat');
    setMessage('');
    onToast(locale === 'pt-BR' ? `Nova conversa com ${agent.name}` : `New conversation with ${agent.name}`);
  };

  const changeModel = (modelId: string) => setSessionModel(ensureSession().id, modelId || undefined);
  const changeEffort = (effort: string) =>
    setSessionReasoningEffort(ensureSession().id, effort as ReasoningEffort);
  const chooseSkill = (skill: string) => {
    updateDraft(skillsPickerOpen ? message : '', skill);
    setSkillsPickerOpen(false);
    setSkillMenuIndex(0);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const send = () => {
    if (busy || connection !== 'connected') return;
    const typed = selectedSkill ? null : typedSkillCommand(message, agent.skills ?? []);
    const skill = selectedSkill ?? typed?.skill;
    const content = typed ? typed.content : message.trim();
    if (!content) {
      if (typed) chooseSkill(typed.skill);
      return;
    }
    sendMessage(agent, content, contextNodes, undefined, skill ?? undefined);
    clearAgentContext(agent.id);
    updateDraft('', null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (skillMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSkillMenuIndex((index) => (skillChoices.length ? (index + 1) % skillChoices.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSkillMenuIndex((index) =>
          skillChoices.length ? (index - 1 + skillChoices.length) % skillChoices.length : 0,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (skillChoices[skillMenuIndex]) chooseSkill(skillChoices[skillMenuIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (skillsPickerOpen) setSkillsPickerOpen(false);
        else updateDraft('');
        return;
      }
    }
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

  return (
    <div className="chat-panel editorial-chat">
      <div className="chat-top">
        <header className="chat-head">
          <span className="conversation-avatar" title={`${agent.role} · ${t(agentStatusLabels[agent.status])}`}><AgentAvatar name={agent.name} image={agent.avatarImage} /></span>
          <SelectMenu className="conversation-agent-picker" value={agent.id} onChange={onSelectAgent} ariaLabel={locale==='pt-BR'?'Conversar com':'Chat with'} options={agents.filter(item=>item.workspaceId===agent.workspaceId).map(item=>({value:item.id,label:item.name}))}/>
          <div className="chat-head-actions">
            <details className="conversation-options" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary aria-label={locale==='pt-BR'?'Opções da conversa':'Conversation options'} title={locale==='pt-BR'?'Opções da conversa':'Conversation options'}><Icon name="more"/></summary><div>
            <button
              className="icon-button"
              aria-label={t('New session')}
              title={t('New session')}
              onClick={startSession}
            >
              <Icon name="plus" />
            </button>
            <button
              className="icon-button"
              aria-label={locale === 'pt-BR' ? 'Abrir todas as sessões' : 'Open all sessions'}
              title={locale === 'pt-BR' ? 'Abrir todas as sessões' : 'Open all sessions'}
              onClick={onNavigateHistory}
            >
              <Icon name="history" />
            </button>
            <button className="icon-button" title={locale==='pt-BR'?'Sessões deste agente':'Agent sessions'} onClick={()=>setTab('sessions')}><Icon name="history"/></button>
            <button className="icon-button" title={t('Context')} onClick={()=>setTab('context')}><Icon name="folder"/></button>
            <button
              className="icon-button"
              aria-label={t('Agent settings')}
              title={t('Agent settings')}
              onClick={onNavigateSettings}
            >
              <Icon name="more" />
            </button>
            <button
              className="chat-expand-button"
              aria-label={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')}
              title={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')}
              onClick={onTogglePresentation}
            >
              <Icon name="panel" />
              <span>{t(presentation === 'side' ? 'Full view' : 'Dock')}</span>
            </button>
            </div></details>
            <button className="icon-button conversation-expand" aria-label={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')} title={t(presentation === 'side' ? 'Open chat in center' : 'Dock chat to side')} onClick={onTogglePresentation}><Icon name="panel"/></button>
            <button
              className="icon-button"
              aria-label={t('Close chat')}
              title={t('Close chat')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <nav className="chat-tabs" hidden={tab==='chat'} aria-label={`${agent.name} panel`}>
          {(['chat', 'sessions', 'context'] as ChatTab[]).map((item) => (
            <button
              key={item}
              className={tab === item ? 'active' : ''}
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {t(tabLabels[item])}
            </button>
          ))}
          <span className={`run-state ${runState}`}>
            <i />
            {t(stateLabels[runState])}
          </span>
        </nav>
      </div>

      {tab === 'chat' && (
        <div
          className="chat-body"
          ref={bodyRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72;
            setShowLatest(!followLatestRef.current);
          }}
        >
          {activeSession && (
            <div className="active-session-bar">
              <span>{activeSession.title}</span>
              <button onClick={() => setTab('sessions')}>{t('All sessions')}</button>
            </div>
          )}
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="chat-empty">
              <AgentAvatar name={agent.name} image={agent.avatarImage} />
              <h3>
                {locale === 'pt-BR'
                  ? 'O que vamos criar?'
                  : 'What shall we create?'}
              </h3>
              <p>{agent.description || (locale==='pt-BR'?'Envie uma ideia, peça uma pesquisa ou traga referências do Canvas.':'Share an idea, ask for research, or bring references from the Canvas.')}</p>
            </div>
          )}
          {activeSession?.messages.map((item) =>
            item.type === 'activity' ? (
              <div className={`tool-activity ${item.status}`} key={item.id}>
                <span className="activity-symbol" aria-hidden="true">{item.status==='done'?'✓':item.status==='error'?'!':<Icon name="spark"/>}</span>
                <span>{item.label}</span>
              </div>
            ) : (
              <article className={`chat-message ${item.role === 'user' ? 'user' : ''}`} key={item.id}>
                <div className="message-meta">
                  <b>{item.role === 'user' ? t('You') : agent.name}</b>
                  <span>{formatTime(item.createdAt, locale)}</span>
                </div>
                <p className="message-content">{item.content}</p>
                {item.selectedSkill && (
                  <div className="message-skill-used">
                    <span>/</span>
                    {item.selectedSkill}
                  </div>
                )}
                {item.contextNodes && item.contextNodes.length > 0 && (
                  <div className="message-context-used">
                    <span>{locale === 'pt-BR' ? 'Contexto usado' : 'Used context'}</span>
                    <div>
                      {item.contextNodes.map((context) => (
                        <i key={context.nodeId}>{context.label}</i>
                      ))}
                    </div>
                  </div>
                )}
                {item.role === 'agent' && (
                  <div className="message-actions">
                    <button
                      disabled={hasMessageNode(item.id)}
                      onClick={() => {
                        const result = addAgentResponse(item, agent);
                        onOpenCanvas();
                        onToast(
                          locale === 'pt-BR'
                            ? `${result.label} adicionado ao Canvas`
                            : `${result.label} added to Canvas`,
                        );
                      }}
                    >
                      {t(hasMessageNode(item.id) ? 'Added to Canvas' : 'Add to Canvas')}
                    </button>
                    <button
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(item.content)
                          .then(() => onToast(t('Copied to clipboard')))
                          .catch(() => onToast(t('Could not copy message')));
                      }}
                    >
                      {t('Copy')}
                    </button>
                  </div>
                )}
              </article>
            ),
          )}
          {runState === 'thinking' && (
            <div className="thinking-row">
              <Icon name="spark"/> {t('Thinking')}…
            </div>
          )}
          {runState === 'error' && (
            <div className="chat-error" role="alert">
              <b>{t('Could not finish this response.')}</b>
              <span>
                {lastRunError?.type === 'activity'
                  ? lastRunError.label
                  : t('Check the provider connection and send another message to retry.')}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === 'sessions' && (
        <div className="chat-body chat-tab-body">
          <div className="chat-tab-heading sessions-heading">
            <div>
              <b>{t('Sessions')}</b>
              <span>
                {agentSessions.length}{' '}
                {locale === 'pt-BR' ? 'conversas independentes' : 'independent conversations'}
              </span>
            </div>
            <button className="soft-button" onClick={startSession}>
              <Icon name="plus" />
              {t('New')}
            </button>
          </div>
          <div className="panel-sessions">
            {agentSessions.map((session) => (
              <article
                className={`panel-session ${activeSession?.id === session.id ? 'active' : ''}`}
                key={session.id}
              >
                {editingSessionId === session.id ? (
                  <input
                    className="session-rename"
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') finishRename();
                      if (event.key === 'Escape') setEditingSessionId(null);
                    }}
                  />
                ) : (
                  <button
                    className="panel-session-main"
                    onClick={() => {
                      openSession(agent.id, session.id);
                      setTab('chat');
                    }}
                  >
                    <span>
                      <b>{session.title}</b>
                      <small>
                        {countMessages(session.messages.length, locale)} ·{' '}
                        {formatSessionDate(session.updatedAt, locale)}
                      </small>
                    </span>
                    {activeSession?.id === session.id && <i>{t('Active')}</i>}
                  </button>
                )}
                {editingSessionId !== session.id && (
                  <div className="session-actions">
                    {confirmDeleteId === session.id ? (
                      <>
                        <button onClick={() => setConfirmDeleteId(null)}>{t('Cancel')}</button>
                        <button
                          className="danger"
                          onClick={() => {
                            deleteSession(session.id);
                            setConfirmDeleteId(null);
                          }}
                        >
                          {t('Confirm')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          aria-label={`${t('Rename')} ${session.title}`}
                          onClick={() => beginRename(session.id, session.title)}
                        >
                          {t('Rename')}
                        </button>
                        <button
                          aria-label={`${t('Delete')} ${session.title}`}
                          onClick={() => {
                            setConfirmDeleteId(session.id);
                            setEditingSessionId(null);
                          }}
                        >
                          {t('Delete')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === 'context' && (
        <div className="chat-body chat-tab-body">
          <div className="chat-tab-heading">
            <b>{t('Agent context')}</b>
            <span>{t('Local agent configuration')}</span>
          </div>
          <div className="context-block">
            <span>{t('Instructions')}</span>
            <p>{agent.instructions}</p>
          </div>
          <div className="context-block">
            <span>{t('Workspace')}</span>
            <p>{getWorkspaceById(agent.workspaceId)?.name ?? agent.workspaceId}</p>
          </div>
          <div className="context-block">
            <span>{t('Tools')}</span>
            <div className="context-tools">
              {agent.tools.map((tool) => (
                <i key={tool}>{t(agentToolDetails[tool].label)}</i>
              ))}
            </div>
          </div>
          {agent.skillsDirectory && (
            <div className="context-block">
              <span>{t('Skills')}</span>
              <p>{agent.skillsDirectory}</p>
              <div className="context-tools">
                {(agent.skills ?? []).map((skill) => (
                  <i key={skill}>{skill}</i>
                ))}
              </div>
            </div>
          )}
          <div className="context-note">
            <Icon name="link" />
            {t('Canvas context will include selected objects when Codex is connected.')}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <footer className="chat-compose">
          {connection !== 'connected' && (
            <div className="composer-connection" role="status">
              <span>
                {connection === 'checking'
                  ? t('Checking connection…')
                  : locale === 'pt-BR'
                    ? `Conecte ${providerId === 'claude' ? 'Claude Code' : providerId === 'codex' ? 'Codex CLI' : 'Gemini'} para enviar mensagens.`
                    : `Connect ${providerId === 'claude' ? 'Claude Code' : providerId === 'codex' ? 'Codex CLI' : 'Gemini'} to send messages.`}
              </span>
              {connection !== 'checking' && (
                <button className="text-link" onClick={onProviderSettings}>
                  {locale === 'pt-BR' ? 'Abrir conexões' : 'Open connections'}
                </button>
              )}
            </div>
          )}
          {showLatest && (
            <button
              className="latest-message-button soft-button"
              onClick={() => {
                followLatestRef.current = true;
                setShowLatest(false);
                bodyRef.current?.scrollTo({
                  top: bodyRef.current.scrollHeight,
                  behavior: reducedMotion ? 'instant' : 'smooth',
                });
              }}
            >
              {locale === 'pt-BR' ? 'Ir para a última mensagem' : 'Jump to latest message'} ↓
            </button>
          )}
          <div className="composer">
            {skillMenuOpen && (
              <div
                className="skill-command-menu"
                id="agent-skill-menu"
                role="listbox"
                aria-label={locale === 'pt-BR' ? 'Skills deste agente' : 'This agent’s skills'}
              >
                <div className="skill-command-heading">
                  <span>{locale === 'pt-BR' ? 'Skills do agente' : 'Agent skills'}</span>
                  <small>
                    {locale === 'pt-BR' ? '↑↓ navegar · Enter selecionar' : '↑↓ navigate · Enter select'}
                  </small>
                </div>
                {skillChoices.length ? (
                  skillChoices.map((skill, index) => (
                    <button
                      id={'skill-option-' + index}
                      key={skill}
                      type="button"
                      role="option"
                      aria-selected={index === skillMenuIndex}
                      className={index === skillMenuIndex ? 'active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSkill(skill)}
                    >
                      <span className="skill-command-symbol">/</span>
                      <span>{skill}</span>
                    </button>
                  ))
                ) : (
                  <div className="skill-command-empty">
                    {agent.skills?.length
                      ? locale === 'pt-BR'
                        ? 'Nenhuma skill corresponde à busca.'
                        : 'No matching skill.'
                      : locale === 'pt-BR'
                        ? 'Este agente ainda não tem skills vinculadas.'
                        : 'This agent has no associated skills yet.'}
                    <button type="button" onClick={onNavigateSettings}>
                      {locale === 'pt-BR' ? 'Gerenciar skills' : 'Manage skills'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {selectedSkill && (
              <div className="composer-selected-skill">
                <span>{locale === 'pt-BR' ? 'Usar skill' : 'Use skill'}</span>
                <button
                  type="button"
                  onClick={() => {
                    updateDraft(message, null);
                    composerRef.current?.focus();
                  }}
                  aria-label={
                    locale === 'pt-BR'
                      ? 'Remover skill ' + selectedSkill + ' da mensagem'
                      : 'Remove skill ' + selectedSkill + ' from message'
                  }
                >
                  /{selectedSkill}
                  <b aria-hidden="true">×</b>
                </button>
              </div>
            )}
            {contextNodes.length > 0 && (
              <div className="composer-context">
                <span>{t('Context')}</span>
                <div>
                  {contextNodes.map((context) => (
                    <button
                      key={context.nodeId}
                      aria-label={
                        locale === 'pt-BR'
                          ? `Remover ${context.label} do contexto`
                          : `Remove ${context.label} from context`
                      }
                      onClick={() => removeNodeFromAgentContext(agent.id, context.nodeId)}
                    >
                      {context.label}
                      <b aria-hidden="true">×</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              ref={composerRef}
              value={message}
              disabled={busy}
              onChange={(event) => {
                updateDraft(event.target.value);
                setSkillMenuIndex(0);
              }}
              onKeyDown={onKeyDown}
              aria-haspopup="listbox"
              aria-expanded={skillMenuOpen}
              aria-controls={skillMenuOpen ? 'agent-skill-menu' : undefined}
              aria-activedescendant={
                skillMenuOpen && skillChoices.length ? 'skill-option-' + skillMenuIndex : undefined
              }
              aria-label={locale === 'pt-BR' ? `Pergunte para ${agent.name}` : `Ask ${agent.name}`}
              placeholder={
                busy
                  ? locale==='pt-BR'?'O agente está trabalhando…':'The agent is working…'
                  : locale === 'pt-BR'
                    ? 'O que vamos criar juntos?'
                    : 'What shall we create together?'
              }
            />
            <div className="composer-bar">
              <div className="composer-options-root" ref={composerOptionsRef} onKeyDown={event=>{if(event.key==='Escape'&&composerOptionsOpen){event.preventDefault();setComposerOptionsOpen(false);composerOptionsRef.current?.querySelector<HTMLButtonElement>('.composer-options-trigger')?.focus();}}}>
                <button className="composer-options-trigger" type="button" aria-label={locale==='pt-BR'?'Modelo, esforço e skills':'Model, effort and skills'} aria-expanded={composerOptionsOpen} onClick={()=>setComposerOptionsOpen(open=>!open)}><Icon name="plus"/></button>
                {composerOptionsOpen && <div className="composer-options-popover" aria-label={locale==='pt-BR'?'Opções da mensagem':'Message options'}>
                <h3>{locale==='pt-BR'?'Como o agente responde':'How the agent responds'}</h3>
              <div className="chat-model-picker">
                <span>{t('Model')}</span>
                <SelectMenu
                  className="chat-select model-select"
                  ariaLabel={t('Model')}
                  value={selectedModelId}
                  disabled={busy || modelsLoading || models.length === 0}
                  placement="top"
                  onChange={changeModel}
                  options={[
                    {
                      value: '',
                      label: modelsLoading
                        ? t('Loading models…')
                        : models.length
                          ? t('Provider default')
                          : t('Models unavailable'),
                    },
                    ...(activeSession?.modelId && !models.some((model) => model.id === activeSession.modelId)
                      ? [{ value: activeSession.modelId, label: activeSession.modelId }]
                      : []),
                    ...models.map((model) => ({ value: model.id, label: model.name })),
                  ]}
                />
              </div>
              <div className="chat-effort-picker">
                <span>{locale === 'pt-BR' ? 'Esforço' : 'Effort'}</span>
                <SelectMenu
                  className="chat-select effort-select"
                  ariaLabel={locale === 'pt-BR' ? 'Esforço do modelo' : 'Model effort'}
                  value={selectedEffort}
                  disabled={busy}
                  placement="top"
                  onChange={changeEffort}
                  options={[
                    { value: 'low', label: locale === 'pt-BR' ? 'Leve' : 'Light' },
                    { value: 'medium', label: locale === 'pt-BR' ? 'Médio' : 'Medium' },
                    { value: 'high', label: locale === 'pt-BR' ? 'Alto' : 'High' },
                    { value: 'xhigh', label: locale === 'pt-BR' ? 'Extra alto' : 'Extra High' },
                  ]}
                />
              </div>
                <button className="composer-skill-action" type="button" disabled={busy} onClick={()=>{setComposerOptionsOpen(false);setSkillsPickerOpen(true);composerRef.current?.focus();}}><Icon name="spark"/>{locale==='pt-BR'?'Selecionar uma skill':'Select a skill'}<span>/</span></button>
                <button className="composer-skill-action" type="button" onClick={()=>{setComposerOptionsOpen(false);onOpenCanvas();}}><Icon name="canvas"/>{locale==='pt-BR'?'Escolher contexto no Canvas':'Choose Canvas context'}</button>
                </div>}
              </div>
              <button className="composer-model-summary" type="button" onClick={()=>setComposerOptionsOpen(true)} title={locale==='pt-BR'?'Alterar modelo e esforço':'Change model and effort'}>{models.find(model=>model.id===selectedModelId)?.name || selectedModelId || (providerId==='codex'?'Codex':providerId==='claude'?'Claude':'Gemini')}<span>{selectedEffort==='low'?(locale==='pt-BR'?'Leve':'Light'):selectedEffort==='high'?(locale==='pt-BR'?'Alto':'High'):selectedEffort==='xhigh'?(locale==='pt-BR'?'Extra alto':'Extra High'):(locale==='pt-BR'?'Médio':'Medium')}</span></button>
              {busy ? (
                <button
                  className="send-button stop"
                  onClick={() => cancelExecution(activeSession?.id)}
                  aria-label={t('Cancel execution')}
                >
                  ■
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={!message.trim() || skillMenuOpen || connection !== 'connected'}
                  onClick={send}
                  aria-label={t('Send')}
                >
                  ↑
                </button>
              )}
            </div>
          </div>
          <p className="composer-hint">
            {locale === 'pt-BR'
              ? 'Enter para enviar · Shift + Enter para nova linha · / para skills'
              : 'Enter to send · Shift + Enter for a new line · / for skills'}
          </p>
        </footer>
      )}
    </div>
  );
}

function countMessages(count: number, locale: string): string {
  return `${count} ${locale === 'pt-BR' ? (count === 1 ? 'item' : 'itens') : count === 1 ? 'item' : 'items'}`;
}
function formatTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(value),
  );
}
function formatSessionDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value));
}
