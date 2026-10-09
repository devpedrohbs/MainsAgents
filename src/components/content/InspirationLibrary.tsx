import {useMemo, useState, type FormEvent, type ReactNode} from 'react';
import {useLanguage} from '../../app/LanguageProvider';
import {
  InspirationError, buildBriefingContext, createReference, describeAvailability, listReferences, removeReference, restoreReference,
  updateReference, workspaceTags,
  type AssetResolver, type BriefingContext, type InspirationErrorCode, type InspirationLibraryState, type InspirationReference,
} from '../../features/content/inspiration';
import './inspiration-library.css';

/** Vídeo local já autorizado/associado pelo fluxo de arquivos do conteúdo (EditorialAsset). */
export interface InspirationAssetOption { id: string; workspaceId: string; name: string; kind: string }

export interface InspirationLibraryProps {
  workspaceId: string;
  state: InspirationLibraryState;
  /** Persistência fica com o integrador: recebe o próximo estado já validado. */
  onChange: (next: InspirationLibraryState) => void | Promise<void>;
  /** Vídeos locais disponíveis para vincular (somente os do workspace são aceitos). */
  assets?: InspirationAssetOption[];
  /** "Usar como briefing": entrega o contexto com atribuição. A biblioteca não envia nada sozinha. */
  onUseAsBriefing?: (briefing: BriefingContext) => void;
  /** B09: per-reference analysis panel (server-owned analyses). When absent, the item shows the static “not analyzed” line. */
  renderAnalysis?: (reference: InspirationReference) => ReactNode;
}

