import type { RadarConfigInput, RadarItem, RadarKind, RadarRun, RadarSnapshotRow, RadarSourceInput, SourceStatus } from '../../../radar-contract.d.mts';
export type * from '../../../radar-contract.d.mts';

export type RadarScope = { profile: string; workspaceId: string };
export type SourceDraft = { kind: RadarSourceInput['kind']; value: string; label: string; regionCode: string };
export const unavailable = (pt: boolean) => pt ? 'indisponível' : 'unavailable';
export function numberText(value: number | null | undefined, pt: boolean, digits = 0) {
  return value == null || !Number.isFinite(value) ? unavailable(pt) : value.toLocaleString(pt ? 'pt-BR' : 'en', { maximumFractionDigits: digits });
}
export function dateText(value: string | null | undefined, pt: boolean) {
  if (!value) return unavailable(pt);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unavailable(pt) : date.toLocaleString(pt ? 'pt-BR' : 'en');
}
export function dayText(value: string, pt: boolean) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(pt ? 'pt-BR' : 'en') : value;
}
export function statusText(status: SourceStatus | RadarRun['status'], pt: boolean) {
  const labels: Record<SourceStatus | RadarRun['status'], [string, string]> = {
    ok: ['Ok', 'OK'], partial: ['Parcial', 'Partial'], needs_reauth: ['Precisa reautenticar', 'Needs reauthentication'],
    limit_reached: ['Limite atingido', 'Limit reached'], error: ['Erro', 'Error'], idle: ['Sem coleta', 'Not collected'],
    running: ['Coletando', 'Collecting'], succeeded: ['Concluída', 'Completed'], failed: ['Falhou', 'Failed'], interrupted: ['Interrompida', 'Interrupted'],
  };
  return labels[status]?.[pt ? 0 : 1] ?? status;
}
export function sourceLabel(source: RadarSourceInput, pt: boolean) {
  switch (source.kind) {
    case 'youtube-channel': return source.label || source.channelId;
    case 'youtube-search': return source.query;
    case 'news-rss': return source.label || source.url;
    case 'hackernews': return `Hacker News (${pt ? 'mínimo' : 'minimum'} ${source.minScore ?? 100})`;
  }
}
export function sourceKindText(kind: RadarSourceInput['kind'], pt: boolean) {
  const labels: Record<RadarSourceInput['kind'], [string, string]> = {
    'youtube-channel': ['Canal do YouTube', 'YouTube channel'], 'youtube-search': ['Busca no YouTube', 'YouTube search'],
    'news-rss': ['Feed RSS / Atom', 'RSS / Atom feed'], hackernews: ['Hacker News', 'Hacker News'],
  };
  return labels[kind][pt ? 0 : 1];
}
export function sourceInput(draft: SourceDraft, pt: boolean): RadarSourceInput {
  const value = draft.value.trim();
  const fail = (a: string, b: string): never => { throw new Error(pt ? a : b); };
  switch (draft.kind) {
    case 'youtube-channel':
      if (!/^UC[\w-]{22}$/.test(value)) fail('Use o channelId com 24 caracteres, começando por UC.', 'Use the 24-character channelId starting with UC.');
      return { kind: draft.kind, channelId: value, ...(draft.label.trim() ? { label: draft.label.trim() } : {}) };
    case 'youtube-search': {
      if (!value || value.length > 120) fail('O tema deve ter entre 1 e 120 caracteres.', 'The topic must contain 1–120 characters.');
      const regionCode = draft.regionCode.trim().toUpperCase();
      if (regionCode && !/^[A-Z]{2}$/.test(regionCode)) fail('Use um código de país com duas letras.', 'Use a two-letter country code.');
      return { kind: draft.kind, query: value, ...(regionCode ? { regionCode } : {}) };
    }
    case 'news-rss': {
      let valid = false;
      try { const url = new URL(value); valid = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; } catch { /* invalid URL */ }
      if (!valid) fail('Use a URL HTTPS de um feed RSS ou Atom.', 'Use the HTTPS URL of an RSS or Atom feed.');
      return { kind: draft.kind, url: value, ...(draft.label.trim() ? { label: draft.label.trim() } : {}) };
    }
    case 'hackernews': {
      const minScore = value === '' ? 100 : Number(value);
      if (!Number.isSafeInteger(minScore) || minScore < 1 || minScore > 5000) fail('A pontuação mínima deve ser um inteiro entre 1 e 5000.', 'The minimum score must be an integer between 1 and 5000.');
      return { kind: draft.kind, minScore };
    }
  }
}
export function validateConfig(config: RadarConfigInput, pt: boolean) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.schedule.time)) throw new Error(pt ? 'Informe um horário válido (HH:MM).' : 'Enter a valid time (HH:MM).');
  return config;
}
export function visibleItems(items: RadarItem[], kind: RadarKind, highlights: boolean) {
  return items.filter(item => item.kind === kind && (!highlights || item.highlight));
}
export function videoFacts(item: RadarItem, pt: boolean) {
  const m = item.metrics;
  const ratio = m?.baselineStatus === 'insufficient' ? (pt ? 'base insuficiente' : 'insufficient baseline')
    : m?.baselineStatus === 'ok' && m.ratio != null ? `${numberText(m.ratio, pt, 2)}× ${pt ? 'a mediana do canal' : 'the channel median'}` : unavailable(pt);
  return {
    views: numberText(m?.latest?.views, pt), ratio,
    baseline: m ? `${numberText(m.baselineCount, pt)} ${pt ? 'vídeos' : 'videos'}; ${pt ? 'mediana' : 'median'} ${numberText(m.baselineMedian, pt)}` : unavailable(pt),
    maturity: m ? m.maturity === 'mature' ? (pt ? 'Maduro (≥ 7 dias)' : 'Mature (≥ 7 days)') : (pt ? 'Imaturo (< 7 dias)' : 'Immature (< 7 days)') : unavailable(pt),
    format: !m || m.format === 'unknown' ? unavailable(pt) : m.format === 'short' ? (pt ? 'Short (hipótese pela duração ≤ 180 s)' : 'Short (hypothesis: duration ≤ 180 s)') : m.format === 'live' ? (pt ? 'Ao vivo' : 'Live') : (pt ? 'Vídeo' : 'Video'),
    growth: m?.growth ? `${numberText(m.growth.viewsPerHour, pt, 2)} ${pt ? 'views/h em' : 'views/h over'} ${numberText(m.growth.hours, pt, 2)} h` : unavailable(pt),
    limitations: m?.limitations ?? [],
  };
}
export function historyRows(snapshots: RadarSnapshotRow[], runs: RadarRun[]) {
  return [...snapshots].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)).map(snapshot => ({
    snapshot, gapDays: runs.find(run => run.id === snapshot.runId)?.gapDays ?? [],
  }));
}
export function safeItemUrl(url: string) {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
