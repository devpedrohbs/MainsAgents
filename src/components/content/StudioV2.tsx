import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatActivityItem, ChatItem, ChatMessageItem } from '../../features/chat/model/Chat';
import { useLanguage } from '../../app/LanguageProvider';
import { useAgents } from '../../features/agents/AgentsProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { useProduction } from '../../features/production/ProductionProvider';
import { executionOverview } from '../production/ExecutionOverviewProjection';
import { pipelineColumnIds, pipelineColumnLabel, runColumn, columnForContentStage, type PipelineColumnId } from '../../features/content/homePipeline';
import type { EditorialContent, EditorialState, EditorialTopic, PublicationStatus } from '../../features/content/model';
import { AgentAvatar } from '../agents/AgentAvatar';
import { StatusIcon, type RunState } from '../common/StatusIcon';
import { executionRunState, runLabel, shortAgo } from '../../features/inbox/inbox';
import { selectRun } from '../../features/inbox/runSelection';

const busyStates = ['thinking', 'searching', 'using-tool'];
const publicationState: Record<PublicationStatus, RunState> = { draft: 'queued', 'in-review': 'waiting', approved: 'queued', sending: 'running', scheduled: 'done', published: 'done', failed: 'failed' };

/** Latest production run of a content in this workspace, with its overview projection. */
export function useContentRun(workspaceId: string, contentId?: string) {
  const { runs } = useProduction();
  const { locale } = useLanguage();
  const run = contentId ? runs.filter((item) => item.workspaceId === workspaceId && item.contentId === contentId && item.stage !== 'canceled').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] : undefined;
  const overview = run ? executionOverview([run], workspaceId, locale === 'pt-BR')[0] : undefined;
  return { run, overview };
}
export function openRunPage(workspaceId: string, runId: string) { selectRun(workspaceId, runId); window.location.hash = 'runs'; }

/** Stage rail under the Studio header: where this content is across the 8 stages, from saved records. */
export function StudioStageRail({ workspaceId, topic, content }: { workspaceId: string; topic?: EditorialTopic; content?: EditorialContent }) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { run, overview } = useContentRun(workspaceId, content?.id);
  if (!topic) return null;
  const column: PipelineColumnId = (run && runColumn(run)) || (content ? columnForContentStage(content.productionStage) : topic.status === 'draft' ? 'ideas' : topic.status === 'approved' ? 'script' : 'research');
  const currentState: RunState = overview ? executionRunState[overview.state] : !content ? (topic.status === 'researching' ? 'running' : topic.status === 'review' ? 'waiting' : topic.status === 'error' ? 'failed' : 'queued') : content.status === 'script-review' ? 'waiting' : content.status === 'error' ? 'failed' : content.status === 'generating' ? 'running' : column === 'published' ? 'done' : 'running';
  const index = pipelineColumnIds.indexOf(column);
  return <nav className="v2-stage-rail" aria-label={pt ? 'Etapas do conteúdo' : 'Content stages'} data-od-id="studio-stage-rail">
    {pipelineColumnIds.map((id, position) => {
      const state: RunState = position < index || (column === 'published' && position === index) ? 'done' : position === index ? currentState : 'queued';
      const meta = position === index && state !== 'done' ? (state === 'waiting' ? (pt ? 'espera você' : 'waits on you') : state === 'failed' ? (pt ? 'parou' : 'stopped') : state === 'running' ? (pt ? 'agora' : 'now') : '') : '';
      return <span key={id} className="v2-stage-item-wrap">
        <span className={`v2-stage-item ${state}`} aria-current={position === index ? 'step' : undefined}><StatusIcon size={12} state={state} />{pipelineColumnLabel(id, pt)}{meta && <span className="v2-sub">{meta}</span>}</span>
        {position < pipelineColumnIds.length - 1 && <i aria-hidden="true" />}
      </span>;
    })}
  </nav>;
}

