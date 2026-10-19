import { useState } from 'react';
import { useAgents } from '../features/agents/AgentsProvider';
import { useChat } from '../features/chat/ChatProvider';
import { Icon } from '../components/common/Icon';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { SelectMenu } from '../components/common/SelectMenu';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { useProduction } from '../features/production/ProductionProvider';
import { contentSpaces, effectiveScope, scopeOfSession, type ScopeKey } from '../features/chat/contentScopes';
import { contentBinding, sessionListLabel } from '../features/chat/contentSessions';
import type { AgentSession } from '../features/chat/model/Chat';
import { OrganizeChatDialog } from '../components/chat/OrganizeChatDialog';
import { ContentActionsMenu } from '../components/content/ContentActionsMenu';
import { ContentDeletionDialog } from '../components/content/ContentDeletionDialog';
import { DeletionRefused } from '../features/content/contentDeletion';

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
  const { sessions, openSession, renameSession, deleteSession, getRunState, contentScopes, selectScope } = useChat();
  const { state: editorialState, ready: editorialReady } = useContentWorkflow();
  const { runs, ready: productionReady, error: productionError } = useProduction();
  const { locale, t } = useLanguage();
  const pt = locale === 'pt-BR';
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState<AgentSession | null>(null);
  const [contentToDelete, setContentToDelete] = useState<{ contentId: string; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState<{ sessionId: string; message: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [showQuiet, setShowQuiet] = useState(false);
  const workspaceAgents = agents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const agentIds = new Set(workspaceAgents.map((agent) => agent.id));
  // Same saved selection as the chat panel: choosing a content here opens the chat in that content too.
  const scopeCtx = { workspaceId: currentWorkspaceId, contents: editorialState.contents, runs, pending: !editorialReady || (!productionReady && !productionError) };
  const scope = effectiveScope(contentScopes, scopeCtx);
  const spaces = contentSpaces(sessions, [...agentIds], scopeCtx, pt);
  const currentSpace = spaces.find((space) => space.scope === scope) ?? spaces[0];
  const busySpaces = new Set(sessions.filter((session) => agentIds.has(session.agentId) && ['thinking', 'searching', 'using-tool'].includes(getRunState(session.id))).map((session) => scopeOfSession(session, scopeCtx)));
  const visibleSpaces = spaces.filter((space) => showQuiet || space.kind !== 'content' || space.chats > 0 || space.scope === scope);
  const quietCount = spaces.length - spaces.filter((space) => space.kind !== 'content' || space.chats > 0 || space.scope === scope).length;
  const pick = (next: ScopeKey) => selectScope(currentWorkspaceId, next);
  const ordered = sessions
    .filter(
      (session) =>
        agentIds.has(session.agentId) &&
        scopeOfSession(session, scopeCtx) === scope &&
        (agentFilter === 'all' || session.agentId === agentFilter) &&
        [session.title, getAgentById(session.agentId)?.name ?? '']
          .join(' ')
          .toLocaleLowerCase(locale)
          .includes(query.trim().toLocaleLowerCase(locale)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const projectSessions = sessions.filter((session) => agentIds.has(session.agentId));
  const runningCount = projectSessions.filter((session) => ['thinking', 'searching', 'using-tool'].includes(getRunState(session.id))).length;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const weekMessages = projectSessions.reduce(
    (total, session) => total + session.messages.filter((item) => item.type === 'message' && new Date(item.createdAt ?? session.updatedAt).getTime() >= weekAgo).length,
    0,
  );
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
      <div className="sessions-stats">
        {[
          { label: pt ? 'Conversas no projeto' : 'Project conversations', value: projectSessions.length, icon: 'message' as const },
          { label: pt ? 'Em execução agora' : 'Running now', value: runningCount, icon: 'history' as const },
          { label: pt ? 'Mensagens esta semana' : 'Messages this week', value: weekMessages, icon: 'edit' as const },
        ].map((stat) => (
          <div className="sessions-stat" key={stat.label}>
            <span className="sessions-stat-icon"><Icon name={stat.icon} /></span>
            <div><strong>{stat.value}</strong><span>{stat.label}</span></div>
          </div>
        ))}
      </div>
      <section className="content-spaces" aria-labelledby="content-spaces-heading">
        <div className="content-spaces-head">
          <h2 id="content-spaces-heading">{pt ? 'Espaços de conteúdo' : 'Content spaces'}</h2>
          <p>{pt ? 'Cada vídeo tem seu espaço: as conversas de todos os agentes sobre ele ficam juntas e separadas dos outros. Geral guarda ideias soltas.' : 'Each video has its own space: every agent’s chats about it stay together and apart from the others. General keeps loose ideas.'}</p>
        </div>
        <div className="content-space-grid" role="group" aria-label={pt ? 'Escolher espaço' : 'Choose space'}>
          {visibleSpaces.map((space) => (
            <div className="content-space-cell" key={space.scope}>
            <button
              type="button"
              className={`content-space-box kind-${space.kind}`}
              aria-pressed={space.scope === scope}
              onClick={() => pick(space.scope)}
            >
              <span className="content-space-title"><b>{space.title}</b>{busySpaces.has(space.scope) && <i>{t('Running')}</i>}</span>
              <span className="content-space-stage">
                {space.kind === 'general' ? (pt ? 'Ideias sem conteúdo' : 'Ideas without content') : space.kind === 'recovery' ? (pt ? 'Vínculo inválido · nada foi apagado' : 'Invalid link · nothing was deleted') : space.stage}
              </span>
              <small>
                {space.chats} {pt ? (space.chats === 1 ? 'conversa' : 'conversas') : space.chats === 1 ? 'chat' : 'chats'}
                {space.agents.length > 0 && ` · ${space.agents.map((item) => getAgentById(item.agentId)?.name ?? t('Deleted agent')).join(', ')}`}
                {space.lastActivity && ` · ${new Date(space.lastActivity).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`}
              </small>
            </button>
            {space.kind === 'content' && space.content && (
              <ContentActionsMenu title={space.title} pt={pt} disabled={!editorialReady} onDelete={() => setContentToDelete({ contentId: space.content!.id, title: space.title })} />
            )}
            </div>
          ))}
        </div>
        {quietCount > 0 && (
          <button type="button" className="text-link content-spaces-more" aria-expanded={showQuiet} onClick={() => setShowQuiet(!showQuiet)}>
            {showQuiet ? (pt ? 'Ocultar conteúdos sem conversa' : 'Hide contents without chats') : pt ? `Mostrar ${quietCount} conteúdos sem conversa` : `Show ${quietCount} contents without chats`}
          </button>
        )}
      </section>
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
          {ordered.length} {pt ? 'conversas em' : 'conversations in'} {currentSpace?.title}
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
              : currentSpace?.kind === 'content'
                ? pt ? `Nenhuma conversa sobre “${currentSpace.title}” ainda` : `No chats about “${currentSpace.title}” yet`
                : currentSpace?.kind === 'recovery'
                  ? pt ? 'Nada precisa de atenção' : 'Nothing needs attention'
                  : pt
                    ? 'Sua próxima conversa começa aqui'
                    : 'Your next conversation starts here'}
          </h2>
          <p>
            {currentSpace?.kind === 'content'
              ? pt ? 'Escolha um agente: a conversa nova já nasce dentro deste conteúdo.' : 'Choose an agent: the new chat starts inside this content.'
              : pt
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
      {!!ordered.length && (
        <div className="conversation-table-head" aria-hidden="true">
          <span>{pt ? 'Conversa' : 'Conversation'}</span>
          <span>{pt ? 'Agente' : 'Agent'}</span>
          <span>{pt ? 'Provedor' : 'Provider'}</span>
          <span>Msgs</span>
          <span>{pt ? 'Atualizada' : 'Updated'}</span>
          <span>Status</span>
          <span />
        </div>
      )}
      <div className="conversation-list">
        {ordered.map((session) => {
          const agent = getAgentById(session.agentId);
          const messages = session.messages.filter((item) => item.type === 'message');
          const last = messages.at(-1);
          const busy = ['thinking', 'searching', 'using-tool'].includes(getRunState(session.id));
          return (
            <article className="conversation-row" key={session.id}>
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
                    {(() => { const label = sessionListLabel(contentBinding(session, scopeCtx), pt); return label && <em className="conversation-scope">{label}</em>; })()}
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
              <div className="conversation-agent">
                <AgentAvatar name={agent?.name ?? t('Deleted agent')} image={agent?.avatarImage} />
                <span>{agent?.name ?? t('Deleted agent')}</span>
              </div>
              <span className="conversation-provider">
                {agent?.providerId === 'claude' ? 'Claude' : agent?.providerId === 'gemini' ? 'Gemini' : 'Codex'}
              </span>
              <span className="conversation-count">{messages.length}</span>
              <span className="conversation-date">
                {new Date(session.updatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
              </span>
              <span className={`conversation-status${busy ? ' running' : ''}`}>
                {busy ? t('Running') : pt ? 'Ociosa' : 'Idle'}
              </span>
              <div className="conversation-actions">
                {deletingId === session.id ? ((() => {
                  const role = runs.find((run) => [run.sourceSession.id, run.editorSession.id, run.publisherSession?.id].includes(session.id));
                  if (role) return (
                    <>
                      <span className="session-role-note">{pt ? 'Conduz a produção deste conteúdo: exclua o conteúdo inteiro.' : 'Conducts this content’s production: delete the whole content.'}</span>
                      <button className="soft-button" onClick={() => setDeletingId(null)}>{t('Cancel')}</button>
                      <button className="danger-button" onClick={() => { setDeletingId(null); setContentToDelete({ contentId: role.contentId, title: editorialState.contents.find((item) => item.id === role.contentId)?.title ?? role.name }); }}>
                        {pt ? 'Excluir conteúdo inteiro…' : 'Delete whole content…'}
                      </button>
                    </>
                  );
                  return (
                  <>
                    <span>{pt ? 'Excluir histórico?' : 'Delete history?'}</span>
                    {deleteError?.sessionId === session.id && <span role="alert" className="session-role-note">{deleteError.message}</span>}
                    <button className="soft-button" disabled={pendingDelete === session.id} onClick={() => { setDeletingId(null); setDeleteError(null); }}>
                      {t('Cancel')}
                    </button>
                    <button
                      className="danger-button"
                      disabled={busy || pendingDelete === session.id}
                      aria-busy={pendingDelete === session.id}
                      onClick={() => {
                        setPendingDelete(session.id); setDeleteError(null);
                        // Announced only after the host confirmed the removal; a refusal stays here with its reason.
                        deleteSession(session.id).then(() => { setDeletingId(null); onToast(pt ? 'Conversa excluída' : 'Conversation deleted'); }, (error) => {
                          if (error instanceof DeletionRefused && error.code === 'production-role' && error.contentId) { setDeletingId(null); setContentToDelete({ contentId: error.contentId, title: editorialState.contents.find((item) => item.id === error.contentId)?.title ?? session.title }); return; }
                          setDeleteError({ sessionId: session.id, message: error instanceof Error ? error.message : String(error) });
                        }).finally(() => setPendingDelete(null));
                      }}
                    >
                      {pendingDelete === session.id ? (pt ? 'Excluindo…' : 'Deleting…') : t('Delete')}
                    </button>
                  </>
                  );
                })()
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
                    {!session.contentId && (
                      <button
                        className="soft-button conversation-organize"
                        title={pt ? 'Mover esta conversa para um conteúdo' : 'Move this chat into a content'}
                        aria-label={pt ? `Organizar ${session.title} em um conteúdo` : `Organize ${session.title} into a content`}
                        onClick={() => setOrganizing(session)}
                      >
                        {pt ? 'Organizar' : 'Organize'}
                      </button>
                    )}
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
      {organizing && (
        <OrganizeChatDialog
          session={organizing}
          pt={pt}
          onClose={() => setOrganizing(null)}
          onDone={(content, count) => {
            setOrganizing(null);
            onToast(pt ? `${count} ${count === 1 ? 'conversa organizada' : 'conversas organizadas'} em “${content.title}”` : `${count} chat(s) organized into “${content.title}”`);
          }}
          onFreshChat={(content) => {
            setOrganizing(null);
            pick(`content:${content.id}`);
            onNewSession();
          }}
        />
      )}
      {contentToDelete && (
        <ContentDeletionDialog
          contentId={contentToDelete.contentId}
          workspaceId={currentWorkspaceId}
          fallbackTitle={contentToDelete.title}
          pt={pt}
          onClose={() => setContentToDelete(null)}
          onDeleted={({ title, chats }) => {
            setContentToDelete(null);
            pick('general');
            const message = pt ? `“${title}” e ${chats} ${chats === 1 ? 'conversa excluídos' : 'conversas excluídos'} deste computador` : `“${title}” and ${chats} ${chats === 1 ? 'chat' : 'chats'} deleted from this computer`;
            setAnnouncement(message); onToast(message);
            // The content box is gone: focus moves to the General box (now selected).
            window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.content-space-box.kind-general')?.focus());
          }}
        />
      )}
      <p className="content-deletion-status" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
}
