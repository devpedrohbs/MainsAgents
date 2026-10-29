import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storageProfile } from '../../data/IndexedDbStateStore';
import { collectRadar, configureRadar, loadRadar, RadarApiError } from './api';
import type { RadarConfigInput, RadarKind, RadarSnapshot } from './model';

export function useRadar(workspaceId: string, kind: RadarKind, highlights: boolean) {
  const profile = window.mainsAgentsDesktop?.state ? storageProfile() : (() => { try { return localStorage.getItem('mainsagents-profile') || 'default'; } catch { return 'default'; } })();
  const scope = useMemo(() => ({ profile, workspaceId }), [profile, workspaceId]);
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryReady, setQueryReady] = useState(false);
  const sequence = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const operation = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);

  const refresh = useCallback(async (signal?: AbortSignal, cursor?: string) => {
    const request = ++sequence.current;
    try {
      const next = await loadRadar(scope, kind, highlights, signal, cursor);
      if (!alive.current || signal?.aborted || request !== sequence.current || activeScope.current !== scope) return;
      if (next?.schemaVersion !== 1 || !Array.isArray(next.items) || !Array.isArray(next.runs) || !next.config || !Array.isArray(next.sources)) throw Error('Invalid Radar snapshot');
      setSnapshot(previous => cursor && previous ? { ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))] } : next);
      setState('ready'); setQueryReady(true);
      setPendingRun(id => id && (next.running?.id === id || next.runs.some(run => run.id === id && run.status !== 'running')) ? null : id);
    } catch {
      if (alive.current && !signal?.aborted && request === sequence.current && activeScope.current === scope) setState('unavailable');
    }
  }, [scope, kind, highlights]);
  const currentRefresh = useRef(refresh);
  currentRefresh.current = refresh;
  useEffect(() => {
    const controller = new AbortController();
    setQueryReady(false);
    void refresh(controller.signal);
    return () => { controller.abort(); sequence.current++; };
  }, [refresh]);

  const running = Boolean(snapshot?.running || pendingRun);
  useEffect(() => {
    if (!running || loadingMore) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [running, loadingMore, refresh]);

  const perform = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try { await action(); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const configure = (input: RadarConfigInput) => perform(async () => {
    await configureRadar(scope, input);
    if (alive.current && activeScope.current === scope) await currentRefresh.current();
  });
  const collect = () => perform(async () => {
    try {
      const result = await collectRadar(scope);
      if (alive.current && activeScope.current === scope) setPendingRun(result.runId);
    } catch (error) {
      if (!(error instanceof RadarApiError && error.status === 409 && error.code === 'already_running')) throw error;
      // A concurrent collection is already doing the requested work. Rejoin its snapshot/polling.
    }
    if (alive.current && activeScope.current === scope) await currentRefresh.current();
  });
  const more = async () => {
    if (!snapshot?.nextCursor || loadingMore || !queryReady) return;
    setLoadingMore(true);
    try { await refresh(undefined, snapshot.nextCursor); } finally { if (alive.current) setLoadingMore(false); }
  };
  return { scope, snapshot, state, busy, running, queryReady, loadingMore, refresh, configure, collect, more };
}
