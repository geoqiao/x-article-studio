/// <reference types="chrome" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOrOpenXArticlesTab, X_ARTICLES_URL } from '../extension/src/x-tab';

const api = {
  tabs: { query: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn() },
  windows: { update: vi.fn() },
};
const ready = { id: 7, windowId: 2, url: X_ARTICLES_URL, status: 'complete', active: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal('chrome', api);
  api.tabs.query.mockResolvedValue([]);
  api.tabs.create.mockResolvedValue({ ...ready, status: 'loading' });
  api.tabs.get.mockResolvedValue(ready);
  api.tabs.update.mockResolvedValue(ready);
  api.windows.update.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('opening X Articles for a confirmed draft', () => {
  it('opens a background tab and waits for navigation to complete', async () => {
    api.tabs.get.mockResolvedValueOnce({ ...ready, url: 'about:blank', pendingUrl: X_ARTICLES_URL, status: 'loading' });
    let resolved = false;
    const result = getOrOpenXArticlesTab().then((id) => { resolved = true; return id; });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: X_ARTICLES_URL, active: false });
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toBe(7);
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it('reuses the active Articles tab without reloading an existing draft', async () => {
    api.tabs.query.mockResolvedValue([ready, { ...ready, id: 9, active: true, url: `${X_ARTICLES_URL}/edit/123` }]);
    api.tabs.get.mockResolvedValue({ ...ready, id: 9, url: `${X_ARTICLES_URL}/edit/123` });
    expect(await getOrOpenXArticlesTab()).toBe(9);
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it('reuses a tab already navigating to Articles', async () => {
    api.tabs.query.mockResolvedValue([{ ...ready, url: 'about:blank', pendingUrl: X_ARTICLES_URL }]);
    expect(await getOrOpenXArticlesTab()).toBe(7);
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('ignores other X pages, lookalike paths and other origins', async () => {
    api.tabs.query.mockResolvedValue([
      { ...ready, url: 'https://x.com/home' },
      { ...ready, url: `${X_ARTICLES_URL}-other` },
      { ...ready, url: 'https://x.com.example.com/compose/articles' },
      { ...ready, url: 'http://x.com/compose/articles' },
    ]);
    expect(await getOrOpenXArticlesTab()).toBe(7);
    expect(api.tabs.create).toHaveBeenCalledOnce();
  });

  it('activates a discarded tab so it can load', async () => {
    api.tabs.query.mockResolvedValue([{ ...ready, discarded: true }]);
    expect(await getOrOpenXArticlesTab()).toBe(7);
    expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('focuses a login redirect and stops before the runner can start', async () => {
    api.tabs.get.mockResolvedValue({ ...ready, url: 'https://x.com/i/flow/login' });
    await expect(getOrOpenXArticlesTab()).rejects.toMatchObject({ code: 'X_ARTICLES_UNAVAILABLE' });
    expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true });
  });

  it('returns a retryable explanation when the user closes the loading tab', async () => {
    api.tabs.get.mockRejectedValue(new Error('No tab with id: 7'));
    api.tabs.update.mockRejectedValue(new Error('No tab with id: 7'));
    await expect(getOrOpenXArticlesTab()).rejects.toMatchObject({ code: 'X_TAB_CLOSED' });
  });

  it('bounds loading time and leaves the tab available for recovery', async () => {
    api.tabs.get.mockResolvedValue({ ...ready, status: 'loading' });
    const result = expect(getOrOpenXArticlesTab()).rejects.toMatchObject({ code: 'X_TAB_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(api.tabs.create).toHaveBeenCalledOnce();
    expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
  });
});
