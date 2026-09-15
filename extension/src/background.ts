import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_ARTICLE_STUDIO_ORIGINS,
  DraftBundleValidationError,
  BridgeError,
  validateDraftBundle,
  verifyDraftBundleHashes,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
} from '../../src/bridge.js';
import type { DraftBundle } from '../../src/types.js';
import {
  RUNNER_GLOBAL,
  type ExtensionRequest,
  type ReviewJobView,
  type ReviewResponse,
  type RunnerResult,
} from './protocol.js';
import {
  armUncertainRetry,
  bundleFingerprint,
  claimJobState,
  completeJob,
  failJob,
  makeJobRecord,
  markUncertain,
  markUploading,
  recoverInterruptedJob,
  type JobRecord,
} from './state.js';
import { claimJob, deleteJob, getJob, putJob, updateJob } from './storage.js';

declare const __ARTICLE_STUDIO_ORIGINS__: readonly string[];
declare const __ARTICLE_STUDIO_EXTENSION_VERSION__: string;

const appOrigins: readonly string[] =
  typeof __ARTICLE_STUDIO_ORIGINS__ === 'undefined' ? DEFAULT_ARTICLE_STUDIO_ORIGINS : __ARTICLE_STUDIO_ORIGINS__;
const extensionVersion =
  typeof __ARTICLE_STUDIO_EXTENSION_VERSION__ === 'undefined' ? 'dev' : __ARTICLE_STUDIO_EXTENSION_VERSION__;
const activeAttempts = new Map<string, string>();

type PageRequestEnvelope = { type: 'article-studio-page-request'; request: BridgeRequestMessage };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBridgeRequest(value: unknown): value is BridgeRequestMessage {
  if (!isRecord(value)) return false;
  return (
    value.source === BRIDGE_PROTOCOL &&
    value.version === BRIDGE_PROTOCOL_VERSION &&
    value.type === 'request' &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    (value.action === 'status' || value.action === 'stage')
  );
}

function isPageRequestEnvelope(value: unknown): value is PageRequestEnvelope {
  return isRecord(value) && value.type === 'article-studio-page-request' && isBridgeRequest(value.request);
}

function isReviewRequest(value: unknown): value is Exclude<ExtensionRequest, PageRequestEnvelope> {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  return (
    (value.type === 'article-studio-review-get' ||
      value.type === 'article-studio-review-create' ||
      value.type === 'article-studio-review-arm-retry' ||
      value.type === 'article-studio-review-discard') &&
    typeof value.jobId === 'string'
  );
}

function isAppSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.frameId !== 0 || !sender.url) return false;
  try {
    return appOrigins.includes(new URL(sender.url).origin);
  } catch {
    return false;
  }
}

function isOwnExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('')));
}

function wireError(error: unknown, fallbackCode = 'EXTENSION_ERROR'): { code: string; message: string } {
  if (error instanceof DraftBundleValidationError) return { code: error.code, message: error.message };
  if (error instanceof BridgeError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { code: fallbackCode, message: message.length > 800 ? `${message.slice(0, 797)}…` : message };
}

function bridgeResponse(request: BridgeRequestMessage, data: BridgeResponseMessage['data']): BridgeResponseMessage {
  return {
    source: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'response',
    requestId: request.requestId,
    action: request.action,
    ok: true,
    data,
  };
}

function bridgeErrorResponse(request: BridgeRequestMessage, error: unknown): BridgeResponseMessage {
  const details = wireError(error);
  return {
    source: BRIDGE_PROTOCOL,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'response',
    requestId: request.requestId,
    action: request.action,
    ok: false,
    error: details,
  };
}

function reviewError(error: unknown, fallbackCode = 'REVIEW_ERROR'): ReviewResponse {
  return { ok: false, error: wireError(error, fallbackCode) };
}

function toReviewView(job: JobRecord): ReviewJobView {
  return {
    jobId: job.jobId,
    title: job.title,
    status: job.status,
    imageCount: job.imageCount,
    totalBytes: job.totalBytes,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    retryable: job.retryable,
    restId: job.restId,
    draftUrl: job.draftUrl,
    progress: job.progress,
  };
}

async function openReview(jobId: string): Promise<void> {
  const reviewUrl = `${chrome.runtime.getURL('review.html')}?jobId=${encodeURIComponent(jobId)}`;
  const openTabs = await chrome.tabs.query({});
  const existing = openTabs.find((tab) => tab.url === reviewUrl);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: reviewUrl, active: true });
}

