import type { RememberedHandles } from './filesystem';
import type { LocalAssetMap, TableMode } from './types';

export type SavedDraft = { markdown: string; title: string; tableMode: TableMode; documentPath: string; files: Array<[string, File]>; handles?: RememberedHandles };

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('article-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadDraft(): Promise<SavedDraft | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('draft', 'readonly').objectStore('draft').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveDraft(draft: Omit<SavedDraft, 'files' | 'handles'>, files: LocalAssetMap, handles: RememberedHandles = {}): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('draft', 'readwrite');
      const store = transaction.objectStore('draft');
      const record = { ...draft, files: [...files] };
      // File handles are stored where the browser can clone them; otherwise save the rest.
      try { store.put({ ...record, handles }, 'current'); } catch { store.put(record, 'current'); }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
