import { decodedBase64ByteLength } from '../../src/bridge.js';
import type { DraftBundle } from '../../src/types.js';

export type JobStatus = 'pending' | 'creating' | 'uploading' | 'failed' | 'uncertain' | 'completed';

export interface JobRecord {
  jobId: string;
  title: string;
  status: JobStatus;
  /** Kept only while the job may still need to run or be inspected after uncertainty. */
  bundle?: DraftBundle;
  fingerprint: string;
  imageCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  retryable: boolean;
  attemptId?: string;
  attemptStartedAt?: string;
  restId?: string;
  draftUrl?: string;
  progress?: { done: number; total: number };
}

export type ClaimDecision =
  | { kind: 'claimed'; job: JobRecord }
  | { kind: 'busy'; job: JobRecord }
  | { kind: 'completed'; job: JobRecord }
  | { kind: 'review-required'; job: JobRecord }
  | { kind: 'missing' };

function shortHash(input: string): string {
  // A small deterministic fingerprint is enough for same-job idempotency and avoids
  // duplicating a potentially multi-megabyte Markdown string in the record.
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function bundleFingerprint(bundle: DraftBundle): string {
  const assetPart = bundle.assets
    .map((asset) => `${asset.source}\u0000${asset.fileName}\u0000${asset.mime}\u0000${asset.sha256}`)
    .join('\u0001');
  return [bundle.schemaVersion, bundle.jobId, bundle.title, bundle.createdAt, bundle.markdown.length, shortHash(bundle.markdown), assetPart].join('\u0002');
}

export function bundleByteCount(bundle: DraftBundle): number {
  return bundle.assets.reduce((total, asset) => total + (decodedBase64ByteLength(asset.base64) ?? 0), 0);
}

export function makeJobRecord(bundle: DraftBundle, now = new Date().toISOString()): JobRecord {
  return {
    jobId: bundle.jobId,
    title: bundle.title,
    status: 'pending',
    bundle,
    fingerprint: bundleFingerprint(bundle),
    imageCount: bundle.assets.length,
    totalBytes: bundleByteCount(bundle),
    createdAt: bundle.createdAt,
    updatedAt: now,
    retryable: true,
  };
}

/** Convert an in-flight record left by a stopped service worker into a manual-review state. */
export function recoverInterruptedJob(job: JobRecord, now = new Date().toISOString()): JobRecord {
  if (job.status !== 'creating' && job.status !== 'uploading') return { ...job };
  return {
    ...job,
    status: 'uncertain',
    updatedAt: now,
    retryable: false,
    attemptId: undefined,
    attemptStartedAt: undefined,
    error: 'The previous attempt stopped before its result was known. Open X Articles and verify whether a draft was created before trying again.',
  };
}

/** Atomically decide whether a user click may start an attempt. */
export function claimJobState(job: JobRecord, attemptId: string, now = new Date().toISOString()): ClaimDecision {
  if (job.status === 'creating' || job.status === 'uploading') return { kind: 'busy', job: { ...job } };
  if (job.status === 'completed') return { kind: 'completed', job: { ...job } };
  if (job.status === 'uncertain') return { kind: 'review-required', job: { ...job } };
  if (job.status !== 'pending' && !(job.status === 'failed' && job.retryable)) {
    return { kind: 'review-required', job: { ...job } };
  }
  return {
    kind: 'claimed',
    job: {
      ...job,
      status: 'creating',
      updatedAt: now,
      error: undefined,
      retryable: false,
      attemptId,
      attemptStartedAt: now,
      progress: { done: 0, total: job.imageCount },
    },
  };
}

export function markUploading(job: JobRecord, done: number, now = new Date().toISOString()): JobRecord {
  return {
    ...job,
    status: 'uploading',
    updatedAt: now,
    progress: { done: Math.max(0, Math.min(done, job.imageCount)), total: job.imageCount },
  };
}

export function completeJob(job: JobRecord, restId: string, draftUrl: string, now = new Date().toISOString()): JobRecord {
  return {
    ...job,
    status: 'completed',
    updatedAt: now,
    // Completed jobs retain only their result metadata. Pending content is deleted here.
    bundle: undefined,
    error: undefined,
    retryable: false,
    attemptId: undefined,
    attemptStartedAt: undefined,
    progress: { done: job.imageCount, total: job.imageCount },
    restId,
    draftUrl,
  };
}

export function failJob(job: JobRecord, error: string, retryable: boolean, now = new Date().toISOString()): JobRecord {
  return {
    ...job,
    status: 'failed',
    updatedAt: now,
    error,
    retryable,
    attemptId: undefined,
    attemptStartedAt: undefined,
  };
}

export function markUncertain(job: JobRecord, error: string, now = new Date().toISOString()): JobRecord {
  return {
    ...job,
    status: 'uncertain',
    updatedAt: now,
    error,
    retryable: false,
    attemptId: undefined,
    attemptStartedAt: undefined,
  };
}

/** Explicitly arm a second attempt after the user has checked X for the first result. */
export function armUncertainRetry(job: JobRecord, now = new Date().toISOString()): JobRecord {
  if (job.status !== 'uncertain') return { ...job };
  return {
    ...job,
    status: 'pending',
    updatedAt: now,
    error: 'The previous result was reviewed by the user; a new attempt is allowed.',
    retryable: true,
  };
}
