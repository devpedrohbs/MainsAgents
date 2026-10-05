import { useCallback, useEffect, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { indexedDbStateStore } from './IndexedDbStateStore';
import { PersistentState } from './PersistentState';
import { saveCoordinator } from './SaveCoordinator';

const persistentState = new PersistentState(indexedDbStateStore, (key, error) => {
  console.warn(`[MainsAgents] Failed to persist ${key}`, error);
  window.dispatchEvent(new CustomEvent('mainsagents:persistence-error', {
    detail: `Could not save ${key}. Keep the app open and export a backup before restarting.`,
  }));
});

export function restoreLocalPersistence(): Promise<void> { return persistentState.restore(); }
export function persistentSnapshot(): Record<string, unknown> { return persistentState.snapshot(); }
export function readPersistentValue<T>(key: string, initial: T): T { return persistentState.get(key, initial); }
export function updatePersistentValue<T>(key: string, initial: T, update: T | ((current: T) => T)): void {
  persistentState.get(key, initial);
  persistentState.set(key, update);
}
export async function saveNow(): Promise<void> {
  await persistentState.saveNow();
  await saveCoordinator.flush();
  await window.mainsAgentsDesktop?.state?.saveCheckpoint?.();
}
// Retry temporary disk/SQLite failures without ever bypassing revision checks.
window.setInterval(()=>{
  if(persistentState.getSaveStatus().phase==='error'||saveCoordinator.getStatus().phase==='error')void saveNow().catch(()=>{});
},5000);
window.addEventListener('beforeunload',event=>{
  if(persistentState.getSaveStatus().pending||saveCoordinator.getStatus().pending){event.preventDefault();event.returnValue='';}
});
window.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
    event.preventDefault();void saveNow().catch(()=>{});
  }
});
export function useSaveStatus() {
  const core=useSyncExternalStore(useCallback(listener=>persistentState.subscribeStatus(listener),[]),useCallback(()=>persistentState.getSaveStatus(),[]));
  const extra=useSyncExternalStore(saveCoordinator.subscribe,saveCoordinator.getStatus);
  return useMemo(()=>({...core,pending:core.pending+extra.pending,phase:core.phase==='error'||extra.phase==='error'?'error' as const:core.phase==='saving'||extra.phase==='saving'?'saving' as const:'saved' as const}),[core,extra]);
}

export function usePersistentState<T>(key: string, initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>, boolean] {
  const subscribe = useCallback((listener: () => void) => persistentState.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => persistentState.get(key, initialValue), [key, initialValue]);
  const value = useSyncExternalStore(subscribe, snapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(update => persistentState.set(key, update), [key]);
  useEffect(() => { persistentState.saveDefault(key); }, [key]);
  return [value, setValue, true];
}
