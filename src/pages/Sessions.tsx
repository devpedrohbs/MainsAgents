import { useState } from 'react';
import { useAgents } from '../features/agents/AgentsProvider';
import { useChat } from '../features/chat/ChatProvider';
import { Icon } from '../components/common/Icon';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { SelectMenu } from '../components/common/SelectMenu';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';

export function Sessions({
  onActivateAgent,
  onToast,
  onNewSession,
  onCreateAgent,
}: {
  onActivateAgent: (id: string) => void;
  onToast: (message: string) => void;
  onNewSession: () => void;
  onCreateAgent: () => void;
}) {
  const { agents, getAgentById } = useAgents();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { sessions, openSession, renameSession, deleteSession, getRunState } = useChat();
  const { locale, t } = useLanguage();
  const pt = locale === 'pt-BR';
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const workspaceAgents = agents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const agentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const ordered = sessions
    .filter(
      (session) =>
        agentIds.has(session.agentId) &&
        (agentFilter === 'all' || session.agentId === agentFilter) &&
        [session.title, getAgentById(session.agentId)?.name ?? '']
          .join(' ')
          .toLocaleLowerCase(locale)
          .includes(query.trim().toLocaleLowerCase(locale)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const saveTitle = () => {
    if (editingId && title.trim()) {
      renameSession(editingId, title.trim());
      setEditingId(null);
      onToast(pt ? 'Conversa renomeada' : 'Conversation renamed');
    }
  };
  return (
    <div className="page sessions-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name} / {t('Sessions')}</p>
          <h1>{pt ? 'Conversas do projeto' : 'Project conversations'}</h1>
          <p>
            {pt
              ? 'Retome uma conversa sem perder o contexto. Cada sessão tem seu próprio histórico.'
              : 'Pick up a conversation with its context intact. Each session has its own history.'}
          </p>
        </div>
        <button className="primary-button" onClick={onNewSession}>
          <Icon name="plus" />
          {t('New session')}
        </button>
      </div>
      <div className="collection-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pt ? 'Buscar conversas…' : 'Search conversations…'}
            aria-label={pt ? 'Buscar conversas' : 'Search conversations'}
          />
        </label>
        <SelectMenu
          ariaLabel={pt ? 'Filtrar por agente' : 'Filter by agent'}
          value={agentFilter}
          onChange={setAgentFilter}
          options={[
            { value: 'all', label: pt ? 'Todos os agentes' : 'All agents' },
            ...workspaceAgents.map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
        />
        <span className="result-count" role="status">
          {ordered.length} {pt ? 'conversas' : 'conversations'}
        </span>
      </div>
      {!ordered.length && (
        <section className="work-panel workspace-empty">
          <span className="empty-symbol">
            <Icon name="message" />
          </span>
          <h2>
            {query || agentFilter !== 'all'
              ? t('No results')
              : pt
                ? 'Sua próxima conversa começa aqui'
                : 'Your next conversation starts here'}
          </h2>
          <p>
            {pt
              ? 'Escolha um agente e abra uma sessão para guardar suas ideias e respostas.'
              : 'Choose an agent and open a session to keep your ideas and responses together.'}
          </p>
          {query || agentFilter !== 'all' ? (
            <button
              className="soft-button"
              onClick={() => {
                setQuery('');
                setAgentFilter('all');
              }}
            >
              {pt ? 'Limpar filtros' : 'Clear filters'}
            </button>
          ) : (
            <button className="soft-button" onClick={workspaceAgents.length ? onNewSession : onCreateAgent}>
              {t(workspaceAgents.length ? 'New session' : 'Create agent')}
            </button>
          )}
        </section>
      )}
      <div className="conversation-list">
        {ordered.map((session) => {
          const agent = getAgentById(session.agentId);
          const messages = session.messages.filter((item) => item.type === 'message');
          const last = messages.at(-1);
          const busy = ['thinking', 'searching', 'using-tool'].includes(getRunState(session.id));
          return (
            <article className="conversation-row" key={session.id}>
              <AgentAvatar name={agent?.name ?? t('Deleted agent')} image={agent?.avatarImage} />
              <div className="conversation-main">
                {editingId === session.id ? (
                  <form
                    className="conversation-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveTitle();
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={pt ? 'Título da conversa' : 'Conversation title'}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button className="soft-button" disabled={!title.trim()} type="submit">
                      {t('Save changes')}
                    </button>
                    <button className="soft-button" type="button" onClick={() => setEditingId(null)}>
                      {t('Cancel')}
                    </button>
                  </form>
                ) : (
                  <button
                    className="conversation-open"
                    onClick={() => {
                      openSession(session.agentId, session.id);
                      onActivateAgent(session.agentId);
                    }}
                  >
                    <b>{session.title}</b>
                    <span>
                      {last?.type === 'message'
                        ? last.content
                        : pt
                          ? 'Conversa ainda sem mensagens'
                          : 'No messages yet'}
                    </span>
                    <small>
                      {agent?.name} · {messages.length} {pt ? 'mensagens' : 'messages'} ·{' '}
                      {new Date(session.updatedAt).toLocaleDateString(locale, {
                        month: 'short',
                        day: 'numeric',
                      })}
                      {busy && ` · ${t('Running')}`}
                    </small>
                  </button>
                )}
              </div>
              <div className="conversation-actions">
                {deletingId === session.id ? (
                  <>
                    <span>{pt ? 'Excluir histórico?' : 'Delete history?'}</span>
                    <button className="soft-button" onClick={() => setDeletingId(null)}>
                      {t('Cancel')}
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy}
                      onClick={() => {
                        deleteSession(session.id);
                        setDeletingId(null);
                        onToast(pt ? 'Conversa excluída' : 'Conversation deleted');
                      }}
                    >
                      {t('Delete')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="icon-button"
                      title={`${t('Rename')} ${session.title}`}
                      aria-label={`${t('Rename')} ${session.title}`}
                      onClick={() => {
                        setTitle(session.title);
                        setEditingId(session.id);
                        setDeletingId(null);
                      }}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      title={
                        busy
                          ? pt
                            ? 'Aguarde a resposta terminar'
                            : 'Wait for the response to finish'
                          : t('Delete')
                      }
                      aria-label={`${t('Delete')} ${session.title}`}
                      onClick={() => {
                        setDeletingId(session.id);
                        setEditingId(null);
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
