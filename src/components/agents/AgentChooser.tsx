import { useState } from 'react';
import type { Agent } from '../../features/agents/model/Agent';
import { FlowDialog } from '../common/FlowDialog';
import { AgentAvatar } from './AgentAvatar';
import { Icon } from '../common/Icon';
import { useLanguage } from '../../app/LanguageProvider';

export function AgentChooser({
  agents,
  title,
  description,
  onChoose,
  onCreate,
  onClose,
}: {
  agents: readonly Agent[];
  title: string;
  description: string;
  onChoose: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { locale, t } = useLanguage();
  const [query, setQuery] = useState('');
  const filtered = agents.filter((agent) =>
    `${agent.name} ${agent.role}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
  );
  return (
    <FlowDialog title={title} description={description} onClose={onClose}>
      <label className="search-field">
        <Icon name="search" />
        <input
          data-autofocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={locale === 'pt-BR' ? 'Buscar agente…' : 'Search agents…'}
          aria-label={t('Agents')}
        />
      </label>
      <div className="flow-options">
        {filtered.map((agent) => (
          <button key={agent.id} className="flow-option" onClick={() => onChoose(agent.id)}>
            <AgentAvatar name={agent.name} image={agent.avatarImage} />
            <span>
              <b>{agent.name}</b>
              <small>{agent.role}</small>
            </span>
            <Icon name="chevron" />
          </button>
        ))}
        {!filtered.length && (
          <p className="flow-empty">
            {agents.length
              ? t('No results')
              : locale === 'pt-BR'
                ? 'Crie um agente para começar.'
                : 'Create an agent to get started.'}
          </p>
        )}
      </div>
      <footer>
        <button className="soft-button" onClick={onCreate}>
          <Icon name="plus" />
          {t('Create agent')}
        </button>
        <button className="soft-button" onClick={onClose}>
          {t('Cancel')}
        </button>
      </footer>
    </FlowDialog>
  );
}
