import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../common/Icon';
import type { EditingReference, ReferenceAnalysis, ReferenceMarker, ReferenceObservation } from '../../features/references/model';
import { referenceFrameUrl, referenceVideoUrl } from '../../features/references/api';
import { coverageSummary, currentVersion, formatRange, formatTime, jobFor, jobPhase, observationDecision, observationResolved, referenceAnalyses, referenceStatus, runningJob, statusLabel } from '../../features/references/viewModel';
import { errorText, type EditingReferencesApi } from '../../features/references/useEditingReferences';
import { StatusChip } from './StatusChip';

type Range = { start: number; end: number };
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Real player over the managed copy. Frame stepping uses the fps the backend measured (falls back to 1/30 s, labelled). */
function Player({ src, fps, duration, time, setTime, selection, setSelection, markers, analysis, pt, videoRef }: { src: string; fps: number | null; duration: number; time: number; setTime: (value: number) => void; selection: Range | null; setSelection: (value: Range | null) => void; markers: ReferenceMarker[]; analysis: ReferenceAnalysis | null; pt: boolean; videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const step = 1 / (fps ?? 30);
  const seek = (value: number) => { const video = videoRef.current; const next = Math.min(Math.max(0, value), duration); if (video) video.currentTime = next; setTime(next); };
  const toggle = () => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); };
  const markIn = () => { setPendingIn(time); setSelection(null); };
  const markOut = () => { const start = pendingIn ?? 0; if (time > start) { setSelection({ start, end: time }); setPendingIn(null); } };
  const keys = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select')) return;
    const map: Record<string, () => void> = { ' ': toggle, k: toggle, ArrowLeft: () => seek(time - (event.shiftKey ? 1 : step)), ArrowRight: () => seek(time + (event.shiftKey ? 1 : step)), i: markIn, o: markOut, Home: () => seek(0), End: () => seek(duration) };
    const action = map[event.key];
    if (action) { event.preventDefault(); action(); }
  };
  const frame = Math.round(time * (fps ?? 30));
  const pct = (value: number) => `${(value / Math.max(duration, 0.001)) * 100}%`;
  const coverage = analysis ? coverageSummary(analysis) : null;
  return <div className="er-player" onKeyDown={keys}>
    <div className="er-video">
      <video ref={videoRef} src={src} preload="metadata" playsInline onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle} aria-label={pt ? 'Vídeo de referência' : 'Reference video'} />
    </div>
    <div className="er-transport" role="toolbar" aria-label={pt ? 'Controles do vídeo' : 'Video controls'}>
      <button type="button" className="icon-button" onClick={toggle} aria-label={playing ? (pt ? 'Pausar (espaço)' : 'Pause (space)') : (pt ? 'Reproduzir (espaço)' : 'Play (space)')}><Icon name={playing ? 'stop' : 'play'} /></button>
      <button type="button" className="icon-button er-step" onClick={() => seek(time - step)} aria-label={pt ? 'Quadro anterior (←)' : 'Previous frame (←)'}>‹</button>
      <button type="button" className="icon-button er-step" onClick={() => seek(time + step)} aria-label={pt ? 'Próximo quadro (→)' : 'Next frame (→)'}>›</button>
      <span className="er-time" aria-live="off"><b>{formatTime(time, true)}</b> / {formatTime(duration, true)}</span>
      <span className="er-frame">{pt ? 'Quadro' : 'Frame'} {frame}{fps ? ` · ${Math.round(fps * 100) / 100} qps` : (pt ? ' · qps não informado' : ' · fps unknown')}</span>
      <span className="er-transport-gap" />
      <button type="button" className="soft-button" onClick={markIn} aria-keyshortcuts="i">{pt ? 'Marcar início' : 'Mark in'}{pendingIn != null && <small> {formatTime(pendingIn, true)}</small>}</button>
      <button type="button" className="soft-button" onClick={markOut} disabled={pendingIn == null || time <= pendingIn} aria-keyshortcuts="o">{pt ? 'Marcar fim' : 'Mark out'}</button>
      {(selection || pendingIn != null) && <button type="button" className="text-link" onClick={() => { setSelection(null); setPendingIn(null); }}>{pt ? 'Limpar seleção' : 'Clear selection'}</button>}
      <label className="er-rate"><span className="sr-only">{pt ? 'Velocidade' : 'Speed'}</span>
        <select value={rate} onChange={(event) => { const next = Number(event.target.value); setRate(next); if (videoRef.current) videoRef.current.playbackRate = next; }}>
          {[0.25, 0.5, 1, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
    </div>
    <div className="er-timeline">
      <input type="range" min={0} max={duration} step={step} value={time} onChange={(event) => seek(Number(event.target.value))} aria-label={pt ? 'Posição no vídeo' : 'Position in video'} aria-valuetext={formatTime(time, true)} />
      <div className="er-track" aria-hidden="true">
        {markers.map((marker) => <i key={marker.id} className={`er-mark ${marker.kind}`} style={{ left: pct(marker.start), width: pct(Math.max(marker.end - marker.start, step)) }} />)}
        {selection && <i className="er-selection" style={{ left: pct(selection.start), width: pct(selection.end - selection.start) }} />}
        {pendingIn != null && <i className="er-pending-in" style={{ left: pct(pendingIn) }} />}
        <i className="er-playhead" style={{ left: pct(time) }} />
      </div>
      {coverage && <div className="er-coverage" role="img" aria-label={pt ? `Cobertura da última análise: ${coverage.examined.length} momentos examinados entre ${formatRange(coverage.start, coverage.end)}; o restante não foi examinado.` : `Last analysis coverage: ${coverage.examined.length} moments examined in ${formatRange(coverage.start, coverage.end)}; the rest was not examined.`}>
        <span className="er-coverage-range" style={{ left: pct(coverage.start), width: pct(coverage.end - coverage.start) }} />
        {coverage.examined.map((value) => <span key={`e${value}`} className="er-coverage-tick" style={{ left: pct(value) }} />)}
        {coverage.pending.map((value) => <span key={`p${value}`} className="er-coverage-tick pending" style={{ left: pct(value) }} />)}
      </div>}
      {coverage && <p className="er-legend"><span className="examined" />{pt ? `${coverage.examined.length} quadros examinados (amostragem)` : `${coverage.examined.length} frames examined (sampling)`}{coverage.pending.length > 0 && <><span className="pending" />{pt ? `${coverage.pending.length} pendentes` : `${coverage.pending.length} pending`}</>}<span className="none" />{pt ? 'Não examinado' : 'Not examined'}</p>}
    </div>
  </div>;
}

function Observation({ api, reference, analysis, observation, index, pt, onSeek, onError }: { api: EditingReferencesApi; reference: EditingReference; analysis: ReferenceAnalysis; observation: ReferenceObservation; index: number; pt: boolean; onSeek: (time: number) => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const approved = snapshot.guidelines.find((guideline) => guideline.source?.observationId === observation.id);
  const decision = observationDecision(observation, snapshot.guidelines);
  const resolved = decision != null;
  const [open, setOpen] = useState(!resolved && index === 0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(observation.adaptation || observation.text);
  const [profileId, setProfileId] = useState<string | null>(null);
  const frames = observation.frameIds.map((id) => analysis.frames.find((frame) => frame.id === id)).filter((frame): frame is NonNullable<typeof frame> => Boolean(frame));
  const approve = async () => {
    try { await api.run({ type: 'guideline.approve', text: text.trim(), profileId, referenceId: reference.id, analysisId: analysis.id, observationId: observation.id }); setEditing(false); }
    catch (error) { onError(errorText(error, pt)); }
  };
  const decide = async (choice: 'keep' | 'discard') => {
    try { await api.run({ type: 'observation.decide', analysisId: analysis.id, observationId: observation.id, decision: choice }); }
    catch (error) { onError(errorText(error, pt)); }
  };
  const stateLabel = decision === 'approved' ? (pt ? 'Aprovada' : 'Approved') : decision === 'keep' ? (pt ? 'Só nesta referência' : 'This reference only') : decision === 'discard' ? (pt ? 'Descartada' : 'Discarded') : (pt ? 'Sugestão' : 'Suggestion');
  return <article className={`er-observation ${resolved ? 'resolved' : ''} ${open ? 'open' : ''}`}>
    <button type="button" className="er-observation-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="er-index">{index + 1}</span>
      <span><b>{observation.text}</b><small>{formatRange(observation.start, observation.end)} · {frames.length} {pt ? (frames.length === 1 ? 'quadro' : 'quadros') : (frames.length === 1 ? 'frame' : 'frames')}</small></span>
      <span className={`er-obs-state ${decision ?? ''}`}>{stateLabel}</span>
    </button>
    {open && <div className="er-observation-body">
      {frames.length > 0 && <div className="er-frames" role="list" aria-label={pt ? 'Quadros usados como evidência' : 'Frames used as evidence'}>
        {frames.map((frame) => <button type="button" role="listitem" key={frame.id} onClick={() => onSeek(frame.time)} aria-label={`${pt ? 'Ir para' : 'Go to'} ${formatTime(frame.time, true)}`}>
          <img src={referenceFrameUrl(api.scope, analysis.id, frame.id)} alt="" loading="lazy" /><small>{formatTime(frame.time, true)}</small>
        </button>)}
      </div>}
      <dl>
        {observation.adaptation && <><dt>{pt ? 'Como adaptar' : 'How to adapt'}</dt><dd>{observation.adaptation}</dd></>}
        {observation.limitations.length > 0 && <><dt>{pt ? 'Limite' : 'Limit'}</dt><dd>{observation.limitations.join(' ')}</dd></>}
        {approved && <><dt>{pt ? 'Orientação aprovada' : 'Approved guidance'}</dt><dd>{approved.text}</dd></>}
      </dl>
      {!resolved && (editing
        ? <div className="er-approve">
          <label className="er-field">{pt ? 'Orientação que os agentes vão seguir' : 'Guidance agents will follow'}<textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} autoFocus /></label>
          <label className="er-field">{pt ? 'Vale para' : 'Applies to'}
            <select value={profileId ?? ''} onChange={(event) => setProfileId(event.target.value || null)}>
              <option value="">{pt ? 'Todos os vídeos do workspace' : 'All videos in the workspace'}</option>
              {snapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          <div className="er-row"><button type="button" className="primary-button" disabled={!text.trim() || api.busy} onClick={() => void approve()}>{pt ? 'Aprovar para meu estilo' : 'Approve for my style'}</button><button type="button" className="text-link" onClick={() => setEditing(false)}>{pt ? 'Cancelar' : 'Cancel'}</button></div>
        </div>
        : <div className="er-row">
          <button type="button" className="primary-button" onClick={() => setEditing(true)}>{pt ? 'Revisar e aprovar' : 'Review and approve'}</button>
          <button type="button" className="soft-button" disabled={api.busy} onClick={() => void decide('keep')} title={pt ? 'Fica guardada nesta referência; não vira orientação geral' : 'Stays on this reference; does not become general guidance'}>{pt ? 'Só nesta referência' : 'This reference only'}</button>
          <button type="button" className="text-link" disabled={api.busy} onClick={() => void decide('discard')}>{pt ? 'Descartar' : 'Discard'}</button>
        </div>)}
    </div>}
  </article>;
}

export function ReferenceStudy({ api, referenceId, pt, locale, onBack, onCreateStudy, onUseInStudio, onError }: { api: EditingReferencesApi; referenceId: string; pt: boolean; locale: string; onBack: () => void; onCreateStudy: (referenceId: string, range: Range | null) => void; onUseInStudio: (referenceId: string) => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const reference = snapshot.references.find((item) => item.id === referenceId);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(0);
  const [selection, setSelection] = useState<Range | null>(null);
  const [tab, setTab] = useState<'notes' | 'analysis'>('analysis');
  const [mode, setMode] = useState<'structure' | 'motion'>('structure');
  const visualAgents = snapshot.agents.filter((agent) => agent.visual);
  const [agentId, setAgentId] = useState(visualAgents[0]?.id ?? '');
  const [markerText, setMarkerText] = useState('');
  const [notes, setNotes] = useState(reference?.notes ?? '');
  const [tags, setTags] = useState(reference?.tags.join(', ') ?? '');
  const [title, setTitle] = useState(reference?.title ?? '');
  useEffect(() => { setNotes(reference?.notes ?? ''); setTags(reference?.tags.join(', ') ?? ''); setTitle(reference?.title ?? ''); }, [reference?.id, reference?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!agentId && visualAgents[0]) setAgentId(visualAgents[0].id); }, [visualAgents, agentId]);
  const analyses = useMemo(() => reference ? referenceAnalyses(snapshot, reference.id) : [], [snapshot, reference]);
  if (!reference) return <div className="er-empty"><h2>{pt ? 'Esta referência não existe mais' : 'This reference no longer exists'}</h2><button type="button" className="soft-button" onClick={onBack}>{pt ? 'Voltar à biblioteca' : 'Back to library'}</button></div>;
  const version = currentVersion(reference);
  const importJob = (() => { const job = jobFor(snapshot, reference.id); return job?.kind === 'import' ? job : null; })();
  const status = referenceStatus(snapshot, reference);
  const latest = analyses[0] ?? null;
  const job = latest ? runningJob(snapshot, latest.id) ?? runningJob(snapshot, reference.id) : runningJob(snapshot, reference.id);
  const running = latest && (latest.status === 'queued' || latest.status === 'running');
  const range = selection ?? (version ? { start: 0, end: version.duration } : null);
  const agent = snapshot.agents.find((item) => item.id === agentId);
  const seek = (value: number) => { if (videoRef.current) videoRef.current.currentTime = value; setTime(value); };
  const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { onError(errorText(error, pt)); } };
  const saveMarkers = (markers: ReferenceMarker[]) => attempt(() => api.run({ type: 'reference.update', id: reference.id, expectedRevision: reference.revision, markers }));
  const addMarker = (kind: 'wanted' | 'avoid' | 'note') => { if (!selection) return; void saveMarkers([...reference.markers, { id: newId(), kind, start: selection.start, end: selection.end, text: markerText.trim() }]).then(() => setMarkerText('')); };
  const startAnalysis = () => version && range && agentId && attempt(() => api.run({ type: 'analysis.start', referenceId: reference.id, versionId: version.id, expectedRevision: reference.revision, agentId, mode, start: range.start, end: range.end }));
  const saveDetails = () => attempt(() => api.run({ type: 'reference.update', id: reference.id, expectedRevision: reference.revision, title: title.trim() || reference.title, notes, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) }));
  const archive = (removed: boolean) => attempt(() => api.run({ type: 'reference.update', id: reference.id, expectedRevision: reference.revision, removed }));
  const markerLabel = { wanted: pt ? 'Quero aproveitar' : 'Want to use', avoid: pt ? 'Quero evitar' : 'Want to avoid', note: pt ? 'Nota' : 'Note' };
  const dirty = notes !== reference.notes || title !== reference.title || tags !== reference.tags.join(', ');
  const pendingCount = analyses.flatMap((analysis) => analysis.observations).filter((observation) => !observationResolved(observation, snapshot.guidelines)).length;

  return <div className="er-study">
    <header className="er-study-head">
      <button type="button" className="icon-button" onClick={onBack} aria-label={pt ? 'Voltar à biblioteca' : 'Back to library'}><Icon name="chevron" className="er-back" /></button>
      <div className="er-study-title"><small>{pt ? 'Referências de edição' : 'Editing references'}</small><h1>{reference.title}</h1></div>
      <StatusChip status={status} label={statusLabel(status, pt)} />
      <span className="er-transport-gap" />
      <button type="button" className="soft-button" onClick={() => onUseInStudio(reference.id)}>{pt ? 'Usar no Estúdio' : 'Use in Studio'}</button>
      {version && <button type="button" className="soft-button" onClick={() => onCreateStudy(reference.id, selection)}>{pt ? 'Criar estudo de motion' : 'Create motion study'}</button>}
    </header>
    <div className="er-study-body">
      <section className="er-study-stage" aria-label={pt ? 'Vídeo e trechos' : 'Video and segments'}>
        {version
          ? <Player src={referenceVideoUrl(api.scope, reference.id, version.id)} fps={version.fps} duration={version.duration} time={time} setTime={setTime} selection={selection} setSelection={setSelection} markers={reference.markers} analysis={latest} pt={pt} videoRef={videoRef} />
          : importJob && (importJob.status === 'queued' || importJob.status === 'running')
            ? <div className="er-link-only" role="status"><span className="er-spinner" aria-hidden="true" /><h2>{pt ? 'Preparando o vídeo…' : 'Preparing the video…'}</h2><p>{jobPhase(importJob)}</p>{importJob.progress != null && <span className="er-bar" role="progressbar" aria-label={pt ? 'Preparação do vídeo' : 'Video preparation'} aria-valuenow={Math.round(importJob.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${importJob.progress * 100}%` }} /></span>}<button type="button" className="text-link" onClick={() => void attempt(() => api.run({ type: 'job.cancel', id: importJob.id }))}>{pt ? 'Cancelar' : 'Cancel'}</button></div>
          : <div className="er-link-only">
            {importJob?.kind === 'import' && importJob.status === 'failed' && <p className="er-callout danger" role="alert">{importJob.error ?? (pt ? 'Não foi possível preparar o vídeo.' : 'Could not prepare the video.')}</p>}
            <Icon name="link" />
            <h2>{reference.sourceUrl ? (pt ? 'Só o link está salvo' : 'Only the link is saved') : (pt ? 'Sem arquivo de vídeo' : 'No video file')}</h2>
            <p>{pt ? 'A IA só analisa quadros de um arquivo de vídeo guardado no app. O link continua aqui como referência.' : 'The AI only analyzes frames from a video file kept in the app. The link stays here as a reference.'}</p>
            {reference.sourceUrl && <a className="text-link" href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.sourceUrl} <Icon name="external" /></a>}
            <button type="button" className="primary-button" disabled={!api.canImport || api.busy} onClick={() => void attempt(() => api.importVideos(reference.folderId, reference.id, reference.revision))}>{pt ? 'Adicionar o arquivo do vídeo' : 'Add the video file'}</button>
            {!api.canImport && <small>{pt ? 'Disponível no app para computador.' : 'Available in the desktop app.'}</small>}
          </div>}
        {version && <div className="er-segments">
          <div className="er-segments-head">
            <b>{pt ? 'Trechos marcados' : 'Marked segments'}</b>
            {selection ? <span className="er-pill">{pt ? 'Seleção' : 'Selection'} {formatRange(selection.start, selection.end)}</span> : <small>{pt ? 'Use Marcar início/fim (I/O) para selecionar um trecho' : 'Use Mark in/out (I/O) to select a segment'}</small>}
          </div>
          {selection && <div className="er-mark-form">
            <input value={markerText} onChange={(event) => setMarkerText(event.target.value)} placeholder={pt ? 'Por quê? (opcional)' : 'Why? (optional)'} aria-label={pt ? 'Comentário do trecho' : 'Segment comment'} />
            <button type="button" className="soft-button er-wanted" disabled={api.busy} onClick={() => addMarker('wanted')}>{markerLabel.wanted}</button>
            <button type="button" className="soft-button er-avoid" disabled={api.busy} onClick={() => addMarker('avoid')}>{markerLabel.avoid}</button>
            <button type="button" className="soft-button" disabled={api.busy} onClick={() => addMarker('note')}>{markerLabel.note}</button>
          </div>}
          {reference.markers.length === 0 ? <p className="er-muted">{pt ? 'Nenhum trecho marcado ainda.' : 'No segments marked yet.'}</p> : <ul className="er-marker-list">
            {[...reference.markers].sort((a, b) => a.start - b.start).map((marker) => <li key={marker.id} className={marker.kind}>
              <button type="button" className="er-marker-jump" onClick={() => { seek(marker.start); setSelection({ start: marker.start, end: marker.end }); }}>
                <span className="er-kind">{markerLabel[marker.kind]}</span><span className="er-range">{formatRange(marker.start, marker.end)}</span><span>{marker.text || '—'}</span>
              </button>
              <button type="button" className="icon-button" aria-label={pt ? `Remover trecho ${formatRange(marker.start, marker.end)}` : `Remove segment ${formatRange(marker.start, marker.end)}`} disabled={api.busy} onClick={() => void saveMarkers(reference.markers.filter((item) => item.id !== marker.id))}><Icon name="close" /></button>
            </li>)}
          </ul>}
        </div>}
      </section>
      <aside className="er-study-side">
        <div className="er-tabs" role="tablist" aria-label={pt ? 'Painel da referência' : 'Reference panel'}>
          <button type="button" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>{pt ? 'Notas' : 'Notes'}</button>
          <button type="button" role="tab" aria-selected={tab === 'analysis'} onClick={() => setTab('analysis')}>{pt ? 'Análise' : 'Analysis'}{pendingCount > 0 && <span className="er-badge">{pendingCount}</span>}</button>
        </div>
        {tab === 'notes' ? <div className="er-side-body" role="tabpanel">
          <label className="er-field">{pt ? 'Título' : 'Title'}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="er-field">{pt ? 'O que aproveitar' : 'What to use'}<textarea rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <label className="er-field">{pt ? 'Tags' : 'Tags'}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <div className="er-row"><button type="button" className="primary-button" disabled={!dirty || api.busy} onClick={() => void saveDetails()}>{pt ? 'Salvar notas' : 'Save notes'}</button>{dirty && <button type="button" className="text-link" onClick={() => { setNotes(reference.notes); setTitle(reference.title); setTags(reference.tags.join(', ')); }}>{pt ? 'Desfazer' : 'Revert'}</button>}</div>
          {version && <dl className="er-facts">
            <dt>{pt ? 'Arquivo' : 'File'}</dt><dd>{version.name}</dd>
            <dt>{pt ? 'Duração' : 'Duration'}</dt><dd>{formatTime(version.duration, true)}</dd>
            <dt>{pt ? 'Resolução' : 'Resolution'}</dt><dd>{version.width}×{version.height}{version.fps ? ` · ${Math.round(version.fps * 100) / 100} qps` : ''}</dd>
            <dt>{pt ? 'Versões' : 'Versions'}</dt><dd>{reference.versions.length}</dd>
          </dl>}
          {reference.sourceUrl && <a className="text-link" href={reference.sourceUrl} target="_blank" rel="noreferrer">{pt ? 'Abrir link original' : 'Open original link'} <Icon name="external" /></a>}
          <div className="er-row er-danger-zone">{reference.removedAt
            ? <button type="button" className="soft-button" disabled={api.busy} onClick={() => void archive(false)}>{pt ? 'Restaurar referência' : 'Restore reference'}</button>
            : <button type="button" className="text-link danger" disabled={api.busy} onClick={() => void archive(true)}>{pt ? 'Arquivar referência' : 'Archive reference'}</button>}</div>
        </div> : <div className="er-side-body" role="tabpanel">
          {version ? <section className="er-analyze">
            <div className="er-segmented" role="group" aria-label={pt ? 'Tipo de análise' : 'Analysis type'}>
              <button type="button" aria-pressed={mode === 'structure'} onClick={() => setMode('structure')}>{pt ? 'Estrutura e ritmo' : 'Structure and rhythm'}</button>
              <button type="button" aria-pressed={mode === 'motion'} onClick={() => setMode('motion')}>{pt ? 'Movimento' : 'Motion'}</button>
            </div>
            {visualAgents.length === 0
              ? <div className="er-callout warn"><b>{pt ? 'Nenhum agente com visão disponível' : 'No agent with vision available'}</b><span>{pt ? 'Conecte em Configurações um provedor que aceite imagens e crie um agente com ele.' : 'Connect a provider that accepts images in Settings and create an agent with it.'}{snapshot.agents.length > 0 && ` ${pt ? 'Agentes atuais sem visão:' : 'Current agents without vision:'} ${snapshot.agents.map((item) => item.name).join(', ')}.`}</span></div>
              : <label className="er-field">{pt ? 'Quem analisa' : 'Who analyzes'}
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  {visualAgents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>}
            <p className="er-note">{selection ? (pt ? `Trecho ${formatRange(selection.start, selection.end)}.` : `Segment ${formatRange(selection.start, selection.end)}.`) : (pt ? 'Sem trecho selecionado: analisa o vídeo inteiro por amostragem.' : 'No segment selected: analyzes the whole video by sampling.')} {pt ? 'Usa o seu agente e conta no seu plano.' : 'Uses your agent and counts toward your plan.'}</p>
            {running
              ? <div className="er-job" role="status"><span className="er-spinner" aria-hidden="true" /><span>{jobPhase(job) || (pt ? 'Na fila…' : 'Queued…')}</span>{job && <button type="button" className="text-link" onClick={() => void attempt(() => api.run({ type: 'job.cancel', id: job.id }))}>{pt ? 'Cancelar' : 'Cancel'}</button>}</div>
              : visualAgents.length > 0 && <button type="button" className="primary-button" disabled={!agent?.visual || api.busy} onClick={() => void startAnalysis()}>{selection ? (pt ? 'Analisar trecho' : 'Analyze segment') : (pt ? 'Analisar vídeo' : 'Analyze video')}</button>}
          </section> : <p className="er-muted">{pt ? 'Adicione o arquivo do vídeo para analisar.' : 'Add the video file to analyze.'}</p>}
          {latest?.status === 'failed' || latest?.status === 'interrupted' ? <p className="er-callout danger" role="alert">{latest.error ?? (pt ? 'A análise parou antes de terminar. Nada foi aprovado.' : 'The analysis stopped before finishing. Nothing was approved.')}</p> : null}
          {latest?.status === 'partial' && <p className="er-callout warn">{pt ? 'Análise parcial: só parte do trecho foi examinada. Veja a cobertura abaixo do vídeo.' : 'Partial analysis: only part of the segment was examined. See the coverage under the video.'}</p>}
          {analyses.filter((analysis) => analysis.observations.length).map((analysis) => {
            const owner = snapshot.agents.find((item) => item.id === analysis.agentId);
            const stale = analysis.versionId !== reference.currentVersionId;
            return <section key={analysis.id} className="er-analysis">
              <header><b>{analysis.mode === 'motion' ? (pt ? 'Movimento' : 'Motion') : (pt ? 'Estrutura e ritmo' : 'Structure and rhythm')} · {formatRange(analysis.start, analysis.end)}</b><small>{owner?.name ?? analysis.agentId} · {new Date(analysis.updatedAt).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></header>
              {stale && <p className="er-callout warn">{pt ? 'Feita sobre uma versão anterior do vídeo.' : 'Made on an earlier version of the video.'}</p>}
              <p className="er-note">{pt ? 'Análise concluída não é estilo aprovado: só vira orientação o que você aprovar.' : 'A finished analysis is not approved style: only what you approve becomes guidance.'}</p>
              {analysis.observations.map((observation, index) => <Observation key={observation.id} api={api} reference={reference} analysis={analysis} observation={observation} index={index} pt={pt} onSeek={seek} onError={onError} />)}
              {analysis.limitations.length > 0 && <details className="er-details"><summary>{pt ? 'Limites desta análise' : 'Limits of this analysis'}</summary><ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
            </section>;
          })}
          {analyses.length === 0 && version && <p className="er-muted">{pt ? 'Ainda não há análise. Marque o que você gosta e peça para analisar.' : 'No analysis yet. Mark what you like and ask for an analysis.'}</p>}
        </div>}
      </aside>
    </div>
  </div>;
}
