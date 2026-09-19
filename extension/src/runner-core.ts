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
    let client: XArticleClient;
    try {
      client = new XArticleClient(
        { bearerToken: '', csrfToken },
        {
          fetchImpl: window.fetch.bind(window) as any,
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

    let created: { restId?: string };
    try {
      // This is intentionally the only draft mutation. There is no publish call here.
      created = await client.createArticleDraft(bundle.title, contentState);
    } catch (error) {
      throw new RunnerFailure(
        'create',
        'DRAFT_CREATE_OUTCOME_UNKNOWN',
        `X did not provide a definitive draft creation result. Open X Articles and check before trying again. (${errorMessage(error)})`,
      );
    }
    if (!created.restId) {
      throw new RunnerFailure(
        'create',
        'DRAFT_ID_MISSING',
        'X accepted the request but returned no draft id. Open X Articles and verify the result before trying again.',
      );
    }
    return { ok: true, restId: String(created.restId) };
  } catch (error) {
    if (error instanceof RunnerFailure) return { ok: false, phase: error.phase, code: error.code, message: error.message };
    return { ok: false, phase: 'preflight', code: 'RUNNER_FAILED', message: errorMessage(error) };
  }
}
