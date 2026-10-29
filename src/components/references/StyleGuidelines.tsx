import { useState } from 'react';
import { Icon } from '../common/Icon';
import type { EditingGuideline } from '../../features/references/model';
import { errorText, type EditingReferencesApi } from '../../features/references/useEditingReferences';

function Guideline({ api, guideline, pt, locale, onOpenReference, onError }: { api: EditingReferencesApi; guideline: EditingGuideline; pt: boolean; locale: string; onOpenReference: (id: string) => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(guideline.text);
  const [history, setHistory] = useState(false);
  const source = guideline.source ? snapshot.references.find((item) => item.id === guideline.source!.referenceId) : undefined;
  const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { onError(errorText(error, pt)); } };
  const update = (patch: { text?: string; enabled?: boolean; profileId?: string | null }) => attempt(async () => { await api.run({ type: 'guideline.update', id: guideline.id, expectedRevision: guideline.revision, ...patch }); setEditing(false); });
  return <li className={`er-guideline ${guideline.enabled ? '' : 'off'}`}>
    <label className="er-switch" title={guideline.enabled ? (pt ? 'Ativa: os agentes seguem' : 'On: agents follow it') : (pt ? 'Pausada: os agentes não usam' : 'Paused: agents do not use it')}>
      <input type="checkbox" role="switch" checked={guideline.enabled} disabled={api.busy} onChange={(event) => void update({ enabled: event.target.checked })} aria-label={pt ? `Orientação ativa: ${guideline.text}` : `Guidance on: ${guideline.text}`} />
      <span aria-hidden="true" />
    </label>
    <div className="er-guideline-body">
      {editing
        ? <form onSubmit={(event) => { event.preventDefault(); if (text.trim() && text.trim() !== guideline.text) void update({ text: text.trim() }); else setEditing(false); }}>
          <textarea rows={2} value={text} onChange={(event) => setText(event.target.value)} autoFocus aria-label={pt ? 'Texto da orientação' : 'Guidance text'} onKeyDown={(event) => { if (event.key === 'Escape') { setText(guideline.text); setEditing(false); } }} />
          <div className="er-row"><button type="submit" className="primary-button" disabled={api.busy}>{pt ? 'Salvar nova versão' : 'Save new version'}</button><button type="button" className="text-link" onClick={() => { setText(guideline.text); setEditing(false); }}>{pt ? 'Cancelar' : 'Cancel'}</button></div>
        </form>
        : <p>{guideline.text}</p>}
      <div className="er-guideline-meta">
        {source ? <button type="button" className="text-link" onClick={() => onOpenReference(source.id)}><Icon name="play" />{source.title}</button> : <span>{pt ? 'Escrita por você' : 'Written by you'}</span>}
        <span>{pt ? 'Versão' : 'Version'} {guideline.revision} · {new Date(guideline.updatedAt).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}</span>
        <label><span className="sr-only">{pt ? 'Vale para' : 'Applies to'}</span>
          <select value={guideline.profileId ?? ''} disabled={api.busy} onChange={(event) => void update({ profileId: event.target.value || null })}>
            <option value="">{pt ? 'Todos os vídeos' : 'All videos'}</option>
            {snapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        {!editing && <button type="button" className="text-link" onClick={() => setEditing(true)}>{pt ? 'Editar' : 'Edit'}</button>}
        {guideline.history.length > 1 && <button type="button" className="text-link" aria-expanded={history} onClick={() => setHistory(!history)}>{pt ? 'Histórico' : 'History'}</button>}
      </div>
      {history && <ol className="er-history">{[...guideline.history].reverse().map((entry) => <li key={entry.revision}><b>v{entry.revision}</b> {entry.text}{!entry.enabled && <em> · {pt ? 'pausada' : 'paused'}</em>}<small>{new Date(entry.at).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>)}</ol>}
    </div>
  </li>;
}

/** "Meu estilo": only what the person approved. Turning a guideline off keeps it, with its history, out of the agents' context. */
export function StyleGuidelines({ api, pt, locale, onOpenReference, onError }: { api: EditingReferencesApi; pt: boolean; locale: string; onOpenReference: (id: string) => void; onError: (message: string) => void }) {
  const snapshot = api.snapshot!;
  const [profile, setProfile] = useState<string | 'all' | null>('all');
  const [draft, setDraft] = useState('');
  const [newProfile, setNewProfile] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const attempt = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { onError(errorText(error, pt)); } };
  const list = snapshot.guidelines.filter((guideline) => profile === 'all' || guideline.profileId === profile).sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updatedAt.localeCompare(a.updatedAt));
  const activeCount = snapshot.guidelines.filter((guideline) => guideline.enabled).length;
  const current = profile && profile !== 'all' ? snapshot.profiles.find((item) => item.id === profile) : undefined;
  return <div className="er-style">
    <aside className="er-library-side">
      <nav className="er-folders" aria-label={pt ? 'Perfis de estilo' : 'Style profiles'}>
        <div className="er-folders-head"><b>{pt ? 'Perfis' : 'Profiles'}</b><button type="button" className="icon-button" aria-label={pt ? 'Novo perfil' : 'New profile'} onClick={() => setNewProfile('')}><Icon name="plus" /></button></div>
        <ul>
          <li><button type="button" className={`er-folder ${profile === 'all' ? 'active' : ''}`} aria-current={profile === 'all' ? 'true' : undefined} onClick={() => setProfile('all')}><Icon name="board" /><span>{pt ? 'Todas as orientações' : 'All guidance'}</span><small>{snapshot.guidelines.length}</small></button></li>
          <li><button type="button" className={`er-folder ${profile === null ? 'active' : ''}`} aria-current={profile === null ? 'true' : undefined} onClick={() => setProfile(null)}><Icon name="globe" /><span>{pt ? 'Para todos os vídeos' : 'For all videos'}</span><small>{snapshot.guidelines.filter((item) => !item.profileId).length}</small></button></li>
          {snapshot.profiles.map((item) => <li key={item.id}>{renaming?.id === item.id
            ? <form className="er-folder-rename" onSubmit={(event) => { event.preventDefault(); const name = renaming.name.trim(); setRenaming(null); if (name && name !== item.name) void attempt(() => api.run({ type: 'profile.update', id: item.id, expectedRevision: item.revision, name })); }}><input autoFocus aria-label={pt ? 'Nome do perfil' : 'Profile name'} value={renaming.name} onChange={(event) => setRenaming({ id: item.id, name: event.target.value })} onBlur={() => setRenaming(null)} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} /></form>
            : <div className={`er-folder-row ${profile === item.id ? 'active' : ''}`}>
              <button type="button" className="er-folder" aria-current={profile === item.id ? 'true' : undefined} onClick={() => setProfile(item.id)}><Icon name="spark" /><span>{item.name}</span><small>{snapshot.guidelines.filter((guideline) => guideline.profileId === item.id).length}</small></button>
              <span className="er-folder-tools"><button type="button" className="icon-button" aria-label={pt ? `Renomear ${item.name}` : `Rename ${item.name}`} onClick={() => setRenaming({ id: item.id, name: item.name })}><Icon name="edit" /></button></span>
            </div>}</li>)}
        </ul>
      </nav>
      {newProfile != null && <form className="er-new-folder" onSubmit={(event) => { event.preventDefault(); const name = newProfile.trim(); if (!name) return setNewProfile(null); void attempt(async () => { await api.run({ type: 'profile.create', name }); setNewProfile(null); }); }}>
        <label>{pt ? 'Novo perfil (ex.: Tutoriais, Shorts)' : 'New profile (e.g. Tutorials, Shorts)'}<input autoFocus value={newProfile} onChange={(event) => setNewProfile(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setNewProfile(null); }} /></label>
        <div><button type="submit" className="soft-button">{pt ? 'Criar' : 'Create'}</button><button type="button" className="text-link" onClick={() => setNewProfile(null)}>{pt ? 'Cancelar' : 'Cancel'}</button></div>
      </form>}
    </aside>
    <section className="er-library-main" aria-label={pt ? 'Orientações aprovadas' : 'Approved guidance'}>
      <header className="er-section-head">
        <div><h2>{current?.name ?? (profile === null ? (pt ? 'Para todos os vídeos' : 'For all videos') : (pt ? 'Meu estilo' : 'My style'))}</h2>
          <p>{pt ? `${activeCount} ${activeCount === 1 ? 'orientação ativa' : 'orientações ativas'}. Os agentes recebem só as ativas, com a versão e a origem.` : `${activeCount} active ${activeCount === 1 ? 'guideline' : 'guidelines'}. Agents receive only active ones, with version and origin.`}</p></div>
      </header>
      <form className="er-manual" onSubmit={(event) => { event.preventDefault(); const text = draft.trim(); if (!text) return; void attempt(async () => { await api.run({ type: 'guideline.approve', text, profileId: profile === 'all' ? null : profile }); setDraft(''); }); }}>
        <label className="sr-only" htmlFor="er-manual-guideline">{pt ? 'Escrever uma orientação' : 'Write a guideline'}</label>
        <input id="er-manual-guideline" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={pt ? 'Escreva uma orientação sua, ex.: “Cortes secos nas trocas de assunto”' : 'Write your own guideline, e.g. “Hard cuts on topic changes”'} />
        <button type="submit" className="soft-button" disabled={!draft.trim() || api.busy}>{pt ? 'Adicionar' : 'Add'}</button>
      </form>
      {list.length === 0
        ? <div className="er-empty small"><h3>{pt ? 'Nada aprovado aqui ainda' : 'Nothing approved here yet'}</h3><p>{pt ? 'Abra uma referência, peça uma análise e aprove os aprendizados que fazem sentido para você.' : 'Open a reference, request an analysis and approve the learnings that make sense to you.'}</p></div>
        : <ul className="er-guidelines">{list.map((guideline) => <Guideline key={guideline.id} api={api} guideline={guideline} pt={pt} locale={locale} onOpenReference={onOpenReference} onError={onError} />)}</ul>}
    </section>
  </div>;
}
