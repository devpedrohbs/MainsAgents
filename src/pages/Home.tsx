import type { PageId } from '../app/types';
import { useChat } from '../features/chat/ChatProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import type { Agent } from '../features/agents/model/Agent';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { StatusIcon, type RunState } from '../components/common/StatusIcon';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { pipelineColumnIds, pipelineColumnLabel, projectHomePipeline, type PipelineColumnId, type PipelineItem } from '../features/content/homePipeline';
import { useProduction } from '../features/production/ProductionProvider';
import { executionOverview } from '../components/production/ExecutionOverviewProjection';
import { usePersistentState } from '../data/localPersistence';
import { usageByDay, usageLedgerKey, type UsageEntry } from '../features/usage/usageLedger';
import type { PublicationStatus } from '../features/content/model';
import { productionStageLabel } from '../features/production/model';
import { executionRunState, inboxToneLabel, inboxToneState, runLabel, shortAgo, type InboxItem } from '../features/inbox/inbox';

interface HomeProps {
  inbox: InboxItem[];
  onCreateAgent: () => void;
  onNewProduction: () => void;
  onSelectAgent: (id: string) => void;
  onNavigate: (page: PageId) => void;
  onOpenRun: (runId: string) => void;
}

const busyStates = ['thinking', 'searching', 'using-tool'];
const DAY = 86_400_000;
const publicationState: Record<PublicationStatus, RunState> = { draft: 'queued', 'in-review': 'waiting', approved: 'queued', sending: 'running', scheduled: 'done', published: 'done', failed: 'failed' };

/** Polyline points for a 7-day sparkline in a 100×26 box; flat when every value is equal. */
function sparkPoints(values: number[]) {
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  return values.map((value, index) => `${(index * 100 / Math.max(1, values.length - 1)).toFixed(1)},${(23 - (value - min) / span * 20).toFixed(1)}`).join(' ');
}
/** Seven local-day buckets, oldest first, counting the timestamps that fall in each. */
function perDay(times: readonly (string | undefined)[], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
  const buckets = Array.from({ length: 7 }, () => 0);
  for (const at of times) { const time = Date.parse(at ?? ''); if (Number.isFinite(time) && time >= start) buckets[Math.min(6, Math.floor((time - start) / DAY))]++; }
  return buckets;
}