async function stageBundle(bundle: DraftBundle): Promise<JobRecord> {
  let job = await getJob(bundle.jobId);
  if (job) {
    if (job.fingerprint !== bundleFingerprint(bundle)) {
      throw new BridgeError('JOB_ID_CONFLICT', 'This job ID is already associated with different article content.');
    }
    if ((job.status === 'creating' || job.status === 'uploading') && !activeAttempts.has(job.jobId)) {
      job = recoverInterruptedJob(job);
      await putJob(job);
    }
    return job;
  }
  job = makeJobRecord(bundle);
  await putJob(job);
  return job;
}

async function readReviewJob(jobId: string): Promise<ReviewJobView | null> {
  let job = await getJob(jobId);
  if (!job) return null;
  if ((job.status === 'creating' || job.status === 'uploading') && !activeAttempts.has(job.jobId)) {
    job = recoverInterruptedJob(job);
    await putJob(job);
  }
  return toReviewView(job);
}

async function findXArticlesTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => {
    if (tab.id === undefined || !tab.url) return false;
    try {
      const url = new URL(tab.url);
      return url.protocol === 'https:' && url.hostname === 'x.com' && url.pathname.startsWith('/compose/articles');
    } catch {
      return false;
    }
  });
  return candidates.find((tab) => tab.active) ?? candidates[0] ?? null;
}

async function injectRunner(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['x-runner.js'],
    world: 'MAIN',
  });
}

async function invokeRunner(tabId: number, bundle: DraftBundle): Promise<RunnerResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (globalName: string, input: unknown) => {
      const candidate = (globalThis as Record<string, unknown>)[globalName];
      if (typeof candidate !== 'function') throw new Error('The X page runner was not installed.');
      return (candidate as (value: unknown) => unknown)(input);
    },
    args: [RUNNER_GLOBAL, bundle],
  });
  const value = (results as Array<{ result?: unknown }>)[0]?.result;
  if (!isRunnerResult(value)) throw new Error('The X page runner returned an invalid result.');
  return value;
}

