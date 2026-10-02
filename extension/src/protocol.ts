import type {
  BridgeRequestMessage,
  BridgeResponseMessage,
} from '../../src/bridge.js';
import type { DraftBundle } from '../../src/types.js';

export type { BridgeRequestMessage, BridgeResponseMessage };

/** The name is intentionally obscure enough to avoid colliding with page scripts. */
export const RUNNER_GLOBAL = '__articleStudioXRunner__';

export type ExtensionRequest =
  | { type: 'article-studio-page-request'; request: BridgeRequestMessage }
  | { type: 'article-studio-review-get'; jobId: string }
  | { type: 'article-studio-review-create'; jobId: string }
  | { type: 'article-studio-review-arm-retry'; jobId: string }
  | { type: 'article-studio-review-discard'; jobId: string }
  | { type: 'article-studio-settings-get' }
  | { type: 'article-studio-settings-set'; autoCreate: boolean };

/**
 * 'rejected' means X answered the create request with a definite refusal, so no
 * draft exists. 'create' means the outcome is unknown and X must be checked.
 */
export type RunnerFailurePhase = 'preflight' | 'assets' | 'rejected' | 'create';

export type RunnerResult =
  | { ok: true; restId: string; warning?: string }
  | { ok: false; phase: RunnerFailurePhase; code: string; message: string };

export interface CompanionSettings {
  /** Create a draft as soon as the website stages it, without the review click. */
  autoCreate: boolean;
}

export interface ReviewJobView {
  jobId: string;
  title: string;
  status: 'pending' | 'creating' | 'uploading' | 'failed' | 'uncertain' | 'completed';
  imageCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
  errorCode?: string;
  warning?: string;
  hasCover: boolean;
  retryable: boolean;
  restId?: string;
  draftUrl?: string;
  progress?: { done: number; total: number };
}

export type ReviewResponse =
  | { ok: true; job?: ReviewJobView; settings?: CompanionSettings; result?: { reviewOpened: boolean; jobId: string } }
  | { ok: false; error: { code: string; message: string } };

export interface StoredBundleRecord {
  jobId: string;
  bundle: DraftBundle;
}
