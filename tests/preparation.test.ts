import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { createPlan } from '../src/plan';
import { exportDraftBackup } from '../src/backup';
import { disposeAssets, exportArticle, prepareArticle, type AssetCache } from '../src/prepare';
import { renderDiagram } from '../src/render';
import type { AssetProgress } from '../src/types';
import { MAX_IMAGE_BYTES } from '../src/files';

vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
vi.mock('../src/render', () => ({ renderDiagram: vi.fn(), renderTable: vi.fn() }));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const bitmap = vi.fn(async () => ({ width: 20, height: 10, close() {} }));
const paddedPng = new Blob([png, Uint8Array.of(2)], { type: 'image/png' });

function mockCanvas(output: Blob = paddedPng) {
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 0, height: 0, getContext: () => context,
    toBlob: vi.fn((callback: BlobCallback, _mime: string) => callback(output)),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { canvas, context };
}

beforeEach(() => {
  vi.resetAllMocks();
  bitmap.mockImplementation(async () => ({ width: 20, height: 10, close() {} }));
  vi.stubGlobal('createImageBitmap', bitmap);
  vi.mocked(renderDiagram).mockResolvedValue(new Blob([png], { type: 'image/png' }));
});

afterEach(() => vi.unstubAllGlobals());

describe('asset preparation and source backups', () => {
  it('pads the reported tall diagram and keeps preview, bundle and ZIP bytes identical', async () => {
    const { canvas, context } = mockCanvas();
    const tall = { width: 1600, height: 3439, close: vi.fn() };
    bitmap.mockResolvedValueOnce(tall);
    const cache: AssetCache = new Map();
    const markdown = '```mermaid\nflowchart TD\nStart-->Finish\n```';
    const prepare = (content: string) => prepareArticle(createPlan(content), new Map(), '', () => {}, new AbortController().signal, cache);
    const result = await prepare(markdown);
    const edited = await prepare(markdown + '\n\nMore text');
    const [asset] = result.assets;
    expect(asset).toMatchObject({ width: 2614, height: 3439, diagram: { contentWidth: 1600, contentHeight: 3439, paddedWidth: 2614 } });
    expect(canvas.toBlob).toHaveBeenCalledTimes(1);
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 2614, 3439);
    expect(context.drawImage).toHaveBeenCalledWith(tall, 507, 0, 1600, 3439);
    expect(tall.close).toHaveBeenCalledOnce();
    expect(edited.assets[0].diagram).toEqual(asset.diagram);
    expect(edited.assets[0].blob).toBe(asset.blob);
    expect(result.issues).toContainEqual(expect.objectContaining({ id: 'tall-mermaid-1', severity: 'warning' }));
    expect(edited.issues).toContainEqual(expect.objectContaining({ id: 'tall-mermaid-1', severity: 'warning' }));
    expect(result.previewHtml).toContain(asset.url);
    const preview = new Uint8Array(await (await fetch(asset.url)).arrayBuffer());
    const zip = await JSZip.loadAsync(await (await exportArticle(result)).arrayBuffer());
    expect(await zip.file(`assets/${asset.fileName}`)!.async('uint8array')).toEqual(preview);
    expect(Buffer.from(result.bundle.assets[0].base64, 'base64')).toEqual(Buffer.from(preview));
    expect(result.bundle.assets[0].sha256).toBe(asset.sha256);
    disposeAssets([...result.assets, ...edited.assets]);
  });

  it('only pads qualifying Mermaid assets and preserves independent warnings in a mixed article', async () => {
    const { canvas } = mockCanvas();
    bitmap.mockResolvedValueOnce({ width: 300, height: 400, close() {} })
      .mockResolvedValueOnce({ width: 900, height: 500, close() {} })
      .mockResolvedValueOnce({ width: 700, height: 1000, close() {} })
      .mockResolvedValueOnce({ width: 400, height: 1000, close() {} })
      .mockResolvedValueOnce({ width: 1600, height: 3439, close() {} })
      .mockResolvedValueOnce({ width: 1600, height: 3439, close() {} });
    const diagrams = ['A', 'B', 'C', 'D', 'E'].map(id => ['```mermaid', 'flowchart TD', `${id}-->X`, '```'].join('\n'));
    const markdown = [...diagrams, '![Portrait](photo.png)'].join('\n\n');
    const result = await prepareArticle(createPlan(markdown), new Map([['photo.png', new File([png], 'photo.png')]]), '', () => {}, new AbortController().signal);
    expect(result.assets.map(({ width, height }) => [width, height])).toEqual([
      [300, 400], [900, 500], [760, 1000], [760, 1000], [2614, 3439], [1600, 3439],
    ]);
    expect(result.issues.map(issue => issue.id)).toEqual(['tall-mermaid-4', 'tall-mermaid-5']);
    expect(canvas.toBlob).toHaveBeenCalledTimes(3);
    disposeAssets(result.assets);
  });

  it('limits the canvas for extreme aspect ratios while preserving scale and PNG compression', async () => {
    const oversized = new Blob([png, new Uint8Array(MAX_IMAGE_BYTES)], { type: 'image/png' });
    const { canvas, context } = mockCanvas();
    canvas.toBlob.mockImplementationOnce(callback => callback(oversized))
      .mockImplementationOnce(callback => callback(oversized))
      .mockImplementationOnce(callback => callback(oversized))
      .mockImplementationOnce(callback => callback(oversized));
    const tall = { width: 1200, height: 25_000, close: vi.fn() };
    bitmap.mockResolvedValueOnce(tall);
    const result = await prepareArticle(createPlan('```mermaid\nflowchart TD\nA-->B\n```'), new Map(), '', () => {}, new AbortController().signal);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 3113, 4096);
    expect(context.drawImage).toHaveBeenNthCalledWith(1, tall, 1458, 0, 1200 * (4096 / 25000), 4096);
    expect(tall.close).toHaveBeenCalledOnce();
    expect(canvas.toBlob.mock.calls.map(([, mime]) => mime)).toEqual(Array(5).fill('image/png'));
    expect(result.assets[0]).toMatchObject({ width: 770, height: 1013, diagram: { contentWidth: 1200, contentHeight: 25000, paddedWidth: 19000 } });
    expect(result.assets[0].blob.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    disposeAssets(result.assets);
  });

  it('releases the bitmap and avoids caching a cancelled canvas export', async () => {
    const { canvas } = mockCanvas();
    const tall = { width: 1600, height: 3439, close: vi.fn() };
    bitmap.mockResolvedValueOnce(tall);
    const controller = new AbortController();
    canvas.toBlob.mockImplementationOnce(callback => {
      controller.abort();
      callback(paddedPng);
    });
    const cache: AssetCache = new Map();
    const pending = prepareArticle(createPlan('```mermaid\nflowchart TD\nA-->B\n```'), new Map(), '', () => {}, controller.signal, cache);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(tall.close).toHaveBeenCalledOnce();
    expect(cache.size).toBe(0);
  });

  it('reuses unchanged images and diagrams across text/title edits, with independent object URLs', async () => {
    const file = new File([png], 'photo.png');
    const files = new Map([['photo.png', file]]);
    const cache: AssetCache = new Map();
    const md = 'Body.\n\n![Photo](photo.png)\n\n```mermaid\ngraph LR\n A-->B\n```';
    const a = await prepareArticle(createPlan(md), files, '', () => {}, new AbortController().signal, cache);
    const b = await prepareArticle(createPlan(md + '\n\nMore.', 'native', 'Changed'), files, '', () => {}, new AbortController().signal, cache);
    expect(renderDiagram).toHaveBeenCalledTimes(1);
    expect(bitmap).toHaveBeenCalledTimes(2);
    expect(a.assets[0].url).not.toBe(b.assets[0].url);
    expect(b.bundle.title).toBe('Changed');
    expect(b.bundle.markdown).toContain('More.');
    expect(b.assets.map(a => a.blob)).toEqual(a.assets.map(a => a.blob));
    disposeAssets(a.assets); disposeAssets(b.assets);
  });

  it('invalidates replaced local files and changed diagram source', async () => {
    const cache: AssetCache = new Map();
    const md = '![Photo](photo.png)\n\n```mermaid\ngraph LR\n A-->B\n```';
    for (const source of [md, md.replace('A-->B', 'A-->C')]) {
      const result = await prepareArticle(createPlan(source), new Map([['photo.png', new File([png], 'photo.png')]]), '', () => {}, new AbortController().signal, cache);
      disposeAssets(result.assets);
    }
    expect(renderDiagram).toHaveBeenCalledTimes(2);
    expect(bitmap).toHaveBeenCalledTimes(4);
  });

  it('distinguishes a missing local file from an invalid image', async () => {
    const progress: AssetProgress[] = [];
    const result = await prepareArticle(createPlan('Body\n\n![Missing](missing.png)\n\n![Invalid](invalid.png)'),
      new Map([['invalid.png', new File(['not an image'], 'invalid.png')]]), '', p => progress.push(p), new AbortController().signal);
    expect(progress.find(p => p.id === 'image-1' && p.state === 'error')?.reason).toBe('missing-file');
    const invalid = progress.find(p => p.id === 'image-2' && p.state === 'error');
    expect(invalid?.reason).toBeUndefined();
    expect(invalid?.message).toContain('PNG');
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(2);
  });

  it('keeps exact Markdown, local bytes, override mappings and errors in an incomplete backup', async () => {
    const file = new File([png], 'chosen.png');
    const markdown = '## No H1\n\n![A](missing/original.png)\n\n- Parent\n  - Child\n';
    const draft = { markdown, title: 'Override', documentPath: 'notes/example.md', tableMode: 'native' as const };
    const blob = await exportDraftBackup(draft, new Map([['missing/original.png', file], ['chosen.png', file]]), createPlan(markdown).issues);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file('source.md')!.async('string')).toBe(markdown);
    const manifest = JSON.parse(await zip.file('draft-backup.json')!.async('string'));
    expect(manifest.title).toBe('Override');
    expect(manifest.files[0][1]).toBe(manifest.files[1][1]);
    expect(await zip.file(manifest.files[0][1])!.async('uint8array')).toEqual(png);
    expect(manifest.issues.some((i: { id: string }) => i.id === 'nested-list')).toBe(true);
    expect(zip.file('article-studio.json')).toBeNull();
  });
});