function isRunnerResult(value: unknown): value is RunnerResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return typeof value.restId === 'string' && value.restId.length > 0;
  return (
    (value.phase === 'preflight' || value.phase === 'assets' || value.phase === 'create') &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

async function updateAttempt(jobId: string, attemptId: string, updater: (job: JobRecord) => JobRecord): Promise<JobRecord | null> {
  return await updateJob(jobId, (job) => (job.attemptId === attemptId ? updater(job) : job));
}

async function runAttempt(job: JobRecord, attemptId: string): Promise<void> {
  if (!job.bundle) {
    await updateAttempt(job.jobId, attemptId, (current) => failJob(current, 'The pending bundle is missing from extension storage.', false));
    return;
  }

  let invocationStarted = false;
  try {
    const tab = await findXArticlesTab();
    if (!tab?.id) {
      await updateAttempt(
        job.jobId,
        attemptId,
        (current) => failJob(current, 'Open a signed-in https://x.com/compose/articles tab, then try again.', true),
      );
      return;
    }

    await injectRunner(tab.id);
    await updateAttempt(job.jobId, attemptId, (current) => markUploading(current, 0));
    invocationStarted = true;
    const result = await invokeRunner(tab.id, job.bundle);
    if (result.ok) {
      const draftUrl = `https://x.com/compose/articles/edit/${encodeURIComponent(result.restId)}`;
      await updateAttempt(job.jobId, attemptId, (current) => completeJob(current, result.restId, draftUrl));
    } else if (result.phase === 'create') {
      await updateAttempt(job.jobId, attemptId, (current) => markUncertain(current, result.message));
    } else {
      // Asset and preflight failures happen before ArticleEntityDraftCreate and can be retried explicitly.
      await updateAttempt(job.jobId, attemptId, (current) => failJob(current, result.message, true));
    }
  } catch (error) {
    const details = wireError(error, 'X_RUNNER_FAILED');
    await updateAttempt(
      job.jobId,
      attemptId,
      (current) =>
        invocationStarted
          ? markUncertain(current, 'The X page stopped responding after the draft attempt began. Open X Articles and verify before trying again.')
          : failJob(current, details.message, true),
    );
  }
}

async function createJob(jobId: string): Promise<ReviewResponse> {
  const attemptId = `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const decision = await claimJob(jobId, attemptId);
  if (decision.kind === 'missing') return reviewError(new BridgeError('JOB_NOT_FOUND', 'This staged article is no longer available.'), 'JOB_NOT_FOUND');
  if (decision.kind === 'busy') return { ok: true, job: toReviewView(decision.job) };
  if (decision.kind === 'completed') return { ok: true, job: toReviewView(decision.job) };
  if (decision.kind === 'review-required') {
    return reviewError(
      new BridgeError('REVIEW_REQUIRED', 'Check X Articles for the previous result before allowing another attempt.'),
      'REVIEW_REQUIRED',
    );
  }

  activeAttempts.set(jobId, attemptId);
  try {
    await runAttempt(decision.job, attemptId);
  } finally {
    activeAttempts.delete(jobId);
  }
  const view = await readReviewJob(jobId);
  return view ? { ok: true, job: view } : reviewError(new BridgeError('JOB_NOT_FOUND', 'The staged article disappeared during processing.'), 'JOB_NOT_FOUND');
}

async function handlePageRequest(request: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  if (request.action === 'status') {
    return bridgeResponse(request, { available: true, version: extensionVersion });
  }
  if (!request.bundle) throw new BridgeError('MISSING_BUNDLE', 'The stage request did not include a draft bundle.');
  const bundle = validateDraftBundle(request.bundle);
  await verifyDraftBundleHashes(bundle);
  await stageBundle(bundle);
  await openReview(bundle.jobId);
  return bridgeResponse(request, { reviewOpened: true, jobId: bundle.jobId });
}

async function handleReviewRequest(request: Exclude<ExtensionRequest, PageRequestEnvelope>): Promise<ReviewResponse> {
  if (request.type === 'article-studio-review-get') {
    const job = await readReviewJob(request.jobId);
    return job ? { ok: true, job } : reviewError(new BridgeError('JOB_NOT_FOUND', 'This staged article is no longer available.'), 'JOB_NOT_FOUND');
  }

  const job = await getJob(request.jobId);
  if (!job) return reviewError(new BridgeError('JOB_NOT_FOUND', 'This staged article is no longer available.'), 'JOB_NOT_FOUND');

  if (request.type === 'article-studio-review-create') return await createJob(request.jobId);

  if (request.type === 'article-studio-review-arm-retry') {
    if (activeAttempts.has(request.jobId)) return reviewError(new BridgeError('JOB_BUSY', 'The current attempt is still running.'), 'JOB_BUSY');
    if (job.status !== 'uncertain') return reviewError(new BridgeError('REVIEW_NOT_REQUIRED', 'This article does not need an uncertain-result review.'), 'REVIEW_NOT_REQUIRED');
    const armed = armUncertainRetry(job);
    await putJob(armed);
    return { ok: true, job: toReviewView(armed) };
  }

  if (activeAttempts.has(request.jobId) || job.status === 'creating' || job.status === 'uploading') {
    return reviewError(new BridgeError('JOB_BUSY', 'Wait for the current attempt to finish before deleting it.'), 'JOB_BUSY');
  }
  await deleteJob(request.jobId);
  return { ok: true };
}

chrome.action.onClicked.addListener(() => {
  const origin = appOrigins.find((candidate) => candidate.startsWith('https://')) ?? appOrigins[0];
  void chrome.tabs.create({ url: `${origin}/` });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isPageRequestEnvelope(message)) {
    if (!isAppSender(sender)) return false;
    void handlePageRequest(message.request)
      .then(sendResponse)
      .catch((error) => sendResponse(bridgeErrorResponse(message.request, error)));
    return true;
  }

  if (isReviewRequest(message)) {
    if (!isOwnExtensionSender(sender)) return false;
    void handleReviewRequest(message)
      .then(sendResponse)
      .catch((error) => sendResponse(reviewError(error)))
      .catch(() => undefined);
    return true;
  }
  return false;
});
