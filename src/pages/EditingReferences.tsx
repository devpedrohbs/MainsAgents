import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/common/Icon';
import { useLanguage } from '../app/LanguageProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { usePersistentState } from '../data/localPersistence';
import { useEditingReferences } from '../features/references/useEditingReferences';
import { offerReferenceToStudio } from '../features/references/viewModel';
import { ReferenceLibrary } from '../components/references/ReferenceLibrary';
import { AddReferencePanel } from '../components/references/AddReferencePanel';
import { ReferenceStudy } from '../components/references/ReferenceStudy';
import { StyleGuidelines } from '../components/references/StyleGuidelines';
import { MotionKit, type StudySeed } from '../components/references/MotionKit';
import '../styles/editing-references.css';

type View = 'library' | 'style' | 'kit';
type Toast = { message: string; tone: 'info' | 'danger'; undo?: () => Promise<void> };


export function EditingReferences({ onOpenStudio }: { onOpenStudio: (contentId?: string) => void }) {
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const { currentWorkspaceId } = useWorkspaces();
  const api = useEditingReferences(currentWorkspaceId);
  const [view, setView] = usePersistentState<View>('editing-references-view', 'library');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [seed, setSeed] = useState<StudySeed | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (next: Toast) => { setToast(next); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(null), next.undo ? 7000 : 4500); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onError = (message: string) => show({ message, tone: 'danger' });
  const open = (id: string) => { setAdding(false); setView('library'); setOpenId(id); };
  const snapshot = api.snapshot;
  const views: Array<[View, string, string]> = [['library', pt ? 'Referências' : 'References', pt ? 'Vídeos que você estuda' : 'Videos you study'], ['style', pt ? 'Meu estilo' : 'My style', pt ? 'O que os agentes seguem' : 'What agents follow'], ['kit', pt ? 'Kit de motion' : 'Motion kit', pt ? 'Peças aprovadas' : 'Approved pieces']];

  const body = () => {
    if (api.state.kind === 'loading' && !snapshot) return <div className="er-state" role="status"><span className="er-spinner" aria-hidden="true" />{pt ? 'Carregando referências…' : 'Loading references…'}</div>;
    if (api.state.kind === 'unavailable') return <div className="er-empty"><span className="er-empty-mark"><Icon name="settings" /></span><h2>{pt ? 'Referências de edição não estão disponíveis nesta versão' : 'Editing references are not available in this version'}</h2><p>{pt ? 'O serviço local de referências não respondeu. Atualize o app ou reinicie-o para ativar a biblioteca.' : 'The local references service did not respond. Update or restart the app to enable the library.'}</p><button type="button" className="soft-button" onClick={() => void api.refresh()}>{pt ? 'Tentar de novo' : 'Try again'}</button></div>;
    if (api.state.kind === 'error' && !snapshot) return <div className="er-empty"><h2>{pt ? 'Não foi possível abrir as referências' : 'Could not open references'}</h2><p className="er-callout danger">{api.state.message}</p><button type="button" className="soft-button" onClick={() => void api.refresh()}>{pt ? 'Tentar de novo' : 'Try again'}</button></div>;
    if (!snapshot) return null;
    if (view === 'library' && openId) return <ReferenceStudy api={api} referenceId={openId} pt={pt} locale={locale} onBack={() => setOpenId(null)} onError={onError}
      onCreateStudy={(referenceId, range) => { setSeed({ referenceId, start: range?.start ?? null, end: range?.end ?? null }); setOpenId(null); setView('kit'); }}
      onUseInStudio={(referenceId) => { offerReferenceToStudio(referenceId); onOpenStudio(); }} />;
    if (view === 'style') return <StyleGuidelines api={api} pt={pt} locale={locale} onOpenReference={open} onError={onError} />;
    if (view === 'kit') return <MotionKit api={api} seed={seed} pt={pt} locale={locale} onSeedUsed={() => setSeed(null)} onError={onError} />;
    return <ReferenceLibrary api={api} pt={pt} locale={locale} onOpen={open} onAdd={() => setAdding(true)} onError={onError} onUndoable={(message, undo) => show({ message, tone: 'info', undo })} />;
  };

  return <div className="page er-page v2-team v2-page" data-od-id="editing-references">
    <header className="er-head v2-header">
      <div className="er-head-title"><h1>{pt ? 'Referências de edição' : 'Editing references'}</h1><p>{pt ? 'Ensine aos agentes como você edita: estude vídeos, aprove orientações e monte seu kit de motion.' : 'Teach agents how you edit: study videos, approve guidance and build your motion kit.'}</p></div>
      <nav className="er-views" aria-label={pt ? 'Seções' : 'Sections'}>
        {views.map(([id, label, hint]) => <button type="button" key={id} aria-current={view === id && !(id === 'library' && openId) ? 'page' : undefined} className={view === id ? 'active' : ''} title={hint} onClick={() => { setView(id); setOpenId(null); }}>
          {label}{id === 'style' && snapshot ? <small>{snapshot.guidelines.filter((item) => item.enabled).length}</small> : id === 'kit' && snapshot ? <small>{snapshot.kit.length}</small> : null}
        </button>)}
      </nav>
      {snapshot && view === 'library' && !openId && <button type="button" className="primary-button er-add-button" onClick={() => setAdding(true)}><Icon name="plus" />{pt ? 'Adicionar referência' : 'Add reference'}</button>}
    </header>
    <main className={`er-body ${adding ? 'with-panel' : ''}`}>
      <div className="er-body-main">{body()}</div>
      {adding && snapshot && <AddReferencePanel api={api} defaultFolder={null} pt={pt} onClose={() => setAdding(false)} onOpen={open} />}
    </main>
    {toast && <div className={`er-toast ${toast.tone}`} role={toast.tone === 'danger' ? 'alert' : 'status'}>
      <span>{toast.message}</span>
      {toast.undo && <button type="button" className="text-link" onClick={() => { const undo = toast.undo!; setToast(null); void undo().then(() => show({ message: pt ? 'Desfeito.' : 'Undone.', tone: 'info' })).catch((error) => onError(error instanceof Error ? error.message : String(error))); }}>{pt ? 'Desfazer' : 'Undo'}</button>}
      <button type="button" className="icon-button" aria-label={pt ? 'Fechar aviso' : 'Dismiss'} onClick={() => setToast(null)}><Icon name="close" /></button>
    </div>}
  </div>;
}
