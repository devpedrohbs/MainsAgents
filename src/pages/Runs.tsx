import { useEffect, useState } from 'react';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useAgents } from '../features/agents/AgentsProvider';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { Icon } from '../components/common/Icon';
import { StatusIcon, type RunState } from '../components/common/StatusIcon';
import { usePersistentState } from '../data/localPersistence';
import { useProduction } from '../features/production/ProductionProvider';
import { productionStageLabel, type ProductionRun } from '../features/production/model';
import { productionProgress } from '../features/production/productionProgress';
import { executionOverview, executionStateLabel, type ExecutionFilter, type ExecutionOverviewItem } from '../components/production/ExecutionOverviewProjection';
import { executionRunState, runLabel, shortAgo } from '../features/inbox/inbox';
import { runsSelectedKey } from '../features/inbox/runSelection';

interface RunsProps {
  onOpenControls: (item: ExecutionOverviewItem) => void;
  onOpenChat: (item: ExecutionOverviewItem) => void;
  onNewProduction: () => void;
  onToast: (message: string) => void;
}

const STAGES = ['writing', 'script-review', 'notion', 'recording', 'planning-edit', 'editing', 'video-review', 'platforms', 'preparing-package', 'generating-cover', 'covers-review', 'package-review', 'schedule', 'scheduling'];
const USER_STAGES = new Set(['script-review', 'recording', 'video-review', 'platforms', 'covers-review', 'package-review', 'schedule']);
const time = (value?: string) => { const parsed = Date.parse(value ?? ''); return Number.isFinite(parsed) ? parsed : 0; };
const duration = (ms: number) => {
  if (!(ms > 0)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${Math.round(h / 24)}d`;
};

interface PlanStep { id: string; n: number; label: string; who: string; agentId?: string; provider?: string; model?: string; state: RunState; start: number; end: number; user: boolean; calls: Array<{ id: string; label: string; start: number; end: number; state: RunState; tokens: number; cost?: number; model?: string }> }

/** Where a halted run stopped: the resume stage, else the last stage the coordinator logged. */
function stoppedStage(run: ProductionRun) {
  if (STAGES.includes(run.resumeStage ?? '') && run.stage !== 'canceled') return run.resumeStage;
  for (const event of [...(run.events ?? [])].reverse()) if (STAGES.includes(event.action)) return event.action;
  return run.entry?.kind === 'recorded' ? 'planning-edit' : 'writing';
}

/** The run's linear stages with real timings: event timestamps mark each start; budget calls become child rows. */
export function planOf(run: ProductionRun, pt: boolean, now: number): PlanStep[] {
  const halted = ['paused', 'blocked', 'canceled'].includes(run.stage), complete = run.stage === 'complete';
  const current = complete ? STAGES.length : STAGES.indexOf(halted ? stoppedStage(run) ?? '' : run.stage);
  const events = run.events ?? [];
  const startedAt = (stage: string) => { const event = events.find((item) => item.action === stage); return event ? time(event.at) : stage === 'writing' ? time(events.find((item) => item.action === 'idea-approved')?.at) : stage === 'planning-edit' ? time(events.find((item) => item.action === 'recorded-import')?.at) : 0; };
  const skip = new Set(run.entry?.kind === 'recorded' ? ['writing', 'script-review', 'notion', 'recording'] : run.scriptMode === 'local' ? ['notion'] : []);
  const visible = STAGES.map((id, index) => ({ id, index, start: startedAt(id) })).filter((stage) => !skip.has(stage.id) && (stage.index >= current || stage.start > 0));
  const end = complete ? time([...events].reverse().find((item) => item.action === 'complete')?.at) || time(run.updatedAt) : now;
  const who = (id: string): Pick<PlanStep, 'who' | 'agentId' | 'provider' | 'model'> => {
    if (USER_STAGES.has(id)) return { who: pt ? 'Você' : 'You' };
    if (['planning-edit', 'editing'].includes(id)) return run.editDirector ? { who: run.editDirector.name, provider: run.editDirector.provider, model: run.editDirector.model, agentId: run.editorAgent?.id } : { who: run.editorAgent?.name ?? '—', agentId: run.editorAgent?.id, provider: run.editorAgent?.providerId, model: run.editorAgent?.modelId };
    const agent = ['preparing-package', 'generating-cover', 'scheduling'].includes(id) ? run.publisherAgent ?? run.sourceAgent : run.sourceAgent;
    return { who: agent?.name ?? '—', agentId: agent?.id, provider: agent?.providerId, model: agent?.modelId };
  };
  const calls = run.budget?.calls ?? [];
  return visible.map((stage, position) => {
    const next = visible.slice(position + 1).find((item) => item.start > 0);
    const isCurrent = stage.index === current;
    const state: RunState = stage.index < current ? 'done' : isCurrent ? (run.stage === 'blocked' ? 'failed' : run.stage === 'paused' ? 'paused' : run.stage === 'canceled' ? 'queued' : USER_STAGES.has(stage.id) ? 'waiting' : 'running') : 'queued';
    const start = stage.start || (isCurrent ? time(run.updatedAt) : 0);
    const stop = state === 'queued' ? start : next?.start || (isCurrent && !halted ? end : time(run.updatedAt)) || start;
    return {
      id: stage.id, n: position + 1, label: productionStageLabel(stage.id, pt), ...who(stage.id), state, start, end: Math.max(start, stop), user: USER_STAGES.has(stage.id),
      calls: calls.filter((call) => call.stage === stage.id).map((call) => {
        const callStart = time(call.at), callEnd = Math.max(callStart, call.usage?.durationMs ? callStart + call.usage.durationMs : time(call.updatedAt));
        const tokens = ['input', 'output', 'cacheRead', 'cacheCreation'].reduce((sum, key) => sum + ((call.usage?.tokens as Record<string, number> | undefined)?.[key] ?? 0), 0);
        return { id: call.id, label: `${call.usage?.provider ?? 'llm'}.${call.key.split(':').pop() || stage.id}${call.attempt > 1 ? ` #${call.attempt}` : ''}`, start: callStart, end: callEnd, state: call.status === 'completed' ? 'done' as RunState : call.status === 'failed' ? 'failed' as RunState : call.status === 'uncertain' ? 'paused' as RunState : 'running' as RunState, tokens, cost: call.usage?.reportedCostUsd, model: call.usage?.model ?? call.usage?.models?.[0]?.model };
      }),
    };
  });
}

function RunList({ workspaceId, items, onPick, onNewProduction, pt, locale }: { workspaceId: string; items: ExecutionOverviewItem[]; onPick: (id: string) => void; onNewProduction: () => void; pt: boolean; locale: string }) {
  const [filter, setFilter] = usePersistentState<ExecutionFilter>(`execution-overview-filter:${workspaceId}`, 'all');
  const filters: ExecutionFilter[] = ['all', 'active', 'waiting', 'blocked', 'paused', 'complete'];
  const shown = filter === 'all' ? items : items.filter((item) => item.state === filter);
  return <div className="page v2-page v2-runs" data-od-id="runs-page">
    <header className="v2-header">
      <h1>{pt ? 'Execuções' : 'Runs'}</h1>
      <span className="v2-sub">{pt ? `${items.length} no workspace` : `${items.length} in this workspace`}</span>
      <span className="v2-spacer" />
      <button className="primary-button" onClick={onNewProduction}><Icon name="plus" />{pt ? 'Nova execução' : 'New run'}</button>
    </header>
    <div className="v2-runs-body">
      <div className="v2-tabs" role="tablist" aria-label={pt ? 'Filtrar execuções' : 'Filter runs'}>
        {filters.map((id) => { const count = id === 'all' ? items.length : items.filter((item) => item.state === id).length; return <button key={id} type="button" role="tab" aria-selected={filter === id} aria-pressed={filter === id} data-od-id={`execution-filter-${id}`} onClick={() => setFilter(id)}>{executionStateLabel(id, pt)} <span className="v2-mono">{count}</span></button>; })}
      </div>
      {shown.length ? <div className="v2-list v2-table-scroll"><div className="v2-runs-table v2-runs-table-full">
        <div className="v2-table-head" aria-hidden="true"><span /><span>ID</span><span>{pt ? 'Conteúdo' : 'Content'}</span><span>{pt ? 'Etapa atual' : 'Current stage'}</span><span>{pt ? 'Com quem' : 'With'}</span><span>{pt ? 'Próximo passo' : 'Next step'}</span><span>{pt ? 'Tempo' : 'Time'}</span></div>
        {shown.map((item) => { const state = executionRunState[item.state]; return <button key={item.id} type="button" className="v2-row" data-state={state} onClick={() => onPick(item.id)} data-run-id={item.id} data-od-id={`execution-${item.id}`}>
          <StatusIcon state={state} label={executionStateLabel(item.state, pt)} />
          <span className="v2-mono v2-run-id">{runLabel(item.id)}</span>
          <span className="v2-ellipsis">{item.name}</span>
          <span className={`v2-ellipsis v2-run-stage ${state}`}>{item.stageLabel}</span>
          <span className="v2-ellipsis v2-sub">{item.agentName ?? '—'}</span>
          <span className="v2-ellipsis v2-sub">{item.reason}</span>
          <span className="v2-mono v2-run-time">{shortAgo(item.updatedAt, locale)}</span>
        </button>; })}
      </div></div> : <div className="v2-list v2-empty-box"><div className="v2-empty"><b>{items.length ? (pt ? 'Nenhuma execução neste filtro' : 'No runs in this filter') : (pt ? 'Nenhuma execução ainda' : 'No runs yet')}</b><span>{pt ? 'Uma execução leva um conteúdo do roteiro à publicação, parando onde precisa de você.' : 'A run takes a content from script to publication, stopping where it needs you.'}</span>{!items.length && <button className="soft-button" onClick={onNewProduction}><Icon name="plus" />{pt ? 'Nova execução' : 'New run'}</button>}</div></div>}
    </div>
  </div>;
}

export function Runs({ onOpenControls, onOpenChat, onNewProduction, onToast }: RunsProps) {
  const { locale } = useLanguage(), pt = locale === 'pt-BR';
  const { currentWorkspaceId } = useWorkspaces();
  const { runs, command, flows } = useProduction();
  const { getAgentById } = useAgents();
  const [selectedId, setSelectedId] = usePersistentState<string>(runsSelectedKey(currentWorkspaceId), '');
  const [stepId, setStepId] = useState('');
  const [tab, setTab] = useState<'trace' | 'log' | 'files'>('trace');
  const [io, setIo] = useState<'in' | 'out' | 'state'>('state');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  const items = executionOverview(runs, currentWorkspaceId, pt);
  const item = items.find((candidate) => candidate.id === selectedId);
  const run = runs.find((candidate) => candidate.id === selectedId && candidate.workspaceId === currentWorkspaceId);
  useEffect(() => { setStepId(''); }, [selectedId]);
  if (!item || !run) return <RunList workspaceId={currentWorkspaceId} items={items} onPick={setSelectedId} onNewProduction={onNewProduction} pt={pt} locale={locale} />;

  const plan = planOf(run, pt, now);
  const progress = productionProgress(run, pt);
  const state = executionRunState[item.state];
  const current = plan.find((step) => step.state !== 'done' && step.state !== 'queued') ?? [...plan].reverse().find((candidate) => candidate.state === 'done');
  const step = plan.find((candidate) => candidate.id === stepId) ?? current ?? plan[0];
  const t0 = Math.min(...plan.filter((s) => s.start).map((s) => s.start), time(run.events?.[0]?.at) || now);
  const t1 = Math.max(t0 + 60_000, run.stage === 'complete' ? Math.max(...plan.map((s) => s.end)) : now);
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value - t0) / (t1 - t0) * 100)).toFixed(2)}%`;
  const span = t1 - t0, tickEvery = [60_000, 300_000, 900_000, 3_600_000, 6 * 3_600_000, 86_400_000, 7 * 86_400_000].find((unit) => span / unit <= 8) ?? 7 * 86_400_000;
  const ticks = Array.from({ length: Math.floor(span / tickEvery) + 1 }, (_, index) => index * tickEvery);
  const tickLabel = (offset: number) => tickEvery >= 86_400_000 ? `${Math.round(offset / 86_400_000)}d` : tickEvery >= 3_600_000 ? `${Math.round(offset / 3_600_000)}h` : `${Math.round(offset / 60_000)}m`;
  const calls = run.budget?.calls ?? [];
  const tokensOf = (list: PlanStep['calls']) => list.reduce((sum, call) => sum + call.tokens, 0);
  const totalTokens = tokensOf(plan.flatMap((s) => s.calls)), costs = plan.flatMap((s) => s.calls).map((c) => c.cost).filter((c): c is number => c !== undefined);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
  const tokenText = (tokens: number, cost?: number) => `${tokens ? `${tokens >= 1000 ? `${(tokens / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}k` : tokens} tokens` : '—'}${cost !== undefined ? ` · ${money(cost)}` : ''}`;
  const flow = flows.flows.find((candidate) => candidate.id === run.flowId);
  const started = time(run.events?.[0]?.at) || t0;
  const clock = (at: number) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  const files = [
    run.entry?.video && { label: pt ? 'Gravação' : 'Recording', name: run.entry.video.name },
    run.inputVideo && { label: pt ? 'Vídeo de entrada' : 'Input video', name: run.inputVideo.assetId },
    run.outputVideo && { label: pt ? 'Vídeo editado' : 'Edited video', name: run.outputVideo.assetId },
    run.approvedVideo && { label: pt ? 'Vídeo aprovado' : 'Approved video', name: run.approvedVideo.assetId },
    run.editWorkflow?.finalVideo && { label: pt ? 'Vídeo final' : 'Final video', name: run.editWorkflow.finalVideo.assetId },
    run.notion?.url && { label: 'Notion', name: run.notion.url },
  ].filter((entry): entry is { label: string; name: string } => !!entry);
  const stateKv: [string, string][] = [
    ['run', runLabel(run.id)], [pt ? 'etapa' : 'stage', productionStageLabel(run.stage, pt)],
    ...(run.scriptVersions?.length ? [[pt ? 'roteiro' : 'script', `v${run.scriptVersions.at(-1)?.version}${run.scriptApproval ? (pt ? ' · aprovado' : ' · approved') : ''}`] as [string, string]] : []),
    ...(run.platforms?.length ? [[pt ? 'redes' : 'networks', run.platforms.join(', ')] as [string, string]] : []),
    ...(run.schedule ? [[pt ? 'agendado' : 'scheduled', clock(time(run.schedule.plannedAt))] as [string, string]] : []),
    ...(run.budget ? [[pt ? 'chamadas' : 'calls', `${calls.length} / ${run.budget.maxCalls}`] as [string, string]] : []),
    ...(run.error ? [[pt ? 'erro' : 'error', run.error] as [string, string]] : []),
  ];
  const stepIn: [string, string][] = [[pt ? 'quem' : 'who', step.who], ...(step.start ? [[pt ? 'início' : 'start', clock(step.start)] as [string, string]] : []), ...(step.user ? [[pt ? 'tipo' : 'type', pt ? 'decisão sua' : 'your decision'] as [string, string]] : [])];
  const stepOut: [string, string][] = step.state === 'done' ? [[pt ? 'concluída' : 'finished', clock(step.end)], [pt ? 'chamadas' : 'calls', String(step.calls.length)], ...(tokensOf(step.calls) ? [['tokens', tokensOf(step.calls).toLocaleString(locale)] as [string, string]] : [])] : [];
  const kv = io === 'in' ? stepIn : io === 'out' ? stepOut : stateKv;
  const act = async (action: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try { await command(run, action); } catch (error) { onToast(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  const headTone = state === 'waiting' ? 'waiting' : state === 'failed' ? 'failed' : state === 'running' ? 'running' : 'muted';
  const canResume = (run.stage === 'paused' || run.stage === 'blocked') && !run.imported;
  const canCancel = !['complete', 'canceled'].includes(run.stage);
  const agentFace = (id?: string) => { const agent = id ? getAgentById(id) : undefined; return agent ? <AgentAvatar name={agent.name} image={agent.avatarImage} mascot={agent.avatarMascot} role={agent.role} /> : <i className="v2-you" aria-hidden="true" />; };

  return <div className="page v2-page v2-run" data-od-id="run-detail" data-run-id={run.id}>
    <header className="v2-header">
      <nav className="v2-crumbs" aria-label={pt ? 'Trilha' : 'Breadcrumb'}>
        <a href="#runs" onClick={(event) => { event.preventDefault(); setSelectedId(''); }}>{pt ? 'Execuções' : 'Runs'}</a><span aria-hidden="true">/</span>
        <span className="v2-mono">{runLabel(run.id)}</span><b className="v2-ellipsis">{item.name}</b>
      </nav>
      <span className={`v2-chip v2-chip-${headTone}`}><StatusIcon size={12} state={state} />{executionStateLabel(item.state, pt)}</span>
      <span className="v2-mono v2-sub">{duration((run.stage === 'complete' ? t1 : now) - started)}</span>
      <span className="v2-spacer" />
      {item.detail && <button type="button" data-od-id="run-controls" className={state === 'waiting' ? 'primary-button' : 'soft-button'} onClick={() => onOpenControls(item)}>{state === 'waiting' ? (pt ? 'Resolver agora' : 'Resolve now') : (pt ? 'Abrir controles' : 'Open controls')}</button>}
      {item.chat && <button type="button" data-od-id="run-chat" className="soft-button" onClick={() => onOpenChat(item)}><Icon name="message" />{pt ? 'Conversa' : 'Chat'}</button>}
      {canResume && <button type="button" className="soft-button" disabled={busy} onClick={() => void act('resume')}>{pt ? 'Retomar' : 'Resume'}</button>}
      {canCancel && <button type="button" className="v2-danger-button" disabled={busy} onClick={() => void act('cancel', pt ? 'Interromper esta execução? Os passos já feitos ficam salvos, mas ela não continua.' : 'Stop this run? Finished steps stay saved, but it will not continue.')}>{pt ? 'Interromper' : 'Stop'}</button>}
    </header>
    <div className="v2-meta-strip">
      <span>Pipeline <b>{flow?.name ?? (pt ? 'configuração removida' : 'removed setup')}</b></span>
      <span>{pt ? 'Entrada' : 'Entry'} <b>{run.entry?.kind === 'recorded' ? (pt ? 'vídeo já gravado' : 'recorded video') : (pt ? 'pauta aprovada' : 'approved idea')}</b></span>
      <span>{pt ? 'Início' : 'Started'} <b className="v2-mono">{clock(started)}</b></span>
      <span>{pt ? 'Roteiro' : 'Script'} <b>{run.scriptMode === 'local' ? (pt ? 'no app, sem Notion' : 'in the app, no Notion') : 'Notion'}</b></span>
      <span className="v2-meta-cost v2-mono">{tokenText(totalTokens, costs.length ? costs.reduce((a, b) => a + b, 0) : undefined)}</span>
    </div>
    <div className="v2-run-body">
      <section className="v2-run-plan" aria-labelledby="run-plan">
        <div className="v2-pane-head"><h2 id="run-plan" className="v2-section-title">{pt ? 'Plano' : 'Plan'}<span className="v2-sub">{plan.filter((s) => s.state === 'done').length} {pt ? 'de' : 'of'} {plan.length}</span></h2></div>
        <ol className="v2-plan">{plan.map((s) => <li key={s.id}><button type="button" aria-pressed={s.id === step.id} onClick={() => setStepId(s.id)} className={s.state}>
          <span className="v2-mono v2-plan-n">{s.n}</span><StatusIcon state={s.state} />
          <span className="v2-plan-copy"><span className="v2-ellipsis">{s.label}</span><span className="v2-sub v2-ellipsis">{s.who}</span></span>
          <span className={`v2-mono v2-plan-dur ${s.state}`}>{s.state === 'queued' ? '—' : duration(s.end - s.start)}</span>
        </button></li>)}</ol>
        <p className="v2-plan-note">{progress.nextAction}</p>
      </section>

      <section className="v2-run-trace" aria-labelledby="run-trace">
        <div className="v2-tabs v2-pane-tabs" role="tablist" aria-label={pt ? 'Visão da execução' : 'Run view'}>
          <h2 id="run-trace" className="v2-section-title">{pt ? 'Rastro' : 'Trace'}</h2>
          <button type="button" role="tab" aria-selected={tab === 'trace'} onClick={() => setTab('trace')}>{pt ? 'Cascata' : 'Waterfall'}</button>
          <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>{pt ? 'Registros' : 'Logs'} <span className="v2-mono">{run.events?.length ?? 0}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>{pt ? 'Arquivos' : 'Files'} <span className="v2-mono">{files.length}</span></button>
          {tab === 'trace' && <span className="v2-legend"><span><i className="tool" />{pt ? 'chamada' : 'call'}</span><span><i className="hatch" />{pt ? 'esperando você' : 'waiting on you'}</span></span>}
        </div>
        <div className="v2-trace-scroll">
          {tab === 'trace' ? <div className="v2-waterfall">
            <div className="v2-ruler"><span>{pt ? 'Passo / chamada' : 'Step / call'}</span><span className="v2-ruler-track">{ticks.map((offset) => <span key={offset} style={{ left: pct(t0 + offset) }}>{tickLabel(offset)}</span>)}</span></div>
            <div className="v2-wf-rows">
              {plan.flatMap((s) => [
                <button key={s.id} type="button" className={`v2-wf-row step ${s.state}`} aria-pressed={s.id === step.id} onClick={() => setStepId(s.id)}>
                  <span className="v2-wf-label"><StatusIcon size={12} state={s.state} /><span className="v2-ellipsis">{s.label}</span></span>
                  <span className="v2-wf-track">{s.state !== 'queued' && <i className={s.state === 'waiting' ? 'hatch' : s.state} style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />}</span>
                  <span className={`v2-mono v2-wf-dur ${s.state}`}>{s.state === 'queued' ? '—' : duration(s.end - s.start)}</span>
                </button>,
                ...s.calls.map((call) => <div key={call.id} className="v2-wf-row call">
                  <span className="v2-wf-label v2-mono"><span className="v2-ellipsis">{call.label}</span></span>
                  <span className="v2-wf-track"><i className={`tool ${call.state}`} style={{ left: pct(call.start), width: `calc(${pct(call.end)} - ${pct(call.start)})` }} /></span>
                  <span className="v2-mono v2-wf-dur">{duration(call.end - call.start)}</span>
                </div>),
              ])}
              {run.stage !== 'complete' && <span className="v2-now-line" aria-hidden="true" style={{ left: `calc(240px + (100% - 304px) * ${((now - t0) / (t1 - t0)).toFixed(4)})` }} />}
            </div>
          </div> : tab === 'log' ? <ol className="v2-log">{[...(run.events ?? [])].reverse().map((event, index) => <li key={`${event.at}-${index}`}><span className="v2-mono">{event.at ? clock(time(event.at)) : '—'}</span><b>{productionStageLabel(event.action, pt) === event.action ? event.action : productionStageLabel(event.action, pt)}</b><span className="v2-ellipsis">{event.detail}</span></li>)}</ol>
            : files.length ? <ul className="v2-log">{files.map((file) => <li key={file.label + file.name}><b>{file.label}</b><span className="v2-mono v2-ellipsis">{file.name}</span></li>)}</ul> : <p className="v2-empty">{pt ? 'Nenhum arquivo registrado nesta execução ainda.' : 'No files recorded in this run yet.'}</p>}
        </div>
      </section>

      <aside className="v2-inspector v2-run-inspector" aria-label={pt ? 'Inspetor' : 'Inspector'}>
        <div className="v2-insp-head">
          <div className="v2-insp-title"><StatusIcon size={16} state={step.state} /><h2 className="v2-ellipsis">{step.label}</h2><span className="v2-sub">{pt ? `Passo ${step.n} de ${plan.length}` : `Step ${step.n} of ${plan.length}`}</span></div>
          <div className="v2-insp-grid">
            <span><span className="v2-sub">{pt ? 'Quem' : 'Who'}</span><span className="v2-insp-who">{agentFace(step.agentId)}{step.who}</span></span>
            <span><span className="v2-sub">{pt ? 'Motor' : 'Engine'}</span><span>{step.user ? (pt ? 'revisão humana' : 'human review') : [step.provider, step.model].filter(Boolean).join(' · ') || '—'}</span></span>
            <span><span className="v2-sub">{pt ? 'Duração' : 'Duration'}</span><span className="v2-mono">{step.state === 'queued' ? '—' : duration(step.end - step.start)}</span></span>
            <span><span className="v2-sub">{pt ? 'Tokens · custo' : 'Tokens · cost'}</span><span className="v2-mono">{tokenText(tokensOf(step.calls), step.calls.some((c) => c.cost !== undefined) ? step.calls.reduce((sum, c) => sum + (c.cost ?? 0), 0) : undefined)}</span></span>
          </div>
        </div>
        {step.id === current?.id && (state === 'waiting' || state === 'failed' || state === 'paused') && <section className={state === 'waiting' ? 'v2-gate' : 'v2-gate v2-gate-danger'} aria-label={pt ? 'Ação necessária' : 'Action needed'}>
          <b>{state === 'waiting' ? (pt ? 'Esta etapa espera você' : 'This step waits on you') : state === 'failed' ? (pt ? 'A execução parou aqui' : 'The run stopped here') : (pt ? 'Execução pausada' : 'Run paused')}</b>
          <span className="v2-gate-text">{item.reason ?? progress.nextAction}</span>
          <div className="v2-actions">
            {item.detail && <button type="button" className="primary-button" onClick={() => onOpenControls(item)}>{state === 'waiting' ? (pt ? 'Revisar e decidir' : 'Review and decide') : (pt ? 'Abrir controles' : 'Open controls')}</button>}
            {canResume && <button type="button" className="soft-button" disabled={busy} onClick={() => void act('resume')}>{pt ? 'Retomar daqui' : 'Resume from here'}</button>}
          </div>
        </section>}
        <div className="v2-tabs" role="tablist" aria-label={pt ? 'Dados do passo' : 'Step data'}>
          <button type="button" role="tab" aria-selected={io === 'in'} onClick={() => setIo('in')}>{pt ? 'Entrada' : 'Input'}</button>
          <button type="button" role="tab" aria-selected={io === 'out'} onClick={() => setIo('out')}>{pt ? 'Saída' : 'Output'}</button>
          <button type="button" role="tab" aria-selected={io === 'state'} onClick={() => setIo('state')}>{pt ? 'Estado da execução' : 'Run state'}</button>
        </div>
        {kv.length ? <dl className="v2-kv">{kv.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p className="v2-sub v2-insp-note">{step.state === 'queued' ? (pt ? 'Ainda não começou. Entra quando as etapas anteriores terminarem.' : 'Not started yet. It runs after the previous steps finish.') : (pt ? 'Esta etapa ainda não terminou.' : 'This step has not finished yet.')}</p>}
        {step.calls.length > 0 && <section className="v2-insp-calls"><span className="v2-sub">{pt ? 'Chamadas de modelo' : 'Model calls'}</span>{step.calls.map((call) => <div key={call.id}><StatusIcon size={12} state={call.state} /><span className="v2-mono v2-ellipsis">{call.model ?? call.label}</span><span className="v2-mono v2-sub">{tokenText(call.tokens, call.cost)}</span></div>)}</section>}
      </aside>
    </div>
  </div>;
}