/** Right panel of the Studio: who works on this content, its versions, deliveries and the run behind it. */
export function StudioContextPanel({ workspaceId, state, topic, content, onOpenSession }: { workspaceId: string; state: EditorialState; topic?: EditorialTopic; content?: EditorialContent; onOpenSession: (agentId: string, sessionId: string) => void }) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { sessions, getRunState } = useChat();
  const { getAgentById } = useAgents();
  const { run, overview } = useContentRun(workspaceId, content?.id);
  if (!topic) return null;
  const related = sessions.filter((session) => (content && session.contentId === content.id) || session.topicId === topic.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const byAgent = [...new Map(related.map((session) => [session.agentId, session])).values()].map((session) => ({ session, agent: getAgentById(session.agentId) })).filter((entry) => entry.agent?.workspaceId === workspaceId);
  const artifacts = state.artifacts.filter((artifact) => artifact.workspaceId === workspaceId && (artifact.topicId === topic.id || (content && artifact.contentId === content.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const artifactLabel = (type: string) => ({ research: pt ? 'Pesquisa' : 'Research', 'script-options': pt ? 'Opções de roteiro' : 'Script options', script: pt ? 'Roteiro' : 'Script' } as Record<string, string>)[type] ?? type;
  const approved = new Set(state.approvals.filter((approval) => approval.decision === 'approved').map((approval) => approval.artifactId));
  const deliveries = content ? (state.publications ?? []).filter((item) => item.contentId === content.id && item.workspaceId === workspaceId).sort((a, b) => (a.plannedAt ?? a.updatedAt).localeCompare(b.plannedAt ?? b.updatedAt)) : [];
  const sources = topic.sources?.slice(0, 4) ?? [];
  return <aside className="v2-studio-context" aria-label={pt ? 'Entregas e contexto' : 'Deliveries and context'} data-od-id="studio-context">
    {run && overview && <section className="v2-block">
      <div className="v2-block-head"><h2 className="v2-section-title">{pt ? 'Execução' : 'Run'}</h2><button type="button" className="v2-link" onClick={() => openRunPage(workspaceId, run.id)}>{pt ? 'Ver execução' : 'View run'}</button></div>
      <button type="button" className="v2-context-run" onClick={() => openRunPage(workspaceId, run.id)}><StatusIcon state={executionRunState[overview.state]} /><span className="v2-mono">{runLabel(run.id)}</span><span className="v2-ellipsis">{overview.stageLabel}</span><span className="v2-sub">{shortAgo(overview.updatedAt, locale)}</span></button>
    </section>}
    <section className="v2-block">
      <h2 className="v2-section-title">{pt ? 'Agentes deste conteúdo' : 'Agents on this content'}</h2>
      {byAgent.length ? <div className="v2-context-list">{byAgent.map(({ session, agent }) => {
        const busy = busyStates.includes(getRunState(session.id));
        return <button key={session.id} type="button" className="v2-context-row" onClick={() => onOpenSession(session.agentId, session.id)}>
          <AgentAvatar name={agent!.name} image={agent!.avatarImage} mascot={agent!.avatarMascot} role={agent!.role} thinking={busy} />
          <span className="v2-team-copy"><b className="v2-ellipsis">{agent!.name}</b><span className="v2-ellipsis">{session.title}</span></span>
          <StatusIcon size={12} state={busy ? 'running' : 'done'} label={busy ? undefined : (pt ? 'Conversa salva' : 'Saved chat')} />
        </button>;
      })}</div> : <p className="v2-sub">{pt ? 'Nenhuma conversa ligada a esta pauta ainda.' : 'No chat linked to this topic yet.'}</p>}
    </section>
    <section className="v2-block">
      <h2 className="v2-section-title">{pt ? 'Versões' : 'Versions'}</h2>
      {artifacts.length ? <div className="v2-context-list">{artifacts.map((artifact) => <div key={artifact.id} className="v2-context-line">
        <StatusIcon size={12} state={approved.has(artifact.id) ? 'done' : 'waiting'} label={approved.has(artifact.id) ? (pt ? 'Aprovada' : 'Approved') : (pt ? 'Para revisar' : 'To review')} />
        <span className="v2-mono">v{artifact.version}</span><span className="v2-ellipsis">{artifactLabel(artifact.type)}</span><span className="v2-mono v2-sub">{shortAgo(artifact.createdAt, locale)}</span>
      </div>)}</div> : <p className="v2-sub">{pt ? 'Pesquisa e roteiros aparecem aqui com a versão.' : 'Research and scripts show here with their version.'}</p>}
    </section>
    <section className="v2-block">
      <h2 className="v2-section-title">{pt ? 'Entregas' : 'Deliveries'}</h2>
      {deliveries.length ? <div className="v2-context-list">{deliveries.map((item) => <div key={item.id} className="v2-context-line">
        <StatusIcon size={12} state={publicationState[item.status]} /><span className="v2-ellipsis">{item.platform}</span>
        <span className="v2-mono v2-sub">{item.plannedAt ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.plannedAt)) : `v${item.version}`}</span>
      </div>)}</div> : <p className="v2-sub">{pt ? 'As entregas por rede aparecem depois do roteiro aprovado.' : 'Per-network deliveries show after the script is approved.'}</p>}
    </section>
    {sources.length > 0 && <section className="v2-block">
      <h2 className="v2-section-title">{pt ? 'O que o agente está usando' : 'What the agent is using'}</h2>
      <div className="v2-context-list">{sources.map((source, index) => <a key={index} className="v2-context-chip" href={source.url} target="_blank" rel="noreferrer"><span className="v2-sub">{pt ? 'Fonte' : 'Source'}</span><span className="v2-ellipsis">{source.title || source.url}</span></a>)}</div>
    </section>}
  </aside>;
}

/** Chats of this topic/content in this workspace, newest first, one per agent. */
export function useTopicSessions(workspaceId: string, topic?: EditorialTopic, content?: EditorialContent) {
  const { sessions } = useChat();
  const { getAgentById } = useAgents();
  if (!topic) return [];
  const related = sessions.filter((session) => (content && session.contentId === content.id) || session.topicId === topic.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...new Map(related.map((session) => [session.agentId, session])).values()].map((session) => ({ session, agent: getAgentById(session.agentId)! })).filter((entry) => entry.agent?.workspaceId === workspaceId);
}

const clock = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayOf = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(iso));
type Block = { kind: 'message'; item: ChatMessageItem } | { kind: 'actions'; id: string; items: ChatActivityItem[] };
function blocksOf(items: readonly ChatItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    if (item.type === 'activity') { const last = out.at(-1); if (last?.kind === 'actions') last.items.push(item); else out.push({ kind: 'actions', id: item.id, items: [item] }); }
    else if (item.content.trim() || item.attachments?.length || item.images?.length) out.push({ kind: 'message', item });
  }
  return out;
}
function ActionGroup({ items, pt }: { items: ChatActivityItem[]; pt: boolean }) {
  const [open, setOpen] = useState(false);
  const ms = items.reduce((sum, item) => sum + (item.startedAt && item.endedAt ? Math.max(0, Date.parse(item.endedAt) - Date.parse(item.startedAt)) : 0), 0);
  const running = items.some((item) => item.status === 'running'), failed = items.some((item) => item.status === 'error');
  return <div className="v2-convo-actions">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${open ? 90 : 0}deg)` }}><path d="M9 6l6 6-6 6" /></svg>
      <StatusIcon size={12} state={running ? 'running' : failed ? 'failed' : 'done'} />
      {items.length} {items.length === 1 ? (pt ? 'ação' : 'action') : (pt ? 'ações' : 'actions')}{ms > 0 && <span className="v2-mono"> · {ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`}</span>}
    </button>
    {open && <div className="v2-convo-actions-list">{items.map((item) => <div key={item.id}><StatusIcon size={12} state={item.status === 'running' ? 'running' : item.status === 'error' ? 'failed' : 'done'} /><span className="v2-ellipsis">{item.label}</span></div>)}</div>}
  </div>;
}

