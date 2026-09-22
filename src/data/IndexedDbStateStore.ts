import type { StateStore } from './StateStore';

// A fresh database name intentionally starts the production app without prototype data.
// Electron stores this database inside its persistent per-user application profile.
const databaseName = 'mainsagents-desktop-v1';
const storeName = 'app-state';
const databaseVersion = 1;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local database'));
    request.onblocked = () => reject(new Error('Local database upgrade was blocked'));
  });
  return databasePromise;
}

export const indexedDbStateStore: StateStore = {
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
};
