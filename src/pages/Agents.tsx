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
  const skillCount = agents.reduce((count, agent) => count + (agent.skills?.length ?? 0), 0);
  return (
    <div className={`team-workspace ${selected?'has-details':''}`}><div className="page agents-page" data-od-id="agents-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{currentWorkspace.name} / {t('Agents')}</p>
          <h1>{pt ? 'Sua equipe' : 'Your team'}</h1>
          <p>{t('Specialists with clear roles, tools, and working context.')}</p>
        </div>
        <button className="primary-button" onClick={onCreate} data-od-id="create-agent">
          <Icon name="plus" />
          {t('Create agent')}
        </button>
      </div>
      {agents.length > 0 && (
        <div className="agent-overview" aria-label={pt ? 'Resumo da equipe' : 'Team overview'}>
          <div>
            <strong>{agents.length}</strong>
            <span>{pt ? 'agentes no workspace' : 'agents in workspace'}</span>
          </div>
          <div>
            <strong>{activeCount}</strong>
            <span>{pt ? 'em atividade' : 'working now'}</span>
          </div>
          <div>
            <strong>{reviewCount}</strong>
            <span>{pt ? 'precisam de revisão' : 'need review'}</span>
          </div>
          <div>
            <strong>{skillCount}</strong>
            <span>{pt ? 'skills vinculadas' : 'associated skills'}</span>
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div className="collection-toolbar" data-od-id="agent-filters">
          <label className="search-field">
            <Icon name="search" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={pt ? 'Buscar por nome ou função…' : 'Search by name or role…'}
              aria-label={pt ? 'Buscar agentes' : 'Search agents'}
            />
          </label>
          <SelectMenu
            className="filter-select"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            ariaLabel={pt ? 'Status do agente' : 'Agent status'}
            options={[
              { value: 'all', label: pt ? 'Todos os status' : 'All statuses' },
              { value: 'working', label: pt ? 'Em atividade' : 'Working' },
              { value: 'review', label: t('Needs review') },
              { value: 'idle', label: t('Ready') },
            ]}
          />
          <SelectMenu
            ariaLabel={pt ? 'Filtrar por IA' : 'Filter by AI'}
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'all', label: pt ? 'Todas as IAs' : 'All AI providers' },
              ...Array.from(new Set(agents.map((agent) => agent.providerId ?? 'codex'))).map((id) => ({
                value: id,
                label: id === 'codex' ? 'Codex CLI' : id === 'claude' ? 'Claude Code CLI' : id,
              })),
            ]}
          />
          <span className="result-count" role="status">
            {filtered.length} {pt ? 'agentes' : 'agents'}
          </span>
        </div>
      )}
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
        <AgentList agents={filtered} selectedId={selected?.id} onSelect={setSelectedId} onConfigure={onSelect} onChat={onChat} />
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
      {agents.length>0 && <div className="team-page-tip"><Icon name="link"/><div><strong>{pt?'Contexto transforma especialistas em uma equipe.':'Context brings specialists together.'}</strong><p>{pt?'Organize as referências no Canvas e envie-as como contexto na conversa.':'Organize references on the Canvas and send them as conversation context.'}</p></div><a className="soft-button" href="#canvas">{pt?'Abrir Canvas':'Open Canvas'}</a></div>}
    </div>{selected && <AgentDetails key={selected.id} agent={selected} workspaceName={currentWorkspace.name} onClose={()=>setSelectedId(null)} onChat={()=>onChat(selected.id)} onConfigure={()=>onSelect(selected.id)}/>}</div>
  );
}
