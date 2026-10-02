import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DraftBundleValidationError,
  MAX_ASSET_BYTES,
  MAX_ASSETS,
  MAX_TOTAL_ASSET_BYTES,
  decodeBase64,
  decodedBase64ByteLength,
  validateDraftBundle,
  verifyDraftBundleHashes,
} from '../src/bridge';
import type { DraftBundle } from '../src/types';

function asset(source: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])) {
  const base64 = Buffer.from(bytes).toString('base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { source, fileName: `${source.replace(/[^a-z0-9]+/gi, '-')}.png`, mime: 'image/png', base64, sha256 };
}

function bundle(overrides: Partial<DraftBundle> = {}): DraftBundle {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    title: 'A local article',
    markdown: 'hello',
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Article Studio bridge bundle validation', () => {
  it('accepts exact contract data and decodes unpadded base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = Buffer.from(bytes).toString('base64').replace(/=+$/, '');
    expect(decodedBase64ByteLength(encoded)).toBe(bytes.length);
    expect([...decodeBase64(encoded)]).toEqual([...bytes]);
    expect(validateDraftBundle(bundle({ assets: [asset('studio-asset://mermaid-1.png', bytes)] }))).toMatchObject({ jobId: 'job-1' });
  });

  it('rejects unsupported media, duplicate mappings, and unsafe file names', () => {
    expect(() =>
      validateDraftBundle(
        bundle({
          assets: [
            { ...asset('image-a'), mime: 'image/gif' },
            { ...asset('image-a'), fileName: '../image.png' },
          ],
        }),
      ),
    ).toThrow(DraftBundleValidationError);
    expect(() => validateDraftBundle(bundle({ assets: [{ ...asset('image-a'), fileName: 'a/b.png' }] }))).toThrow(/safe file name/);
  });

  it('enforces the count, per-image, and decoded total caps before crossing the boundary', () => {
    const tooMany = Array.from({ length: MAX_ASSETS + 1 }, (_, index) => asset(`image-${index}`));
    expect(() => validateDraftBundle(bundle({ assets: tooMany }))).toThrow(/more than 40/);

    const large = asset('large', new Uint8Array(MAX_ASSET_BYTES + 1));
    expect(() => validateDraftBundle(bundle({ assets: [large] }))).toThrow(/5 MiB/);

    const chunks = Array.from({ length: 5 }, (_, index) => asset(`chunk-${index}`, new Uint8Array(4 * 1024 * 1024 + 1)));
    expect(() => validateDraftBundle(bundle({ assets: chunks }))).toThrow(/20 MiB/);
    expect(MAX_TOTAL_ASSET_BYTES).toBe(20 * 1024 * 1024);
  });

  it('validates an optional cover with the same rules and counts it toward the total', async () => {
    const cover = asset('studio-cover://cover', new Uint8Array([7, 7, 7]));
    expect(validateDraftBundle(bundle({ cover })).cover).toEqual(cover);
    expect(() => validateDraftBundle(bundle({ cover: { ...cover, mime: 'image/gif' } }))).toThrow(/cover\.mime/);
    const chunks = Array.from({ length: 4 }, (_, index) => asset(`chunk-${index}`, new Uint8Array(4 * 1024 * 1024)));
    const large = asset('studio-cover://cover', new Uint8Array(4 * 1024 * 1024 + 1));
    expect(() => validateDraftBundle(bundle({ assets: chunks, cover: large }))).toThrow(/20 MiB/);
    await expect(verifyDraftBundleHashes(bundle({ cover: { ...cover, base64: Buffer.from([7, 7, 8]).toString('base64') } }))).rejects.toMatchObject({ code: 'ASSET_HASH_MISMATCH' });
  });

  it('checks each declared SHA-256 and catches tampering', async () => {
    const original = new Uint8Array([9, 8, 7]);
    const valid = bundle({ assets: [asset('image-a', original)] });
    await expect(verifyDraftBundleHashes(valid)).resolves.toBeUndefined();
    await expect(verifyDraftBundleHashes({ ...valid, assets: [{ ...valid.assets[0], base64: Buffer.from([9, 8, 6]).toString('base64') }] })).rejects.toMatchObject({ code: 'ASSET_HASH_MISMATCH' });
  });
});
