import { useEffect, useState } from 'react';
import { Icon } from '../common/Icon';
import type { HyperframesEngine, MotionSpec, MotionStudy } from '../../features/references/model';
import { studyArtifactUrl } from '../../features/references/api';
import { formatRange, jobFor, jobPhase } from '../../features/references/viewModel';
import { errorText, type EditingReferencesApi } from '../../features/references/useEditingReferences';

export type StudySeed = { referenceId: string; start: number | null; end: number | null };
const formats: Array<{ id: string; label: [string, string]; width: number; height: number }> = [
  { id: 'vertical', label: ['Vertical 9:16', 'Vertical 9:16'], width: 1080, height: 1920 },
  { id: 'wide', label: ['Horizontal 16:9', 'Landscape 16:9'], width: 1920, height: 1080 },
  { id: 'square', label: ['Quadrado 1:1', 'Square 1:1'], width: 1080, height: 1080 },
];
const kinds: Array<{ id: MotionSpec['kind']; label: [string, string] }> = [
  { id: 'diagram', label: ['Diagrama de passos', 'Step diagram'] }, { id: 'title', label: ['Título', 'Title'] },
  { id: 'callout', label: ['Destaque', 'Callout'] }, { id: 'comparison', label: ['Comparação', 'Comparison'] },
];
const blankSpec = (title: string): MotionSpec => ({ title, text: '', kind: 'diagram', accent: '#5b8cff', background: '#0f1729', duration: 4, width: 1080, height: 1920, fps: 30 });

