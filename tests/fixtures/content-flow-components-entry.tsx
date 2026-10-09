// QA harness entry for F02/F04/F05 components in isolation (no app shell, no persistence, no network, no AI).
// All state/callbacks are mocks owned by this fixture; the components and their pure models are the real ones.
import {StrictMode, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocaleContext} from './language-stub';
import {InspirationLibrary} from '../../src/components/content/InspirationLibrary';
import {emptyInspirationState, type BriefingContext, type InspirationLibraryState} from '../../src/features/content/inspiration';
import {RecordingPackage} from '../../src/components/production/RecordingPackage';
import {type RecordingChecklistState, type RecordingRunInput} from '../../src/features/production/recordingPackage';
import {ThumbnailGallery} from '../../src/components/production/ThumbnailGallery';
import {
  applySource, approve, conceptSignature, createGalleryState, recordArtifact, selectConcept, updateConcept,
  type ThumbnailArtifact, type ThumbnailConceptId, type ThumbnailGalleryState, type ThumbnailItemStatus, type ThumbnailSource,
} from '../../src/features/production/thumbnailGallery';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'inspiration';
const locale = params.get('locale') === 'en-US' ? 'en-US' : 'pt-BR';
const pt = locale === 'pt-BR';
const log: Record<string, unknown[]> = {};
const note = (key: string, value: unknown) => { (log[key] ??= []).push(value); };
const fx: Record<string, any> = { log, view };
(window as any).__fx = fx;

// ---------- F05 ----------
const assets = [
  { id: 'a1', workspaceId: 'w1', name: 'camera-original.mp4', kind: 'video' },
  { id: 'a2', workspaceId: 'w2', name: 'other-workspace.mp4', kind: 'video' },
  { id: 'a3', workspaceId: 'w1', name: 'cover.png', kind: 'image' },
];
function InspirationHost() {
  const [workspaceId, setWorkspace] = useState('w1');
  const [state, setState] = useState<InspirationLibraryState>(emptyInspirationState());
  const [failNext, setFailNext] = useState(false);
  useEffect(() => { fx.setWorkspace = setWorkspace; fx.failNext = (v: boolean) => setFailNext(v); fx.state = () => state; });
  fx.state = () => state;
  return <>
    <div className="fx-bar"><button type="button" onClick={() => setWorkspace('w1')}>w1</button><button type="button" onClick={() => setWorkspace('w2')}>w2</button><span>workspace: {workspaceId}</span></div>
    <InspirationLibrary workspaceId={workspaceId} state={state} assets={assets}
      onChange={async next => { note('saves', next.references.length); if (failNext) { setFailNext(false); throw new Error('mock persistence failure'); } setState(next); }}
      onUseAsBriefing={(ctx: BriefingContext) => note('briefings', ctx)} />
  </>;
}

// ---------- F02 ----------
const v1 = { version: 1, hash: 'h1', hook: 'Hook um', cta: 'CTA um', text: 'Fala aprovada v1', path: { title: 'Caminho A', outline: ['Abrir com problema', 'Mostrar a solução'] }, improvisationTopics: ['bastidores'], thumbnailDirection: 'Rosto + produto' };
const v2 = { ...v1, version: 2, hash: 'h2', text: 'Fala editada v2' };
const scenarios: Record<string, RecordingRunInput> = {
  none: { scriptVersions: [] },
  unapproved: { scriptVersions: [v1], scriptApproval: null },
  stale: { scriptVersions: [v1, v2], scriptApproval: { version: 1, hash: 'h1' }, notion: { scriptVersion: 1, scriptHash: 'h1' } },
  notion: { scriptVersions: [v1], scriptApproval: { version: 1, hash: 'h1' }, notion: null },
  v1: { scriptVersions: [v1], scriptApproval: { version: 1, hash: 'h1' }, notion: { scriptVersion: 1, scriptHash: 'h1' } },
  v2: { scriptVersions: [v1, v2], scriptApproval: { version: 2, hash: 'h2' }, notion: { scriptVersion: 2, scriptHash: 'h2' } },
};
function RecordingHost() {
  const [scenario, setScenario] = useState(params.get('scenario') ?? 'v1');
  const [checklist, setChecklist] = useState<RecordingChecklistState | null>(null);
  const [busy, setBusy] = useState(false);
  fx.setScenario = setScenario; fx.setBusy = setBusy; fx.checklist = () => checklist;
  return <RecordingPackage run={scenarios[scenario]} pt={pt} busy={busy} checklist={checklist}
    onChecklistChange={next => { note('checklist', next); setChecklist(next); }} onImportVideo={() => note('import', scenario)}
    onSuggestionsChange={(version, hash, list) => note('suggestions', { version, hash, count: list.length })} />;
}

