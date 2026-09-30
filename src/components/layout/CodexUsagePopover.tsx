import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../app/LanguageProvider';
import { readCodexUsage, type CodexUsage } from '../../features/chat/codexUsage';

export function CodexUsagePopover() {
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(false);
      try { const result = await readCodexUsage(controller.signal); if (!controller.signal.aborted) setUsage(result); }
      catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [open, refresh]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const unavailable = pt ? 'Indisponível' : 'Unavailable';
  const formatDate = (date: number) => new Date(date * 1000).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <div className="codex-usage" ref={root}>
    <button className="soft-button codex-usage-trigger" aria-expanded={open} aria-controls="codex-usage-panel" onClick={() => setOpen(!open)} title={pt ? 'Consumo do plano Codex' : 'Codex plan usage'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18a9 9 0 1 1 16 0M12 12l4-4"/><circle cx="12" cy="12" r="1"/></svg><span>{pt ? 'Uso' : 'Usage'}</span>
    </button>
    {open && <section id="codex-usage-panel" className="codex-usage-panel" aria-label={pt ? 'Uso do Codex' : 'Codex usage'} aria-busy={loading}>
      <div className="codex-usage-heading"><h2>{pt ? 'Uso do Codex' : 'Codex usage'}</h2><button className="text-link" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? pt ? 'Atualizando…' : 'Refreshing…' : pt ? 'Atualizar' : 'Refresh'}</button></div>
      <p>{usage?.plan ? `${pt ? 'Plano' : 'Plan'} ${usage.plan} · ` : ''}{pt ? 'Consumo da conta conectada pelo CLI.' : 'Usage for the account connected through the CLI.'}</p>
      {error && <p role="status">{pt ? 'Não foi possível consultar o consumo. Confira o login do Codex CLI e tente atualizar.' : 'Could not read usage. Check your Codex CLI login and refresh.'}</p>}
      {!usage && loading && <p role="status">{pt ? 'Consultando seu plano…' : 'Reading your plan…'}</p>}
      {(!loading || usage) && !error && ([['5h', pt ? '5 horas' : '5 hours', usage?.fiveHours], ['week', pt ? 'Semana' : 'Week', usage?.weekly]] as const).map(([id, label, window]) => <div className="codex-usage-window" key={id}>
        <div><strong>{label}</strong><span>{window?.usedPercent != null ? `${Math.round(window.usedPercent)}% ${pt ? 'utilizado' : 'used'}` : unavailable}</span></div>
        {window?.usedPercent != null && <progress max={100} value={window.usedPercent} aria-label={label} />}
        <small>{window?.resetsAt ? `${pt ? 'Renova em' : 'Resets'} ${formatDate(window.resetsAt)}` : pt ? 'O CLI não informou a renovação deste limite.' : 'The CLI did not report a reset for this limit.'}</small>
      </div>)}
      {usage && <small>{pt ? 'Última consulta' : 'Last checked'}: {new Date(usage.fetchedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}{error ? pt ? ' · Dados anteriores' : ' · Previous data' : ''}</small>}
      <p className="codex-usage-footnote">{pt ? 'Os limites são compartilhados com outros aplicativos que usam sua conta Codex. Disponíveis para planos ChatGPT compatíveis.' : 'Limits are shared with other apps using your Codex account. Available for supported ChatGPT plans.'}</p>
    </section>}
  </div>;
}
