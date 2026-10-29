import { useCallback, useEffect, useRef, useState } from 'react';
import { storageProfile } from '../../data/IndexedDbStateStore';
import { importReferenceVideos, loadReferences, referenceCommand } from './api';
import type { ReferenceCommand, ReferenceCommandResult, ReferenceScope, ReferenceSnapshot } from './model';

export type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'unavailable'; message: string } | { kind: 'error'; message: string };
type ApiError = Error & { code?: string; status?: number };

export function referenceScope(workspaceId: string): ReferenceScope {
  let profile = 'default';
  if (window.mainsAgentsDesktop?.state) profile = storageProfile();
  else { try { profile = localStorage.getItem('mainsagents-profile') || 'default'; } catch { /* storage blocked */ } }
  return { profile, workspaceId };
}

/**
 * The only path from the Editing references screens to data: the typed client. The snapshot it returns is the single
 * source of truth; commands carry the entity revision they were built from, and a conflict reloads instead of retrying.
 */
export function useEditingReferences(workspaceId: string) {
  const scope = useRef(referenceScope(workspaceId));
  scope.current = referenceScope(workspaceId);
  const [snapshot, setSnapshot] = useState<ReferenceSnapshot | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busy, setBusy] = useState(0);
  const latest = useRef<ReferenceSnapshot | null>(null);
  latest.current = snapshot;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await loadReferences(scope.current, signal);
      // Anything that is not a Round 8 snapshot means this host has no references service: say so, never guess.
      if (next?.schemaVersion !== 1 || !Array.isArray(next.references)) { setState({ kind: 'unavailable', message: 'unexpected response' }); return null; }
      setSnapshot(next); setState({ kind: 'ready' });
      return next;
    } catch (error) {
      if (signal?.aborted) return null;
      const failure = error as ApiError;
      // A missing route (404) or a non-JSON answer means this build has no references backend yet.
      if (failure.status === 404 || error instanceof SyntaxError || failure instanceof TypeError) setState({ kind: 'unavailable', message: failure.message });
      else setState({ kind: 'error', message: failure.message });
      return null;
    }
  }, []);

  useEffect(() => { const controller = new AbortController(); setState({ kind: 'loading' }); void refresh(controller.signal); return () => controller.abort(); }, [workspaceId, refresh]);

  // Poll only while the backend reports work in progress; stop as soon as nothing is queued or running.
  const working = Boolean(snapshot?.jobs.some((job) => job.status === 'queued' || job.status === 'running') || snapshot?.engine.status === 'checking' || snapshot?.engine.status === 'preparing');
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [working, refresh]);

  const run = useCallback(async (command: ReferenceCommand): Promise<ReferenceCommandResult> => {
    setBusy((count) => count + 1);
    try {
      const result = await referenceCommand(scope.current, command);
      setSnapshot(result.snapshot);
      return result;
    } catch (error) {
      const failure = error as ApiError;
      if (failure.status === 409 || failure.code === 'revision_conflict') {
        await refresh();
        throw Object.assign(new Error('changed-elsewhere'), { code: 'revision_conflict' });
      }
      throw error;
    } finally { setBusy((count) => count - 1); }
  }, [refresh]);

  const importVideos = useCallback(async (folderId: string | null, referenceId?: string, expectedRevision?: number) => {
    setBusy((count) => count + 1);
    try {
      const result = await importReferenceVideos(scope.current, folderId, referenceId, expectedRevision);
      if (result) setSnapshot(result.snapshot);
      return result;
    } finally { setBusy((count) => count - 1); }
  }, []);

  return { scope: scope.current, snapshot, state, busy: busy > 0, refresh, run, importVideos, latest: () => latest.current, canImport: Boolean(window.mainsAgentsDesktop?.editingReferences) };
}

export type EditingReferencesApi = ReturnType<typeof useEditingReferences>;

export function errorText(error: unknown, pt: boolean) {
  const failure = error as ApiError;
  if (failure?.code === 'revision_conflict') return pt ? 'Isso mudou em outro lugar. Recarreguei a versão atual; confira e tente de novo.' : 'This changed elsewhere. The current version was reloaded; check it and try again.';
  return failure instanceof Error ? failure.message : String(error);
}
