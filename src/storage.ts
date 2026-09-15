import type { LocalAssetMap, TableMode } from './types';

export type SavedDraft = { markdown: string; title: string; tableMode: TableMode; documentPath: string; files: Array<[string, File]> };

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

export async function saveDraft(draft: Omit<SavedDraft, 'files'>, files: LocalAssetMap): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('draft', 'readwrite');
      transaction.objectStore('draft').put({ ...draft, files: [...files] }, 'current');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
