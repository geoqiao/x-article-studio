import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftBundle } from '../src/types';

const fakeClientState = vi.hoisted(() => ({
  uploadCalls: [] as number[],
  draftCalls: 0,
  failOnByte: undefined as number | undefined,
  bearerToken: undefined as string | undefined,
  lastContentState: undefined as unknown,
  createResponse: undefined as { status: number; body: string } | 'network' | undefined,
  coverCalls: [] as Array<[string, string]>,
  coverFails: false,
}));

vi.mock('@kaitox/x-article', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kaitox/x-article')>();
  type FetchImpl = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  class FakeXArticleClient {
    private readonly fetchImpl: FetchImpl;

    constructor(credentials: { bearerToken: string }, options: { fetchImpl: FetchImpl }) {
      fakeClientState.bearerToken = credentials.bearerToken;
      this.fetchImpl = options.fetchImpl;
    }

    // Mirrors Kaitox's postJson: read the body, then throw on a non-2xx status.
    private async post(url: string): Promise<unknown> {
      const response = await this.fetchImpl(url);
      const text = await response.text();
      if (!response.ok) throw new Error(`请求失败 ${response.status} ${url}\n${text}`);
      return text ? JSON.parse(text) : {};
    }

    async uploadMedia(bytes: Uint8Array): Promise<string> {
      const marker = bytes[0];
      fakeClientState.uploadCalls.push(marker);
      if (marker === fakeClientState.failOnByte) throw new Error('simulated image upload failure');
      return `media-${marker}`;
    }

    async createArticleDraft(_title: string, contentState: unknown): Promise<{ restId: string }> {
      fakeClientState.draftCalls += 1;
      fakeClientState.lastContentState = contentState;
      if (fakeClientState.createResponse) await this.post('https://x.com/i/api/graphql/id/ArticleEntityDraftCreate');
      return { restId: 'draft-123' };
    }

    async updateCoverMedia(articleEntityId: string, mediaId: string): Promise<{ raw: unknown }> {
      fakeClientState.coverCalls.push([articleEntityId, mediaId]);
      if (fakeClientState.coverFails) throw new Error('simulated cover failure');
      return { raw: {} };
    }
  }
  return { ...actual, XArticleClient: FakeXArticleClient };
});

import { classifyCreateFailure, runArticleDraft } from '../extension/src/runner-core';

const CLOUDFLARE_BLOCK = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1><p>Cloudflare Ray ID: 1</p></body></html>';

