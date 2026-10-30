import { useMemo, useState } from 'react';
import { StatusIcon } from '../common/StatusIcon';
import { Icon } from '../common/Icon';
import type { EditingReference, ReferenceFolder } from '../../features/references/model';
import { referenceVideoUrl } from '../../features/references/api';
import { currentVersion, folderSubtree, formatRange, formatTime, referenceAnalyses, observationDecision, jobFor, jobPhase, pendingObservations, referenceStatus, statusLabel, type ReferenceStatus } from '../../features/references/viewModel';
import { errorText, type EditingReferencesApi } from '../../features/references/useEditingReferences';
import { StatusChip } from './StatusChip';

export const NO_FOLDER = '__none';
type FolderFilter = string | null;
const statusOrder: ReferenceStatus[] = ['review', 'partial', 'analyzing', 'unanalyzed', 'link', 'approved', 'failed', 'archived'];

/** Folder tree with sub-folders; "All" and "No folder" are filters, not folders. Rename, sub-folder and delete live on each row. */
function FolderTree({ folders, counts, selected, onSelect, onCreate, onRename, onDelete, pt }: { folders: ReferenceFolder[]; counts: Map<string | null, number>; selected: FolderFilter; onSelect: (id: FolderFilter) => void; onCreate: (parentId: string | null) => void; onRename: (folder: ReferenceFolder, name: string) => void; onDelete: (folder: ReferenceFolder) => void; pt: boolean }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const children = (parentId: string | null) => folders.filter((folder) => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const total = (id: string) => [...folderSubtree(folders, id)].reduce((sum, folderId) => sum + (counts.get(folderId) ?? 0), 0);
  const render = (parentId: string | null, depth: number) => children(parentId).map((folder) => (
    <li key={folder.id}>
      {renaming === folder.id
        ? <form className="er-folder-rename" style={{ paddingLeft: 10 + depth * 14 }} onSubmit={(event) => { event.preventDefault(); setRenaming(null); if (name.trim() && name.trim() !== folder.name) onRename(folder, name.trim()); }}>
          <input autoFocus aria-label={pt ? 'Nome da pasta' : 'Folder name'} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} onBlur={() => setRenaming(null)} />
        </form>
        : <div className={`er-folder-row ${selected === folder.id ? 'active' : ''}`}>
          <button type="button" className="er-folder" aria-current={selected === folder.id ? 'true' : undefined} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => onSelect(folder.id)}>
            <Icon name="folder" /><span>{folder.name}</span><small>{total(folder.id)}</small>
          </button>
          <span className="er-folder-tools">
            <button type="button" className="icon-button" aria-label={pt ? `Nova subpasta em ${folder.name}` : `New sub-folder in ${folder.name}`} title={pt ? 'Nova subpasta' : 'New sub-folder'} onClick={() => onCreate(folder.id)}><Icon name="plus" /></button>
            <button type="button" className="icon-button" aria-label={pt ? `Renomear ${folder.name}` : `Rename ${folder.name}`} title={pt ? 'Renomear' : 'Rename'} onClick={() => { setName(folder.name); setRenaming(folder.id); }}><Icon name="edit" /></button>
            <button type="button" className="icon-button" aria-label={pt ? `Excluir a pasta ${folder.name}` : `Delete folder ${folder.name}`} title={pt ? 'Excluir pasta (as referências vão para Sem pasta)' : 'Delete folder (references move to No folder)'} onClick={() => onDelete(folder)}><Icon name="trash" /></button>
          </span>
        </div>}
      {children(folder.id).length > 0 && <ul>{render(folder.id, depth + 1)}</ul>}
    </li>
  ));
  const all = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return <nav className="er-folders" aria-label={pt ? 'Pastas' : 'Folders'}>
    <div className="er-folders-head"><b>{pt ? 'Pastas' : 'Folders'}</b><button type="button" className="icon-button" aria-label={pt ? 'Nova pasta' : 'New folder'} title={pt ? 'Nova pasta' : 'New folder'} onClick={() => onCreate(null)}><Icon name="plus" /></button></div>
    <ul>
      <li><button type="button" className={`er-folder ${selected === null ? 'active' : ''}`} aria-current={selected === null ? 'true' : undefined} onClick={() => onSelect(null)}><Icon name="board" /><span>{pt ? 'Todas as referências' : 'All references'}</span><small>{all}</small></button></li>
      <li><button type="button" className={`er-folder ${selected === NO_FOLDER ? 'active' : ''}`} aria-current={selected === NO_FOLDER ? 'true' : undefined} onClick={() => onSelect(NO_FOLDER)}><Icon name="note" /><span>{pt ? 'Sem pasta' : 'No folder'}</span><small>{counts.get(null) ?? 0}</small></button></li>
      {render(null, 0)}
    </ul>
  </nav>;
}

