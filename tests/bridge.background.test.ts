/// <reference types="chrome" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL, BRIDGE_PROTOCOL_VERSION } from '../src/bridge';
import { claimJobState, type JobRecord } from '../extension/src/state';
import * as storage from '../extension/src/storage';
import { X_ARTICLES_URL } from '../extension/src/x-tab';

vi.mock('../extension/src/storage', () => ({
  claimJob: vi.fn(),
  deleteJob: vi.fn(),
  getJob: vi.fn(),
  getSettings: vi.fn(),
  putJob: vi.fn(),
  putSettings: vi.fn(),
  updateJob: vi.fn(),
}));

const extensionUrl = 'chrome-extension://companion/';
const appUrl = 'http://localhost:4318/';
const bundle = {
  schemaVersion: 1,
  jobId: 'window-job',
  title: 'An article',
  markdown: 'Hello!',
  assets: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const reviewUrl = `${extensionUrl}review.html?jobId=${bundle.jobId}`;
const readyXTab: chrome.tabs.Tab = {
  id: 7,
  windowId: 3,
  url: X_ARTICLES_URL,
  status: 'complete',
  index: 0,
  active: false,
  highlighted: false,
  selected: false,
  pinned: false,
  frozen: false,
  incognito: false,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
};
const api = {
  action: { onClicked: { addListener: vi.fn() } },
  runtime: {
    id: 'companion',
    getURL: (path: string) => `${extensionUrl}${path}`,
    ContextType: { TAB: 'TAB' },
    getContexts: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
  scripting: { executeScript: vi.fn() },
  tabs: { create: vi.fn(), get: vi.fn(), query: vi.fn(), update: vi.fn() },
  windows: { update: vi.fn() },
};

let job: JobRecord | null;
let onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0];

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  vi.stubGlobal('chrome', api);
  job = null;
  api.runtime.getContexts.mockResolvedValue([]);
  api.tabs.query.mockResolvedValue([]);
  api.tabs.create.mockResolvedValue(readyXTab);
  api.tabs.get.mockResolvedValue(readyXTab);
  api.scripting.executeScript.mockResolvedValue([{ result: { ok: true, restId: '123' } }]);
  vi.mocked(storage.getJob).mockImplementation(async () => job);
  vi.mocked(storage.getSettings).mockResolvedValue({ autoCreate: false });
  vi.mocked(storage.putJob).mockImplementation(async (record) => { job = record; });
  vi.mocked(storage.claimJob).mockImplementation(async (_jobId, attemptId) => {
    if (!job) return { kind: 'missing' };
    const decision = claimJobState(job, attemptId);
    if (decision.kind === 'claimed') job = decision.job;
    return decision;
  });
  vi.mocked(storage.updateJob).mockImplementation(async (_jobId, update) => {
    job = job && update(job);
    return job;
  });
  await import('../extension/src/background');
  onMessage = api.runtime.onMessage.addListener.mock.calls[0][0];
});

afterEach(() => vi.unstubAllGlobals());

function send(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  return new Promise((resolve) => {
    expect(onMessage(message, sender, resolve)).toBe(true);
  });
}

function stage(windowId?: number) {
  return send({
    type: 'article-studio-page-request',
    request: {
      source: BRIDGE_PROTOCOL,
      version: BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      requestId: 'stage-request',
      action: 'stage',
      bundle,
    },
  }, {
    frameId: 0,
    url: appUrl,
    tab: windowId === undefined ? undefined : { ...readyXTab, windowId },
  });
}

function confirm(windowId?: number) {
  return send({ type: 'article-studio-review-create', jobId: bundle.jobId }, {
    id: api.runtime.id,
    url: reviewUrl,
    tab: windowId === undefined ? undefined : { ...readyXTab, windowId },
  });
}