export function Home({ inbox, onCreateAgent, onNewProduction, onSelectAgent, onNavigate, onOpenRun }: HomeProps) {
  const { agents: allAgents, getAgentById } = useAgents();
  const { runs: productionRuns } = useProduction();
  const { currentWorkspaceId } = useWorkspaces();
  const { sessions, getRunState } = useChat();
  const { locale, t } = useLanguage();
  const { state, ready, storageError, jobsError } = useContentWorkflow();
  const [range, setRange] = usePersistentState<'today' | 'week'>('mission-range', 'today');
  const [ledger] = usePersistentState<UsageEntry[]>(usageLedgerKey, []);
  const pt = locale === 'pt-BR', week = range === 'week', now = new Date();
  const agents = allAgents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const workspaceSessions = sessions.filter((session) => agentIds.has(session.agentId));
  const busySession = (agentId: string) => workspaceSessions.find((session) => session.agentId === agentId && busyStates.includes(getRunState(session.id)));
  const working = agents.filter((agent) => busySession(agent.id)).length;
  const runsHere = productionRuns.filter((run) => run.workspaceId === currentWorkspaceId);
  const executions = executionOverview(productionRuns, currentWorkspaceId, pt);
  const executionById = new Map(executions.map((item) => [item.id, item]));
  const time = (value?: string) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const periodStart = week ? startToday - 6 * DAY : startToday, previousStart = week ? periodStart - 7 * DAY : periodStart - DAY;

  // KPIs: every number below is counted from saved records (runs, inbox, publications, usage ledger), never estimated.
  const completedAt = (runId: string) => runsHere.find((run) => run.id === runId)?.events?.filter((event) => event.action === 'complete').at(-1)?.at;
  const completions = executions.filter((item) => item.state === 'complete').map((item) => completedAt(item.id) ?? item.updatedAt);
  const countIn = (times: readonly (string | undefined)[], from: number, to = Infinity) => times.filter((at) => time(at) >= from && time(at) < to).length;
  const running = executions.filter((item) => item.state === 'active').length, waitingRuns = executions.filter((item) => item.state === 'waiting').length;
  const failedRuns = executions.filter((item) => item.state === 'blocked').length;
  const oldestWait = [...inbox].sort((a, b) => a.at.localeCompare(b.at))[0];
  const publications = (state.publications ?? []).filter((item) => item.workspaceId === currentWorkspaceId);
  const delivered = publications.filter((item) => item.status === 'published' || item.status === 'scheduled').map((item) => item.receipt?.checkedAt ?? item.updatedAt);
  const usage = usageByDay(ledger.filter((entry) => entry.workspaceId === currentWorkspaceId), 14, now);
  const usageIn = usage.slice(week ? 7 : 13);
  const cost = usageIn.reduce((sum, day) => sum + (day.cost ?? 0), 0), costKnown = usageIn.some((day) => day.cost !== undefined);
  const tokens = usageIn.reduce((sum, day) => sum + day.total, 0), turns = usageIn.reduce((sum, day) => sum + day.turns, 0);
  const tokenLabel = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M` : value >= 1000 ? `${Math.round(value / 1000).toLocaleString(locale)}k` : value.toLocaleString(locale);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const delta = (current: number, previous: number, unit: string) => current === previous ? (pt ? `igual ${unit}` : `same ${unit}`) : `${current > previous ? '+' : '−'}${Math.abs(current - previous)} ${unit}`;
  const vsLabel = week ? (pt ? 'vs semana anterior' : 'vs previous week') : (pt ? 'vs ontem' : 'vs yesterday');
  const doneNow = countIn(completions, periodStart), donePrev = countIn(completions, previousStart, periodStart);
  const deliveredNow = countIn(delivered, periodStart), deliveredPrev = countIn(delivered, previousStart, periodStart);
  const kpis = [
    week
      ? { id: 'done', label: pt ? 'Execuções concluídas' : 'Runs completed', value: doneNow.toLocaleString(locale), note: delta(doneNow, donePrev, vsLabel), tone: doneNow >= donePrev ? 'good' : 'muted', color: 'var(--state-done)', series: perDay(completions) }
      : { id: 'running', label: pt ? 'Em execução' : 'Running', value: running.toLocaleString(locale), note: waitingRuns ? (pt ? `${waitingRuns} ${waitingRuns === 1 ? 'travada' : 'travadas'} em você` : `${waitingRuns} stuck on you`) : (pt ? `${working} ${working === 1 ? 'agente trabalhando' : 'agentes trabalhando'}` : `${working} agents working`), tone: waitingRuns ? 'warn' : 'muted', color: 'var(--state-running)', series: perDay(runsHere.flatMap((run) => (run.events ?? []).map((event) => event.at))) },
    { id: 'waiting', label: pt ? 'Esperando você' : 'Waiting on you', value: inbox.length.toLocaleString(locale), note: oldestWait ? (pt ? `mais antiga: ${shortAgo(oldestWait.at, locale)}` : `oldest: ${shortAgo(oldestWait.at, locale)}`) : (pt ? 'nada pendente' : 'nothing pending'), tone: 'muted', color: 'var(--state-waiting)', series: perDay(inbox.map((item) => item.at)) },
    week
      ? { id: 'delivered', label: pt ? 'Entregas publicadas ou agendadas' : 'Deliveries published or scheduled', value: deliveredNow.toLocaleString(locale), note: delta(deliveredNow, deliveredPrev, vsLabel), tone: deliveredNow >= deliveredPrev ? 'good' : 'muted', color: 'var(--accent)', series: perDay(delivered) }
      : { id: 'done', label: pt ? 'Concluídas hoje' : 'Completed today', value: doneNow.toLocaleString(locale), note: delta(doneNow, donePrev, vsLabel), tone: doneNow > donePrev ? 'good' : 'muted', color: 'var(--state-done)', series: perDay(completions) },
    { id: 'cost', label: week ? (pt ? 'Custo de modelos · 7 dias' : 'Model cost · 7 days') : (pt ? 'Custo hoje' : 'Cost today'), value: costKnown ? money(cost) : tokens ? tokenLabel(tokens) : '—', note: costKnown ? `${tokenLabel(tokens)} tokens` : tokens ? (pt ? `tokens · ${turns} respostas` : `tokens · ${turns} replies`) : (pt ? 'sem uso registrado' : 'no usage recorded'), tone: 'muted', color: 'var(--muted)', series: usage.slice(7).map((day) => costKnown ? day.cost ?? 0 : day.total) },
  ];

  // Runs table: every content in production, placed on the 8 stages by the same projection the Studio uses.
  const projection = projectHomePipeline({ contents: state.contents, topics: state.topics, runs: productionRuns, workspaceId: currentWorkspaceId });
  const touchedAt = (item: PipelineItem) => state.contents.find((content) => content.id === item.contentId)?.updatedAt ?? state.topics.find((topic) => topic.id === item.topicId)?.updatedAt ?? '';
  const rank: Record<RunState, number> = { failed: 0, waiting: 1, running: 2, paused: 3, queued: 4, done: 5 };
  const rows = pipelineColumnIds.flatMap((column) => projection[column].map((item) => {
    const execution = item.runId ? executionById.get(item.runId) : undefined;
    const runState: RunState = execution ? executionRunState[execution.state] : column === 'published' ? 'done' : 'queued';
    return { column, item, execution, runState, at: execution?.updatedAt ?? touchedAt(item) };
  })).sort((a, b) => rank[a.runState] - rank[b.runState] || b.at.localeCompare(a.at));
  const shownRows = rows.filter((row) => row.runState !== 'done').concat(rows.filter((row) => row.runState === 'done').slice(0, 2)).slice(0, 8);
  const teamFor = (row: typeof rows[number]) => {
    const run = row.item.runId ? runsHere.find((candidate) => candidate.id === row.item.runId) : undefined;
    const ids = run ? [run.sourceAgent?.id, run.editorAgent?.id, run.publisherAgent?.id] : workspaceSessions.filter((session) => row.item.contentId ? session.contentId === row.item.contentId : !!row.item.topicId && session.topicId === row.item.topicId).map((session) => session.agentId);
    return [...new Set(ids.filter((id): id is string => !!id))].map((id) => getAgentById(id)).filter((agent): agent is Agent => !!agent);
  };
  const [, setStudioView] = usePersistentState<'studio' | 'calendar'>('studio-view', 'studio');
  const openStudio = (view: 'studio' | 'calendar') => { setStudioView(view); onNavigate('content'); };
  const openContent = (item: PipelineItem) => { openStudio('studio'); window.dispatchEvent(new CustomEvent('mainsagents:open-content', { detail: { contentId: item.contentId, topicId: item.topicId } })); };
  const openRow = (row: typeof rows[number]) => row.item.runId && row.execution ? onOpenRun(row.item.runId) : openContent(row.item);
  const resume = rows.filter((row) => row.column !== 'schedule' && row.column !== 'published').sort((a, b) => touchedAt(b.item).localeCompare(touchedAt(a.item)))[0];

  // Right column.
  const idleLine = (agent: Agent) => {
    const last = workspaceSessions.filter((session) => session.agentId === agent.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return last ? (pt ? `Livre · ativo há ${shortAgo(last.updatedAt, locale)}` : `Free · active ${shortAgo(last.updatedAt, locale)} ago`) : (pt ? 'Livre' : 'Free');
  };
  const team = agents.map((agent) => {
    const busy = busySession(agent.id), waiting = inbox.find((item) => item.agent?.id === agent.id);
    const runState: RunState = busy ? 'running' : waiting ? 'waiting' : 'queued';
    const doing = busy ? busy.title : waiting ? (pt ? `Parado: ${waiting.title}` : `Stopped: ${waiting.title}`) : idleLine(agent);
    return { agent, runState, doing };
  }).sort((a, b) => rank[a.runState] - rank[b.runState]);
  const upcoming = publications.filter((item) => item.plannedAt && time(item.plannedAt) >= startToday && item.status !== 'draft' && item.status !== 'published').sort((a, b) => time(a.plannedAt) - time(b.plannedAt)).slice(0, 4);
  const contentTitle = (contentId: string) => state.contents.find((content) => content.id === contentId)?.title ?? (pt ? 'Conteúdo' : 'Content');
  const feed = [
    ...runsHere.flatMap((run) => (run.events ?? []).filter((event) => event.at).map((event) => ({ at: event.at, who: run.name || run.topic?.title || runLabel(run.id), what: productionStageLabel(event.action, pt) === event.action ? event.action.replaceAll('-', ' ') : productionStageLabel(event.action, pt) }))),
    ...publications.map((item) => ({ at: item.updatedAt, who: contentTitle(item.contentId), what: `${item.platform} · ${({ draft: pt ? 'rascunho' : 'draft', 'in-review': pt ? 'em revisão' : 'in review', approved: pt ? 'aprovado' : 'approved', sending: pt ? 'enviando' : 'sending', scheduled: pt ? 'agendado' : 'scheduled', published: pt ? 'publicado' : 'published', failed: pt ? 'falhou' : 'failed' } as Record<PublicationStatus, string>)[item.status]}` })),
  ].filter((entry) => time(entry.at)).sort((a, b) => time(b.at) - time(a.at)).slice(0, 6);
  const clock = (at: string) => time(at) >= startToday ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at)) : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(at));
  const openRuns = executions.filter((item) => item.state === 'active' || item.state === 'waiting').length;
  const runsSummary = pt ? `${openRuns} ${openRuns === 1 ? 'ativa' : 'ativas'}${failedRuns ? ` · ${failedRuns} com falha` : ''}` : `${openRuns} active${failedRuns ? ` · ${failedRuns} failed` : ''}`;
  const kindColor = (item: InboxItem) => item.tone === 'blocked' ? 'var(--danger-text)' : item.tone === 'reply' ? 'var(--muted)' : item.tone === 'next' ? 'var(--fg-2)' : 'var(--warn)';

  return (
    <div className="page overview-page v2-page v2-mission" data-od-id="workspace-overview">
      <header className="v2-header" data-od-id="overview-header">
        <h1 data-od-id="overview-heading">Mission Control</h1>
        <span className="v2-sub">{new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</span>
        <span className="v2-spacer" />
        <div className="v2-segmented" role="group" aria-label={pt ? 'Período' : 'Period'}>
          <button type="button" aria-pressed={!week} onClick={() => setRange('today')}>{pt ? 'Hoje' : 'Today'}</button>
          <button type="button" aria-pressed={week} onClick={() => setRange('week')}>{pt ? '7 dias' : '7 days'}</button>
        </div>
        <button className="primary-button" data-od-id="overview-create" onClick={agents.length ? onNewProduction : onCreateAgent}>
          <Icon name="plus" />{agents.length ? (pt ? 'Nova execução' : 'New run') : t('Create agent')}
        </button>
      </header>

      <div className="v2-mission-body">
        <div className="v2-mission-main">
          <section className="v2-kpis" aria-label={pt ? 'Resumo' : 'Summary'} data-od-id="overview-kpis">
            {kpis.map((kpi) => <div key={kpi.id} data-kpi={kpi.id}>
              <span className="v2-kpi-label"><i aria-hidden="true" style={{ background: kpi.color }} />{kpi.label}</span>
              <span className="v2-kpi-line"><b className="v2-kpi-value">{kpi.value}</b><span className={`v2-kpi-note ${kpi.tone}`}>{kpi.note}</span></span>
              <svg className="v2-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points={sparkPoints(kpi.series)} style={{ stroke: kpi.color }} /></svg>
            </div>)}
          </section>

          <section className="ov-needs v2-block" aria-labelledby="needs-heading" data-od-id="overview-needs">
            <div className="v2-block-head">
              <h2 id="needs-heading" className="v2-section-title">{pt ? 'Precisa de você' : 'Needs you'}{ready && inbox.length > 0 && <span className="v2-count waiting ov-needs-count">{inbox.length}</span>}<span className="v2-sub">{pt ? 'ordenado pelo que trava mais trabalho' : 'sorted by what blocks the most work'}</span></h2>
              <a href="#inbox" className="v2-link" onClick={(event) => { event.preventDefault(); onNavigate('inbox'); }}>{pt ? 'Abrir caixa de entrada' : 'Open inbox'}</a>
            </div>
            {(storageError || jobsError) && <div className="ov-alert" role="alert"><b>{pt ? 'Não foi possível atualizar todas as pendências' : 'Could not refresh all next steps'}</b><span>{storageError || jobsError}</span></div>}
            {!ready ? <p className="v2-empty" role="status">{pt ? 'Carregando suas pendências…' : 'Loading your next steps…'}</p> : inbox.length ? <div className="v2-list">
              {inbox.slice(0, 6).map((item) => (
                <button key={item.id} className={`v2-row ov-need inbox-row ${item.tone}`} onClick={item.open} {...item.data}>
                  <StatusIcon state={inboxToneState[item.tone]} label={inboxToneLabel(item.tone, pt)} />
                  <span className="v2-need-kind v2-ellipsis" style={{ color: kindColor(item) }}>{item.title}</span>
                  <span className="v2-need-title v2-ellipsis">{item.context}</span>
                  {item.agent ? <span className="v2-face" title={item.agent.name}><AgentAvatar name={item.agent.name} image={item.agent.avatarImage} mascot={item.agent.avatarMascot} role={item.agent.role} /></span> : <span className="v2-face v2-face-icon" aria-hidden="true"><Icon name={item.icon} /></span>}
                  <span className="v2-need-wait v2-mono">{shortAgo(item.at, locale)}</span>
                  <span className="v2-row-action">{item.action}</span>
                </button>
              ))}
              {inbox.length > 6 && <button className="v2-row v2-more ov-more" onClick={() => onNavigate('inbox')}>{pt ? `Ver todas (${inbox.length})` : `View all (${inbox.length})`}</button>}
            </div> : <div className="v2-list v2-empty-box"><div className="v2-empty"><b>{pt ? 'Tudo em dia' : 'All caught up'}</b><span>{pt ? 'Aprovações, escolhas, perguntas dos agentes e falhas aparecem aqui.' : 'Approvals, choices, agent questions and failures appear here.'}</span></div>
              {resume && <button className="v2-row ov-resume" onClick={() => openContent(resume.item)} data-od-id="overview-resume">
                <StatusIcon state="queued" />
                <span className="v2-need-kind v2-ellipsis">{pt ? 'Continuar de onde parou' : 'Pick up where you left off'}</span>
                <span className="v2-need-title v2-ellipsis">{resume.item.title}</span>
                <span className="v2-row-action">{pt ? 'Continuar' : 'Continue'}</span>
              </button>}
            </div>}
          </section>

          <section className="ov-production execution-overview v2-block" aria-labelledby="runs-heading" data-od-id="execution-overview">
            <div className="v2-block-head">
              <h2 id="runs-heading" className="v2-section-title">{pt ? 'Execuções' : 'Runs'}<span className="v2-sub">{runsSummary}</span></h2>
              <a href="#runs" className="v2-link" onClick={(event) => { event.preventDefault(); onNavigate('runs'); }}>{pt ? 'Ver todas' : 'View all'}</a>
            </div>
            {shownRows.length ? <div className="v2-list v2-table-scroll"><div className="v2-runs-table">
              <div className="v2-table-head" aria-hidden="true"><span /><span>ID</span><span>{pt ? 'Conteúdo' : 'Content'}</span><span>{pt ? 'Etapa atual' : 'Current stage'}</span><span>{pt ? 'Progresso' : 'Progress'}</span><span>{pt ? 'Equipe' : 'Team'}</span><span>{pt ? 'Tempo' : 'Time'}</span></div>
              {shownRows.map((row) => {
                const step = pipelineColumnIds.indexOf(row.column) + 1, faces = teamFor(row);
                const stage = `${pipelineColumnLabel(row.column, pt)}${row.execution ? ` · ${row.execution.stageLabel}` : ''}`;
                return <button key={row.item.id} className="v2-row ov-prod-row" data-column={row.column} data-state={row.runState} onClick={() => openRow(row)} title={row.item.title}>
                  <StatusIcon state={row.runState} />
                  <span className="v2-mono v2-run-id">{row.item.runId ? runLabel(row.item.runId) : '—'}</span>
                  <span className="v2-ellipsis ov-prod-title">{row.item.title}</span>
                  <span className={`v2-ellipsis v2-run-stage ov-prod-stage ${row.runState}`}>{stage}</span>
                  <span className="v2-steps ov-bars" role="img" aria-label={pt ? `Etapa ${step} de 8` : `Stage ${step} of 8`}>{pipelineColumnIds.map((id: PipelineColumnId, index) => <i key={id} className={index + 1 < step || row.runState === 'done' ? 'done' : index + 1 === step ? row.runState === 'failed' ? 'failed' : row.runState === 'waiting' ? 'waiting' : 'running' : ''} />)}</span>
                  <span className="v2-faces">{faces.slice(0, 3).map((agent) => <AgentAvatar key={agent.id} name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={!!busySession(agent.id)} />)}</span>
                  <span className="v2-mono v2-run-time">{shortAgo(row.at, locale)}</span>
                </button>;
              })}
            </div></div> : <div className="v2-list v2-empty-box"><div className="v2-empty"><b>{pt ? 'Nada em execução' : 'Nothing running'}</b><span>{pt ? 'Comece uma execução ou crie uma pauta no Estúdio.' : 'Start a run or create an idea in the Studio.'}</span><span className="v2-empty-actions"><button className="soft-button" onClick={agents.length ? onNewProduction : onCreateAgent}><Icon name="plus" />{pt ? 'Nova execução' : 'New run'}</button><button className="soft-button" onClick={() => openStudio('studio')}>{pt ? 'Abrir Estúdio' : 'Open Studio'}</button></span></div></div>}
          </section>
        </div>

        <aside className="v2-mission-side" aria-label={pt ? 'Equipe e agenda' : 'Team and schedule'} data-od-id="workspace-team">
          <section className="v2-block" aria-labelledby="now-heading" data-od-id="team-panel">
            <div className="v2-block-head"><h2 id="now-heading" className="v2-section-title">{pt ? 'Equipe agora' : 'Team now'}</h2>{agents.length > 0 && <a href="#agents" className="v2-link" onClick={(event) => { event.preventDefault(); onNavigate('agents'); }}>{pt ? 'Equipe' : 'Team'}</a>}</div>
            {agents.length ? <div className="v2-card v2-team-card">{team.map(({ agent, runState, doing }) => (
              <button className="v2-team-row" key={agent.id} onClick={() => onSelectAgent(agent.id)} data-od-id={'team-agent-' + agent.id}>
                <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} thinking={runState === 'running'} />
                <span className="v2-team-copy"><b>{agent.name}</b><span className="v2-ellipsis">{doing}</span></span>
                <StatusIcon state={runState} label={runState === 'queued' ? (pt ? 'Livre' : 'Free') : undefined} />
              </button>
            ))}</div> : <div className="v2-card v2-empty"><span>{pt ? 'Um especialista para cada parte do trabalho.' : 'A specialist for every part of your work.'}</span><button className="soft-button" onClick={onCreateAgent}><Icon name="plus" />{t('Create agent')}</button></div>}
          </section>

          <section className="v2-block" aria-labelledby="next-heading" data-od-id="overview-upcoming">
            <div className="v2-block-head"><h2 id="next-heading" className="v2-section-title">{pt ? 'Próximas publicações' : 'Upcoming posts'}</h2><a href="#content" className="v2-link" onClick={(event) => { event.preventDefault(); openStudio('calendar'); }}>{pt ? 'Calendário' : 'Calendar'}</a></div>
            {upcoming.length ? <div className="v2-card v2-upcoming">{upcoming.map((item) => {
              const date = new Date(item.plannedAt!);
              return <div className="v2-upcoming-row" key={item.id}>
                <span className="v2-date-box"><span>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date).replace('.', '')}</span><b>{String(date.getDate()).padStart(2, '0')}</b></span>
                <span className="v2-team-copy"><span className="v2-ellipsis">{contentTitle(item.contentId)}</span><span>{item.platform} · {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)}</span></span>
                <StatusIcon state={publicationState[item.status]} />
              </div>;
            })}</div> : <p className="v2-card v2-empty">{pt ? 'Nenhuma publicação com data marcada.' : 'No posts with a date yet.'}</p>}
          </section>

          <section className="v2-block" aria-labelledby="feed-heading" data-od-id="overview-activity">
            <h2 id="feed-heading" className="v2-section-title">{pt ? 'Atividade' : 'Activity'}</h2>
            {feed.length ? <ol className="v2-feed">{feed.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="v2-mono">{clock(entry.at)}</span><span><b>{entry.who}</b> {entry.what}</span></li>)}</ol> : <p className="v2-empty">{pt ? 'A atividade das execuções e publicações aparece aqui.' : 'Run and publication activity shows here.'}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
