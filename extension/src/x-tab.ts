import { BridgeError } from '../../src/bridge.js';

export const X_ARTICLES_URL = 'https://x.com/compose/articles';
const LOAD_TIMEOUT_MS = 30_000;

function isArticlesUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://x.com' &&
      (url.pathname === '/compose/articles' || url.pathname.startsWith('/compose/articles/'));
  } catch {
    return false;
  }
}

/** Best effort: a closed tab or window must not change a known draft result. */
export async function focusXTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // The user may have closed the tab while the request was finishing.
  }
}

/** Called only after the user confirms creation in the extension review. */
export async function getOrOpenXArticlesTab(): Promise<number> {
  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter((tab) => tab.id !== undefined && isArticlesUrl(tab.pendingUrl ?? tab.url));
  const existing = candidates.find((tab) => tab.active) ?? candidates[0];
  // Keep the review visible while X loads and the draft is created.
  const tab = existing ?? await chrome.tabs.create({ url: X_ARTICLES_URL, active: false });
  if (tab.id === undefined) throw new BridgeError('X_TAB_UNAVAILABLE', 'X Articles could not be opened. Try again.');
  const tabId = tab.id;

  try {
    // A discarded tab does not load until it is activated.
    if (tab.discarded) await focusXTab(tabId);
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      let current: chrome.tabs.Tab;
      try {
        current = await chrome.tabs.get(tabId);
      } catch {
        throw new BridgeError('X_TAB_CLOSED', 'The X tab was closed before it was ready. Try again to reopen it.');
      }
      if (current.status === 'complete' && !current.pendingUrl) {
        if (!isArticlesUrl(current.url)) {
          throw new BridgeError(
            'X_ARTICLES_UNAVAILABLE',
            'X Articles is not ready. Sign in and check that your account has Articles access in the X tab, then return here and try again.',
          );
        }
        return tabId;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new BridgeError('X_TAB_TIMEOUT', 'X Articles is taking too long to load. Check the X tab, then try again.');
  } catch (error) {
    await focusXTab(tabId);
    throw error;
  }
}
