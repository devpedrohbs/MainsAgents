import type { StateStore } from './StateStore';

// Keep the legacy database name stable for browser use and desktop migration.
// Sandboxed HTML previews can throw even when accessing the storage getter.
// A blocked profile lookup must not prevent the application from rendering.
function readAccountProfile(): string {
  try {
    const desktopProfile = typeof window !== 'undefined' ? window.mainsAgentsDesktop?.state?.profile : undefined;
    if (desktopProfile) return desktopProfile === 'default' ? '' : desktopProfile;
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem('mainsagents-profile') ?? '';
  } catch {
    return '';
  }
}
const accountProfile = readAccountProfile();
const databaseName = accountProfile ? `mainsagents-account-${accountProfile}` : 'mainsagents-desktop-v1';
const storeName = 'app-state';
const databaseVersion = 2;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local database'));
    request.onblocked = () => reject(new Error('Local database upgrade was blocked'));
  }).catch((error)=>{databasePromise=null;throw error});
  databasePromise=pending;
  return pending;
}

const legacyStateStore: StateStore = {
  async read<T>(key: string): Promise<T | undefined> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error(`Could not read ${key}`));
    });
  },
  async write<T>(key: string, value: T): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error(`Could not save ${key}`));
      transaction.onabort = () => reject(transaction.error ?? new Error(`Could not save ${key}`));
    });
  },
  async readAll(): Promise<Record<string, unknown>> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const keys = store.getAllKeys();
      const values = store.getAll();
      transaction.oncomplete = () => resolve(Object.fromEntries(keys.result.map((key, index) => [String(key), values.result[index]])));
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not read local data'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not read local data'));
    });
  },
  async replaceAll(values: Record<string, unknown>): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      store.clear();
      for (const [key, value] of Object.entries(values)) store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not restore backup'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not restore backup'));
    });
  },
};

const desktopState = typeof window !== 'undefined' ? window.mainsAgentsDesktop?.state : undefined;
const profile = accountProfile || 'default';
let initialization: Promise<void> | undefined;
async function readyDesktopState() {
  if (!desktopState) return;
  initialization ??= (async () => {
    if (!await desktopState.hasProfile(profile)) {
      // A failed legacy read aborts migration; never seed a new store with defaults.
      await desktopState.initialize(profile, await legacyStateStore.readAll());
    }
  })().catch(error => { initialization = undefined; throw error; });
  await initialization;
}

export const indexedDbStateStore: StateStore = desktopState ? {
  async read<T>(key: string) { await readyDesktopState(); return desktopState.read<T>(profile, key); },
  async write<T>(key: string, value: T) { await readyDesktopState(); await desktopState.write(profile, key, value); },
  async readAll() { await readyDesktopState(); return desktopState.readAll(profile); },
  async replaceAll(values) { await readyDesktopState(); await desktopState.replaceAll(profile, values); },
} : legacyStateStore;
