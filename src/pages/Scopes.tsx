import { useEffect, useState } from 'react';
import { useAgents } from '../features/agents/AgentsProvider';
import { useChat } from '../features/chat/ChatProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { useProduction } from '../features/production/ProductionProvider';
import { contentLink, contentScopeKey, contentSpaces, scopeSessions, type ContentSpace } from '../features/chat/contentScopes';
import type { Agent } from '../features/agents/model/Agent';
import type { AgentSession } from '../features/chat/model/Chat';
import { Icon } from '../components/common/Icon';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { FlowDialog } from '../components/common/FlowDialog';
import { SelectMenu } from '../components/common/SelectMenu';
import { ContentDeletionDialog } from '../components/content/ContentDeletionDialog';

/**
 * Scopes are the workspace's contents seen as rooms of agents: each one keeps its own chats (contentScopes), so two contents run
 * side by side without mixing context. Creating a scope creates the content and one chat per chosen agent inside it.
 */
type Filter = 'active' | 'archived' | 'all';
const busyStates = ['thinking', 'searching', 'using-tool'];
const initials = (title: string) => title.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word[0] ?? '')).slice(0, 2).map((word) => word[0].toLocaleUpperCase()).join('') || '•';
const chatsLabel = (n: number, pt: boolean) => pt ? `${n} ${n === 1 ? 'conversa' : 'conversas'}` : `${n} ${n === 1 ? 'chat' : 'chats'}`;
const agentsLabel = (n: number, pt: boolean) => pt ? `${n} ${n === 1 ? 'agente' : 'agentes'}` : `${n} ${n === 1 ? 'agent' : 'agents'}`;

function relative(iso: string | undefined, locale: string) {
  if (!iso) return '';
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000), format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440) return format.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(minutes) < 10080) return format.format(Math.round(minutes / 1440), 'day');
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
const lastReply = (session: AgentSession | undefined) => {
  const item = session?.messages.slice().reverse().find((message) => message.type === 'message' && message.content.trim());
  return item?.type === 'message' ? item.content.replace(/\s+/g, ' ').slice(0, 180) : undefined;
};

