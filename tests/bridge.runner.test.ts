import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftBundle } from '../src/types';

const fakeClientState = vi.hoisted(() => ({
  uploadCalls: [] as number[],
  draftCalls: 0,
  failOnByte: undefined as number | undefined,
  bearerToken: undefined as string | undefined,
  lastContentState: undefined as unknown,
}));

vi.mock('@kaitox/x-article', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kaitox/x-article')>();
  class FakeXArticleClient {
    constructor(credentials: { bearerToken: string }) {
      fakeClientState.bearerToken = credentials.bearerToken;
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
      return { restId: 'draft-123' };
    }
  }
  return { ...actual, XArticleClient: FakeXArticleClient };
});

import { runArticleDraft } from '../extension/src/runner-core';

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
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch: globalThis.fetch },
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
});
