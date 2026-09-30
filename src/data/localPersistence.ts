import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { indexedDbStateStore } from './IndexedDbStateStore';

export function usePersistentState<T>(key: string, initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>, boolean] {
  const initialRef = useRef<T>(undefined as T);
  const [value, setValue] = useState<T>(() => {
    const resolved = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    initialRef.current = resolved;
    return resolved;
  });
  const [hydrated, setHydrated] = useState(false);
  const alive = useRef(true);
  const hydratedRef = useRef(false);
  const pendingUpdates = useRef<SetStateAction<T>[]>([]);
  const loadVersion = useRef(0);

  const setPersistentValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (!hydratedRef.current) pendingUpdates.current.push(update);
    setValue(update);
  }, []);

  useEffect(() => {
    const version = ++loadVersion.current;
    alive.current = true;
    hydratedRef.current = false;
    setHydrated(false);
    indexedDbStateStore.read<T>(key)
      .then((saved) => {
        if (!alive.current || version !== loadVersion.current) return;
        let restored = saved ?? initialRef.current;
        for (const update of pendingUpdates.current) restored = typeof update === 'function' ? (update as (current: T) => T)(restored) : update;
        pendingUpdates.current = [];
        setValue(restored);
        hydratedRef.current = true;
        setHydrated(true);
      })
      .catch((error) => {
        if (!alive.current || version !== loadVersion.current) return;
        console.warn(`[MainsAgents] Failed to restore ${key}`, error);
        window.dispatchEvent(new CustomEvent('mainsagents:persistence-error',{detail:`Could not restore ${key}. Your saved data has been kept. Restart the app to try again.`}));
      });
    return () => { alive.current = false; };
  }, [key]);

  useEffect(() => {
    if (!hydrated || !hydratedRef.current) return;
    indexedDbStateStore.write(key, value).catch((error) => {console.warn(`[MainsAgents] Failed to persist ${key}`, error);window.dispatchEvent(new CustomEvent('mainsagents:persistence-error',{detail:`Could not save ${key}. Check available disk space.`}))});
  }, [hydrated, key, value]);

  return [value, setPersistentValue, hydrated];
}