function NewScopeDialog({ agents, pt, onClose, onCreate }: { agents: readonly Agent[]; pt: boolean; onClose: () => void; onCreate: (input: { title: string; goal: string; agentIds: string[]; collaborate: boolean }) => Promise<void> }) {
  const [title, setTitle] = useState(''), [goal, setGoal] = useState(''), [picked, setPicked] = useState<string[]>(agents.length === 1 ? [agents[0].id] : []);
  const [collaborate, setCollaborate] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const submit = async () => {
    if (!title.trim() || !picked.length || saving) return;
    setSaving(true); setError('');
    try { await onCreate({ title: title.trim(), goal: goal.trim(), agentIds: picked, collaborate }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false); }
  };
  return <FlowDialog title={pt ? 'Novo escopo' : 'New scope'} description={pt ? 'Um escopo reúne agentes em torno de um trabalho. As conversas dele ficam separadas das outras.' : 'A scope gathers agents around one piece of work. Its chats stay separate from the others.'} onClose={onClose}>
    <form className="scope-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>{pt ? 'Nome' : 'Name'}<input autoFocus value={title} maxLength={120} disabled={saving} onChange={(event) => setTitle(event.target.value)} placeholder={pt ? 'Ex.: Post para LinkedIn' : 'E.g. LinkedIn post'} /></label>
      <label>{pt ? 'Objetivo' : 'Goal'} <small>{pt ? '(opcional, vira contexto do conteúdo)' : '(optional, becomes the content’s context)'}</small>
        <textarea rows={2} value={goal} maxLength={2000} disabled={saving} onChange={(event) => setGoal(event.target.value)} placeholder={pt ? 'Ex.: carrossel semanal sobre automação no Excel' : 'E.g. weekly carousel about Excel automation'} /></label>
      <fieldset disabled={saving}>
        <legend>{pt ? 'Agentes' : 'Agents'} <b>{pt ? `${picked.length} escolhidos` : `${picked.length} chosen`}</b></legend>
        {agents.length ? agents.map((agent) => <label key={agent.id} className={`scope-pick ${picked.includes(agent.id) ? 'on' : ''}`}>
          <input type="checkbox" checked={picked.includes(agent.id)} onChange={() => toggle(agent.id)} />
          <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} /><span>{agent.name}</span><small>{agent.role || '—'} · {(agent.providerId ?? 'codex') === 'claude' ? 'Claude' : 'Codex'}</small>
        </label>) : <p className="scope-muted">{pt ? 'Crie um agente antes de montar um escopo.' : 'Create an agent before setting up a scope.'}</p>}
      </fieldset>
      <label className="scope-switch"><input type="checkbox" role="switch" checked={collaborate} disabled={saving} onChange={(event) => setCollaborate(event.target.checked)} />
        <span><b>{pt ? 'Agentes podem consultar uns aos outros' : 'Agents can consult each other'}</b><small>{pt ? 'Ativa “Colaboração entre agentes” nos escolhidos. Eles só consultam quem está neste escopo.' : 'Turns on “Agent collaboration” for the chosen agents. They only consult agents in this scope.'}</small></span></label>
      {error && <p role="alert" className="scope-error">{error}</p>}
      <div className="scope-form-actions">
        <small>{pt ? 'Cada agente ganha uma conversa nova dentro do escopo.' : 'Each agent gets a new chat inside the scope.'}</small>
        <button type="button" className="soft-button" disabled={saving} onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button>
        <button type="submit" className="primary-button" disabled={saving || !title.trim() || !picked.length}>{saving ? (pt ? 'Criando…' : 'Creating…') : (pt ? 'Criar escopo' : 'Create scope')}</button>
      </div>
    </form>
  </FlowDialog>;
}

