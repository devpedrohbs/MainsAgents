import type { PageId } from '../../app/types';
import { Icon } from '../common/Icon';
import { Breadcrumbs } from './Breadcrumbs';
import { useLanguage } from '../../app/LanguageProvider';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { CodexUsagePopover } from './CodexUsagePopover';
import { SaveIndicator } from './SaveIndicator';

interface TopbarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onOpenCommand: () => void;
  onCreate: () => void;
  onTogglePanel: () => void;
  onToggleNav: () => void;
  panelOpen: boolean;
  hasAgent: boolean;
}
export function Topbar({
  page,
  onNavigate,
  onOpenCommand,
  onCreate,
  onTogglePanel,
  onToggleNav,
  panelOpen,
  hasAgent,
}: TopbarProps) {
  const { locale, t } = useLanguage();
  return (
    <header className="topbar" data-od-id="topbar">
      <button
        className="icon-button mobile-menu-button"
        onClick={onToggleNav}
        aria-label={locale === 'pt-BR' ? 'Abrir navegação' : 'Open navigation'}
        aria-controls="workspace-navigation"
      >
        <Icon name="menu" />
      </button>
      <div className="studio-project"><WorkspaceSwitcher /><Breadcrumbs page={page} onNavigate={onNavigate} /></div>
      <div className="top-actions">
        <SaveIndicator />
        <CodexUsagePopover />
        <button
          className="soft-button global-search"
          onClick={onOpenCommand}
          data-od-id="global-search"
          aria-label={
            locale === 'pt-BR' ? 'Buscar agentes, tarefas e sessões' : 'Search agents, tasks and sessions'
          }
        >
          <Icon name="search" />
          <span>{locale === 'pt-BR' ? 'Buscar no workspace…' : 'Search workspace…'}</span>
          <span className="kbd">Ctrl K</span>
        </button>
        <button
          className="soft-button chat-toggle"
          onClick={onTogglePanel}
          aria-label={t('Toggle chat panel')}
          aria-pressed={panelOpen}
          disabled={!hasAgent}
          title={
            !hasAgent
              ? locale === 'pt-BR'
                ? 'Crie um agente para conversar'
                : 'Create an agent to start chatting'
              : t('Toggle chat panel')
          }
          data-od-id="toggle-chat"
        >
          <Icon name="message" />
          <span>{t('Chat')}</span>
        </button>
        <button
          className="primary-button global-create"
          onClick={onCreate}
          aria-label={locale === 'pt-BR' ? 'Criar' : 'Create'}
        >
          <Icon name="plus" />
          <span>{locale === 'pt-BR' ? 'Criar' : 'Create'}</span>
        </button>
      </div>
    </header>
  );
}
