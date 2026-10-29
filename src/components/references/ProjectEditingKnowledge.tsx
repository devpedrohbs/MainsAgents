import { useEffect, useState } from 'react';
import { Icon } from '../common/Icon';
import { editingContext } from '../../features/references/api';
import type { EditingContextManifest } from '../../features/references/model';
import { errorText, useEditingReferences } from '../../features/references/useEditingReferences';
import { PROJECT_LIMITS, projectSelection, referenceStatus, takeReferenceForStudio, type ProjectSelection } from '../../features/references/viewModel';
import { EngineStatus } from './MotionKit';
import '../../styles/editing-references.css';

const same = (a: ProjectSelection, b: ProjectSelection) => (['referenceIds', 'profileIds', 'kitIds'] as const).every((key) => a[key].length === b[key].length && a[key].every((value) => b[key].includes(value)));
const emptySelection: ProjectSelection = { referenceIds: [], profileIds: [], kitIds: [] };

/**
 * Editing knowledge for one Studio project: which approved style profiles, references and kit pieces the agent receives
 * when it edits this video. Saved through `project.attach`; the visual stage reads it from the backend, not from here.
 */
/** Turns a target (whole video or a time range) and a request into the stage's own revision notes; sending stays with the person. */
function AdjustmentComposer({ pt, onCompose }: { pt: boolean; onCompose: (text: string) => void }) {
  const [target, setTarget] = useState<'video' | 'range'>('video');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [request, setRequest] = useState('');
  const valid = request.trim() && (target === 'video' || (start.trim() && end.trim()));
  const compose = () => {
    const where = target === 'video' ? (pt ? 'Vídeo inteiro' : 'Whole video') : `${pt ? 'Trecho' : 'Segment'} ${start.trim()}–${end.trim()}`;
    onCompose(`[${where}] ${request.trim()} ${pt ? '(Siga as orientações e referências anexadas a este vídeo; mantenha cortes, voz e duração.)' : '(Follow the guidance and references attached to this video; keep cuts, voice and duration.)'}`);
    setRequest('');
  };
  return <fieldset className="er-adjust"><legend>{pt ? 'Pedir ajuste com base no seu estilo' : 'Request an adjustment based on your style'}</legend>
    <div className="er-row">
      <label className="er-check"><input type="radio" name="er-adjust-target" checked={target === 'video'} onChange={() => setTarget('video')} />{pt ? 'Vídeo inteiro' : 'Whole video'}</label>
      <label className="er-check"><input type="radio" name="er-adjust-target" checked={target === 'range'} onChange={() => setTarget('range')} />{pt ? 'Um trecho' : 'A segment'}</label>
      {target === 'range' && <><input className="er-time-input" value={start} onChange={(event) => setStart(event.target.value)} placeholder="00:08" aria-label={pt ? 'Início do trecho' : 'Segment start'} /><span>–</span><input className="er-time-input" value={end} onChange={(event) => setEnd(event.target.value)} placeholder="00:14" aria-label={pt ? 'Fim do trecho' : 'Segment end'} /></>}
    </div>
    <textarea rows={2} value={request} onChange={(event) => setRequest(event.target.value)} placeholder={pt ? 'Ex.: deixe a entrada das caixas mais discreta, como na referência.' : 'E.g. make the boxes enter more subtly, like the reference.'} aria-label={pt ? 'Pedido de ajuste' : 'Adjustment request'} />
    <div className="er-row"><button type="button" className="soft-button" disabled={!valid} onClick={compose}>{pt ? 'Colocar no pedido desta etapa' : 'Add to this stage request'}</button><small className="er-muted">{pt ? 'Nada é enviado até você pedir a nova versão.' : 'Nothing is sent until you request the new version.'}</small></div>
  </fieldset>;
}