/** Center of the V2 Studio: the conversation with each agent working on this content, a pending gate, and a composer. */
export function StudioConversation({ workspaceId, topic, content, pendingGate, onReview, onOpenSession, onShowStages }: { workspaceId: string; topic: EditorialTopic; content?: EditorialContent; pendingGate?: { title: string; detail: string }; onReview: () => void; onOpenSession: (agentId: string, sessionId: string) => void; onShowStages: () => void }) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { getRunState, sendMessage } = useChat();
  const entries = useTopicSessions(workspaceId, topic, content);
  const [pickedId, setPickedId] = useState('');
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const active = entries.find((entry) => entry.session.id === pickedId) ?? entries[0];
  const items = active?.session.messages ?? [];
  const blocks = useMemo(() => blocksOf(items.slice(-80)), [items]);
  const busy = active ? busyStates.includes(getRunState(active.session.id)) : false;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [active?.session.id, items.length]);
  const send = () => { const text = draft.trim(); if (!text || !active || busy) return; sendMessage(active.agent, text, undefined, active.session.id); setDraft(''); };
  if (!active) return <div className="v2-convo v2-convo-empty" data-od-id="studio-conversation">
    <div className="v2-empty"><b>{pt ? 'Nenhuma conversa nesta pauta ainda' : 'No conversation on this topic yet'}</b><span>{pt ? 'Pesquisa, roteiro e produção abrem conversas com os agentes; elas aparecem aqui.' : 'Research, script and production open agent chats; they show here.'}</span>
      <button type="button" className="soft-button" onClick={onShowStages}>{pt ? 'Ver etapas' : 'View stages'}</button></div>
  </div>;
  let lastDay = '';
  return <div className="v2-convo" data-od-id="studio-conversation">
    <div className="v2-convo-tabs" role="tablist" aria-label={pt ? 'Agentes deste conteúdo' : 'Agents on this content'}>
      {entries.map(({ session, agent }) => { const on = session.id === active.session.id, working = busyStates.includes(getRunState(session.id)); return <button key={session.id} type="button" role="tab" aria-selected={on} onClick={() => setPickedId(session.id)} title={session.title}>
        <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={working} />{agent.name}{working && <StatusIcon size={12} state="running" />}
      </button>; })}
      <span className="v2-spacer" />
      <button type="button" className="v2-link" onClick={() => onOpenSession(active.session.agentId, active.session.id)}>{pt ? 'Abrir no chat' : 'Open in chat'}</button>
    </div>
    <div className="v2-convo-scroll" ref={scroller}>
      <div className="v2-convo-thread">
        {items.length > 80 && <button type="button" className="v2-link v2-convo-more" onClick={() => onOpenSession(active.session.agentId, active.session.id)}>{pt ? `Mensagens anteriores no chat (${items.length - 80})` : `Earlier messages in chat (${items.length - 80})`}</button>}
        {blocks.map((block) => {
          if (block.kind === 'actions') return <div key={block.id} className="v2-convo-indent"><ActionGroup items={block.items} pt={pt} /></div>;
          const item = block.item, day = dayOf(item.createdAt, locale), user = item.role === 'user';
          const divider = day !== lastDay ? <div className="v2-convo-day"><i />{day}<i /></div> : null;
          lastDay = day;
          return <div key={item.id}>{divider}<article className={`v2-convo-msg ${user ? 'user' : 'agent'}`}>
            {user ? <span className="v2-convo-face" aria-hidden="true">{pt ? 'VC' : 'ME'}</span> : <AgentAvatar name={active.agent.name} image={active.agent.avatarImage} mascot={active.agent.avatarMascot} role={active.agent.role} />}
            <div className="v2-convo-body">
              <span className="v2-sub"><b>{user ? (pt ? 'Você' : 'You') : (item.sourceAgentName ?? active.agent.name)}</b> · {clock(item.createdAt, locale)}{item.deliveryState === 'streaming' && <> · {pt ? 'escrevendo…' : 'writing…'}</>}</span>
              <p>{item.content.length > 1600 ? `${item.content.slice(0, 1600)}…` : item.content}</p>
              {!!item.attachments?.length && <div className="v2-convo-files">{item.attachments.map((file) => <span key={file.path} className="v2-chip">{file.name}</span>)}</div>}
              {!!item.receipts?.length && <div className="v2-convo-files">{item.receipts.map((receipt) => <span key={receipt.id} className="v2-chip"><StatusIcon size={11} state="done" />{receipt.label ?? receipt.name}</span>)}</div>}
            </div>
          </article></div>;
        })}
        {pendingGate && <section className="v2-convo-gate" aria-label={pendingGate.title}>
          <div><StatusIcon state="waiting" /><b>{pendingGate.title}</b></div>
          <p>{pendingGate.detail}</p>
          <div className="v2-convo-gate-actions"><button type="button" className="primary-button" onClick={onReview}>{pt ? 'Revisar e decidir' : 'Review and decide'}</button></div>
        </section>}
        {busy && <div className="v2-convo-indent v2-sub"><StatusIcon size={12} state="running" /> <b>{active.agent.name}</b> {pt ? 'está trabalhando…' : 'is working…'}</div>}
      </div>
    </div>
    <form className="v2-convo-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <label><span className="sr-only">{pt ? `Mensagem para ${active.agent.name}` : `Message to ${active.agent.name}`}</span>
        <textarea rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder={pt ? `Peça um ajuste ao ${active.agent.name}…` : `Ask ${active.agent.name} for a change…`} /></label>
      <div className="v2-convo-composer-bar">
        <span className="v2-sub">{pt ? 'Enter envia · Shift+Enter quebra linha' : 'Enter sends · Shift+Enter new line'}</span>
        <span className="v2-spacer" />
        <span className="v2-sub v2-ellipsis">{active.session.title}</span>
        <button type="submit" className="v2-convo-send" aria-label={pt ? 'Enviar' : 'Send'} disabled={!draft.trim() || busy}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>
      </div>
    </form>
  </div>;
}