function Thumb({ api, reference, pt }: { api: EditingReferencesApi; reference: EditingReference; pt: boolean }) {
  const version = currentVersion(reference);
  const job = api.snapshot ? jobFor(api.snapshot, reference.id) : null;
  if (job?.kind === 'import' && (job.status === 'queued' || job.status === 'running')) return <div className="er-thumb pending"><span>{jobPhase(job) || (pt ? 'Preparando vídeo…' : 'Preparing video…')}</span>{job.progress != null && <span className="er-bar" role="progressbar" aria-label={pt ? 'Preparação do vídeo' : 'Video preparation'} aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${job.progress * 100}%` }} /></span>}</div>;
  if (job?.kind === 'import' && job.status === 'failed') return <div className="er-thumb failed"><span>{job.error ?? (pt ? 'Não foi possível preparar o vídeo' : 'Could not prepare the video')}</span></div>;
  if (!version) return <div className="er-thumb link"><Icon name="link" /><span>{pt ? 'Link salvo — adicione o arquivo para análise visual' : 'Link saved — add the file for visual analysis'}</span></div>;
  // The first frame of the managed copy is the thumbnail; nothing is generated in the renderer.
  return <div className="er-thumb"><video src={`${referenceVideoUrl(api.scope, reference.id, version.id)}#t=0.5`} preload="metadata" muted tabIndex={-1} aria-hidden="true" /><span className="er-duration">{formatTime(version.duration)}</span></div>;
}

export function ReferenceLibrary({ api, pt, locale, onOpen, onAdd, onError, onUndoable }: { api: EditingReferencesApi; pt: boolean; locale: string; onOpen: (id: string) => void; onAdd: () => void; onError: (message: string) => void; onUndoable: (message: string, undo: () => Promise<void>) => void }) {
  const snapshot = api.snapshot!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderFilter>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [status, setStatus] = useState<ReferenceStatus | 'all'>('all');
  const [newFolder, setNewFolder] = useState<{ parentId: string | null; name: string } | null>(null);
  const rows = useMemo(() => snapshot.references.map((reference) => ({ reference, status: referenceStatus(snapshot, reference), pending: pendingObservations(snapshot, reference).length })), [snapshot]);
  const live = rows.filter((row) => row.status !== 'archived');
  const counts = useMemo(() => { const map = new Map<string | null, number>(); for (const row of live) map.set(row.reference.folderId, (map.get(row.reference.folderId) ?? 0) + 1); return map; }, [live]);
  const subtree = folder && folder !== NO_FOLDER ? folderSubtree(snapshot.folders, folder) : null;
  const tags = useMemo(() => Array.from(new Set(live.flatMap((row) => row.reference.tags))).sort((a, b) => a.localeCompare(b, locale)), [live, locale]);
  const needle = query.trim().toLocaleLowerCase(locale);
  const visible = rows
    .filter((row) => (status === 'all' ? row.status !== 'archived' : row.status === status))
    .filter((row) => (folder === NO_FOLDER ? row.reference.folderId == null : !subtree || (row.reference.folderId != null && subtree.has(row.reference.folderId))))
    .filter((row) => !tag || row.reference.tags.includes(tag))
    .filter((row) => !needle || `${row.reference.title} ${row.reference.tags.join(' ')} ${row.reference.notes}`.toLocaleLowerCase(locale).includes(needle))
    .sort((a, b) => b.reference.createdAt.localeCompare(a.reference.createdAt));
  const selected = visible.find(row=>row.reference.id===selectedId) ?? visible[0];
  const selectedVersion = selected ? currentVersion(selected.reference) : null;
  const observations = selected ? referenceAnalyses(snapshot, selected.reference.id).filter(analysis=>analysis.versionId===selected.reference.currentVersionId).flatMap(analysis=>analysis.observations) : [];
  const pending = live.filter((row) => row.pending > 0);
  const pendingTotal = pending.reduce((sum, row) => sum + row.pending, 0);
  const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { onError(errorText(error, pt)); } };

  // Deleting a folder: the backend moves its references to "No folder" and returns an undo id that restores both.
  const removeFolder = (target: ReferenceFolder) => attempt(async () => {
    const result = await api.run({ type: 'folder.delete', id: target.id, expectedRevision: target.revision });
    if (folder === target.id) setFolder(null);
    const message = pt ? `Pasta “${target.name}” excluída. As referências foram para Sem pasta.` : `Folder “${target.name}” deleted. Its references moved to No folder.`;
    if (result.undoId) { const undoId = result.undoId; onUndoable(message, async () => { await api.run({ type: 'folder.restore', undoId, expectedRevision: api.latest()?.revision ?? result.snapshot.revision }); }); }
    else onError(message);
  });
  const submitFolder = () => {
    if (!newFolder?.name.trim()) return setNewFolder(null);
    void attempt(async () => { await api.run({ type: 'folder.create', name: newFolder.name.trim(), parentId: newFolder.parentId }); setNewFolder(null); });
  };
  const moveTo = (reference: EditingReference, folderId: string | null) => attempt(() => api.run({ type: 'reference.update', id: reference.id, expectedRevision: reference.revision, folderId }));

  if (!snapshot.references.length && !snapshot.folders.length) return <div className="er-empty">
    <span className="er-empty-mark"><Icon name="play" /></span>
    <h2>{pt ? 'Ensine seu estilo com vídeos que você admira' : 'Teach your style with videos you admire'}</h2>
    <p>{pt ? 'Marque os trechos que você gosta, revise o que a IA observou e aprove só o que deve virar orientação. Os agentes usam o que você aprovar neste workspace.' : 'Mark the parts you like, review what the AI observed and approve only what should become guidance. Agents use what you approve in this workspace.'}</p>
    <button type="button" className="primary-button" onClick={onAdd}>{pt ? 'Adicionar meu primeiro vídeo' : 'Add my first video'}</button>
    <small>{pt ? 'O arquivo original não é alterado: o app guarda uma cópia própria.' : 'Your original file is not changed: the app keeps its own copy.'}</small>
  </div>;

  return <div className="er-library">
    <aside className="er-library-side">
      <FolderTree folders={snapshot.folders} counts={counts} selected={folder} onSelect={setFolder} onCreate={(parentId) => setNewFolder({ parentId, name: '' })} onRename={(target, name) => void attempt(() => api.run({ type: 'folder.update', id: target.id, expectedRevision: target.revision, name }))} onDelete={(target) => void removeFolder(target)} pt={pt} />
      {newFolder && <form className="er-new-folder" onSubmit={(event) => { event.preventDefault(); submitFolder(); }}>
        <label>{newFolder.parentId ? `${pt ? 'Nova subpasta em' : 'New sub-folder in'} ${snapshot.folders.find((item) => item.id === newFolder.parentId)?.name ?? ''}` : (pt ? 'Nova pasta' : 'New folder')}<input autoFocus value={newFolder.name} onChange={(event) => setNewFolder({ ...newFolder, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setNewFolder(null); }} /></label>
        <div><button type="submit" className="soft-button" disabled={api.busy}>{pt ? 'Criar' : 'Create'}</button><button type="button" className="text-link" onClick={() => setNewFolder(null)}>{pt ? 'Cancelar' : 'Cancel'}</button></div>
      </form>}
    </aside>
    <section className="er-library-main" aria-label={pt ? 'Referências' : 'References'}>
      {pendingTotal > 0 && <div className="er-pending" role="status">
        <Icon name="spark" />
        <div><b>{pt ? `${pendingTotal} ${pendingTotal === 1 ? 'aprendizado esperando' : 'aprendizados esperando'} sua revisão` : `${pendingTotal} ${pendingTotal === 1 ? 'learning awaits' : 'learnings await'} your review`}</b><span>{pending[0].reference.title}</span></div>
        <button type="button" className="primary-button" onClick={() => onOpen(pending[0].reference.id)}>{pt ? 'Continuar revisão' : 'Continue review'}</button>
      </div>}
      <div className="er-filters">
        <label className="er-search"><Icon name="search" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pt ? 'Buscar em títulos, tags e notas' : 'Search titles, tags and notes'} aria-label={pt ? 'Buscar referências' : 'Search references'} /></label>
        {tags.length > 0 && <div className="er-chips" role="group" aria-label={pt ? 'Filtrar por tag' : 'Filter by tag'}>
          <button type="button" aria-pressed={tag === null} onClick={() => setTag(null)}>{pt ? 'Todas' : 'All'}</button>
          {tags.map((item) => <button type="button" key={item} aria-pressed={tag === item} onClick={() => setTag(tag === item ? null : item)}>{item}</button>)}
        </div>}
        <label className="er-select"><span>{pt ? 'Situação' : 'Status'}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ReferenceStatus | 'all')}>
            <option value="all">{pt ? 'Todas (sem arquivadas)' : 'All (not archived)'}</option>
            {statusOrder.map((item) => <option key={item} value={item}>{statusLabel(item, pt)}</option>)}
          </select>
        </label>
      </div>
      <span className="er-count" role="status">{visible.length} {pt ? (visible.length === 1 ? 'referência' : 'referências') : (visible.length === 1 ? 'reference' : 'references')}</span>
      {visible.length === 0 ? <p className="er-muted">{pt ? 'Nenhuma referência nesta pasta ou com estes filtros.' : 'No references in this folder or with these filters.'}</p> : <div className="er-grid">
        {visible.map(({ reference, status: itemStatus }) => <article key={reference.id} className={`er-card ${selected?.reference.id===reference.id?'selected':''}`}>
          <button type="button" className="er-card-open" onClick={() => onOpen(reference.id)} aria-label={`${pt ? 'Abrir' : 'Open'} ${reference.title} · ${statusLabel(itemStatus, pt)}`}>
            <Thumb api={api} reference={reference} pt={pt} />
            <span className="er-card-body">
              <b>{reference.title}</b>
              {reference.tags.length > 0 && <span className="er-card-tags">{reference.tags.join(' · ')}</span>}
              <span className="er-card-meta"><StatusChip status={itemStatus} label={statusLabel(itemStatus, pt)} /><time dateTime={reference.createdAt}>{new Date(reference.createdAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}</time></span>
            </span>
          </button>
          <button type="button" className="er-card-inspect" aria-label={pt?`Ver detalhes de ${reference.title}`:`View details for ${reference.title}`} aria-pressed={selected?.reference.id===reference.id} onClick={()=>setSelectedId(reference.id)}><Icon name="search"/></button>
          <label className="er-card-move"><span className="sr-only">{pt ? `Pasta de ${reference.title}` : `Folder of ${reference.title}`}</span>
            <Icon name="folder" />
            <select value={reference.folderId ?? ''} onChange={(event) => void moveTo(reference, event.target.value || null)} disabled={api.busy}>
              <option value="">{pt ? 'Sem pasta' : 'No folder'}</option>
              {snapshot.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </article>)}
      </div>}
    </section>
    {selected && <aside className="er-library-preview v2-inspector" aria-label={pt?'Referência selecionada':'Selected reference'}>
      {selectedVersion ? <video className="er-inspector-video" src={referenceVideoUrl(api.scope,selected.reference.id,selectedVersion.id)} controls preload="metadata" aria-label={selected.reference.title}/> : <div className="er-inspector-placeholder"><StatusChip status={selected.status} label={statusLabel(selected.status,pt)}/></div>}
      <div><h2>{selected.reference.title}</h2><span className="er-muted v2-mono">{new Date(selected.reference.createdAt).toLocaleDateString(locale)}{selectedVersion ? ` · ${formatTime(selectedVersion.duration)}` : ''}</span></div>
      {selected.reference.notes && <p className="er-note">{selected.reference.notes}</p>}
      <section className="er-inspector-observations"><h3>{pt?'Observações com evidência':'Evidence observations'}</h3>
        {observations.length ? observations.map(observation=><div className="er-inspector-observation" key={observation.id}>
          <span className="v2-mono">{formatRange(observation.start,observation.end)}</span><span>{observation.text}</span><StatusIcon size={12} state={observationDecision(observation,snapshot.guidelines)==='approved'?'done':observationDecision(observation,snapshot.guidelines)?'paused':'waiting'}/>
        </div>) : <p className="er-note">{pt?'Ainda sem observações. Abra a referência para marcar um trecho e pedir a análise.':'No observations yet. Open the reference to mark a segment and request analysis.'}</p>}
      </section>
      <button type="button" className="primary-button" onClick={()=>onOpen(selected.reference.id)}>{pt?'Estudar trecho':'Study segment'}</button>
    </aside>}
  </div>;
}
