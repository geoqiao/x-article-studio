import type { CompanionSettings, ExtensionRequest, ReviewJobView, ReviewResponse } from './protocol.js';
import type { DraftBundle } from '../../src/types.js';
import { getJob } from './storage.js';
import { X_ARTICLES_URL } from './x-tab.js';

type ReviewRequest = Exclude<ExtensionRequest, { type: 'article-studio-page-request' }>;

const root = document.getElementById('app');
const jobId = new URL(location.href).searchParams.get('jobId')?.trim() ?? '';
let current: ReviewJobView | null = null;
let previewBundle: DraftBundle | undefined;
let previewLoaded = false;
let notice = '';
let actionInFlight = false;
let settings: CompanionSettings = { autoCreate: false };

function request(message: ReviewRequest): Promise<ReviewResponse> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: ReviewResponse | undefined) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response) {
          reject(new Error('The extension returned no response.'));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function statusLabel(status: ReviewJobView['status']): string {
  switch (status) {
    case 'pending':
      return 'Ready for review';
    case 'creating':
      return 'Opening X Articles';
    case 'uploading':
      return 'Uploading images to X';
    case 'failed':
      return 'Needs attention';
    case 'uncertain':
      return 'Result needs checking';
    case 'completed':
      return 'Draft created';
  }
}

function appendButton(container: HTMLElement, label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const button = element('button', label, primary ? 'primary' : 'secondary');
  button.type = 'button';
  button.disabled = actionInFlight;
  button.addEventListener('click', onClick);
  container.append(button);
  return button;
}

/**
 * The switch that replaces the review click. It lives on this extension page, so
 * the website and automation driving the website cannot turn it on.
 */
function settingsSection(): HTMLElement {
  const section = element('section', undefined, 'settings');
  const label = element('label', undefined, 'setting');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.checked = settings.autoCreate;
  checkbox.addEventListener('change', () => void saveAutoCreate(checkbox.checked));
  label.append(checkbox, element('span', 'Create drafts without this review'));
  section.append(
    label,
    element(
      'p',
      'When on, Create X draft on the Article Studio website uploads the images and creates the draft straight away. A failed or uncertain attempt still opens this review. Drafts are never published for you. Change this any time from the extension’s options.',
      'muted',
    ),
  );
  return section;
}

async function saveAutoCreate(autoCreate: boolean): Promise<void> {
  try {
    const response = await request({ type: 'article-studio-settings-set', autoCreate });
    if (response.ok && response.settings) settings = response.settings;
    else if (!response.ok) notice = response.error.message;
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  }
  await refresh();
}

function renderEmpty(message: string, title = 'Article Studio review'): void {
  if (!root) return;
  root.replaceChildren();
  const card = element('section', undefined, 'card');
  card.append(element('p', 'Article Studio', 'eyebrow'), element('h1', title), element('p', message, 'muted'));
  if (notice) card.append(element('p', notice, 'notice'));
  card.append(settingsSection());
  root.append(card);
}

function renderView(view: ReviewJobView, bundle = previewBundle): void {
  if (!root) return;
  root.replaceChildren();

  const card = element('section', undefined, 'card');
  card.append(element('p', 'Article Studio · X companion', 'eyebrow'));
  card.append(element('h1', view.title || 'Untitled article'));
  card.append(element('p', statusLabel(view.status), `status status-${view.status}`));

  const details = element('dl', undefined, 'details');
  for (const [label, value] of [
    ['Images', String(view.imageCount)],
    ['Cover', view.hasCover ? 'Included' : 'None'],
    ['Image data', formatBytes(view.totalBytes)],
    ['Job ID', view.jobId],
  ]) {
    details.append(element('dt', label), element('dd', value));
  }
  card.append(details);

  if (bundle) {
    const preview = element('section', undefined, 'preview');
    preview.append(element('h2', 'Markdown review'));
    const markdown = element('pre', bundle.markdown, 'markdown');
    markdown.tabIndex = 0;
    preview.append(markdown);

    if (bundle.assets.length || bundle.cover) {
      preview.append(element('h2', 'Asset review'));
      const grid = element('div', undefined, 'asset-grid');
      for (const asset of bundle.cover ? [bundle.cover, ...bundle.assets] : bundle.assets) {
        const figure = element('figure', undefined, 'asset');
        const image = element('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = asset.fileName;
        // The bytes are already in extension IndexedDB. This data URL never
        // causes a network request for the opaque studio-asset:// source.
        image.src = `data:${asset.mime};base64,${asset.base64}`;
        figure.append(image, element('figcaption', asset === bundle.cover ? `Cover · ${asset.fileName}` : `${asset.fileName} · ${asset.source}`));
        grid.append(figure);
      }
      preview.append(grid);
    }
    card.append(preview);
  }

  if (view.status === 'creating' || view.status === 'uploading') {
    const progress = view.progress && view.progress.total > 0 ? ` (${view.progress.done}/${view.progress.total} images)` : '';
    card.append(element('p', view.status === 'creating'
      ? 'X Articles opens automatically. Once it loads, draft creation continues using your X session.'
      : `The extension is working in the X Articles tab${progress}. Keep both tabs open while it finishes.`, 'muted'));
  }

  if (view.error) card.append(element('p', view.error, view.status === 'uncertain' ? 'warning' : 'error'));
  if (view.warning) card.append(element('p', view.warning, 'warning'));
  if (notice) card.append(element('p', notice, 'notice'));

  const actions = element('div', undefined, 'actions');
  if (view.status === 'pending' || (view.status === 'failed' && view.retryable)) {
    card.append(element('p', 'Confirm to upload these images and create an X draft. We will open X Articles for you if needed.', 'muted'));
    appendButton(actions, 'Create X draft', () => void createDraft(), true);
  }
  if (view.status === 'uncertain') {
    appendButton(actions, 'Open X Articles', () => {
      void chrome.tabs.create({ url: X_ARTICLES_URL, active: true });
    });
    appendButton(actions, 'I checked X — allow another attempt', () => void armRetry(), true);
  }
  if (view.status === 'completed' && view.draftUrl) {
    const link = element('a', 'Open the created X draft', 'primary link-button');
    link.href = view.draftUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  if (view.status !== 'creating' && view.status !== 'uploading') {
    appendButton(actions, view.status === 'completed' ? 'Delete stored job' : 'Discard staged article', () => void discardJob());
  }
  card.append(actions, settingsSection());
  root.append(card);
}

async function refresh(): Promise<void> {
  try {
    const response = await request({ type: 'article-studio-settings-get' });
    if (response.ok && response.settings) settings = response.settings;
  } catch {
    // The switch keeps its last known state; the job below still renders.
  }
  if (!jobId) {
    renderEmpty('Create X draft on the Article Studio website opens a review here.', 'Companion settings');
    return;
  }
  try {
    const response = await request({ type: 'article-studio-review-get', jobId });
    if (!response.ok || !response.job) {
      previewBundle = undefined;
      renderEmpty(response.ok ? 'The staged article is no longer available.' : response.error.message, 'Review unavailable');
      return;
    }
    current = response.job;
    if (!previewLoaded) {
      try {
        previewBundle = (await getJob(jobId))?.bundle;
      } catch {
        previewBundle = undefined;
      }
      previewLoaded = true;
    }
    if (current.status === 'completed') previewBundle = undefined;
    renderView(current);
  } catch (error) {
    renderEmpty(error instanceof Error ? error.message : String(error), 'Review unavailable');
  }
}

async function createDraft(): Promise<void> {
  if (!current || actionInFlight || (current.status !== 'pending' && !(current.status === 'failed' && current.retryable))) return;
  actionInFlight = true;
  notice = '';
  current = { ...current, status: 'creating', error: undefined };
  renderView(current);
  try {
    const response = await request({ type: 'article-studio-review-create', jobId });
    if (!response.ok) notice = response.error.message;
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  } finally {
    actionInFlight = false;
    await refresh();
  }
}

async function armRetry(): Promise<void> {
  if (!current || actionInFlight || current.status !== 'uncertain') return;
  actionInFlight = true;
  notice = 'The next attempt is still waiting for a separate Create X draft click.';
  try {
    const response = await request({ type: 'article-studio-review-arm-retry', jobId });
    if (!response.ok) notice = response.error.message;
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
  } finally {
    actionInFlight = false;
    await refresh();
  }
}

async function discardJob(): Promise<void> {
  if (!current || actionInFlight || current.status === 'creating' || current.status === 'uploading') return;
  actionInFlight = true;
  try {
    const response = await request({ type: 'article-studio-review-discard', jobId });
    if (response.ok) {
      current = null;
      previewBundle = undefined;
      renderEmpty('The staged article and its local content have been deleted.', 'Job deleted');
    } else {
      notice = response.error.message;
      await refresh();
    }
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
    await refresh();
  } finally {
    actionInFlight = false;
  }
}

void refresh();
window.setInterval(() => {
  if (current?.status === 'creating' || current?.status === 'uploading') void refresh();
}, 1_000);
