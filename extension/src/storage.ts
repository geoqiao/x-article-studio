import { claimJobState, type ClaimDecision, type JobRecord } from './state.js';

const DATABASE_NAME = 'article-studio-bridge';
const DATABASE_VERSION = 1;
const JOB_STORE = 'jobs';

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this extension context.'));

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(JOB_STORE)) database.createObjectStore(JOB_STORE, { keyPath: 'jobId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open extension storage.'));
  });
  return databasePromise;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const database = await openDatabase();
  return await new Promise<JobRecord | null>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readonly');
    const request = transaction.objectStore(JOB_STORE).get(jobId);
    request.onsuccess = () => resolve((request.result as JobRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('Unable to read extension storage.'));
  });
}

export async function putJob(job: JobRecord): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readwrite');
    transaction.objectStore(JOB_STORE).put(job);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to write extension storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Extension storage write was aborted.'));
  });
}

export async function deleteJob(jobId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readwrite');
    transaction.objectStore(JOB_STORE).delete(jobId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to delete extension storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Extension storage delete was aborted.'));
  });
}

/** Use a read-write transaction so two review clicks cannot both claim a pending job. */
export async function claimJob(jobId: string, attemptId: string, now = new Date().toISOString()): Promise<ClaimDecision> {
  const database = await openDatabase();
  return await new Promise<ClaimDecision>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readwrite');
    const store = transaction.objectStore(JOB_STORE);
    const request = store.get(jobId);
    let decision: ClaimDecision | undefined;

    request.onsuccess = () => {
      const current = request.result as JobRecord | undefined;
      decision = current ? claimJobState(current, attemptId, now) : { kind: 'missing' };
      if (decision.kind === 'claimed') store.put(decision.job);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Unable to claim extension job.'));
    };
    transaction.oncomplete = () => {
      if (decision) resolve(decision);
      else reject(new Error('Extension job claim completed without a decision.'));
    };
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to claim extension job.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Extension job claim was aborted.'));
  });
}

/** Apply one state transition atomically and return the resulting record. */
export async function updateJob(jobId: string, updater: (job: JobRecord) => JobRecord | null): Promise<JobRecord | null> {
  const database = await openDatabase();
  return await new Promise<JobRecord | null>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readwrite');
    const store = transaction.objectStore(JOB_STORE);
    const request = store.get(jobId);
    let result: JobRecord | null = null;

    request.onsuccess = () => {
      const current = request.result as JobRecord | undefined;
      if (!current) return;
      try {
        result = updater(current);
        if (result) store.put(result);
        else store.delete(jobId);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to update extension storage.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to update extension storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Extension storage update was aborted.'));
  });
}

export async function deleteAllJobs(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(JOB_STORE, 'readwrite');
    transaction.objectStore(JOB_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Unable to clear extension storage.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Extension storage clear was aborted.'));
  });
}
