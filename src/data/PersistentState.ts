import type { StateStore } from './StateStore';

type Update<T> = T | ((current: T) => T);
type Listener = () => void;
export interface SaveStatus { phase: 'loading' | 'saving' | 'saved' | 'error'; pending: number; savedAt?: string }

// One live value per key. Two screens must not save independent, stale copies of
// the same preference over each other after mounting or reloading.
export class PersistentState {
  private values: Record<string, unknown> = {};
  private listeners = new Map<string, Set<Listener>>();
  private defaults = new Set<string>();
  private loaded = false;
  private loading?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private dirty = new Map<string, unknown>();
  private statusListeners = new Set<Listener>();
  private status: SaveStatus = { phase: 'loading', pending: 0 };
  private store: StateStore;
  private reportError: (key: string, error: unknown) => void;

  constructor(store: StateStore, reportError: (key: string, error: unknown) => void) {
    this.store = store;
    this.reportError = reportError;
  }

  restore(): Promise<void> {
    this.loading ??= this.store.readAll().then(values => {
      this.values = values;
      this.loaded = true;
      this.updateStatus('saved');
    }).catch(error => { this.loading = undefined; throw error; });
    return this.loading;
  }

  get<T>(key: string, initial: T | (() => T)): T {
    if (!this.loaded) throw new Error('Local data must be restored before opening the workspace');
    if (!Object.hasOwn(this.values, key)) {
      this.values[key] = typeof initial === 'function' ? (initial as () => T)() : initial;
      this.defaults.add(key);
    }
    return this.values[key] as T;
  }

  subscribe(key: string, listener: Listener): () => void {
    const listeners = this.listeners.get(key) ?? new Set<Listener>();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  saveDefault(key: string): void {
    if (!this.defaults.delete(key)) return;
    this.persist(key, this.values[key]);
  }

  set<T>(key: string, update: Update<T>): void {
    if (!this.loaded || !Object.hasOwn(this.values, key)) throw new Error('Local state has not been restored');
    const current = this.values[key] as T;
    const value = typeof update === 'function' ? (update as (current: T) => T)(current) : update;
    if (Object.is(current, value)) return;
    this.defaults.delete(key);
    // Desktop SQLite acknowledges the commit before React is notified. Closing
    // the application immediately after an edit cannot drop that mutation.
    this.persist(key, value);
    this.values[key] = value;
    for (const listener of this.listeners.get(key) ?? []) listener();
  }

  private persist(key: string, value: unknown): void {
    this.dirty.set(key,value); this.updateStatus('saving');
    if (this.store.writeSync) {
      try { this.store.writeSync(key, value); this.dirty.delete(key); this.updateStatus(this.dirty.size?'error':'saved'); }
      catch (error) { this.updateStatus('error'); this.reportError(key, error); }
    } else {
      // Browser IndexedDB writes stay ordered even when a transaction is slow.
      this.queue = this.queue.then(async () => {
        await this.store.write(key, value);
        if(Object.is(this.dirty.get(key),value))this.dirty.delete(key);
        this.updateStatus(this.dirty.size?'saving':'saved');
      }).catch(error => { this.updateStatus('error'); this.reportError(key, error); });
    }
  }

  async flush(): Promise<void> { await this.queue; }
  async saveNow(): Promise<void> {
    await this.queue;
    for(const [key,value] of this.dirty) {
      if(this.store.writeSync)this.store.writeSync(key,value);
      else await this.store.write(key,value);
      this.dirty.delete(key);
    }
    this.updateStatus('saved');
  }
  private updateStatus(phase: SaveStatus['phase']) {
    this.status={phase,pending:this.dirty.size,savedAt:phase==='saved'?new Date().toISOString():this.status.savedAt};
    for(const listener of this.statusListeners)listener();
  }
  getSaveStatus(): SaveStatus { return this.status; }
  subscribeStatus(listener: Listener): () => void { this.statusListeners.add(listener);return()=>{this.statusListeners.delete(listener)}; }

  snapshot(): Record<string, unknown> {
    if (!this.loaded) throw new Error('Local state has not been restored');
    return structuredClone(this.values);
  }
}
