import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { createPlan } from '../src/plan';
import { exportDraftBackup } from '../src/backup';
import { disposeAssets, prepareArticle, type AssetCache } from '../src/prepare';
import { renderDiagram } from '../src/render';
import type { AssetProgress } from '../src/types';

vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
vi.mock('../src/render', () => ({ renderDiagram: vi.fn(), renderTable: vi.fn() }));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const bitmap = vi.fn(async () => ({ width: 10, height: 20, close() {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', bitmap);
  vi.mocked(renderDiagram).mockResolvedValue(new Blob([png], { type: 'image/png' }));
});

describe('asset preparation and source backups', () => {
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
