// Minimal IndexedDB key-value store (used to cache the baked world between sessions).
const DB = 'wild-mystics';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* storage unavailable */ }
}

export async function idbDeletePrefix(prefix: string, keep: string): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => { for (const k of req.result) if (String(k).startsWith(prefix) && k !== keep) store.delete(k); };
  } catch { /* ignore */ }
}
