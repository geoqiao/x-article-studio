import {
  ARTICLE_DRAFT_CREATE_QUERY_ID,
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
  XArticleClient,
  collectImageSources,
  markdownToContentState,
} from '@kaitox/x-article';
import {
  decodeBase64,
  validateDraftBundle,
  verifyDraftBundleHashes,
} from '../../src/bridge.js';
import type { DraftBundle } from '../../src/types.js';
import type { RunnerFailurePhase, RunnerResult } from './protocol.js';

interface QueryIds {
  queryId: string;
  coverQueryId: string;
}

class RunnerFailure extends Error {
  constructor(
    readonly phase: RunnerFailurePhase,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunnerFailure';
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 800 ? `${message.slice(0, 797)}…` : message;
}

export interface ObservedResponse {
  status: number;
  body: string;
}

/**
 * Kaitox reports a failed request as text only. Recording the response lets the
 * runner tell a definite refusal from an unknown outcome.
 */
function observingFetch(observe: (response: ObservedResponse | undefined) => void) {
  return async (url: string, init?: RequestInit) => {
    observe(undefined);
    const response = await window.fetch(url, init);
    const text = async () => {
      const body = await response.text();
      observe({ status: response.status, body });
      return body;
    };
    return { ok: response.ok, status: response.status, text, json: async () => JSON.parse(await text()) };
  };
}

/** The first error X put in a JSON body, without echoing an HTML error page. */
function xErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: unknown }> };
    const message = parsed.errors?.[0]?.message;
    if (typeof message !== 'string' || !message) return '';
    return message.length > 200 ? `${message.slice(0, 197)}…` : message;
  } catch {
    return '';
  }
}

