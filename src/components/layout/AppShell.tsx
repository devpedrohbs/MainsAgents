import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { RightPanel } from './RightPanel';
import { useLanguage } from '../../app/LanguageProvider';
import { useChat } from '../../features/chat/ChatProvider';
import { AgentCollaboration } from '../chat/AgentCollaboration';

interface AppShellProps extends PropsWithChildren {
  page: PageId;
  agents: readonly Agent[];
  activeAgent?: Agent;
  panelOpen: boolean;
  chatPresentation: 'side' | 'floating';
  focusMode: boolean;
  onToggleChatPresentation: () => void;
  onNavigate: (page: PageId) => void;
  onSelectAgent: (agentId: string) => void;
  onEditAgent: (agentId: string) => void;
  onTogglePanel: () => void;
  onOpenCommand: () => void;
  onCreate: () => void;
  onProviderSettings: () => void;
  onToast: (message: string) => void;
}
export function AppShell({
  page,
  agents,
  activeAgent,
  panelOpen,
  chatPresentation,
  focusMode,
  onToggleChatPresentation,
  onNavigate,
  onSelectAgent,
  onEditAgent,
  onTogglePanel,
  onOpenCommand,
  onCreate,
  onProviderSettings,
  onToast,
  children,
}: AppShellProps) {
  const { locale } = useLanguage();
  const { collaborationId } = useChat();
  const [navOpen, setNavOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const showPanel = panelOpen && Boolean(activeAgent);
  const floating = showPanel && chatPresentation === 'floating';
  const closeNav = () => setNavOpen(false);
  useEffect(() => {
    if (!navOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = shellRef.current?.querySelector<HTMLElement>('.sidebar');
    sidebar?.querySelector<HTMLElement>('button,a')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
      }
      if (event.key === 'Tab') {
        const items = Array.from(
          sidebar?.querySelectorAll<HTMLElement>('button,a[href],input,select,[tabindex="0"]') ?? [],
        ).filter((item) => item.offsetParent !== null);
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const media = window.matchMedia('(min-width: 761px)');
    const resize = () => {
      if (media.matches) setNavOpen(false);
    };
    document.addEventListener('keydown', key);
    media.addEventListener('change', resize);
    return () => {
      document.removeEventListener('keydown', key);
      media.removeEventListener('change', resize);
      previous?.focus();
    };
  }, [navOpen]);
  return (
    <div
      ref={shellRef}
      className={[
        'app-shell studio-shell',
        showPanel && !floating ? '' : 'inspector-collapsed',
        focusMode ? 'focus-mode-enabled' : '',
        navOpen ? 'mobile-nav-open' : '',
      ].join(' ')}
      data-od-id="app-shell"
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        {locale === 'pt-BR' ? 'Pular para o conteúdo' : 'Skip to content'}
      </a>
      {navOpen && (
        <button
          className="nav-backdrop"
          aria-label={locale === 'pt-BR' ? 'Fechar navegação' : 'Close navigation'}
          onClick={closeNav}
          tabIndex={-1}
        />
      )}
      <Sidebar
        currentPage={page}
        agents={agents}
        onNavigate={(next) => {
          onNavigate(next);
          closeNav();
        }}
        onSelectAgent={(id) => {
          onSelectAgent(id);
          closeNav();
        }}
        onClose={closeNav}
        onOpenCommand={() => {
          closeNav();
          onOpenCommand();
        }}
      />
        <Topbar
          onCreate={onCreate}
          page={page}
          onNavigate={onNavigate}
          onOpenCommand={onOpenCommand}
          onTogglePanel={onTogglePanel}
          onToggleNav={() => setNavOpen(true)}
          panelOpen={showPanel}
          hasAgent={Boolean(activeAgent)}
        />
      <main className="main" inert={navOpen} data-od-id="main-region">
        <div className="view" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </main>
      {showPanel && activeAgent && !collaborationId && (
        <div className={'chat-layer ' + (floating ? 'floating' : '')} inert={navOpen}>
          {floating && (
            <button
              className="chat-floating-backdrop"
              aria-label={locale === 'pt-BR' ? 'Fechar chat' : 'Close chat window'}
              onClick={onTogglePanel}
            />
          )}
          <RightPanel
            onSelectAgent={onSelectAgent}
            onProviderSettings={onProviderSettings}
            agent={activeAgent}
            onNavigate={onNavigate}
            onEditAgent={onEditAgent}
            onToast={onToast}
            presentation={chatPresentation}
            onTogglePresentation={onToggleChatPresentation}
            onClose={onTogglePanel}
          />
        </div>
      )}
      {collaborationId&&<AgentCollaboration onCreateCanvas={()=>{if(showPanel)onTogglePanel();onNavigate('canvas');}} onNavigate={onNavigate} onEditAgent={onEditAgent} onProviderSettings={onProviderSettings} onToast={onToast}/>}
    </div>
  );
}
