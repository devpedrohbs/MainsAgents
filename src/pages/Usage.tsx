import { useState } from 'react';
import { useAgents } from '../features/agents/AgentsProvider';
import { useWorkspaces } from '../app/WorkspaceProvider';
import { useLanguage } from '../app/LanguageProvider';
import { useContentWorkflow } from '../features/content/ContentWorkflowProvider';
import { usePersistentState } from '../data/localPersistence';
import { SelectMenu } from '../components/common/SelectMenu';
import { AgentAvatar } from '../components/agents/AgentAvatar';
import { ProviderGlyph } from '../components/layout/Sidebar';
import { inPeriod, usageByDay, usageGroups, usageLedgerKey, usageTotals, type UsageEntry, type UsageProvider } from '../features/usage/usageLedger';
import { useProviderUsage, usageProviderKey } from '../features/usage/useProviderUsage';
import type { UsageWindow } from '../features/chat/codexUsage';

type Group = 'agent' | 'scope' | 'model';
const RING = 2 * Math.PI * 50;
const noEntries: UsageEntry[] = [];

function LimitRing({ label, window, pt, locale, note }: { label: string; window: UsageWindow | null | undefined; pt: boolean; locale: string; note: string }) {
  const percent = window?.usedPercent == null ? null : Math.round(window.usedPercent);
  const reset = window?.resetsAt ? new Date(window.resetsAt * 1000) : null;
  const sameDay = reset && reset.toDateString() === new Date().toDateString();
  const resetText = reset ? `${pt ? 'Renova' : 'Resets'} ${sameDay ? (pt ? 'às ' : 'at ') : ''}${reset.toLocaleString(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : pt ? 'Renovação não informada' : 'Reset not reported';
  return <article className="usage-limit">
    <svg viewBox="0 0 120 120" role="img" aria-label={percent == null ? `${label}: ${pt ? 'sem dados' : 'no data'}` : `${label}: ${percent}% ${pt ? 'usado' : 'used'}`}>
      <circle cx="60" cy="60" r="50" className="track" />
      {percent != null && <circle cx="60" cy="60" r="50" className="value" strokeDasharray={`${(RING * percent / 100).toFixed(1)} ${RING.toFixed(1)}`} transform="rotate(-90 60 60)" />}
      <text x="60" y="67" textAnchor="middle">{percent == null ? '—' : `${percent}%`}</text>
    </svg>
    <div><span className="usage-eyebrow">{label}</span><strong>{percent == null ? (pt ? 'Sem dados ainda' : 'No data yet') : resetText}</strong><small>{note}</small></div>
  </article>;
}

const compact = (value: number, locale: string) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: value >= 1e6 ? 2 : 1 }).format(value);
const money = (value: number, locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

export function Usage() {
  const { agents } = useAgents();
  const { currentWorkspaceId } = useWorkspaces();
  const { state: editorialState } = useContentWorkflow();
  const { locale } = useLanguage();
  const pt = locale === 'pt-BR';
  const [provider, setProvider] = usePersistentState<UsageProvider>(usageProviderKey, 'codex');
  const [ledger] = usePersistentState<UsageEntry[]>(usageLedgerKey, noEntries);
  const [days, setDays] = useState<7 | 30>(30);
  const [agentFilter, setAgentFilter] = useState('all');
  const [group, setGroup] = useState<Group>('agent');
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const limits = useProviderUsage(provider, { intervalMs: 60_000, refresh });
  const workspaceAgents = agents.filter((agent) => agent.workspaceId === currentWorkspaceId);
  const ownAgent = new Set(workspaceAgents.map((agent) => agent.id));
  const entries = inPeriod((Array.isArray(ledger) ? ledger : []).filter((entry) => entry.provider === provider && (entry.workspaceId ? entry.workspaceId === currentWorkspaceId : ownAgent.has(entry.agentId)) && (agentFilter === 'all' || entry.agentId === agentFilter)), days);
  const totals = usageTotals(entries);
  const claude = provider === 'claude';
  // Claude's CLI reports its own cost estimate; Codex reports tokens only, so its chart is in tokens.
  const measure = claude && totals.cost !== undefined ? 'cost' : 'tokens';
  const value = (item: { cost?: number; total: number }) => measure === 'cost' ? item.cost ?? 0 : item.total;
  const format = (n: number) => measure === 'cost' ? money(n, locale) : compact(n, locale);
  const daily = usageByDay(entries, days);
  const max = Math.max(...daily.map(value), 0);
  const shown = hover ?? daily.length - 1;
  const dayLabel = (date: Date) => date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? (pt ? 'Agente removido' : 'Removed agent');
  const scopeName = (id: string) => id === '' ? (pt ? 'Geral' : 'General') : editorialState.contents.find((content) => content.id === id)?.title ?? (pt ? 'Escopo removido' : 'Removed scope');
  const rows = usageGroups(entries, (entry) => group === 'agent' ? entry.agentId : group === 'scope' ? entry.contentId ?? '' : entry.model ?? '').sort((a, b) => value(b) - value(a));
  const rowTotal = rows.reduce((sum, row) => sum + value(row), 0);
  const rowName = (key: string) => group === 'agent' ? agentName(key) : group === 'scope' ? scopeName(key) : key || (pt ? 'Modelo não informado' : 'Model not reported');
  const observed = claude && limits.usage?.observedAt ? new Date(limits.usage.observedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  const limitNote = claude
    ? observed ? (pt ? `Informado pelo Claude na resposta das ${observed}` : `Reported by Claude at ${observed}`) : (pt ? 'Aparece depois da próxima resposta do Claude' : 'Shows after Claude’s next reply')
    : limits.error ? (pt ? 'Confira o login do Codex CLI' : 'Check your Codex CLI login') : limits.usage?.plan ? `${pt ? 'Plano' : 'Plan'} ${limits.usage.plan}` : (pt ? 'Lido da conta conectada' : 'Read from the connected account');
  const tiles: [string, string][] = [
    [pt ? 'Entrada' : 'Input', compact(totals.tokens.input, locale)],
    [pt ? 'Saída' : 'Output', compact(totals.tokens.output, locale)],
    [pt ? 'Leitura de cache' : 'Cache reads', compact(totals.tokens.cacheRead, locale)],
    ...(claude ? [[pt ? 'Criação de cache' : 'Cache writes', compact(totals.tokens.cacheCreation, locale)] as [string, string]] : []),
    [pt ? 'Respostas' : 'Replies', String(totals.turns)],
  ];
  const groupLabels: Record<Group, string> = { agent: pt ? 'Agente' : 'Agent', scope: pt ? 'Escopo' : 'Scope', model: pt ? 'Modelo' : 'Model' };

  return <div className={`page usage-page usage-${provider}`} data-od-id="usage-page">
    <div className="usage-toolbar">
      <div className="usage-segment" role="group" aria-label={pt ? 'Provedor' : 'Provider'}>
        {(['claude', 'codex'] as const).map((id) => <button key={id} type="button" aria-pressed={provider === id} className={`usage-provider-${id}`} onClick={() => { setProvider(id); setHover(null); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><ProviderGlyph provider={id} /></svg>{id === 'claude' ? 'Claude' : 'Codex'}
        </button>)}
      </div>
      <SelectMenu className="filter-select" ariaLabel={pt ? 'Filtrar por agente' : 'Filter by agent'} value={agentFilter} onChange={setAgentFilter}
        options={[{ value: 'all', label: pt ? 'Todos os agentes' : 'All agents' }, ...workspaceAgents.map((agent) => ({ value: agent.id, label: agent.name }))]} />
      <div className="usage-segment" role="group" aria-label={pt ? 'Período' : 'Period'}>
        {([7, 30] as const).map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => { setDays(n); setHover(null); }}>{pt ? `${n} dias` : `${n} days`}</button>)}
      </div>
      <button type="button" className="soft-button usage-refresh" disabled={limits.loading} onClick={() => setRefresh((n) => n + 1)}>{limits.loading ? (pt ? 'Atualizando…' : 'Refreshing…') : (pt ? 'Atualizar' : 'Refresh')}</button>
    </div>

    <section className="usage-hero" aria-label={pt ? 'Resumo do período' : 'Period summary'}>
      <div className="usage-headline">
        <span className="usage-eyebrow">{claude ? (pt ? `Custo estimado · ${days} dias` : `Estimated cost · ${days} days`) : (pt ? `Tokens · ${days} dias` : `Tokens · ${days} days`)}</span>
        <strong>{claude ? (totals.cost !== undefined ? money(totals.cost, locale) : '—') : compact(totals.total, locale)}</strong>
        <small>{totals.turns} {pt ? (totals.turns === 1 ? 'resposta' : 'respostas') : (totals.turns === 1 ? 'reply' : 'replies')} · {claude ? (pt ? 'estimativa do Claude Code, não é a fatura' : 'Claude Code estimate, not your bill') : (pt ? 'tokens informados pelo Codex' : 'tokens reported by Codex')}</small>
      </div>
      <LimitRing label={pt ? 'Janela de 5 horas' : '5-hour window'} window={limits.usage?.fiveHours} pt={pt} locale={locale} note={limitNote} />
      <LimitRing label={pt ? 'Limite semanal' : 'Weekly limit'} window={limits.usage?.weekly} pt={pt} locale={locale} note={limitNote} />
    </section>

    <section className="usage-section" aria-labelledby="usage-daily">
      <div className="usage-section-head">
        <h2 id="usage-daily">{measure === 'cost' ? (pt ? 'Custo por dia' : 'Cost per day') : (pt ? 'Tokens por dia' : 'Tokens per day')}</h2>
        {entries.length > 0 && <span className="usage-readout" aria-live="polite">{dayLabel(daily[shown].date)} · {format(value(daily[shown]))} · {daily[shown].turns} {pt ? 'respostas' : 'replies'}</span>}
        <button type="button" className="text-link" aria-expanded={table} onClick={() => setTable(!table)}>{table ? (pt ? 'Ver gráfico' : 'Show chart') : (pt ? 'Ver tabela' : 'Show table')}</button>
      </div>
      {entries.length === 0 ? <p className="usage-empty">{pt ? `Nenhuma resposta do ${claude ? 'Claude' : 'Codex'} registrada neste período. O uso passa a aparecer a partir das próximas conversas.` : `No ${claude ? 'Claude' : 'Codex'} replies recorded in this period. Usage appears from your next chats.`}</p>
        : table ? <table className="usage-table"><thead><tr><th>{pt ? 'Dia' : 'Day'}</th><th>{measure === 'cost' ? (pt ? 'Custo' : 'Cost') : 'Tokens'}</th><th>{pt ? 'Respostas' : 'Replies'}</th></tr></thead>
          <tbody>{daily.filter((day) => day.turns).reverse().map((day) => <tr key={day.key}><td>{dayLabel(day.date)}</td><td>{format(value(day))}</td><td>{day.turns}</td></tr>)}</tbody></table>
        : <>
          <div className="usage-chart" onMouseLeave={() => setHover(null)}>
            <span className="usage-axis top">{format(max)}</span><span className="usage-axis mid">{format(max / 2)}</span>
            {daily.map((day, index) => <button key={day.key} type="button" aria-label={`${dayLabel(day.date)}: ${format(value(day))}`} className={index === shown ? 'current' : ''} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)}>
              <span style={{ height: max ? `${Math.max(value(day) / max * 100, value(day) > 0 ? 3 : 0)}%` : 0 }} />
            </button>)}
          </div>
          <div className="usage-chart-dates" aria-hidden="true"><span>{dayLabel(daily[0].date)}</span><span>{dayLabel(daily[Math.floor(daily.length / 2)].date)}</span><span>{dayLabel(daily[daily.length - 1].date)}</span></div>
        </>}
    </section>

    <section className="usage-section" aria-labelledby="usage-tokens">
      <h2 id="usage-tokens">Tokens</h2>
      <div className="usage-tiles">{tiles.map(([label, text]) => <div key={label}><span>{label}</span><strong>{text}</strong></div>)}</div>
    </section>

    <section className="usage-section" aria-labelledby="usage-breakdown">
      <div className="usage-section-head">
        <h2 id="usage-breakdown">{pt ? `Por ${groupLabels[group].toLocaleLowerCase(locale)}` : `By ${groupLabels[group].toLocaleLowerCase(locale)}`}</h2>
        <div className="usage-segment" role="group" aria-label={pt ? 'Agrupar por' : 'Group by'}>
          {(Object.keys(groupLabels) as Group[]).map((id) => <button key={id} type="button" aria-pressed={group === id} onClick={() => setGroup(id)}>{groupLabels[id]}</button>)}
        </div>
      </div>
      {rows.length ? <div className="usage-breakdown" role="table" aria-label={pt ? 'Uso por grupo' : 'Usage by group'}>
        <div role="row" className="usage-row head"><span role="columnheader">{groupLabels[group]}</span><span role="columnheader">{measure === 'cost' ? (pt ? 'Custo' : 'Cost') : 'Tokens'}</span><span role="columnheader">{pt ? 'Participação' : 'Share'}</span><span role="columnheader">{pt ? 'Respostas' : 'Replies'}</span></div>
        {rows.map((row) => { const share = rowTotal ? Math.round(value(row) / rowTotal * 100) : 0; return <div role="row" className="usage-row" key={row.key || 'none'}>
          <span role="cell" className="usage-row-name">{group === 'agent' && <AgentAvatar name={agentName(row.key)} image={agents.find((agent) => agent.id === row.key)?.avatarImage} mascot={agents.find((agent) => agent.id === row.key)?.avatarMascot} role={agents.find((agent) => agent.id === row.key)?.role} />}<span>{rowName(row.key)}</span></span>
          <span role="cell">{format(value(row))}</span>
          <span role="cell" className="usage-share"><i><b style={{ width: `${share}%` }} /></i><small>{share}%</small></span>
          <span role="cell">{row.turns}</span>
        </div>; })}
      </div> : <p className="usage-empty">{pt ? 'Sem respostas para agrupar.' : 'No replies to group.'}</p>}
    </section>
  </div>;
}
