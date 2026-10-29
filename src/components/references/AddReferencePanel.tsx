import { useState } from 'react';
import { Icon } from '../common/Icon';
import { errorText, type EditingReferencesApi } from '../../features/references/useEditingReferences';

/**
 * Side panel (the library stays visible). A video goes through the desktop host, which opens its own picker and keeps a
 * managed copy; a link stores only the address. Saving never starts an analysis: that is its own action in the study.
 */
export function AddReferencePanel({ api, defaultFolder, pt, onClose, onOpen }: { api: EditingReferencesApi; defaultFolder: string | null; pt: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const snapshot = api.snapshot!;
  const [source, setSource] = useState<'file' | 'link'>(api.canImport ? 'file' : 'link');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolder);
  const [problem, setProblem] = useState('');
  const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  const validUrl = /^https?:\/\/\S+\.\S+/i.test(url.trim());

  const importFile = async () => {
    setProblem('');
    try {
      const result = await api.importVideos(folderId);
      if (!result) return; // picker cancelled
      const id = result.entityId;
      const reference = id ? result.snapshot.references.find((item) => item.id === id) : undefined;
      if (reference && (title.trim() || notes.trim() || tagList.length)) {
        await api.run({ type: 'reference.update', id: reference.id, expectedRevision: reference.revision, ...(title.trim() ? { title: title.trim() } : {}), ...(notes.trim() ? { notes } : {}), ...(tagList.length ? { tags: tagList } : {}) });
      }
      if (id) onOpen(id); else onClose();
    } catch (error) { setProblem(errorText(error, pt)); }
  };
  const saveLink = async (open: boolean) => {
    if (!validUrl || !title.trim()) return;
    setProblem('');
    const existing = snapshot.references.find((item) => !item.removedAt && item.sourceUrl?.trim() === url.trim());
    if (existing) { setProblem(pt ? `Este link já está na biblioteca como “${existing.title}”. Nada foi duplicado.` : `This link is already in the library as “${existing.title}”. Nothing was duplicated.`); return; }
    try {
      const result = await api.run({ type: 'reference.link', title: title.trim(), sourceUrl: url.trim(), folderId, notes, tags: tagList });
      if (open && result.entityId) onOpen(result.entityId); else onClose();
    } catch (error) { setProblem(errorText(error, pt)); }
  };

  return <aside className="er-add" role="dialog" aria-modal="false" aria-label={pt ? 'Adicionar referência' : 'Add reference'} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <header><h2>{pt ? 'Adicionar referência' : 'Add reference'}</h2><button type="button" className="icon-button" aria-label={pt ? 'Fechar painel' : 'Close panel'} onClick={onClose}><Icon name="close" /></button></header>
    <div className="er-add-body">
      <div className="er-segmented" role="group" aria-label={pt ? 'Origem' : 'Source'}>
        <button type="button" aria-pressed={source === 'file'} onClick={() => setSource('file')}>{pt ? 'Arquivo de vídeo' : 'Video file'}</button>
        <button type="button" aria-pressed={source === 'link'} onClick={() => setSource('link')}>{pt ? 'Só um link' : 'Just a link'}</button>
      </div>
      {source === 'file'
        ? <p className="er-note">{api.canImport
          ? (pt ? 'Você escolhe o vídeo na próxima janela. O app guarda uma cópia gerenciada; o arquivo original não é alterado. Formatos: MP4, MOV, M4V, WebM.' : 'You choose the video in the next window. The app keeps a managed copy; your original file is not changed. Formats: MP4, MOV, M4V, WebM.')
          : (pt ? 'Importar arquivos só funciona no app para computador. Aqui você pode salvar um link.' : 'Importing files only works in the desktop app. Here you can save a link.')}</p>
        : <>
          <label className="er-field">{pt ? 'Endereço' : 'Address'}<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" autoFocus /></label>
          <p className="er-note">{pt ? 'O app guarda só o endereço; nada é baixado. Para a IA ver os quadros, adicione depois o arquivo do vídeo nesta referência.' : 'The app keeps only the address; nothing is downloaded. For the AI to see frames, add the video file to this reference later.'}</p>
        </>}
      <label className="er-field">{pt ? 'Título' : 'Title'}{source === 'file' && <small>{pt ? 'Opcional — usa o nome do arquivo' : 'Optional — uses the file name'}</small>}<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="er-field">{pt ? 'O que você quer aproveitar?' : 'What do you want to use?'}<small>{pt ? 'Opcional' : 'Optional'}</small><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <label className="er-field">{pt ? 'Tags, separadas por vírgula' : 'Tags, comma separated'}<small>{pt ? 'Opcional' : 'Optional'}</small><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={pt ? 'motion, diagrama' : 'motion, diagram'} /></label>
      <label className="er-field">{pt ? 'Pasta' : 'Folder'}
        <select value={folderId ?? ''} onChange={(event) => setFolderId(event.target.value || null)}>
          <option value="">{pt ? 'Sem pasta' : 'No folder'}</option>
          {snapshot.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      {problem && <p className="er-callout danger" role="alert">{problem}</p>}
    </div>
    <footer>
      {source === 'file'
        ? <button type="button" className="primary-button" disabled={!api.canImport || api.busy} onClick={() => void importFile()}>{api.busy ? (pt ? 'Importando…' : 'Importing…') : (pt ? 'Escolher vídeo e salvar' : 'Choose video and save')}</button>
        : <>
          <button type="button" className="soft-button" disabled={!validUrl || !title.trim() || api.busy} onClick={() => void saveLink(false)}>{pt ? 'Salvar' : 'Save'}</button>
          <button type="button" className="primary-button" disabled={!validUrl || !title.trim() || api.busy} onClick={() => void saveLink(true)}>{pt ? 'Salvar e abrir' : 'Save and open'}</button>
        </>}
    </footer>
  </aside>;
}