describe('companion tab routing from runtime messages', () => {
  it('stages the source window and opens review there even when another window already has a review', async () => {
    api.runtime.getContexts.mockResolvedValue([{ tabId: 12, windowId: 1 }]);

    await expect(stage(3)).resolves.toMatchObject({ ok: true, data: { reviewOpened: true } });
    expect(job).toMatchObject({ sourceWindowId: 3 });
    expect(api.tabs.update).not.toHaveBeenCalled();
    expect(api.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: reviewUrl, active: true, windowId: 3 });
  });

  it('reactivates an existing review in the same window', async () => {
    api.runtime.getContexts.mockResolvedValue([{ tabId: 12, windowId: 1 }, { tabId: 13, windowId: 3 }]);

    await expect(stage(3)).resolves.toMatchObject({ ok: true, data: { reviewOpened: true } });
    expect(api.tabs.update).toHaveBeenCalledExactlyOnceWith(13, { active: true });
    expect(api.windows.update).toHaveBeenCalledExactlyOnceWith(3, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('opens the review without a window ID if its source window closed', async () => {
    api.tabs.create.mockRejectedValueOnce(new Error('No window with id: 3'));

    await expect(stage(3)).resolves.toMatchObject({ ok: true, data: { reviewOpened: true } });
    expect(api.tabs.create.mock.calls).toEqual([
      [{ url: reviewUrl, active: true, windowId: 3 }],
      [{ url: reviewUrl, active: true }],
    ]);
  });

  it('follows the confirming review tab if it is now in a different window', async () => {
    await stage(3);

    await expect(confirm(4)).resolves.toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(api.tabs.create).toHaveBeenLastCalledWith({ url: X_ARTICLES_URL, active: false, windowId: 4 });
  });

  it('uses the stored source when a confirmation has no sender tab', async () => {
    await stage(3);

    await expect(confirm()).resolves.toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(api.tabs.create).toHaveBeenLastCalledWith({ url: X_ARTICLES_URL, active: false, windowId: 3 });
  });

  it('still completes the draft after the stored window closes', async () => {
    await stage(3);
    api.tabs.create.mockRejectedValueOnce(new Error('No window with id: 3'));

    await expect(confirm()).resolves.toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(api.tabs.create.mock.calls.slice(1)).toEqual([
      [{ url: X_ARTICLES_URL, active: false, windowId: 3 }],
      [{ url: X_ARTICLES_URL, active: false }],
    ]);
  });

  it('lets requests without a sender tab or a stored window use Chrome defaults', async () => {
    await expect(stage()).resolves.toMatchObject({ ok: true, data: { reviewOpened: true } });
    await expect(confirm()).resolves.toMatchObject({ ok: true, job: { status: 'completed' } });
    expect(api.tabs.create.mock.calls).toEqual([
      [{ url: reviewUrl, active: true }],
      [{ url: X_ARTICLES_URL, active: false }],
    ]);
  });

  it('opens X Articles in the staging window for automatic creation', async () => {
    vi.mocked(storage.getSettings).mockResolvedValue({ autoCreate: true });

    await expect(stage(3)).resolves.toMatchObject({ ok: true, data: { reviewOpened: false, autoCreate: true } });
    await vi.waitFor(() => expect(job).toMatchObject({ status: 'completed' }));
    expect(api.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: X_ARTICLES_URL, active: false, windowId: 3 });
  });

  it('opens the review in the staging window if automatic creation needs attention', async () => {
    vi.mocked(storage.getSettings).mockResolvedValue({ autoCreate: true });
    api.scripting.executeScript.mockResolvedValue([{ result: {
      ok: false, phase: 'preflight', code: 'AUTH_REQUIRED', message: 'Sign in',
    } }]);

    await expect(stage(3)).resolves.toMatchObject({ ok: true, data: { reviewOpened: false, autoCreate: true } });
    await vi.waitFor(() => expect(api.tabs.create.mock.calls).toEqual([
      [{ url: X_ARTICLES_URL, active: false, windowId: 3 }],
      [{ url: reviewUrl, active: true, windowId: 3 }],
    ]));
  });
});