// ---------- F04 ----------
const formats = [{ id: 'reels', label: 'Reels 9:16', width: 1080, height: 1920 }, { id: 'feed', label: 'Feed 4:5', width: 1080, height: 1350 }];
const mockImage = (label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="270" height="480"><rect width="100%" height="100%" fill="#444"/><text x="20" y="60" fill="#fff" font-size="22">MOCK ${label}</text></svg>`)}`;
const sourceA: ThumbnailSource = { assetId: 'asset', versionId: 'v1', sha256: 'aaa' };
const sourceB: ThumbnailSource = { assetId: 'asset', versionId: 'v2', sha256: 'bbb' };
function GalleryHost() {
  const [source, setSource] = useState(sourceA);
  const [format, setFormat] = useState('reels');
  const [state, setState] = useState<ThumbnailGalleryState>(() => createGalleryState(sourceA));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Partial<Record<ThumbnailConceptId, ThumbnailItemStatus>>>({});
  const [failExport, setFailExport] = useState(false);
  fx.setSource = (which: 'A' | 'B') => { const next = which === 'A' ? sourceA : sourceB; setSource(next); setState(s => applySource(s, next)); };
  fx.setBusy = setBusy; fx.failExport = setFailExport; fx.state = () => state;
  fx.lateResult = () => setState(s => recordArtifact(s, sourceB, { conceptId: 'product', format: 'reels', assetId: 'late', sha256: 'x', width: 1, height: 1, sourceVersionId: 'v1', sourceSha256: 'aaa', inputsSignature: 'x' }));
  return <ThumbnailGallery state={state} source={source} formats={formats} format={format} pt={pt} busy={busy} status={status} sourceDurationSeconds={30}
    resolveAsset={async (artifact: ThumbnailArtifact) => { note('resolve', artifact.assetId); return mockImage(artifact.conceptId); }}
    onFormatChange={setFormat}
    onAdjust={(id, patch) => { note('adjust', id); setState(s => updateConcept(s, id, patch)); }}
    onSelect={id => setState(s => selectConcept(s, id))}
    onCancel={id => setStatus(s => ({ ...s, [id]: { state: 'idle' } }))}
    onGenerate={id => {
      note('generate', id);
      if (failExport) { setStatus(s => ({ ...s, [id]: { state: 'error', message: 'mock engine failure' } })); return; }
      setState(s => {
        const concept = s.concepts.find(c => c.id === id)!;
        return recordArtifact(s, source, { conceptId: id, format, assetId: `mock-${id}`, sha256: `sha-${id}`, width: 1080, height: 1920, sourceVersionId: source.versionId, sourceSha256: source.sha256, inputsSignature: conceptSignature(concept, format, source) });
      });
    }}
    onApprove={() => { note('approve', 1); setState(s => approve(s, source, format)); }} />;
}

function App() {
  return <LocaleContext.Provider value={locale}><div className="studio-shell fx-shell"><main className="fx-page">
    {view === 'inspiration' ? <InspirationHost /> : view === 'recording' ? <RecordingHost /> : <GalleryHost />}
  </main></div></LocaleContext.Provider>;
}
document.documentElement.dataset.appearance = params.get('theme') ?? 'light';
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
