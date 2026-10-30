import type { PageId } from '../../app/types';
import { Icon } from '../common/Icon';
import { Breadcrumbs } from './Breadcrumbs';
import { useLanguage } from '../../app/LanguageProvider';

interface TopbarProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onToggleNav: () => void;
}
/** V2 has no top bar on desktop: pages own their 44px header. This strip only opens the navigation on narrow windows. */
export function Topbar({ page, onNavigate, onToggleNav }: TopbarProps) {
  const { locale } = useLanguage();
  return (
    <header className="topbar v2-mobile-bar" data-od-id="topbar">
      <button
        className="icon-button mobile-menu-button"
        onClick={onToggleNav}
        aria-label={locale === 'pt-BR' ? 'Abrir navegação' : 'Open navigation'}
        aria-controls="workspace-navigation"
      >
        <Icon name="menu" />
      </button>
      <div className="studio-project"><Breadcrumbs page={page} onNavigate={onNavigate} /></div>
    </header>
  );
}