export function ProjectEditingKnowledge({ contentId, workspaceId, pt, onCompose }: { contentId: string; workspaceId: string; pt: boolean; onCompose?: (text: string) => void }) {
  const [focusReferenceId] = useState(takeReferenceForStudio);
  const api = useEditingReferences(workspaceId);
  const snapshot = api.snapshot;
  const attached = snapshot ? projectSelection(snapshot, contentId) : null;
  const [draft, setDraft] = useState<ProjectSelection>(emptySelection);
  const [manifest, setManifest] = useState<EditingContextManifest | null>(null);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(Boolean(focusReferenceId));
  const attachedKey = JSON.stringify(attached);
  useEffect(() => {
    const base: ProjectSelection = attached ? { referenceIds: attached.referenceIds, profileIds: attached.profileIds, kitIds: attached.kitIds } : emptySelection;
    setDraft(focusReferenceId && !base.referenceIds.includes(focusReferenceId) ? { ...base, referenceIds: [...base.referenceIds, focusReferenceId].slice(-PROJECT_LIMITS.referenceIds) } : base);
  }, [attachedKey, focusReferenceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusReferenceId) setOpen(true); }, [focusReferenceId]);

  if (api.state.kind === 'unavailable') return null;
  if (!snapshot) return <section className="er-project" aria-busy="true"><span className="er-muted">{pt ? 'Carregando conhecimento de edição…' : 'Loading editing knowledge…'}</span></section>;
  const references = snapshot.references.filter((reference) => !reference.removedAt);
  const activeGuidelines = snapshot.guidelines.filter((guideline) => guideline.enabled);
  const general = activeGuidelines.filter((guideline) => !guideline.profileId).length;
  const toggle = (key: keyof ProjectSelection, id: string) => setDraft((current) => {
    const has = current[key].includes(id);
    if (!has && current[key].length >= PROJECT_LIMITS[key]) { setProblem(pt ? `Limite de ${PROJECT_LIMITS[key]} itens neste grupo.` : `Limit of ${PROJECT_LIMITS[key]} items in this group.`); return current; }
    setProblem(''); setSaved(false); setManifest(null);
    return { ...current, [key]: has ? current[key].filter((item) => item !== id) : [...current[key], id] };
  });
  const dirty = !same(draft, attached ?? emptySelection);
  const save = async () => {
    try { await api.run({ type: 'project.attach', contentId, ...draft, expectedRevision: attached?.revision ?? 0 }); setSaved(true); setProblem(''); }
    catch (error) { setProblem(errorText(error, pt)); }
  };
  const preview = async () => {
    try { setManifest(await editingContext(api.scope, draft)); }
    catch (error) { setProblem(errorText(error, pt)); }
  };
  const count = (attached?.referenceIds.length ?? 0) + (attached?.profileIds.length ?? 0) + (attached?.kitIds.length ?? 0);
  const nothingYet = !references.length && !snapshot.guidelines.length && !snapshot.kit.length;

  return <section className="er-project" aria-labelledby={`er-project-${contentId}`}>
    <div className="er-project-head">
      <b id={`er-project-${contentId}`}>{pt ? 'Conhecimento de edição deste vídeo' : 'Editing knowledge for this video'}</b>
      <span className="er-muted">{pt ? `${general} ${general === 1 ? 'orientação geral ativa' : 'orientações gerais ativas'}` : `${general} active general ${general === 1 ? 'guideline' : 'guidelines'}`}{count ? ` · ${count} ${pt ? 'anexados' : 'attached'}` : ''}</span>
      <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? (pt ? 'Fechar' : 'Close') : (pt ? 'Escolher' : 'Choose')}</button>
    </div>
    {open && (nothingYet
      ? <p className="er-note">{pt ? 'Você ainda não estudou referências nem aprovou orientações. ' : 'You have not studied references or approved guidance yet. '}<a className="text-link" href="#references">{pt ? 'Abrir Referências de edição' : 'Open Editing references'}<Icon name="external" /></a></p>
      : <>
        <EngineStatus api={api} engine={snapshot.engine} pt={pt} compact onError={setProblem} />
        {snapshot.profiles.length > 0 && <fieldset><legend>{pt ? 'Perfis de estilo' : 'Style profiles'}</legend>
          {snapshot.profiles.map((profile) => { const n = activeGuidelines.filter((guideline) => guideline.profileId === profile.id).length; return <label key={profile.id} className="er-check"><input type="checkbox" checked={draft.profileIds.includes(profile.id)} onChange={() => toggle('profileIds', profile.id)} />{profile.name}<small>{n} {pt ? (n === 1 ? 'orientação' : 'orientações') : (n === 1 ? 'guideline' : 'guidelines')}</small></label>; })}
        </fieldset>}
        {references.length > 0 && <fieldset><legend>{pt ? 'Referências' : 'References'}</legend>
          {references.map((reference) => <label key={reference.id} className="er-check"><input type="checkbox" checked={draft.referenceIds.includes(reference.id)} onChange={() => toggle('referenceIds', reference.id)} />{reference.title}<small>{referenceStatus(snapshot, reference) === 'approved' ? (pt ? 'aprovada' : 'approved') : reference.markers.length ? `${reference.markers.length} ${pt ? 'trechos' : 'segments'}` : ''}</small></label>)}
        </fieldset>}
        {snapshot.kit.length > 0 && <fieldset><legend>{pt ? 'Kit de motion' : 'Motion kit'}</legend>
          {snapshot.kit.map((item) => <label key={item.id} className="er-check"><input type="checkbox" checked={draft.kitIds.includes(item.id)} onChange={() => toggle('kitIds', item.id)} />{item.name}<small>v{item.studyRevision}</small></label>)}
        </fieldset>}
        <p className="er-note">{pt ? 'O agente recebe isso como contexto na etapa visual. Cortes, áudio e duração aprovados não mudam.' : 'The agent receives this as context in the visual stage. Approved cuts, audio and duration do not change.'}</p>
        <div className="er-row">
          <button type="button" className="primary-button" disabled={!dirty || api.busy} onClick={() => void save()}>{pt ? 'Salvar para este vídeo' : 'Save for this video'}</button>
          <button type="button" className="soft-button" disabled={api.busy} onClick={() => void preview()}>{pt ? 'Ver o que o agente recebe' : 'See what the agent receives'}</button>
          {saved && !dirty && <span className="er-pill ok" role="status">{pt ? 'Salvo' : 'Saved'}</span>}
          <a className="text-link" href="#references">{pt ? 'Gerenciar' : 'Manage'}</a>
        </div>
        {onCompose && <AdjustmentComposer pt={pt} onCompose={onCompose} />}
        {manifest && <div className="er-manifest-wrap">
          <pre className="er-manifest" tabIndex={0} aria-label={pt ? 'Contexto enviado ao agente' : 'Context sent to the agent'}>{manifest.text}</pre>
          {manifest.truncated && <p className="er-note">{pt ? 'Resumido para caber no limite do agente.' : 'Shortened to fit the agent limit.'}</p>}
        </div>}
      </>)}
    {problem && <p className="er-callout danger" role="alert">{problem}</p>}
  </section>;
}