const messages = {
  'pt-BR': {
    kicker: 'REFERÊNCIAS', title: 'Biblioteca de referências', intro: 'Guarde links ou vídeos locais autorizados como inspiração. Nada é baixado, analisado ou publicado automaticamente.',
    add: 'Adicionar referência', save: 'Salvar', cancel: 'Cancelar', edit: 'Editar', remove: 'Remover', restore: 'Restaurar', briefing: 'Usar como briefing',
    url: 'Link da referência', urlHint: 'http:// ou https://', refTitle: 'Título (opcional)', author: 'Autor (opcional)', authorHint: 'Só se você souber; não é preenchido automaticamente.',
    notes: 'Notas', tags: 'Tags', tagsHint: 'Separe por vírgula', video: 'Vídeo local autorizado (opcional)', noVideo: 'Nenhum', search: 'Buscar referências',
    filterTags: 'Filtrar por tag', clearFilters: 'Limpar filtros', showRemoved: 'Mostrar removidas', hideRemoved: 'Ocultar removidas', count: (n: number) => `${n} referência(s)`,
    emptyTitle: 'Nenhuma referência ainda', empty: 'Cole o link de um Reel ou vincule um vídeo que você tem autorização para usar.', emptyFiltered: 'Nenhuma referência combina com os filtros.',
    removedNotice: 'Referência removida.', undo: 'Desfazer', briefingSent: 'Contexto de briefing enviado.', noBriefing: 'Esta tela ainda não está ligada a um briefing.',
    linkOnly: 'Somente link · conteúdo não acessado', local: 'Vídeo local autorizado', localMissing: 'Vínculo com o vídeo indisponível',
    notAnalyzed: 'Sem análise: metadados e conteúdo não foram coletados.', authorMissing: 'Autor não informado', by: 'Autor', open: 'Abrir link', openNote: 'Abre no navegador do sistema, fora do app.',
    savedAt: 'Atualizada', removedAt: 'Removida',
    errors: {
      workspace_required: 'Selecione um workspace.', source_required: 'Informe um link ou vincule um vídeo local.', url_invalid: 'Link inválido. Use um endereço http:// ou https:// completo.',
      url_protocol: 'Apenas links http:// e https:// são aceitos.', url_credentials: 'Remova usuário e senha do link.', url_too_long: 'Link longo demais.', duplicate_url: 'Este link já está na biblioteca deste workspace.',
      asset_unavailable: 'Este vídeo não está mais disponível.', asset_not_video: 'Escolha um arquivo de vídeo.', asset_wrong_workspace: 'Este vídeo pertence a outro workspace.',
      not_found: 'Referência não encontrada neste workspace.', revision_conflict: 'A referência mudou. Recarregue e tente de novo.', too_many_tags: 'Use no máximo 12 tags.',
      text_too_long: 'Algum texto passou do limite permitido.', not_removed: 'Esta referência não está removida.',
    } as Record<InspirationErrorCode, string>, fallbackError: 'Não foi possível concluir. Tente novamente.',
  },
  'en-US': {
    kicker: 'REFERENCES', title: 'Reference library', intro: 'Keep links or authorized local videos as inspiration. Nothing is downloaded, analyzed or published automatically.',
    add: 'Add reference', save: 'Save', cancel: 'Cancel', edit: 'Edit', remove: 'Remove', restore: 'Restore', briefing: 'Use as briefing',
    url: 'Reference link', urlHint: 'http:// or https://', refTitle: 'Title (optional)', author: 'Author (optional)', authorHint: 'Only if you know it; never filled in automatically.',
    notes: 'Notes', tags: 'Tags', tagsHint: 'Separate with commas', video: 'Authorized local video (optional)', noVideo: 'None', search: 'Search references',
    filterTags: 'Filter by tag', clearFilters: 'Clear filters', showRemoved: 'Show removed', hideRemoved: 'Hide removed', count: (n: number) => `${n} reference(s)`,
    emptyTitle: 'No references yet', empty: 'Paste a Reel link or attach a video you are authorized to use.', emptyFiltered: 'No reference matches these filters.',
    removedNotice: 'Reference removed.', undo: 'Undo', briefingSent: 'Briefing context sent.', noBriefing: 'This screen is not connected to a briefing yet.',
    linkOnly: 'Link only · content not accessed', local: 'Authorized local video', localMissing: 'Video link unavailable',
    notAnalyzed: 'Not analyzed: metadata and content were not collected.', authorMissing: 'Author not provided', by: 'Author', open: 'Open link', openNote: 'Opens in your system browser, outside the app.',
    savedAt: 'Updated', removedAt: 'Removed',
    errors: {
      workspace_required: 'Select a workspace.', source_required: 'Enter a link or attach a local video.', url_invalid: 'Invalid link. Use a full http:// or https:// address.',
      url_protocol: 'Only http:// and https:// links are accepted.', url_credentials: 'Remove the username and password from the link.', url_too_long: 'Link is too long.', duplicate_url: 'This link is already in this workspace library.',
      asset_unavailable: 'This video is no longer available.', asset_not_video: 'Choose a video file.', asset_wrong_workspace: 'This video belongs to another workspace.',
      not_found: 'Reference not found in this workspace.', revision_conflict: 'The reference changed. Reload and try again.', too_many_tags: 'Use at most 12 tags.',
      text_too_long: 'Some text is over the allowed limit.', not_removed: 'This reference is not removed.',
    } as Record<InspirationErrorCode, string>, fallbackError: 'Could not finish. Please try again.',
  },
};

interface Draft { sourceUrl: string; title: string; author: string; notes: string; tags: string; assetId: string }
const blank: Draft = { sourceUrl: '', title: '', author: '', notes: '', tags: '', assetId: '' };

