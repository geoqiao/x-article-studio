export type Settings = { /** Flag Obsidian [[wikilinks]] that would reach X as literal text. */ warnWikilinks: boolean };

const KEY = 'article-studio:settings';
const DEFAULTS: Settings = { warnWikilinks: true };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...(typeof stored === 'object' && stored ? stored : {}) };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: settings last for this page only */ }
}
