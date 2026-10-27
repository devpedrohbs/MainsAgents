import { useState } from 'react';
import { useAgents } from '../features/agents/AgentsProvider';
import { useChat } from '../features/chat/ChatProvider';
import { Icon } from '../components/common/Icon';
import { AgentAvatar } from '../components/agents/AgentAvatar';
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
  const { currentWorkspaceId } = useWorkspaces();
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const selected = ordered.find((session) => session.id === selectedId) ?? ordered[0];
  const openChat = (session: AgentSession) => { openSession(session.agentId, session.id); onActivateAgent(session.agentId); };
  const providerOf = (agentId: string) => { const agent = getAgentById(agentId); return agent?.providerId === 'claude' ? 'Claude' : agent?.providerId === 'gemini' ? 'Gemini' : 'Codex'; };
  const shortDate = (at: string) => new Date(at).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const renderRow = (session: AgentSession) => {
    const agent = getAgentById(session.agentId);
    const messages = session.messages.filter((item) => item.type === 'message');
    const last = messages.at(-1);
    const busy = ['thinking', 'searching', 'using-tool'].includes(getRunState(session.id));
    const isSelected = selected?.id === session.id;
    return (
      <article className={`conversation-row${isSelected ? ' selected' : ''}`} key={session.id}>
        {editingId === session.id ? (
          <form className="conversation-rename" onSubmit={(event) => { event.preventDefault(); saveTitle(); }}>
            <input autoFocus aria-label={pt ? 'Título da conversa' : 'Conversation title'} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null); }} />
            <button className="soft-button" disabled={!title.trim()} type="submit">{t('Save changes')}</button>
            <button className="soft-button" type="button" onClick={() => setEditingId(null)}>{t('Cancel')}</button>
          </form>
        ) : (
          // One click previews the chat on the right; double click (or "Continuar conversa") opens it.
          <button className="conversation-open" aria-current={isSelected} onClick={() => setSelectedId(session.id)} onDoubleClick={() => openChat(session)}>
            <AgentAvatar name={agent?.name ?? t('Deleted agent')} image={agent?.avatarImage} mascot={agent?.avatarMascot} role={agent?.role} thinking={busy} />
            <span className="conversation-copy">
              <span className="conversation-line"><b>{session.title}</b><small>{busy ? t('Running') : shortDate(session.updatedAt)}</small></span>
              <span className="conversation-snippet">{agent?.name ?? t('Deleted agent')}: {last?.type === 'message' ? last.content : pt ? 'conversa ainda sem mensagens' : 'no messages yet'}</span>
            </span>
          </button>
        )}
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
                <button className="soft-button" disabled={pendingDelete === session.id} onClick={() => { setDeletingId(null); setDeleteError(null); }}>{t('Cancel')}</button>
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
          })()) : (
            <>
              <button className="icon-button conversation-continue" title={pt ? `Abrir ${session.title}` : `Open ${session.title}`} aria-label={pt ? `Abrir conversa ${session.title}` : `Open chat ${session.title}`} onClick={() => openChat(session)}>
                <Icon name="message" />
              </button>
              <button className="icon-button" title={`${t('Rename')} ${session.title}`} aria-label={`${t('Rename')} ${session.title}`} onClick={() => { setTitle(session.title); setEditingId(session.id); setDeletingId(null); }}>
                <Icon name="edit" />
              </button>
              {!session.contentId && (
                <button className="icon-button conversation-organize" title={pt ? 'Mover esta conversa para um conteúdo' : 'Move this chat into a content'} aria-label={pt ? `Organizar ${session.title} em um conteúdo` : `Organize ${session.title} into a content`} onClick={() => setOrganizing(session)}>
                  <Icon name="folder" />
                </button>
              )}
              <button className="icon-button" disabled={busy} title={busy ? (pt ? 'Aguarde a resposta terminar' : 'Wait for the response to finish') : t('Delete')} aria-label={`${t('Delete')} ${session.title}`} onClick={() => { setDeletingId(session.id); setEditingId(null); }}>
                <Icon name="trash" />
              </button>
            </>
          )}
        </div>
      </article>
    );
  };
  const emptyGroup = (
    <div className="hs-empty">
      <b>
        {query || agentFilter !== 'all'
          ? t('No results')
          : currentSpace?.kind === 'content'
            ? pt ? `Nenhuma conversa sobre “${currentSpace.title}” ainda` : `No chats about “${currentSpace.title}” yet`
            : currentSpace?.kind === 'recovery'
              ? pt ? 'Nada precisa de atenção' : 'Nothing needs attention'
              : pt ? 'Sua próxima conversa começa aqui' : 'Your next conversation starts here'}
      </b>
      {query || agentFilter !== 'all'
        ? <button className="soft-button" onClick={() => { setQuery(''); setAgentFilter('all'); }}>{pt ? 'Limpar filtros' : 'Clear filters'}</button>
        : <button className="soft-button" onClick={workspaceAgents.length ? onNewSession : onCreateAgent}>{t(workspaceAgents.length ? 'New session' : 'Create agent')}</button>}
    </div>
  );
  const previewAgent = selected ? getAgentById(selected.agentId) : undefined;
  const previewMessages = selected ? selected.messages.filter((item) => item.type === 'message').slice(-6) : [];
  const previewBusy = selected ? ['thinking', 'searching', 'using-tool'].includes(getRunState(selected.id)) : false;
  return (
    <div className="page sessions-page hs">
      <section className="hs-list" aria-labelledby="history-heading">
        <div className="hs-head">
          <div className="hs-title">
            <div>
              <h1 id="history-heading">{pt ? 'Histórico de conversas' : 'Conversation history'}</h1>
              <p>{[pt ? `${projectSessions.length} conversas` : `${projectSessions.length} chats`, runningCount ? (pt ? `${runningCount} em execução` : `${runningCount} running`) : '', pt ? `${weekMessages} mensagens esta semana` : `${weekMessages} messages this week`].filter(Boolean).join(' · ')}</p>
            </div>
            <button className="icon-button" onClick={onNewSession} title={t('New session')} aria-label={t('New session')}><Icon name="plus" /></button>
          </div>
          <label className="search-field">
            <Icon name="search" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pt ? 'Buscar conversas…' : 'Search conversations…'} aria-label={pt ? 'Buscar conversas' : 'Search conversations'} />
          </label>
          <div className="hs-faces" role="group" aria-label={pt ? 'Filtrar por agente' : 'Filter by agent'}>
            {workspaceAgents.map((agent) => (
              <button key={agent.id} aria-pressed={agentFilter === agent.id} title={agent.name} aria-label={agent.name} onClick={() => setAgentFilter(agentFilter === agent.id ? 'all' : agent.id)} className={agentFilter !== 'all' && agentFilter !== agent.id ? 'dim' : ''}>
                <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} />
              </button>
            ))}
            <span className="result-count" role="status">{ordered.length} {pt ? 'em' : 'in'} {currentSpace?.title}</span>
          </div>
        </div>
        <div className="content-space-grid hs-groups" role="group" aria-label={pt ? 'Escolher espaço' : 'Choose space'}>
          {visibleSpaces.map((space) => {
            const open = space.scope === scope;
            return (
              <div className={`content-space-cell${open ? ' open' : ''}`} key={space.scope}>
                <div className="hs-group-head">
                  <button type="button" className={`content-space-box kind-${space.kind}`} aria-pressed={open} aria-expanded={open} onClick={() => pick(space.scope)}>
                    <i className="hs-dot" aria-hidden="true" />
                    <span className="content-space-title"><b>{space.title}</b>{busySpaces.has(space.scope) && <i>{t('Running')}</i>}</span>
                    <small>
                      {space.kind === 'general' ? (pt ? 'Ideias sem conteúdo' : 'Ideas without content') : space.kind === 'recovery' ? (pt ? 'Vínculo inválido · nada foi apagado' : 'Invalid link · nothing was deleted') : space.stage}
                      {' · '}{space.chats}
                    </small>
                  </button>
                  {space.kind === 'content' && space.content && (
                    <ContentActionsMenu title={space.title} pt={pt} disabled={!editorialReady} onDelete={() => setContentToDelete({ contentId: space.content!.id, title: space.title })} />
                  )}
                </div>
                {open && <div className="conversation-list">{ordered.length ? ordered.map(renderRow) : emptyGroup}</div>}
              </div>
            );
          })}
          {quietCount > 0 && (
            <button type="button" className="text-link content-spaces-more" aria-expanded={showQuiet} onClick={() => setShowQuiet(!showQuiet)}>
              {showQuiet ? (pt ? 'Ocultar conteúdos sem conversa' : 'Hide contents without chats') : pt ? `Mostrar ${quietCount} conteúdos sem conversa` : `Show ${quietCount} contents without chats`}
            </button>
          )}
        </div>
      </section>
      <section className="hs-preview" aria-label={pt ? 'Prévia da conversa' : 'Conversation preview'}>
        {selected ? <>
          <header className="hs-preview-head">
            <AgentAvatar name={previewAgent?.name ?? t('Deleted agent')} image={previewAgent?.avatarImage} mascot={previewAgent?.avatarMascot} role={previewAgent?.role} thinking={previewBusy} />
            <div>
              <b>{selected.title}</b>
              <span>{[previewAgent?.name ?? t('Deleted agent'), providerOf(selected.agentId), `${selected.messages.filter((item) => item.type === 'message').length} ${pt ? 'mensagens' : 'messages'}`, shortDate(selected.updatedAt)].join(' · ')}</span>
            </div>
            <button className="primary-button" onClick={() => openChat(selected)}>{pt ? 'Continuar conversa' : 'Continue chat'}</button>
          </header>
          <div className="hs-chips">
            <span className="hs-scope">{sessionListLabel(contentBinding(selected, scopeCtx), pt) || currentSpace?.title}</span>
            {previewBusy && <span className="hs-running">{t('Running')}</span>}
          </div>
          <div className="hs-thread">
            {previewMessages.length ? previewMessages.map((item) => item.type === 'message' && (
              <div className={`hs-bubble ${item.role === 'user' ? 'user' : 'agent'}`} key={item.id}>
                <small>{item.role === 'user' ? t('You') : item.sourceAgentName ?? previewAgent?.name} · {new Date(item.createdAt ?? selected.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</small>
                <p>{item.content.length > 600 ? item.content.slice(0, 600) + '…' : item.content}</p>
              </div>
            )) : <p className="hs-note">{pt ? 'Conversa ainda sem mensagens.' : 'No messages yet.'}</p>}
            {previewMessages.length > 0 && <p className="hs-note">{pt ? 'Prévia das últimas mensagens · abra para ver tudo' : 'Latest messages · open to see everything'}</p>}
          </div>
        </> : <div className="hs-preview-empty"><Icon name="message" /><p>{pt ? 'Escolha uma conversa para ver a prévia.' : 'Pick a conversation to preview it.'}</p></div>}
      </section>
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
