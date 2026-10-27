import { useState } from 'react';
import type { Agent, AgentStatusValue } from '../features/agents/model/Agent';
import { AgentList } from '../components/agents/AgentList';
import { Icon } from '../components/common/Icon';
import { SelectMenu } from '../components/common/SelectMenu';
import { useLanguage } from '../app/LanguageProvider';
import { AgentDetails } from '../components/agents/AgentDetails';
import { useWorkspaces } from '../app/WorkspaceProvider';

export function Agents({
  agents,
  onSelect,
  onChat,
  onCreate,
}: {
  agents: readonly Agent[];
  onSelect: (agentId: string) => void;
  onChat: (agentId: string) => void;
  onCreate: () => void;
}) {
  const { locale, t } = useLanguage();
  const pt = locale === 'pt-BR';
  const {currentWorkspace} = useWorkspaces();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find(agent => agent.id === selectedId);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [status, setStatus] = useState<AgentStatusValue | 'all'>('all');
  const filtered = agents.filter(
    (agent) =>
      (status === 'all' || agent.status === status) &&
      (provider === 'all' || (agent.providerId ?? 'codex') === provider) &&
      [agent.name, agent.role, agent.description]
        .join(' ')
        .toLocaleLowerCase(locale)
        .includes(query.trim().toLocaleLowerCase(locale)),
  );
  const activeCount = agents.filter((agent) => agent.status === 'working').length;
  const reviewCount = agents.filter((agent) => agent.status === 'review').length;
  const providers = Array.from(new Set(agents.map((agent) => agent.providerId ?? 'codex')));
  const skillCount = agents.reduce((count, agent) => count + (agent.skills?.length ?? 0), 0);
  return (
    <div className={`team-workspace ${selected?'has-details':''}`}><div className="page agents-page ag" data-od-id="agents-page">
      <div className="ag-head">
        <div>
          <h1>{pt ? 'Sua equipe' : 'Your team'}</h1>
          <p>{agents.length
            ? [pt ? `${agents.length} agente${agents.length === 1 ? '' : 's'}` : `${agents.length} agent${agents.length === 1 ? '' : 's'}`,
               activeCount ? (pt ? `${activeCount} trabalhando agora` : `${activeCount} working now`) : '',
               reviewCount ? (pt ? `${reviewCount} com entrega para revisar` : `${reviewCount} with work to review`) : '',
               skillCount ? `${skillCount} skills` : ''].filter(Boolean).join(' · ') + '.'
            : t('Specialists with clear roles, tools, and working context.')}</p>
        </div>
        {agents.length > 0 && <>
          <label className="search-field">
            <Icon name="search" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pt ? 'Buscar por nome ou função…' : 'Search by name or role…'} aria-label={pt ? 'Buscar agentes' : 'Search agents'} />
          </label>
          <div className="ag-segment" role="group" aria-label={pt ? 'Filtrar por IA' : 'Filter by AI'} data-od-id="agent-filters">
            {[['all', pt ? 'Todas as IAs' : 'All AIs'], ...providers.map((id) => [id, id === 'claude' ? 'Claude' : id === 'gemini' ? 'Gemini' : 'Codex'])].map(([id, label]) => (
              <button key={id} aria-pressed={provider === id} onClick={() => setProvider(id)}>{label}</button>
            ))}
          </div>
          <SelectMenu className="filter-select" value={status} onChange={(value) => setStatus(value as typeof status)} ariaLabel={pt ? 'Status do agente' : 'Agent status'}
            options={[
              { value: 'all', label: pt ? 'Todos os status' : 'All statuses' },
              { value: 'working', label: pt ? 'Em atividade' : 'Working' },
              { value: 'review', label: t('Needs review') },
              { value: 'idle', label: t('Ready') },
            ]} />
        </>}
        <button className="primary-button" onClick={onCreate} data-od-id="create-agent">
          <Icon name="plus" />
          {t('Create agent')}
        </button>
      </div>
      {agents.length === 0 ? (
        <section className="work-panel workspace-empty" data-od-id="agents-empty">
          <span className="empty-symbol">
            <Icon name="users" />
          </span>
          <h2>{t('Create a specialist for your workflow')}</h2>
          <p>{t('Give an agent a clear role, add its skills, and start a conversation when it is ready.')}</p>
          <button className="soft-button" onClick={onCreate}>
            <Icon name="plus" />
            {t('Create your first agent')}
          </button>
        </section>
      ) : filtered.length ? (
        <div className="ag-grid">
          <AgentList agents={filtered} selectedId={selected?.id} onSelect={setSelectedId} onConfigure={onSelect} onChat={id=>{setSelectedId(null);onChat(id);}} />
          <button className="ag-new" onClick={onCreate}>
            <span aria-hidden="true"><Icon name="plus" /></span>
            <b>{t('Create agent')}</b>
            <small>{pt ? 'Um especialista para cada parte do trabalho. Escolha o boneco, a IA e as ferramentas.' : 'A specialist for each part of the work. Pick the mascot, the AI and the tools.'}</small>
          </button>
        </div>
      ) : (
        <section className="work-panel workspace-empty" data-od-id="agents-no-results">
          <h2>{t('No results')}</h2>
          <p>
            {pt
              ? 'Tente outro nome ou altere o filtro de status.'
              : 'Try a different name or change the status filter.'}
          </p>
          <button
            className="soft-button"
            onClick={() => {
              setQuery('');
              setStatus('all');
              setProvider('all');
            }}
          >
            {pt ? 'Limpar filtros' : 'Clear filters'}
          </button>
        </section>
      )}
    </div>{selected && <AgentDetails key={selected.id} agent={selected} workspaceName={currentWorkspace.name} onClose={()=>setSelectedId(null)} onChat={()=>{setSelectedId(null);onChat(selected.id);}} onConfigure={()=>onSelect(selected.id)}/>}</div>
  );
}
