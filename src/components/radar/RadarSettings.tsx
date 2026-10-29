import { useEffect, useState } from 'react';
import { dateText, sourceInput, sourceKindText, sourceLabel, statusText, validateConfig, type RadarConfigInput, type RadarSnapshot, type SourceDraft } from '../../features/radar/model';

export function RadarSettings({ snapshot, profile, busy, pt, onSave, onRefresh }: { snapshot: RadarSnapshot; profile: string; busy: boolean; pt: boolean; onSave: (input: RadarConfigInput) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState<RadarConfigInput>(snapshot.config);
  const [dirty, setDirty] = useState(false);
  const [source, setSource] = useState<SourceDraft>({ kind: 'youtube-channel', value: '', label: '', regionCode: '' });
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const configKey = JSON.stringify(snapshot.config);
  useEffect(() => { if (!dirty) setDraft(JSON.parse(configKey)); }, [configKey, dirty]);
  const update = (next: RadarConfigInput) => { setDraft(next); setDirty(true); setMessage(''); };
  const add = () => {
    try {
      const input = sourceInput(source, pt);
      update({ ...draft, sources: [...draft.sources, { ...input, enabled: true }] });
      setSource({ ...source, value: '', label: '' });
      setFailed(false);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <details className="radar-section radar-settings" open={snapshot.config.sources.length === 0 || undefined}>
    <summary>{pt ? 'Configuração e fontes' : 'Settings and sources'}{dirty ? (pt ? ' · alterações não salvas' : ' · unsaved changes') : ''}</summary>
    <form onSubmit={event => {
      event.preventDefault(); setMessage('');
      void (async () => {
        try { await onSave(validateConfig(draft, pt)); setDirty(false); setFailed(false); setMessage(pt ? 'Configuração salva.' : 'Settings saved.'); }
        catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
      })();
    }}>
      <fieldset disabled={busy}><legend>{pt ? 'Coleta diária' : 'Daily collection'}</legend>
        <div className="radar-row"><label className="radar-check"><input type="checkbox" checked={draft.schedule.enabled} onChange={e => update({ ...draft, schedule: { ...draft.schedule, enabled: e.target.checked } })} />{pt ? 'Ativar agendamento' : 'Enable schedule'}</label>
          <label className="radar-field">{pt ? 'Horário local do computador' : 'Computer local time'}<input type="time" required value={draft.schedule.time} onChange={e => update({ ...draft, schedule: { ...draft.schedule, time: e.target.value } })} /></label></div>
        <p className="radar-muted">{pt ? 'Próxima coleta salva' : 'Next saved collection'}: {snapshot.nextRunAt ? dateText(snapshot.nextRunAt, pt) : pt ? 'Agendamento desligado' : 'Schedule off'}. {pt ? 'O app precisa estar aberto; ao iniciar ou retomar, verifica coletas pendentes.' : 'The app must be open; startup and resume check for due collections.'}</p>
      </fieldset>
      <fieldset disabled={busy}><legend>{pt ? 'Fontes acompanhadas' : 'Followed sources'}</legend>
        {!draft.sources.length && <p className="radar-muted">{pt ? 'Adicione um canal, tema, feed ou Hacker News para começar.' : 'Add a channel, topic, feed, or Hacker News to begin.'}</p>}
        <ul className="radar-source-list">{draft.sources.map((input, index) => {
          const state = snapshot.sources.find(s => s.id === input.id);
          return <li key={input.id ?? `new-${index}`}><div className="radar-source-main"><label className="radar-check"><input type="checkbox" checked={input.enabled} onChange={e => update({ ...draft, sources: draft.sources.map((s, i) => i === index ? { ...s, enabled: e.target.checked } : s) })} /><strong>{sourceLabel(input, pt)}</strong></label>
            <button type="button" className="radar-text-button" aria-label={`${pt ? 'Remover' : 'Remove'} ${sourceLabel(input, pt)}`} onClick={() => update({ ...draft, sources: draft.sources.filter((_, i) => i !== index) })}>{pt ? 'Remover' : 'Remove'}</button></div>
            <small className="radar-muted">{sourceKindText(input.kind, pt)}{input.kind === 'youtube-channel' ? ` · ${input.channelId}` : input.kind === 'news-rss' ? ` · ${input.url}` : input.kind === 'youtube-search' && input.regionCode ? ` · ${input.regionCode}` : ''}</small>
            {state ? <div className="radar-source-state"><span className={`radar-status ${state.status}`}>{statusText(state.status, pt)}</span>{!input.enabled && <span>{pt ? 'Desativada' : 'Disabled'}</span>}
              {state.errorMessage && <p lang="pt-BR">{state.errorMessage}</p>}
              {state.retryAt && <p>{pt ? 'Nova tentativa a partir de' : 'Retry from'}: {dateText(state.retryAt, pt)}</p>}
              <small>{pt ? 'Última tentativa' : 'Last attempt'}: {dateText(state.lastAttemptAt, pt)}; {pt ? 'último sucesso' : 'last success'}: {dateText(state.lastSuccessAt, pt)}</small>
            </div> : <p className="radar-muted">{pt ? 'Fonte ainda não salva.' : 'Source not yet saved.'}</p>}
          </li>;
        })}</ul>
        <div className="radar-add-source">
          <label className="radar-field">{pt ? 'Tipo de fonte' : 'Source type'}<select value={source.kind} onChange={e => setSource({ kind: e.target.value as SourceDraft['kind'], value: '', label: '', regionCode: '' })}><option value="youtube-channel">{pt ? 'Canal do YouTube' : 'YouTube channel'}</option><option value="youtube-search">{pt ? 'Tema de busca no YouTube (API)' : 'YouTube search topic (API)'}</option><option value="news-rss">Feed RSS / Atom</option><option value="hackernews">Hacker News</option></select></label>
          <label className="radar-field">{source.kind === 'youtube-channel' ? 'Channel ID (UC…)' : source.kind === 'youtube-search' ? (pt ? 'Tema (até 120 caracteres)' : 'Topic (up to 120 characters)') : source.kind === 'news-rss' ? 'URL HTTPS' : pt ? 'Pontuação mínima (1–5000; padrão: 100)' : 'Minimum score (1–5000; default: 100)'}<input type={source.kind === 'hackernews' ? 'number' : source.kind === 'news-rss' ? 'url' : 'text'} min={source.kind === 'hackernews' ? 1 : undefined} max={source.kind === 'hackernews' ? 5000 : undefined} step={source.kind === 'hackernews' ? 1 : undefined} value={source.value} onChange={e => setSource({ ...source, value: e.target.value })} /></label>
          {(source.kind === 'youtube-channel' || source.kind === 'news-rss') && <label className="radar-field">{pt ? 'Nome (opcional)' : 'Name (optional)'}<input value={source.label} onChange={e => setSource({ ...source, label: e.target.value })} /></label>}
          {source.kind === 'youtube-search' && <label className="radar-field">{pt ? 'País (opcional, ex.: BR)' : 'Country (optional, e.g. US)'}<input maxLength={2} value={source.regionCode} onChange={e => setSource({ ...source, regionCode: e.target.value })} /></label>}
          <button type="button" className="soft-button" onClick={add}>{pt ? 'Adicionar fonte' : 'Add source'}</button>
        </div>
      </fieldset>
      <div className="radar-row"><button type="submit" className="primary-button" disabled={busy || !dirty}>{busy ? (pt ? 'Salvando…' : 'Saving…') : pt ? 'Salvar configuração' : 'Save settings'}</button>{dirty && <button type="button" className="soft-button" disabled={busy} onClick={() => { setDirty(false); setMessage(''); }}>{pt ? 'Descartar alterações' : 'Discard changes'}</button>}<small className="radar-muted">{pt ? 'Salve para aplicar fontes, remoções e agendamento.' : 'Save to apply sources, removals, and schedule.'}</small></div>
      {message && <p className={failed ? 'radar-error' : 'radar-muted'} role={failed ? 'alert' : 'status'}>{message}</p>}
    </form>
    <RadarCredentials profile={profile} snapshot={snapshot} pt={pt} onRefresh={onRefresh} />
  </details>;
}

function RadarCredentials({ profile, snapshot, pt, onRefresh }: { profile: string; snapshot: RadarSnapshot; pt: boolean; onRefresh: () => Promise<void> }) {
  const bridge = window.mainsAgentsDesktop?.radarKey;
  const [key, setKey] = useState('');
  const [status, setStatus] = useState({ configured: snapshot.credentials.youtubeApiKey, secureStorage: snapshot.credentials.secureStorage });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setKey('');
    setStatus({ configured: snapshot.credentials.youtubeApiKey, secureStorage: snapshot.credentials.secureStorage });
    if (bridge) void bridge.status(profile).then(value => { if (active) setStatus(value); }).catch(() => { if (active) setMessage(pt ? 'Status da chave indisponível.' : 'Key status unavailable.'); });
    return () => { active = false; };
  }, [bridge, profile, snapshot.credentials.youtubeApiKey, snapshot.credentials.secureStorage, pt]);
  const change = async (remove: boolean) => {
    if (!bridge || busy) return;
    setBusy(true); setMessage('');
    const input = key.trim(); setKey('');
    try { setStatus(remove ? await bridge.remove(profile) : await bridge.save(profile, input)); await onRefresh(); }
    catch { setMessage(pt ? 'Não foi possível atualizar a chave. Tente de novo.' : 'Could not update the key. Try again.'); }
    finally { setBusy(false); }
  };
  return <form className="radar-key" onSubmit={e => { e.preventDefault(); void change(false); }}>
    <h3>{pt ? 'Chave da YouTube Data API' : 'YouTube Data API key'}</h3>
    <p className="radar-muted">{pt ? 'Gratuita, sem cartão, com cota diária fixa. Sem a chave, no YouTube só os canais seguidos via RSS funcionam; buscas e métricas da API ficam indisponíveis. RSS de notícias e Hacker News funcionam sem ela.' : 'Free, no credit card, with a fixed daily quota. Without a key, YouTube only supports followed channels via RSS; API search and metrics are unavailable. News RSS and Hacker News work without it.'}</p>
    <p role="status">{pt ? 'Chave' : 'Key'}: <strong>{status.configured ? (pt ? 'configurada' : 'configured') : (pt ? 'não configurada' : 'not configured')}</strong></p>
    {!bridge && <p className="radar-muted">{pt ? 'Abra o app desktop para salvar ou remover a chave.' : 'Open the desktop app to save or remove the key.'}</p>}
    {bridge && !status.secureStorage && <p className="radar-error">{pt ? 'Armazenamento seguro indisponível; não é possível salvar uma chave.' : 'Secure storage unavailable; a key cannot be saved.'}</p>}
    <div className="radar-row"><label className="radar-field">{pt ? 'Nova chave' : 'New key'}<input type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy || !bridge || !status.secureStorage} onChange={e => setKey(e.target.value)} /></label><button type="submit" className="soft-button" disabled={busy || !bridge || !status.secureStorage || !key.trim()}>{pt ? 'Salvar chave' : 'Save key'}</button><button type="button" className="soft-button" disabled={busy || !bridge || !status.configured} onClick={() => void change(true)}>{pt ? 'Remover chave' : 'Remove key'}</button></div>
    {message && <p className="radar-error" role="alert">{message}</p>}
  </form>;
}
