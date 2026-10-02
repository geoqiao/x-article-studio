import {
  BRIDGE_PROTOCOL,
  BRIDGE_PROTOCOL_VERSION,
  COMPANION_CAPABILITIES,
  DEFAULT_ARTICLE_STUDIO_ORIGINS,
  DraftBundleValidationError,
  BridgeError,
  isBridgeAction,
  validateDraftBundle,
  verifyDraftBundleHashes,
  type BridgeJob,
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
import { claimJob, deleteJob, getJob, getSettings, putJob, putSettings, updateJob } from './storage.js';
import { focusXTab, getOrOpenXArticlesTab } from './x-tab.js';

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
    isBridgeAction(value.action)
  );
}

function isPageRequestEnvelope(value: unknown): value is PageRequestEnvelope {
  return isRecord(value) && value.type === 'article-studio-page-request' && isBridgeRequest(value.request);
}

function isReviewRequest(value: unknown): value is Exclude<ExtensionRequest, PageRequestEnvelope> {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'article-studio-settings-get') return true;
  if (value.type === 'article-studio-settings-set') return typeof value.autoCreate === 'boolean';
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
    errorCode: job.errorCode,
    warning: job.warning,
    hasCover: Boolean(job.hasCover),
    retryable: job.retryable,
    restId: job.restId,
    draftUrl: job.draftUrl,
    progress: job.progress,
  };
}

async function openReview(jobId: string): Promise<void> {
  const reviewUrl = `${chrome.runtime.getURL('review.html')}?jobId=${encodeURIComponent(jobId)}`;
  // Without the broad tabs permission, tabs.query hides even our own review URLs.
  // Extension contexts expose our pages without access to unrelated browsing data.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.TAB],
    documentUrls: [reviewUrl],
  });
  const existing = contexts.find((context) => context.tabId >= 0);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
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
    (value.phase === 'preflight' || value.phase === 'assets' || value.phase === 'rejected' || value.phase === 'create') &&
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
    const tabId = await getOrOpenXArticlesTab();
    await injectRunner(tabId);
    await updateAttempt(job.jobId, attemptId, (current) => markUploading(current, 0));
    invocationStarted = true;
    const result = await invokeRunner(tabId, job.bundle);
    if (result.ok) {
      const draftUrl = `https://x.com/compose/articles/edit/${encodeURIComponent(result.restId)}`;
      await updateAttempt(job.jobId, attemptId, (current) => completeJob(current, result.restId, draftUrl, result.warning));
    } else if (result.phase === 'create') {
      await updateAttempt(job.jobId, attemptId, (current) => markUncertain(current, result.message));
    } else {
      // Asset and preflight failures happen before ArticleEntityDraftCreate, and a
      // rejection is X's definite refusal of it. No draft exists, so a retry is safe.
      await updateAttempt(job.jobId, attemptId, (current) => failJob(current, result.message, true, result.code));
      if (result.code === 'AUTH_REQUIRED') await focusXTab(tabId);
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

/** The page learns the outcome of a job it staged; the staged content stays in the extension. */
function toBridgeJob(job: ReviewJobView): BridgeJob {
  return {
    jobId: job.jobId,
    status: job.status,
    error: job.error,
    errorCode: job.errorCode,
    warning: job.warning,
    retryable: job.retryable,
    draftUrl: job.draftUrl,
    progress: job.progress,
  };
}

/**
 * Automatic creation, enabled by the user in the companion settings, replaces
 * the review click. Anything short of a created draft opens the review so the
 * user sees the reason and decides what happens next.
 */
async function createWithoutReview(jobId: string): Promise<void> {
  let created = false;
  try {
    const response = await createJob(jobId);
    created = response.ok && response.job?.status === 'completed';
  } finally {
    if (!created) await openReview(jobId).catch(() => undefined);
  }
}

async function handlePageRequest(request: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  if (request.action === 'status') {
    const settings = await getSettings();
    return bridgeResponse(request, { available: true, version: extensionVersion, capabilities: [...COMPANION_CAPABILITIES], autoCreate: settings.autoCreate });
  }
  if (request.action === 'job') {
    if (typeof request.jobId !== 'string' || !request.jobId) throw new BridgeError('MISSING_JOB_ID', 'The job request did not include a job ID.');
    const job = await readReviewJob(request.jobId);
    return bridgeResponse(request, job ? toBridgeJob(job) : { jobId: request.jobId, status: 'missing' });
  }
  if (!request.bundle) throw new BridgeError('MISSING_BUNDLE', 'The stage request did not include a draft bundle.');
  const bundle = validateDraftBundle(request.bundle);
  await verifyDraftBundleHashes(bundle);
  const job = await stageBundle(bundle);
  const { autoCreate } = await getSettings();
  // A job that is running or already has its draft only needs its state read back.
  const startable = job.status === 'pending' || (job.status === 'failed' && job.retryable);
  if (autoCreate && (startable || job.status === 'creating' || job.status === 'uploading' || job.status === 'completed')) {
    if (startable) void createWithoutReview(bundle.jobId);
    return bridgeResponse(request, { reviewOpened: false, jobId: bundle.jobId, autoCreate: true });
  }
  await openReview(bundle.jobId);
  return bridgeResponse(request, { reviewOpened: true, jobId: bundle.jobId });
}

async function handleReviewRequest(request: Exclude<ExtensionRequest, PageRequestEnvelope>): Promise<ReviewResponse> {
  if (request.type === 'article-studio-settings-get') return { ok: true, settings: await getSettings() };
  if (request.type === 'article-studio-settings-set') {
    await putSettings({ autoCreate: request.autoCreate });
    return { ok: true, settings: await getSettings() };
  }
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
