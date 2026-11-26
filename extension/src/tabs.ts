/** Prefer the originating window, which may close before the tab is created. */
export async function createTabInWindow(
  properties: Omit<chrome.tabs.CreateProperties, 'windowId'>,
  windowId?: number,
): Promise<chrome.tabs.Tab> {
  if (windowId !== undefined && windowId >= 0) {
    try {
      return await chrome.tabs.create({ ...properties, windowId });
    } catch {
      // Let Chrome choose a window if the preferred window is unavailable.
    }
  }
  return await chrome.tabs.create(properties);
}