export function InspirationLibrary({ workspaceId, state, onChange, assets = [], onUseAsBriefing, renderAnalysis }: InspirationLibraryProps) {
  const { locale } = useLanguage();
  const t = messages[locale === 'pt-BR' ? 'pt-BR' : 'en-US'];
  const [formOpen, setFormOpen] = useState(false), [editing, setEditing] = useState<InspirationReference>();
  const [draft, setDraft] = useState<Draft>(blank), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [undoId, setUndoId] = useState<string>(), [query, setQuery] = useState(''), [activeTags, setActiveTags] = useState<string[]>([]), [showRemoved, setShowRemoved] = useState(false), [busy, setBusy] = useState(false);

  const workspaceAssets = useMemo(() => assets.filter(asset => asset.workspaceId === workspaceId && asset.kind === 'video'), [assets, workspaceId]);
  const resolver = useMemo<AssetResolver>(() => id => { const found = assets.find(asset => asset.id === id); return found && { workspaceId: found.workspaceId, name: found.name, kind: found.kind }; }, [assets]);
  const tags = useMemo(() => workspaceTags(state, workspaceId), [state, workspaceId]);
  const visibleTags = activeTags.filter(tag => tags.some(item => item.tag === tag));
  const items = useMemo(() => listReferences(state, { workspaceId, tags: visibleTags, query, onlyRemoved: showRemoved }), [state, workspaceId, visibleTags.join('|'), query, showRemoved]);
  const filtering = !!query.trim() || visibleTags.length > 0;

  const fail = (failure: unknown) => setError(failure instanceof InspirationError ? t.errors[failure.code] ?? t.fallbackError : t.fallbackError);
  const commit = async (compute: () => InspirationLibraryState, after?: () => void) => {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await onChange(compute()); after?.(); } catch (failure) { fail(failure); } finally { setBusy(false); }
  };
  const closeForm = () => { setFormOpen(false); setEditing(undefined); setDraft(blank); setError(''); };
  const openCreate = () => { setEditing(undefined); setDraft(blank); setError(''); setFormOpen(true); };
  const openEdit = (ref: InspirationReference) => { setEditing(ref); setDraft({ sourceUrl: ref.sourceUrl ?? '', title: ref.title ?? '', author: ref.author ?? '', notes: ref.notes, tags: ref.tags.join(', '), assetId: ref.asset?.assetId ?? '' }); setError(''); setFormOpen(true); };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void commit(() => editing
      ? updateReference(state, workspaceId, editing.id, { sourceUrl: draft.sourceUrl, title: draft.title, author: draft.author, notes: draft.notes, tags: draft.tags, assetId: draft.assetId || null }, { expectedRevision: editing.revision, resolver }).state
      : createReference(state, workspaceId, { sourceUrl: draft.sourceUrl, title: draft.title, author: draft.author, notes: draft.notes, tags: draft.tags, assetId: draft.assetId || undefined }, resolver).state, closeForm);
  };
  const remove = (ref: InspirationReference) => void commit(() => removeReference(state, workspaceId, ref.id).state, () => { setUndoId(ref.id); setNotice(t.removedNotice); });
  const restore = (id: string) => void commit(() => restoreReference(state, workspaceId, id).state, () => { setUndoId(undefined); setNotice(''); });
  const useBriefing = (ref: InspirationReference) => {
    setError(''); setNotice('');
    if (!onUseAsBriefing) { setNotice(t.noBriefing); return; }
    try { onUseAsBriefing(buildBriefingContext(state, workspaceId, ref.id, locale === 'pt-BR' ? 'pt-BR' : 'en-US', resolver)); setNotice(t.briefingSent); } catch (failure) { fail(failure); }
  };
  const toggleTag = (tag: string) => setActiveTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]);
  const field = (key: keyof Draft) => ({ value: draft[key], onChange: (event: { target: { value: string } }) => setDraft(current => ({ ...current, [key]: event.target.value })) });
  const stateLabel = (ref: InspirationReference) => {
    const { availability } = describeAvailability(ref, resolver);
    return availability === 'local_authorized' ? t.local : availability === 'local_missing' ? t.localMissing : t.linkOnly;
  };

  return <section className="editorial-card inspiration-library" aria-labelledby="inspiration-title">
    <div className="editorial-section-head"><div><span className="editorial-kicker">{t.kicker}</span><h2 id="inspiration-title">{t.title}</h2><p className="editorial-meta">{t.intro}</p></div><span className="inspiration-count" aria-live="polite">{t.count(items.length)}</span></div>

    <div className="inspiration-toolbar">
      <input type="search" className="inspiration-search" aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" className="soft-button" aria-pressed={showRemoved} onClick={() => setShowRemoved(value => !value)}>{showRemoved ? t.hideRemoved : t.showRemoved}</button>
      <button type="button" className="primary-button" onClick={openCreate} disabled={busy || formOpen}>{t.add}</button>
    </div>

    {tags.length > 0 && <div className="inspiration-tags" role="group" aria-label={t.filterTags}>
      {tags.map(({ tag, count }) => <button type="button" key={tag} className="inspiration-tag" aria-pressed={visibleTags.includes(tag)} onClick={() => toggleTag(tag)}>#{tag} <span>{count}</span></button>)}
      {filtering && <button type="button" className="inspiration-clear" onClick={() => { setQuery(''); setActiveTags([]); }}>{t.clearFilters}</button>}
    </div>}

    {formOpen && <form className="inspiration-form" noValidate onSubmit={submit} aria-label={editing ? t.edit : t.add}>
      <label>{t.url}<input type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder={t.urlHint} autoFocus {...field('sourceUrl')} /></label>
      <label>{t.refTitle}<input maxLength={160} {...field('title')} /></label>
      <label>{t.author}<input maxLength={120} aria-describedby="inspiration-author-hint" {...field('author')} /><small id="inspiration-author-hint">{t.authorHint}</small></label>
      <label>{t.tags}<input aria-describedby="inspiration-tags-hint" {...field('tags')} /><small id="inspiration-tags-hint">{t.tagsHint}</small></label>
      <label>{t.video}<select {...field('assetId')}><option value="">{t.noVideo}</option>{workspaceAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      <label>{t.notes}<textarea rows={4} maxLength={4000} {...field('notes')} /></label>
      {error && <p role="alert" className="inspiration-error">{error}</p>}
      <div className="inspiration-form-actions"><button type="button" className="soft-button" onClick={closeForm}>{t.cancel}</button><button type="submit" className="primary-button" disabled={busy}>{t.save}</button></div>
    </form>}

    {!formOpen && error && <p role="alert" className="inspiration-error">{error}</p>}
    {notice && <p role="status" className="inspiration-notice">{notice}{undoId && <button type="button" className="inspiration-undo" onClick={() => restore(undoId)}>{t.undo}</button>}</p>}

    {!items.length && !formOpen && <div className="inspiration-empty"><strong>{filtering || showRemoved ? t.emptyFiltered : t.emptyTitle}</strong>{!filtering && !showRemoved && <p>{t.empty}</p>}</div>}

    <ul className="inspiration-list">{items.map(ref => <li key={ref.id} className="inspiration-item" data-removed={ref.removedAt ? 'true' : undefined}>
      <div className="inspiration-item-head"><strong title={ref.title}>{ref.title || ref.asset?.name || ref.sourceHost}</strong><span className="inspiration-state" data-availability={describeAvailability(ref, resolver).availability}>{stateLabel(ref)}</span></div>
      {ref.sourceUrl && <a className="inspiration-url" href={ref.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" title={t.openNote}>{ref.sourceHost}<span className="inspiration-sr"> — {t.open}. {t.openNote}</span></a>}
      {ref.asset && <p className="inspiration-meta">{ref.asset.name}</p>}
      <p className="inspiration-meta">{ref.author ? `${t.by}: ${ref.author}` : t.authorMissing}{renderAnalysis ? '' : ` · ${t.notAnalyzed}`}</p>
      {ref.notes && <p className="inspiration-notes">{ref.notes}</p>}
      {ref.tags.length > 0 && <p className="inspiration-meta">{ref.tags.map(tag => `#${tag}`).join(' ')}</p>}
      <p className="inspiration-meta">{ref.removedAt ? `${t.removedAt} ` : `${t.savedAt} `}{new Date(ref.removedAt ?? ref.updatedAt).toLocaleDateString(locale)}</p>
      {!ref.removedAt && renderAnalysis?.(ref)}
      <div className="inspiration-actions">
        {ref.removedAt
          ? <button type="button" className="soft-button" disabled={busy} onClick={() => restore(ref.id)}>{t.restore}</button>
          : <><button type="button" className="primary-button" disabled={busy} onClick={() => useBriefing(ref)}>{t.briefing}</button>
              <button type="button" className="soft-button" disabled={busy} onClick={() => openEdit(ref)}>{t.edit}</button>
              <button type="button" className="soft-button" disabled={busy} onClick={() => remove(ref)}>{t.remove}</button></>}
      </div>
    </li>)}</ul>
  </section>;
}
