import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageId } from '../../app/types';
import type { Agent } from '../../features/agents/model/Agent';
import { ChatPanel } from '../chat/ChatPanel';
import { useLanguage } from '../../app/LanguageProvider';
import { usePersistentState } from '../../data/localPersistence';

interface RightPanelProps {
  onSelectAgent: (agentId: string) => void;
  agent: Agent;
  onNavigate: (page: PageId) => void;
  onEditAgent: (agentId: string) => void;
  onToast: (message: string) => void;
  onProviderSettings: () => void;
  presentation: 'side' | 'floating';
  onTogglePresentation: () => void;
  onClose: () => void;
}
export function RightPanel({
  onSelectAgent,
  agent,
  onNavigate,
  onEditAgent,
  onToast,
  onProviderSettings,
  presentation,
  onTogglePresentation,
  onClose,
}: RightPanelProps) {
  const { locale } = useLanguage();
  const panelRef = useRef<HTMLElement>(null);
  const [width, setWidth] = usePersistentState<number>('studio-conversation-width', 320);
  useEffect(() => {
    document.documentElement.style.setProperty('--inspector-w', `${width}px`);
  }, [width]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, presentation]);
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const initialWidth = width;
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale') || 1);
    const move = (next: PointerEvent) => setWidth(Math.max(280, Math.min(520, initialWidth + (next.clientX - startX) / scale)));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  return (
    <aside className="inspector" ref={panelRef}>
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={locale === 'pt-BR' ? 'Redimensionar painel de chat' : 'Resize chat panel'}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setWidth(Math.max(280, width - 20));
          if (event.key === 'ArrowRight') setWidth(Math.min(520, width + 20));
        }}
      />
      <ChatPanel
        onSelectAgent={onSelectAgent}
        onProviderSettings={onProviderSettings}
        agent={agent}
        onNavigateHistory={() => onNavigate('sessions')}
        onNavigateSettings={() => onEditAgent(agent.id)}
        onOpenCanvas={() => onNavigate('canvas')}
        onToast={onToast}
        presentation={presentation}
        onTogglePresentation={onTogglePresentation}
        onClose={onClose}
      />
    </aside>
  );
}
