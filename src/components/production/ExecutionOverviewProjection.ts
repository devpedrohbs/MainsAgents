import type {ProductionRun} from '../../features/production/model';
import {productionProgress} from '../../features/production/productionProgress.ts';

export const executionStates = ['active', 'waiting', 'paused', 'blocked', 'complete', 'canceled', 'unknown'] as const;
export type ExecutionState = typeof executionStates[number];
export type ExecutionFilter = ExecutionState | 'all';
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
const linearStages = ['writing', 'script-review', 'notion', 'recording', 'planning-edit', 'editing', 'video-review', 'platforms', 'preparing-package', 'generating-cover', 'covers-review', 'package-review', 'schedule', 'scheduling'];
/** Mirrors the progress contract's stop evidence, using stage codes rather than translated labels. */
function agentStage(run: ProductionRun) {
  if (!['paused', 'blocked', 'canceled'].includes(run.stage)) return run.stage;
  const resume = linearStages.includes(run.resumeStage ?? '') ? run.resumeStage : undefined;
  let recorded: string | undefined;
  for (const event of [...(run.events ?? [])].reverse()) {
    if (linearStages.includes(event.action)) { recorded = event.action; break; }
    if (event.action === 'idea-approved') { recorded = 'writing'; break; }
  }
  return run.stage === 'canceled' ? recorded ?? resume : resume ?? recorded;
}
export function executionStateLabel(state: ExecutionFilter, pt = true): string {
  const labels: Record<ExecutionFilter, [string, string]> = {
    all: ['Todas', 'All'], active: ['Em execução', 'Running'], waiting: ['Aguardando você', 'Waiting for you'],
    paused: ['Pausadas', 'Paused'], blocked: ['Bloqueadas', 'Blocked'], complete: ['Concluídas', 'Completed'],
    canceled: ['Canceladas', 'Canceled'], unknown: ['Estado desconhecido', 'Unknown state'],
  };
  return labels[state][pt ? 0 : 1];
}

/** Only the provider's current profile is consumed; workspace filtering precedes every projection. */
export function executionOverview(runs: readonly ProductionRun[], workspaceId: string, pt = true) {
  return runs.filter(run => run && run.workspaceId === workspaceId && text(run.id)).map(original => {
    const run: ProductionRun = {...original, stage: text(original.stage) ?? 'unknown', resumeStage: text(original.resumeStage), error: text(original.error), updatedAt: text(original.updatedAt) ?? '', events: Array.isArray(original.events) ? original.events.filter(event => event && typeof event.action === 'string') : []};
    const progress = productionProgress(run, pt);
    const stage = agentStage(run);
    const editor = ['planning-edit', 'editing', 'video-review'].includes(stage ?? '');
    const publisher = ['preparing-package', 'generating-cover', 'package-review', 'platforms', 'schedule', 'scheduling', 'complete'].includes(stage ?? '');
    const agent = editor ? run.editorAgent : publisher ? run.publisherAgent ?? run.sourceAgent : run.sourceAgent;
    const session = editor ? run.editorSession : publisher ? run.publisherSession ?? run.sourceSession : run.sourceSession;
    const agentKnown = progress.state !== 'unknown' && (!['paused', 'blocked', 'canceled'].includes(run.stage) || !!progress.stoppedAt);
    return {
      id: run.id, name: text(run.name) || text(run.topic?.title) || (pt ? 'Produção sem título' : 'Untitled production'),
      state: progress.state, stageLabel: progress.stoppedAt ?? progress.stageLabel,
      agentName: agentKnown ? text(agent?.name) : undefined,
      reason: progress.reason || (progress.state === 'active'
        ? run.step?.phase === 'queued' ? (pt ? 'Etapa aguardando o executor.' : 'Step waiting for the executor.')
          : (pt ? 'Etapa automática; atividade do executor não confirmada nesta lista.' : 'Automatic stage; executor activity is not confirmed in this list.')
        : progress.nextAction),
      updatedAt: Number.isFinite(Date.parse(run.updatedAt)) ? run.updatedAt : undefined,
      chat: agentKnown && text(session?.id) && text(session?.agentId) && session.agentId === agent?.id ? {agentId: session.agentId, sessionId: session.id} : undefined,
      detail: text(run.flowId) && text(run.sourceSession?.id) && text(run.editorSession?.id) && text(run.sourceAgent?.id) && text(run.editorAgent?.id) && text(run.topic?.title)
        && runs.filter(other => other && other.workspaceId === workspaceId && other.flowId === run.flowId).every(other => other.sourceSession && other.editorSession)
        ? {workspaceId: run.workspaceId, flowId: run.flowId, sessionId: run.sourceSession.id, runId: run.id} : undefined,
    };
  }).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.id.localeCompare(b.id));
}
export type ExecutionOverviewItem = ReturnType<typeof executionOverview>[number];
export function filterExecutions(items: ExecutionOverviewItem[], filter: ExecutionFilter) {
  return filter === 'all' ? items : items.filter(item => item.state === filter);
}
