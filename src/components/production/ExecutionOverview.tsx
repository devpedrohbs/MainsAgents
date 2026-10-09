import {useProduction} from '../../features/production/ProductionProvider';
import {useWorkspaces} from '../../app/WorkspaceProvider';
import {useLanguage} from '../../app/LanguageProvider';
import {useAgents} from '../../features/agents/AgentsProvider';
import {usePersistentState} from '../../data/localPersistence';
import {executionOverview, executionStates, executionStateLabel, filterExecutions, type ExecutionFilter, type ExecutionOverviewItem} from './ExecutionOverviewProjection';
import './ExecutionOverview.css';

export function ExecutionOverview({onOpen, onOpenChat}: {
  onOpen: (item: ExecutionOverviewItem) => void;
  onOpenChat: (item: ExecutionOverviewItem) => void;
}) {
  const {runs, ready, error} = useProduction();
  const {currentWorkspaceId} = useWorkspaces();
  const {locale} = useLanguage();
  const {agents} = useAgents();
  const pt = locale === 'pt-BR';
  const [savedFilter, setFilter] = usePersistentState<ExecutionFilter>(`execution-overview-filter:${currentWorkspaceId}`, 'all');
  const filter = savedFilter === 'all' || executionStates.includes(savedFilter) ? savedFilter : 'all';
  const items = executionOverview(runs, currentWorkspaceId, pt);
  const visible = filterExecutions(items, filter);
  return <section className="execution-overview work-panel" aria-labelledby="executions-heading" data-od-id="execution-overview">
    <div className="panel-heading"><h2 id="executions-heading">{pt ? 'Execuções de produção' : 'Production executions'}</h2><span className="neutral-count">{items.length}</span></div>
    <div className="execution-filters" role="group" aria-label={pt ? 'Filtrar execuções' : 'Filter executions'}>
      {(['all', ...executionStates] as const).map(state => <button key={state} aria-pressed={filter === state} onClick={() => setFilter(state)} data-od-id={`execution-filter-${state}`}>
        {executionStateLabel(state, pt)} <span>{state === 'all' ? items.length : items.filter(item => item.state === state).length}</span>
      </button>)}
    </div>
    {error && <p className="execution-notice" role="status">{pt ? 'Não foi possível atualizar. Os dados abaixo podem estar desatualizados.' : 'Could not refresh. Data below may be out of date.'} {error}</p>}
    {!ready && !error ? <p className="execution-notice" role="status">{pt ? 'Consultando execuções…' : 'Loading executions…'}</p> : !visible.length ? <p className="execution-notice">{items.length ? (pt ? 'Nenhuma execução neste filtro.' : 'No executions match this filter.') : (pt ? 'As produções deste workspace aparecerão aqui.' : 'Productions in this workspace will appear here.')}</p> : <ul className="execution-list">
      {visible.map(item => {
        const chatAvailable = item.chat && agents.some(agent => agent.id === item.chat?.agentId && agent.workspaceId === currentWorkspaceId);
        return <li key={item.id} data-od-id={`execution-${item.id}`}>
          <div className="execution-title"><strong>{item.name}</strong><span className="execution-state">{executionStateLabel(item.state, pt)}</span></div>
          <dl><div><dt>{pt ? 'Etapa' : 'Stage'}</dt><dd>{item.stageLabel}</dd></div><div><dt>{pt ? 'Agente' : 'Agent'}</dt><dd>{item.agentName || (pt ? 'Não confirmado' : 'Unconfirmed')}</dd></div><div><dt>{pt ? 'Atualização' : 'Updated'}</dt><dd>{item.updatedAt ? <time dateTime={item.updatedAt}>{new Intl.DateTimeFormat(locale, {dateStyle: 'short', timeStyle: 'short'}).format(new Date(item.updatedAt))}</time> : (pt ? 'Não informada' : 'Not recorded')}</dd></div></dl>
          <p className="execution-reason">{item.reason}</p>
          <div className="execution-actions"><button className="soft-button" disabled={!item.detail} onClick={() => onOpen(item)} aria-label={`${pt ? 'Abrir produção' : 'Open production'}: ${item.name}`}>{pt ? 'Abrir produção' : 'Open production'}</button><button className="text-link" disabled={!chatAvailable} onClick={() => onOpenChat(item)} aria-label={`${pt ? 'Abrir chat' : 'Open chat'}: ${item.name}`}>{pt ? 'Abrir chat' : 'Open chat'}</button></div>
          {(!item.detail || !chatAvailable) && <p className="execution-reason">{pt ? 'Atalhos indisponíveis quando o histórico não confirma a produção, a sessão ou o agente neste workspace.' : 'Shortcuts are unavailable when history does not confirm the production, session or agent in this workspace.'}</p>}
        </li>;
      })}
    </ul>}
  </section>;
}