function image(source: string, marker: number) {
  const bytes = new Uint8Array([marker, 4, 5]);
  return {
    source,
    fileName: `${marker}.png`,
    mime: 'image/png',
    base64: Buffer.from(bytes).toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function bundle(): DraftBundle {
  return {
    schemaVersion: 1,
    jobId: 'runner-job',
    title: 'Runner article',
    markdown: '![one](studio-asset://one.png)\n![two](studio-asset://two.png)',
    // Deliberately reverse metadata order: the runner must follow Markdown order.
    assets: [image('studio-asset://two.png', 2), image('studio-asset://one.png', 1)],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  fakeClientState.uploadCalls = [];
  fakeClientState.draftCalls = 0;
  fakeClientState.failOnByte = undefined;
  fakeClientState.bearerToken = undefined;
  fakeClientState.lastContentState = undefined;
  fakeClientState.createResponse = undefined;
  fakeClientState.coverCalls = [];
  fakeClientState.coverFails = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: async () => {
        const planned = fakeClientState.createResponse;
        if (!planned || planned === 'network') throw new TypeError('Failed to fetch');
        return new Response(planned.body, { status: planned.status });
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { cookie: 'ct0=runner-csrf' },
  });
});

describe('MAIN-world draft runner', () => {
  it('asks for sign-in before uploading or creating when the X session is absent', async () => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } });
    const result = await runArticleDraft(bundle());
    expect(result).toMatchObject({ ok: false, phase: 'preflight', code: 'AUTH_REQUIRED' });
    expect(fakeClientState.uploadCalls).toEqual([]);
    expect(fakeClientState.draftCalls).toBe(0);
  });

  it('never calls draft creation after any image upload fails', async () => {
    fakeClientState.failOnByte = 2;
    const result = await runArticleDraft(bundle());
    expect(result).toMatchObject({ ok: false, phase: 'assets', code: 'ASSET_UPLOAD_FAILED' });
    expect(fakeClientState.uploadCalls).toEqual([1, 2]);
    expect(fakeClientState.draftCalls).toBe(0);
  });

  it('uploads every mapped image once in Markdown order and creates one draft', async () => {
    const result = await runArticleDraft(bundle());
    expect(result).toEqual({ ok: true, restId: 'draft-123' });
    expect(fakeClientState.uploadCalls).toEqual([1, 2]);
    expect(fakeClientState.draftCalls).toBe(1);
    expect(fakeClientState.bearerToken).toBe('');

    const mediaIds = (fakeClientState.lastContentState as { entity_map: Array<{ value: { type: string; data: { media_items?: Array<{ media_id: string }> } } }> }).entity_map
      .filter((entry) => entry.value.type === 'MEDIA')
      .flatMap((entry) => entry.value.data.media_items ?? [])
      .map((item) => item.media_id);
    expect(mediaIds).toEqual(['media-1', 'media-2']);
  });

  it('reports a firewall block as a definite refusal that needs no check in X', async () => {
    fakeClientState.createResponse = { status: 403, body: CLOUDFLARE_BLOCK };
    const result = await runArticleDraft(bundle());
    expect(result).toMatchObject({ ok: false, phase: 'rejected', code: 'X_FIREWALL_BLOCKED' });
    if (result.ok) return;
    expect(result.message).toContain('no draft was created');
    expect(result.message).toContain('curl');
    expect(result.message).not.toContain('<html');
  });

  it('keeps the check-X gate when the create outcome is unknown', async () => {
    fakeClientState.createResponse = 'network';
    expect(await runArticleDraft(bundle())).toMatchObject({ ok: false, phase: 'create', code: 'DRAFT_CREATE_OUTCOME_UNKNOWN' });
    fakeClientState.createResponse = { status: 502, body: 'Bad gateway' };
    expect(await runArticleDraft(bundle())).toMatchObject({ ok: false, phase: 'create', code: 'DRAFT_CREATE_OUTCOME_UNKNOWN' });
  });

  it('classifies other refusals by status and quotes only X’s own error text', () => {
    const json = (message: string) => JSON.stringify({ errors: [{ message }] });
    expect(classifyCreateFailure({ status: 403, body: json('Forbidden') }, new Error('x'))).toMatchObject({ phase: 'rejected', code: 'X_AUTH_REJECTED' });
    expect(classifyCreateFailure({ status: 429, body: '' }, new Error('x'))).toMatchObject({ phase: 'rejected', code: 'X_RATE_LIMITED' });
    const rejected = classifyCreateFailure({ status: 400, body: json('GRAPHQL_VALIDATION_FAILED') }, new Error('x'));
    expect(rejected).toMatchObject({ phase: 'rejected', code: 'DRAFT_CREATE_REJECTED' });
    expect(rejected.message).toContain('GRAPHQL_VALIDATION_FAILED');
    expect(classifyCreateFailure({ status: 408, body: '' }, new Error('x'))).toMatchObject({ phase: 'create' });
    expect(classifyCreateFailure(undefined, new TypeError('Failed to fetch'))).toMatchObject({ phase: 'create' });
  });

  it('uploads the cover before creation and sets it on the new draft', async () => {
    const cover = { ...image('studio-cover://cover', 9), fileName: 'cover.png' };
    const result = await runArticleDraft({ ...bundle(), cover });
    expect(result).toEqual({ ok: true, restId: 'draft-123' });
    expect(fakeClientState.uploadCalls).toEqual([1, 2, 9]);
    expect(fakeClientState.coverCalls).toEqual([['draft-123', 'media-9']]);
  });

  it('never creates a draft when the cover upload fails', async () => {
    fakeClientState.failOnByte = 9;
    const result = await runArticleDraft({ ...bundle(), cover: image('studio-cover://cover', 9) });
    expect(result).toMatchObject({ ok: false, phase: 'assets', code: 'ASSET_UPLOAD_FAILED' });
    expect(fakeClientState.draftCalls).toBe(0);
  });

  it('keeps the created draft and warns when X does not accept the cover', async () => {
    fakeClientState.coverFails = true;
    const result = await runArticleDraft({ ...bundle(), cover: image('studio-cover://cover', 9) });
    expect(result).toMatchObject({ ok: true, restId: 'draft-123' });
    if (result.ok) expect(result.warning).toContain('Set the cover in X');
  });
});
