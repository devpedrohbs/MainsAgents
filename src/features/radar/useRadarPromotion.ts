import { useEffect, useMemo, useRef, useState } from 'react';
import { useContentWorkflow } from '../content/ContentWorkflowProvider';
import { loadRadarHistory, promoteRadar } from './api';
import { prepareRadarReference, RadarPromotionQueue, type PromotionTarget } from './promotion';
import type { RadarItem, RadarRecommendation, RadarScope, RadarSnapshot, RadarSnapshotRow } from './model';

export function useRadarPromotion(scope: RadarScope, snapshot: RadarSnapshot | null, pt: boolean) {
  const editorial = useContentWorkflow();
  const latest = useRef(editorial);
  latest.current = editorial;
  const [known, setKnown] = useState<Record<string, RadarItem>>({});
  const [busy, setBusy] = useState(false);
  const operations = useRef(0);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const queue = useMemo(() => {
    const prefix = `radar-promotion:${encodeURIComponent(scope.profile)}:${encodeURIComponent(scope.workspaceId)}:`;
    return new RadarPromotionQueue({
      read: key => { try { return localStorage.getItem(prefix + key); } catch { return null; } },
      write: (key, id) => { try { localStorage.setItem(prefix + key, id); } catch { /* In-memory receipt and editorial URL deduplication still protect retries. */ } },
    });
  }, [scope]);
  const itemKey = (snapshot?.items ?? []).map(item => item.id).join('|');
  const recommendationKey = (snapshot?.synthesis.recommendations ?? []).map(rec => rec.itemId).join('|');
  useEffect(() => {
    const controller = new AbortController();
    const visible = new Set(itemKey.split('|'));
    for (const id of new Set(recommendationKey.split('|').filter(Boolean))) {
      if (!visible.has(id)) void loadRadarHistory(scope, id, controller.signal).then(({ item }) => {
        if (!controller.signal.aborted) setKnown(previous => ({ ...previous, [id]: item }));
      }).catch(() => { /* Promotion retries the authoritative lookup and shows any failure. */ });
    }
    return () => controller.abort();
  }, [scope, itemKey, recommendationKey]);
  const getItem = (id: string) => {
    const item = snapshot?.items.find(item => item.id === id);
    const cached = known[id];
    if (!item) return cached;
    return cached ? { ...item, promoted: [...item.promoted, ...cached.promoted.filter(link => !item.promoted.some(old => old.target === link.target))] } : item;
  };
  const promote = async (itemId: string, target: PromotionTarget, recommendation?: RadarRecommendation) => {
    setError(''); operations.current++; setBusy(true);
    try {
      let latestObservation: RadarSnapshotRow | undefined;
      const item = await queue.promote(itemId, target, {
        load: async () => {
          const history = await loadRadarHistory(scope, itemId);
          latestObservation = [...history.snapshots].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0];
          return history.item;
        },
        create: async item => {
          const current = latest.current;
          if (!current.ready || current.storageError) throw Error(current.storageError || (pt ? 'A biblioteca editorial ainda está carregando.' : 'Editorial library is still loading.'));
          if (target === 'topic') {
            const existing = current.state.topics.find(topic => topic.workspaceId === scope.workspaceId && topic.originUrl === new URL(item.url).href);
            if (existing) return existing.id;
            // URL inputs accept only a URL. Draft topics cannot be revised through the provider;
            // the recommendation remains in the synthesis and in saved reference notes.
            return (await current.createTopic({ workspaceId: scope.workspaceId, inputKind: 'url', input: item.url, category: 'Tecnologia', priority: 'normal' })).id;
          }
          const prepared = prepareRadarReference(current.state.inspiration, scope.workspaceId, item, recommendation, pt, latestObservation);
          await current.saveInspiration(prepared.state);
          return prepared.reference.id;
        },
        register: async id => (await promoteRadar(scope, itemId, target, id)).item,
      });
      if (mounted.current) setKnown(previous => ({ ...previous, [itemId]: item }));
    } catch (failure) {
      if (mounted.current) setError(`${pt ? 'Não foi possível concluir o vínculo. Tente de novo; um registro já criado será reutilizado.' : 'Could not complete the link. Try again; any record already created will be reused.'} ${failure instanceof Error ? failure.message : String(failure)}`);
    } finally { operations.current--; if (mounted.current) setBusy(operations.current > 0); }
  };
  return { getItem, promote, busy, error, ready: editorial.ready && !editorial.storageError };
}
