import type { RadarConfigInput, RadarItem, RadarKind, RadarScope, RadarSnapshot, RadarSnapshotRow } from './model';
export class RadarApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}
export function radarRoute(scope: RadarScope, suffix = '', query: Record<string, string> = {}) {
  return `/api/content/radar${suffix}?${new URLSearchParams({ ...query, profile: scope.profile, workspaceId: scope.workspaceId })}`;
}
async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const value = await response.json().catch(() => { throw new RadarApiError('Invalid Radar response', response.status); });
  if (!response.ok) throw new RadarApiError(value.error || `Radar: HTTP ${response.status}`, response.status, value.code);
  return value;
}
export const loadRadar = (scope: RadarScope, kind: RadarKind, highlight: boolean, signal?: AbortSignal, cursor?: string) => request<RadarSnapshot>(radarRoute(scope, '', { kind, ...(highlight ? { highlight: '1' } : {}), ...(cursor ? { cursor } : {}), limit: '50' }), { signal });
export const configureRadar = (scope: RadarScope, config: RadarConfigInput, signal?: AbortSignal) => request<RadarSnapshot>(radarRoute(scope, '/config'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config), signal });
export const collectRadar = (scope: RadarScope, signal?: AbortSignal) => request<{ runId: string; status: 'running' }>(radarRoute(scope, '/collect'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal });
export const loadRadarHistory = (scope: RadarScope, id: string, signal?: AbortSignal) => request<{ item: RadarItem; snapshots: RadarSnapshotRow[] }>(radarRoute(scope, `/items/${encodeURIComponent(id)}/history`), { signal });
// The backend also returns an accepted waiting/blocked record when its preflight gate prevents sending.
export const synthesizeRadar = (scope: RadarScope) => request<{ synthesisId: string; status: 'running' | 'waiting_limit' | 'blocked' }>(radarRoute(scope, '/synthesize'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
export const promoteRadar = (scope: RadarScope, id: string, target: 'topic' | 'reference', targetId: string) => request<{ item: RadarItem; created: boolean }>(radarRoute(scope, `/items/${encodeURIComponent(id)}/promote`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, targetId }) });
