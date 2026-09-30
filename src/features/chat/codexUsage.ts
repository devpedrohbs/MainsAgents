export interface UsageWindow { usedPercent: number | null; resetsAt: number | null }
export interface CodexUsage { fiveHours: UsageWindow | null; weekly: UsageWindow | null; plan: string | null; fetchedAt: string }
type LimitWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };
type Limit = { limitId?: string; planType?: string; primary?: LimitWindow | null; secondary?: LimitWindow | null };
interface UsageResponse { rateLimits?: Limit | null; rateLimitsByLimitId?: Record<string, Limit> | null; fetchedAt?: string }

/** Duration identifies each quota; primary/secondary ordering varies by account. */
export function normalizeCodexUsage(input: UsageResponse): CodexUsage {
  const limit = input.rateLimitsByLimitId?.codex ?? input.rateLimits;
  const windows = [limit?.primary, limit?.secondary];
  const windowFor = (minutes: number): UsageWindow | null => {
    const value = windows.find(window => window?.windowDurationMins === minutes);
    if (!value) return null;
    return {
      usedPercent: typeof value.usedPercent === 'number' && Number.isFinite(value.usedPercent) ? Math.min(100, Math.max(0, value.usedPercent)) : null,
      resetsAt: typeof value.resetsAt === 'number' && Number.isFinite(value.resetsAt) && value.resetsAt > 0 ? value.resetsAt : null,
    };
  };
  return { fiveHours: windowFor(300), weekly: windowFor(10080), plan: limit?.planType ?? null, fetchedAt: input.fetchedAt ?? new Date().toISOString() };
}

export async function readCodexUsage(signal: AbortSignal): Promise<CodexUsage> {
  const response = await fetch('/api/codex/usage', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Codex usage unavailable');
  return normalizeCodexUsage(await response.json());
}