/** States of the local motion engine, each with what the person can do next. Nothing renders until it is ready. */
export function EngineStatus({ api, engine, pt, compact = false, onError }: { api: EditingReferencesApi; engine: HyperframesEngine; pt: boolean; compact?: boolean; onError: (message: string) => void }) {
  const job = engine.jobId ? api.snapshot?.jobs.find((item) => item.id === engine.jobId) ?? null : null;
  const prepare = async () => { try { await api.run({ type: 'engine.prepare' }); } catch (error) { onError(errorText(error, pt)); } };
  const text: Record<HyperframesEngine['status'], [string, string, string, string]> = {
    'not-configured': ['Motor de motion não preparado', 'Motion engine not prepared', 'Para gerar estudos e prévias, o app prepara o motor local uma vez. Nada é enviado para fora do seu computador.', 'To generate studies and previews, the app prepares the local engine once. Nothing leaves your computer.'],
    checking: ['Verificando o motor de motion…', 'Checking the motion engine…', 'Confirmando versão e dependências locais.', 'Confirming version and local dependencies.'],
    preparing: ['Preparando o motor de motion…', 'Preparing the motion engine…', 'Você pode continuar usando o app enquanto isso.', 'You can keep using the app meanwhile.'],
    ready: ['Motor de motion pronto', 'Motion engine ready', 'Estudos e prévias rodam localmente.', 'Studies and previews run locally.'],
    incompatible: ['Versão do motor incompatível', 'Incompatible engine version', `Esperada ${engine.expectedVersion}. Prepare de novo para instalar a versão certa.`, `Expected ${engine.expectedVersion}. Prepare again to install the right version.`],
    error: ['O motor de motion falhou', 'The motion engine failed', 'Tente preparar de novo. Se continuar, veja a mensagem abaixo.', 'Try preparing again. If it persists, see the message below.'],
  };
  const [title, titleEn, body, bodyEn] = text[engine.status];
  const working = engine.status === 'checking' || engine.status === 'preparing';
  return <section className={`er-engine ${engine.status} ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
    <span className="er-engine-dot" aria-hidden="true" />
    <div>
      <b>{pt ? title : titleEn}{engine.version && engine.status === 'ready' ? ` · ${engine.version}` : ''}</b>
      {!compact && <span>{pt ? body : bodyEn}</span>}
      {working && job && <span>{jobPhase(job)}</span>}
      {engine.message && engine.status !== 'ready' && <small>{engine.message}</small>}
    </div>
    {(engine.status === 'not-configured' || engine.status === 'incompatible' || engine.status === 'error') && <button type="button" className="primary-button" disabled={api.busy} onClick={() => void prepare()}>{engine.status === 'not-configured' ? (pt ? 'Preparar motor' : 'Prepare engine') : (pt ? 'Preparar de novo' : 'Prepare again')}</button>}
    {working && <span className="er-spinner" aria-hidden="true" />}
  </section>;
}

function StudyEditor({ api, study, seed, pt, onSaved, onClose, onError }: { api: EditingReferencesApi; study: MotionStudy | null; seed: StudySeed | null; pt: boolean; onSaved: (id: string) => void; onClose: () => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const reference = snapshot.references.find((item) => item.id === (study?.referenceId ?? seed?.referenceId));
  const [title, setTitle] = useState(study?.title ?? (reference ? `${pt ? 'Estudo' : 'Study'} · ${reference.title}` : ''));
  const [spec, setSpec] = useState<MotionSpec>(study?.spec ?? blankSpec(reference?.title ?? ''));
  useEffect(() => { if (study) { setTitle(study.title); setSpec(study.spec); } }, [study?.id, study?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof MotionSpec>(key: K, value: MotionSpec[K]) => setSpec((current) => ({ ...current, [key]: value }));
  const format = formats.find((item) => item.width === spec.width && item.height === spec.height)?.id ?? 'custom';
  const valid = title.trim() && spec.title.trim() && spec.duration > 0 && spec.duration <= 30;
  const save = async () => {
    try {
      const result = study
        ? await api.run({ type: 'study.update', id: study.id, expectedRevision: study.revision, title: title.trim(), spec })
        : await api.run({ type: 'study.create', title: title.trim(), referenceId: reference?.id, versionId: reference?.currentVersionId ?? undefined, spec });
      onSaved(study?.id ?? result.entityId ?? '');
    } catch (error) { onError(errorText(error, pt)); }
  };
  return <form className="er-study-form" onSubmit={(event) => { event.preventDefault(); if (valid) void save(); }}>
    <header><h3>{study ? (pt ? 'Ajustar estudo' : 'Adjust study') : (pt ? 'Novo estudo de motion' : 'New motion study')}</h3><button type="button" className="icon-button" aria-label={pt ? 'Fechar' : 'Close'} onClick={onClose}><Icon name="close" /></button></header>
    {reference && <p className="er-note">{pt ? 'Inspirado em' : 'Inspired by'} <b>{reference.title}</b>{seed?.start != null && seed.end != null ? ` · ${formatRange(seed.start, seed.end)}` : ''}. {pt ? 'O estudo recria a ideia com o seu texto; não copia o vídeo.' : 'The study recreates the idea with your text; it does not copy the video.'}</p>}
    <label className="er-field">{pt ? 'Nome do estudo' : 'Study name'}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label className="er-field">{pt ? 'Tipo' : 'Type'}<select value={spec.kind} onChange={(event) => set('kind', event.target.value as MotionSpec['kind'])}>{kinds.map((item) => <option key={item.id} value={item.id}>{item.label[pt ? 0 : 1]}</option>)}</select></label>
    <label className="er-field">{pt ? 'Título na tela' : 'On-screen title'}<input value={spec.title} onChange={(event) => set('title', event.target.value)} /></label>
    <label className="er-field">{pt ? 'Texto (uma etapa por linha)' : 'Text (one step per line)'}<textarea rows={4} value={spec.text} onChange={(event) => set('text', event.target.value)} /></label>
    <div className="er-grid-2">
      <label className="er-field">{pt ? 'Formato' : 'Format'}<select value={format} onChange={(event) => { const item = formats.find((entry) => entry.id === event.target.value); if (item) setSpec((current) => ({ ...current, width: item.width, height: item.height })); }}>{formats.map((item) => <option key={item.id} value={item.id}>{item.label[pt ? 0 : 1]}</option>)}{format === 'custom' && <option value="custom">{spec.width}×{spec.height}</option>}</select></label>
      <label className="er-field">{pt ? 'Duração (s)' : 'Duration (s)'}<input type="number" min={1} max={30} step={0.5} value={spec.duration} onChange={(event) => set('duration', Number(event.target.value))} /></label>
      <label className="er-field">{pt ? 'Cor de destaque' : 'Accent color'}<input type="color" value={spec.accent} onChange={(event) => set('accent', event.target.value)} /></label>
      <label className="er-field">{pt ? 'Fundo' : 'Background'}<input type="color" value={spec.background} onChange={(event) => set('background', event.target.value)} /></label>
    </div>
    <footer className="er-row"><button type="submit" className="primary-button" disabled={!valid || api.busy}>{study ? (pt ? 'Salvar ajuste' : 'Save adjustment') : (pt ? 'Criar estudo' : 'Create study')}</button><button type="button" className="text-link" onClick={onClose}>{pt ? 'Cancelar' : 'Cancel'}</button></footer>
  </form>;
}

function StudyCard({ api, study, pt, locale, onEdit, onError }: { api: EditingReferencesApi; study: MotionStudy; pt: boolean; locale: string; onEdit: () => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const [kitName, setKitName] = useState<string | null>(null);
  const video = study.artifacts.find((artifact) => artifact.kind === 'video');
  const frame = study.artifacts.find((artifact) => artifact.kind === 'frame');
  const job = jobFor(snapshot, study.id);
  const rendering = study.status === 'queued' || study.status === 'running';
  const inKit = snapshot.kit.find((item) => item.studyId === study.id && item.studyRevision === study.revision);
  const engineReady = snapshot.engine.status === 'ready';
  const reference = study.referenceId ? snapshot.references.find((item) => item.id === study.referenceId) : undefined;
  const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { onError(errorText(error, pt)); } };
  return <article className="er-study-card">
    <div className="er-preview" style={{ aspectRatio: `${study.spec.width} / ${study.spec.height}` }}>
      {video && study.status === 'completed'
        ? <video src={studyArtifactUrl(api.scope, study.id, video.id)} poster={frame ? studyArtifactUrl(api.scope, study.id, frame.id) : undefined} controls loop playsInline preload="metadata" aria-label={`${pt ? 'Prévia de' : 'Preview of'} ${study.title}`} />
        : rendering ? <div className="er-preview-state" role="status"><span className="er-spinner" aria-hidden="true" /><span>{jobPhase(job) || (pt ? 'Gerando prévia…' : 'Rendering preview…')}</span></div>
          : study.status === 'failed' || study.status === 'interrupted' ? <div className="er-preview-state danger" role="alert">{study.error ?? (pt ? 'A prévia falhou.' : 'The preview failed.')}</div>
            : <div className="er-preview-state">{pt ? 'Sem prévia ainda' : 'No preview yet'}</div>}
    </div>
    <div className="er-study-card-body">
      <b>{study.title}</b>
      <small>{kinds.find((item) => item.id === study.spec.kind)?.label[pt ? 0 : 1]} · {study.spec.duration}s · {study.spec.width}×{study.spec.height} · {pt ? 'versão' : 'version'} {study.revision}{reference ? ` · ${reference.title}` : ''}</small>
      {inKit && <span className="er-pill ok"><Icon name="spark" />{pt ? 'Esta versão está no kit' : 'This version is in the kit'}</span>}
      <div className="er-row">
        {rendering
          ? job && <button type="button" className="text-link" onClick={() => void attempt(() => api.run({ type: 'job.cancel', id: job.id }))}>{pt ? 'Cancelar' : 'Cancel'}</button>
          : <button type="button" className={video && study.status === 'completed' ? 'soft-button' : 'primary-button'} disabled={!engineReady || api.busy} title={engineReady ? undefined : (pt ? 'Prepare o motor de motion primeiro' : 'Prepare the motion engine first')} onClick={() => void attempt(() => api.run({ type: 'study.render', id: study.id, expectedRevision: study.revision }))}>{video ? (pt ? 'Gerar de novo' : 'Render again') : (pt ? 'Gerar prévia' : 'Render preview')}</button>}
        <button type="button" className="soft-button" disabled={rendering} onClick={onEdit}>{pt ? 'Ajustar' : 'Adjust'}</button>
        {video && study.status === 'completed' && !inKit && kitName == null && <button type="button" className="primary-button" onClick={() => setKitName(study.title)}>{pt ? 'Aprovar para o kit' : 'Approve to kit'}</button>}
      </div>
      {!engineReady && !rendering && <p className="er-note">{pt ? 'Para gerar a prévia, prepare o motor de motion no topo desta página.' : 'To render the preview, prepare the motion engine at the top of this page.'}</p>}
      {kitName != null && <form className="er-row er-kit-name" onSubmit={(event) => { event.preventDefault(); if (kitName.trim()) void attempt(async () => { await api.run({ type: 'kit.approve', studyId: study.id, expectedRevision: study.revision, name: kitName.trim() }); setKitName(null); }); }}>
        <label className="er-field">{pt ? 'Nome no kit' : 'Name in kit'}<input autoFocus value={kitName} onChange={(event) => setKitName(event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={!kitName.trim() || api.busy}>{pt ? 'Salvar no kit' : 'Save to kit'}</button>
        <button type="button" className="text-link" onClick={() => setKitName(null)}>{pt ? 'Cancelar' : 'Cancel'}</button>
      </form>}
      <time className="er-muted" dateTime={study.updatedAt}>{new Date(study.updatedAt).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
    </div>
  </article>;
}

/** Kit de motion: approved, reusable motion pieces, plus the studies that produce them. */
export function MotionKit({ api, seed, pt, locale, onSeedUsed, onError }: { api: EditingReferencesApi; seed: StudySeed | null; pt: boolean; locale: string; onSeedUsed: () => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const [editing, setEditing] = useState<{ study: MotionStudy | null; seed: StudySeed | null } | null>(seed ? { study: null, seed } : null);
  useEffect(() => { if (seed) { setEditing({ study: null, seed }); onSeedUsed(); } }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const studies = [...snapshot.studies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const kit = snapshot.kit.map((item) => ({ item, study: snapshot.studies.find((study) => study.id === item.studyId) })).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
  return <div className="er-kit">
    <EngineStatus api={api} engine={snapshot.engine} pt={pt} onError={onError} />
    <section aria-labelledby="er-kit-title">
      <header className="er-section-head"><div><h2 id="er-kit-title">{pt ? 'Kit de motion' : 'Motion kit'}</h2><p>{pt ? 'Peças aprovadas que os agentes podem usar nos seus vídeos, sempre na versão que você aprovou.' : 'Approved pieces agents can use in your videos, always at the version you approved.'}</p></div></header>
      {kit.length === 0 ? <p className="er-muted">{pt ? 'Nenhuma peça no kit. Gere a prévia de um estudo e aprove a versão que ficou boa.' : 'No pieces in the kit. Render a study preview and approve the version you like.'}</p>
        : <ul className="er-kit-list">{kit.map(({ item, study }) => {
          // The kit points at an immutable study version; show that version's video, not the latest draft.
          const approved = study?.versions?.find((version) => version.revision === item.studyRevision);
          const artifacts = approved?.artifacts ?? (study?.revision === item.studyRevision ? study.artifacts : []);
          const video = artifacts.find((artifact) => artifact.kind === 'video');
          const outdated = study && study.revision !== item.studyRevision;
          return <li key={item.id}>
            <div className="er-preview small" style={study ? { aspectRatio: `${study.spec.width} / ${study.spec.height}` } : undefined}>{video && study ? <video src={studyArtifactUrl(api.scope, study.id, video.id)} muted loop playsInline preload="metadata" onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)} onMouseLeave={(event) => event.currentTarget.pause()} aria-label={item.name} /> : <Icon name="spark" />}</div>
            <div><b>{item.name}</b><small>{study ? `${kinds.find((kind) => kind.id === study.spec.kind)?.label[pt ? 0 : 1]} · ${study.spec.duration}s` : ''} · {pt ? 'versão' : 'version'} {item.studyRevision}</small>{outdated && <small className="er-warn-text">{pt ? 'O estudo mudou depois; o kit continua com a versão aprovada.' : 'The study changed later; the kit keeps the approved version.'}</small>}{study && !video && <small className="er-warn-text">{pt ? 'A prévia desta versão não está disponível.' : 'This version preview is not available.'}</small>}</div>
          </li>;
        })}</ul>}
    </section>
    <section aria-labelledby="er-studies-title">
      <header className="er-section-head"><div><h2 id="er-studies-title">{pt ? 'Estudos' : 'Studies'}</h2><p>{pt ? 'Recrie uma ideia de movimento com o seu conteúdo, veja a prévia real e ajuste até aprovar.' : 'Recreate a motion idea with your content, watch the real preview and adjust until you approve.'}</p></div>
        {!editing && <button type="button" className="soft-button" onClick={() => setEditing({ study: null, seed: null })}><Icon name="plus" />{pt ? 'Novo estudo' : 'New study'}</button>}</header>
      {editing && <StudyEditor api={api} study={editing.study} seed={editing.seed} pt={pt} onSaved={() => setEditing(null)} onClose={() => setEditing(null)} onError={onError} />}
      {studies.length === 0 && !editing ? <p className="er-muted">{pt ? 'Nenhum estudo ainda. Abra uma referência e escolha “Criar estudo de motion”, ou crie um aqui.' : 'No studies yet. Open a reference and choose “Create motion study”, or create one here.'}</p>
        : <div className="er-study-grid">{studies.map((study) => <StudyCard key={study.id} api={api} study={study} pt={pt} locale={locale} onEdit={() => setEditing({ study, seed: null })} onError={onError} />)}</div>}
    </section>
  </div>;
}