export function Scopes({ onOpenChat, onOpenStudio, onToast, onCreateAgent }: { onOpenChat: (agentId: string, sessionId: string) => void; onOpenStudio: (contentId: string) => void; onToast: (message: string) => void; onCreateAgent: () => void }) {
  const { agents, updateAgent } = useAgents();
  const { currentWorkspaceId, currentWorkspace } = useWorkspaces();
  const { sessions, createSession, getRunState, selectScope } = useChat();
  const { state: editorialState, ready: editorialReady, createSessionContent } = useContentWorkflow();
  const { runs, ready: productionReady, error: productionError } = useProduction();
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [filter, setFilter] = useState<Filter>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ contentId: string; title: string } | null>(null);
  // The sidebar item always leads back to the list, also from inside a scope.
  useEffect(() => { const back = (event: Event) => { if ((event as CustomEvent<string>).detail === 'scopes') setOpenId(null); }; window.addEventListener('mainsagents:nav', back); return () => window.removeEventListener('mainsagents:nav', back); }, []);
  const workspaceAgents = agents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const ctx = { workspaceId: currentWorkspaceId, contents: editorialState.contents, runs, pending: !editorialReady || (!productionReady && !productionError) };
  const spaces = contentSpaces(sessions, workspaceAgents.map((agent) => agent.id), ctx, pt).filter((space): space is ContentSpace & { content: NonNullable<ContentSpace['content']> } => space.kind === 'content' && !!space.content);
  const shown = spaces.filter((space) => filter === 'all' || (filter === 'archived') === !!space.archived);
  const goalOf = (space: ContentSpace) => editorialState.topics.find((topic) => topic.id === space.content?.topicId)?.summary;
  const scopeChats = (space: ContentSpace) => scopeSessions(sessions, undefined, space.scope, ctx);
  const working = (space: ContentSpace) => new Set(scopeChats(space).filter((session) => busyStates.includes(getRunState(session.id))).map((session) => session.agentId)).size;
  const agentOf = (id: string) => agents.find((agent) => agent.id === id);

  const create = async ({ title, goal, agentIds, collaborate }: { title: string; goal: string; agentIds: string[]; collaborate: boolean }) => {
    const content = await createSessionContent(currentWorkspaceId, title, goal);
    for (const id of agentIds) {
      const agent = agentOf(id); if (!agent) continue;
      createSession(agent.id, title, agent.providerId ?? 'codex', agent.modelId, contentLink(content), false);
      if (collaborate && !agent.tools.includes('subagents')) updateAgent(agent.id, { ...agent, tools: [...agent.tools, 'subagents'] });
    }
    selectScope(currentWorkspaceId, contentScopeKey(content.id));
    setCreating(false); setOpenId(content.id);
    onToast(pt ? `Escopo “${title}” criado com ${agentsLabel(agentIds.length, pt)}` : `Scope “${title}” created with ${agentsLabel(agentIds.length, pt)}`);
  };

  const current = openId ? spaces.find((space) => space.content.id === openId) : undefined;
  const dialogs = <>
    {creating && <NewScopeDialog agents={workspaceAgents} pt={pt} onClose={() => setCreating(false)} onCreate={create} />}
    {deleting && <ContentDeletionDialog contentId={deleting.contentId} workspaceId={currentWorkspaceId} fallbackTitle={deleting.title} pt={pt} onClose={() => setDeleting(null)}
      onDeleted={({ title, chats }) => { setDeleting(null); setOpenId(null); selectScope(currentWorkspaceId, 'general'); onToast(pt ? `Escopo “${title}” e ${chatsLabel(chats, pt)} excluídos deste computador` : `Scope “${title}” and ${chatsLabel(chats, pt)} deleted from this computer`); }} />}
  </>;

  if (current) {
    const chats = scopeChats(current);
    const members = current.agents.map((item) => ({ agent: agentOf(item.agentId), chats: chats.filter((session) => session.agentId === item.agentId) })).filter((item): item is { agent: Agent; chats: AgentSession[] } => !!item.agent);
    const outside = workspaceAgents.filter((agent) => !members.some((member) => member.agent.id === agent.id));
    const activity = chats.slice(0, 6);
    const addAgent = (id: string) => { const agent = agentOf(id); if (!agent) return; const session = createSession(agent.id, current.title, agent.providerId ?? 'codex', agent.modelId, contentLink(current.content), false); onToast(pt ? `${agent.name} entrou em “${current.title}”` : `${agent.name} joined “${current.title}”`); onOpenChat(agent.id, session.id); };
    return <div className="page scope-page" data-od-id="scope-page">
      <nav className="scope-trail" aria-label={pt ? 'Trilha' : 'Breadcrumb'}><a href="#scopes" onClick={(event) => { event.preventDefault(); setOpenId(null); }}>{pt ? 'Escopos' : 'Scopes'}</a><span aria-hidden="true">/</span><strong>{current.title}</strong></nav>
      <div className="scope-layout">
        <main className="scope-main">
          <header className="scope-head">
            <span className="scope-mark" aria-hidden="true">{initials(current.title)}</span>
            <div><h1>{current.title}</h1>{goalOf(current) && <p>{goalOf(current)}</p>}</div>
            <span className={`scope-state ${current.archived ? 'archived' : ''}`}>{current.stage}</span>
          </header>
          <section aria-labelledby="scope-agents">
            <div className="scope-section-head"><h2 id="scope-agents">{pt ? 'Agentes neste escopo' : 'Agents in this scope'}</h2><span>{members.length}</span>
              {outside.length > 0 && <SelectMenu className="scope-add" value="" ariaLabel={pt ? 'Adicionar agente' : 'Add agent'} onChange={addAgent} options={[{ value: '', label: pt ? 'Adicionar agente' : 'Add agent' }, ...outside.map((agent) => ({ value: agent.id, label: agent.name }))]} />}
            </div>
            {members.length ? <div className="scope-agent-grid">{members.map(({ agent, chats: own }) => {
              const latest = own[0], busy = own.some((session) => busyStates.includes(getRunState(session.id))), reply = lastReply(latest);
              return <article key={agent.id} className="scope-agent">
                <div className="scope-agent-head"><AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} /><div><b>{agent.name}</b><small>{agent.role || '—'} · {(agent.providerId ?? 'codex') === 'claude' ? 'Claude' : 'Codex'}</small></div>
                  <span className={`scope-status ${busy ? 'busy' : ''}`}><i aria-hidden="true" />{busy ? (pt ? 'Trabalhando' : 'Working') : (pt ? 'Pronto' : 'Ready')}</span></div>
                <p className={reply ? '' : 'scope-muted'}>{reply ?? (pt ? 'Ainda sem respostas neste escopo.' : 'No replies in this scope yet.')}</p>
                <div className="scope-agent-foot"><small>{chatsLabel(own.length, pt)}{latest ? ` · ${relative(latest.updatedAt, locale)}` : ''}</small>
                  {latest && <button type="button" className="primary-button" onClick={() => onOpenChat(agent.id, latest.id)}>{pt ? 'Abrir chat' : 'Open chat'}</button>}</div>
              </article>;
            })}</div> : <p className="scope-muted">{pt ? 'Nenhum agente conversou neste escopo ainda. Adicione um agente para começar.' : 'No agent has chatted in this scope yet. Add an agent to start.'}</p>}
          </section>
          {members.length > 0 && <section aria-labelledby="scope-collab">
            <div className="scope-section-head"><h2 id="scope-collab">{pt ? 'Colaboração' : 'Collaboration'}</h2></div>
            <p className="scope-muted">{pt ? 'Com a colaboração ligada, um agente pode pedir ajuda aos outros agentes deste escopo, e o pedido abre uma conversa aqui dentro. Agentes de fora não são consultados: adicione-os ao escopo se precisar. A chave vale para o agente em todos os escopos.' : 'With collaboration on, an agent can ask the other agents of this scope for help, and the request opens a chat in here. Agents outside are not consulted: add them to the scope if needed. The switch applies to the agent in every scope.'}</p>
            <div className="scope-collab">{members.map(({ agent }) => { const on = agent.tools.includes('subagents'); return <label key={agent.id} className="scope-switch">
              <input type="checkbox" role="switch" checked={on} onChange={() => updateAgent(agent.id, { ...agent, tools: on ? agent.tools.filter((tool) => tool !== 'subagents') : [...agent.tools, 'subagents'] })} />
              <span><b>{agent.name}</b><small>{on ? (pt ? 'Pode consultar outros agentes' : 'Can consult other agents') : (pt ? 'Trabalha sozinho' : 'Works alone')}</small></span></label>; })}</div>
          </section>}
        </main>
        <aside className="scope-aside" aria-label={pt ? 'Detalhes do escopo' : 'Scope details'}>
          <section><h2>{pt ? 'Conteúdo no Estúdio' : 'Content in Studio'}</h2>
            <button type="button" className="scope-link-card" onClick={() => onOpenStudio(current.content.id)}><b>{current.title}</b><small>{current.stage}</small></button></section>
          <section><h2>{pt ? 'Atividade' : 'Activity'}</h2>
            {activity.length ? <ul className="scope-activity">{activity.map((session) => <li key={session.id}><b>{agentOf(session.agentId)?.name ?? (pt ? 'Agente removido' : 'Removed agent')}</b> <span>{session.title}</span><small>{relative(session.updatedAt, locale)}</small></li>)}</ul> : <p className="scope-muted">{pt ? 'Sem conversas ainda.' : 'No chats yet.'}</p>}</section>
          <section className="scope-danger"><h2>{pt ? 'Apagar este escopo' : 'Delete this scope'}</h2>
            <p>{pt ? `Remove o conteúdo e ${chatsLabel(current.chats, pt)} deste computador. Os agentes continuam na sua equipe.` : `Removes the content and ${chatsLabel(current.chats, pt)} from this computer. The agents stay on your team.`}</p>
            <button type="button" className="danger-button" onClick={() => setDeleting({ contentId: current.content.id, title: current.title })}>{pt ? 'Apagar escopo…' : 'Delete scope…'}</button></section>
        </aside>
      </div>
      {dialogs}
    </div>;
  }

  const counts: Record<Filter, number> = { active: spaces.filter((space) => !space.archived).length, archived: spaces.filter((space) => space.archived).length, all: spaces.length };
  return <div className="page scopes-page" data-od-id="scopes-page">
    <div className="page-head">
      <div><p className="eyebrow">{currentWorkspace.name} / {pt ? 'Escopos' : 'Scopes'}</p><h1>{pt ? 'Escopos' : 'Scopes'}</h1>
        <p>{pt ? 'Cada escopo reúne os agentes de um trabalho. As conversas ficam separadas por escopo, então dois conteúdos rodam juntos sem misturar contexto.' : 'Each scope gathers the agents of one piece of work. Chats stay separate per scope, so two contents run side by side without mixing context.'}</p></div>
      <div className="scopes-head-actions">
      <a className="soft-button scope-history-link" href="#sessions"><Icon name="history" />{pt ? 'Histórico de conversas' : 'Conversation history'}</a>
      <button className="primary-button" data-od-id="create-scope" onClick={() => workspaceAgents.length ? setCreating(true) : onCreateAgent()}><Icon name="plus" />{pt ? 'Novo escopo' : 'New scope'}</button>
      </div>
    </div>
    <div className="scope-filter" role="group" aria-label={pt ? 'Filtrar escopos' : 'Filter scopes'}>
      {(['active', 'archived', 'all'] as const).map((id) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{id === 'active' ? (pt ? 'Ativos' : 'Active') : id === 'archived' ? (pt ? 'Arquivados' : 'Archived') : (pt ? 'Todos' : 'All')} <span>{counts[id]}</span></button>)}
    </div>
    <div className="scope-grid">
      {shown.map((space) => { const busy = working(space), goal = goalOf(space); return <button type="button" key={space.scope} className="scope-card" onClick={() => setOpenId(space.content.id)}>
        <div className="scope-card-head"><span className="scope-mark" aria-hidden="true">{initials(space.title)}</span><div><b>{space.title}</b><small>{relative(space.lastActivity, locale)}</small></div><span className={`scope-state ${space.archived ? 'archived' : ''}`}>{space.stage}</span></div>
        <p>{goal ?? (pt ? 'Sem objetivo definido.' : 'No goal set.')}</p>
        <div className="scope-card-foot">
          <span className="scope-faces" aria-hidden="true">{space.agents.slice(0, 5).map((item) => { const agent = agentOf(item.agentId); return agent ? <AgentAvatar key={agent.id} name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} /> : null; })}</span>
          <small>{agentsLabel(space.agents.length, pt)} · {chatsLabel(space.chats, pt)}</small>
          {busy > 0 && <span className="scope-status busy"><i aria-hidden="true" />{pt ? `${busy} trabalhando` : `${busy} working`}</span>}
        </div>
      </button>; })}
      <button type="button" className="scope-card scope-card-new" onClick={() => workspaceAgents.length ? setCreating(true) : onCreateAgent()}>
        <span className="scope-plus" aria-hidden="true"><Icon name="plus" /></span><b>{pt ? 'Novo escopo' : 'New scope'}</b>
        <small>{workspaceAgents.length ? (pt ? 'Escolha os agentes e o que eles vão fazer juntos.' : 'Choose the agents and what they will do together.') : (pt ? 'Crie um agente primeiro.' : 'Create an agent first.')}</small>
      </button>
    </div>
    {dialogs}
  </div>;
}