function isFirewallBlock(response: ObservedResponse): boolean {
  if (response.status !== 403 || /^\s*[{[]/.test(response.body)) return false;
  return /cloudflare|you have been blocked|attention required|cf-ray/i.test(response.body);
}

/**
 * Decide what a failed ArticleEntityDraftCreate means. A 4xx answer is a refusal:
 * no draft exists and another attempt is safe. No answer, a timeout, or a 5xx may
 * still have created one, so those keep the check-X-first gate.
 */
export function classifyCreateFailure(response: ObservedResponse | undefined, error: unknown): RunnerFailure {
  const refused = response && response.status >= 400 && response.status < 500 && response.status !== 408;
  if (!refused) {
    const detail = response ? `HTTP ${response.status}` : errorMessage(error);
    return new RunnerFailure(
      'create',
      'DRAFT_CREATE_OUTCOME_UNKNOWN',
      `X did not provide a definitive draft creation result. Open X Articles and check before trying again. (${detail})`,
    );
  }
  if (isFirewallBlock(response)) {
    return new RunnerFailure(
      'rejected',
      'X_FIREWALL_BLOCKED',
      'X’s firewall blocked this request before it reached X, so no draft was created. This usually happens when the article contains a shell pipe command such as “curl … | sh”. Reword or remove that text in Article Studio, then create the draft again.',
    );
  }
  const detail = xErrorDetail(response.body);
  const suffix = detail ? ` (${detail})` : '';
  if (response.status === 429) {
    return new RunnerFailure('rejected', 'X_RATE_LIMITED', `X is limiting requests from this account (HTTP 429), so no draft was created. Wait a few minutes, then try again.${suffix}`);
  }
  if (response.status === 401 || response.status === 403) {
    return new RunnerFailure(
      'rejected',
      'X_AUTH_REJECTED',
      `X refused the request (HTTP ${response.status}), so no draft was created. Reload the X Articles tab, check that you are signed in and that your account has Articles access, then try again.${suffix}`,
    );
  }
  return new RunnerFailure(
    'rejected',
    'DRAFT_CREATE_REJECTED',
    `X rejected the draft (HTTP ${response.status}), so no draft was created. Reload the X Articles tab and try again; X may have changed its editor.${suffix}`,
  );
}

function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function queryIdFromResource(resourceName: string): { operation: string; queryId: string } | undefined {
  const match = /\/graphql\/([A-Za-z0-9_-]+)\/(ArticleEntityDraftCreate|ArticleEntityUpdateCoverMedia)(?:[./?#]|$)/.exec(resourceName);
  return match ? { queryId: match[1], operation: match[2] } : undefined;
}

/**
 * Match Kaitox's xsession fallback constants, but prefer IDs already observed by
 * the Articles page. X rotates these IDs, and resource timing retains the exact
 * operation URL after the page has used it once.
 */
export function deriveQueryIds(): QueryIds {
  const found: Partial<Record<'ArticleEntityDraftCreate' | 'ArticleEntityUpdateCoverMedia', string>> = {};
  try {
    const entries = performance.getEntriesByType('resource');
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const resource = entries[index] as PerformanceResourceTiming;
      const match = queryIdFromResource(resource.name);
      if (match && !found[match.operation as keyof typeof found]) found[match.operation as keyof typeof found] = match.queryId;
    }
  } catch {
    // The built-in Kaitox values below remain usable if timing data is unavailable.
  }
  return {
    queryId: found.ArticleEntityDraftCreate ?? ARTICLE_DRAFT_CREATE_QUERY_ID,
    coverQueryId: found.ArticleEntityUpdateCoverMedia ?? ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
  };
}

function ensureImageMapping(bundle: DraftBundle): string[] {
  const sources = collectImageSources(bundle.markdown);
  const sourceSet = new Set(sources);
  const bySource = new Map(bundle.assets.map((asset) => [asset.source, asset]));
  const missing = sources.filter((source) => !bySource.has(source));
  const extra = bundle.assets.filter((asset) => !sourceSet.has(asset.source));
  if (missing.length) throw new RunnerFailure('preflight', 'MISSING_ASSET', `No bundled image asset exists for: ${missing.join(', ')}`);
  if (extra.length) throw new RunnerFailure('preflight', 'UNREFERENCED_ASSET', `Bundled image is not referenced by Markdown: ${extra[0].fileName}`);
  return sources;
}

/** Run the private X client in the X page's MAIN world. No cookie value leaves this function. */
export async function runArticleDraft(input: unknown): Promise<RunnerResult> {
  try {
    const bundle = validateDraftBundle(input);
    await verifyDraftBundleHashes(bundle);
    const imageSources = ensureImageMapping(bundle);
    const csrfToken = readCsrfToken();
    if (!csrfToken) throw new RunnerFailure('preflight', 'AUTH_REQUIRED', 'Sign in to X in the X Articles tab, then return here and choose Create X draft. Your account needs Articles access.');

    const queryIds = deriveQueryIds();
    let lastResponse: ObservedResponse | undefined;
    let client: XArticleClient;
    try {
      client = new XArticleClient(
        { bearerToken: '', csrfToken },
        {
          fetchImpl: observingFetch((response) => { lastResponse = response; }) as any,
          credentialsMode: 'include',
          articleDraftCreateQueryId: queryIds.queryId,
          updateCoverMediaQueryId: queryIds.coverQueryId,
        },
      );
    } catch (error) {
      throw new RunnerFailure('preflight', 'CLIENT_SETUP_FAILED', errorMessage(error));
    }

    const assetsBySource = new Map(bundle.assets.map((asset) => [asset.source, asset]));
    const mediaMap: Record<string, string> = {};
    for (const source of imageSources) {
      const asset = assetsBySource.get(source);
      if (!asset) throw new RunnerFailure('preflight', 'MISSING_ASSET', `No bundled image asset exists for: ${source}`);
      try {
        const mediaId = await client.uploadMedia(decodeBase64(asset.base64), asset.mime, 'tweet_image');
        if (!mediaId) throw new Error('X returned no media id.');
        mediaMap[source] = mediaId;
      } catch (error) {
        throw new RunnerFailure('assets', 'ASSET_UPLOAD_FAILED', `Image ${asset.fileName} could not be uploaded: ${errorMessage(error)}`);
      }
    }

    // The cover uploads with the body images, so its failure also stops before creation.
    let coverMediaId: string | undefined;
    if (bundle.cover) {
      try {
        coverMediaId = await client.uploadMedia(decodeBase64(bundle.cover.base64), bundle.cover.mime, 'tweet_image');
        if (!coverMediaId) throw new Error('X returned no media id.');
      } catch (error) {
        throw new RunnerFailure('assets', 'ASSET_UPLOAD_FAILED', `The cover image could not be uploaded: ${errorMessage(error)}`);
      }
    }

    let contentState;
    try {
      const converted = markdownToContentState(bundle.markdown, mediaMap);
      if (converted.skippedImages.length) {
        throw new Error(`The converter still could not resolve: ${converted.skippedImages.join(', ')}`);
      }
      contentState = converted.contentState;
    } catch (error) {
      throw new RunnerFailure('preflight', 'CONVERSION_FAILED', `Markdown conversion failed: ${errorMessage(error)}`);
    }

    let created: { restId?: string; raw?: unknown };
    try {
      // This and the cover below are the only draft mutations. There is no publish call here.
      lastResponse = undefined;
      created = await client.createArticleDraft(bundle.title, contentState);
    } catch (error) {
      throw classifyCreateFailure(lastResponse, error);
    }
    if (!created.restId) {
      const detail = xErrorDetail(JSON.stringify(created.raw ?? {}));
      throw new RunnerFailure(
        'create',
        'DRAFT_ID_MISSING',
        `X answered without a draft id${detail ? ` (${detail})` : ''}. Open X Articles and verify the result before trying again.`,
      );
    }
    const restId = String(created.restId);
    if (!coverMediaId) return { ok: true, restId };
    try {
      lastResponse = undefined;
      const cover = await client.updateCoverMedia(restId, coverMediaId);
      const detail = xErrorDetail(JSON.stringify(cover.raw ?? {}));
      if (detail) throw new Error(detail);
      return { ok: true, restId };
    } catch (error) {
      // The draft exists, so a cover problem is reported without failing the job.
      const observed = lastResponse as ObservedResponse | undefined;
      const reason = observed && observed.status >= 400 ? `HTTP ${observed.status}` : errorMessage(error).split('\n')[0];
      return { ok: true, restId, warning: `The draft was created, but X did not accept the cover. Set the cover in X. (${reason})` };
    }
  } catch (error) {
    if (error instanceof RunnerFailure) return { ok: false, phase: error.phase, code: error.code, message: error.message };
    return { ok: false, phase: 'preflight', code: 'RUNNER_FAILED', message: errorMessage(error) };
  }
}
