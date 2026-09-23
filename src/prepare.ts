import DOMPurify from 'dompurify';
import JSZip from 'jszip';
import { renderPreviewHtml } from '@kaitox/x-article';
import { fetchImageFile, MAX_TOTAL_BYTES, resolveLocalFile, sha256, sniffImage, toBase64 } from './files';
import { renderDiagram, renderTable } from './render';
import { safeFileStem } from './plan';
import { rewriteImageDestinations } from './portable';
import type { ArticlePlan, AssetProgress, Issue, LocalAssetMap, PreparedArticle, PreparedAsset } from './types';

type CachedAsset = { input: File | string; blob: Blob; width: number; height: number; sha256: string; base64: string };
export type AssetCache = Map<string, CachedAsset>;

export function safePreview(plan: ArticlePlan, assets: PreparedAsset[] = []): string {
  const urls = new Map(assets.map((a) => [a.spec.source, a.url]));
  const placements: string[] = [];
  let placement = 0;
  const html = renderPreviewHtml(plan.markdown, { title: plan.title || 'Untitled article', resolveImage: (src) => { placements.push(src); return urls.get(src); } })
    .replace(/<figure class="xp-fig">/g, () => {
      const source = placements[placement++];
      const asset = plan.assets.find((item) => item.source === source);
      return `<figure class="xp-fig"${asset ? ` data-asset-id="${asset.id}"` : ''}>`;
    })
    .replaceAll('图片加载中…', 'Image not ready. Choose a file below or check the image details.')
    .replaceAll('（正文为空）', 'Your article preview will appear here.');
  // Sanitize third-party renderer output even when it currently escapes content.
  // Local-file previews have opaque origins and create blob:null/... URLs.
  // resolveImage above supplies only object URLs created from prepared assets.
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|blob:(?:https?:\/\/|null\/)|[#/])/i });
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  if (width > 16_384 || height > 16_384 || width * height > 40_000_000) throw new Error('Image dimensions exceed this version’s processing limit. Resize it first.');
  return { width, height };
}

export async function prepareArticle(plan: ArticlePlan, files: LocalAssetMap, documentPath: string, onProgress: (p: AssetProgress) => void, signal: AbortSignal, cache: AssetCache = new Map()): Promise<PreparedArticle> {
  const issues: Issue[] = [...plan.issues];
  const assets: PreparedAsset[] = [];
  const bundleAssets: PreparedArticle['bundle']['assets'] = [];
  const sources = plan.assets.filter(asset => asset.kind === 'image').map(asset => asset.source);
  for (const key of cache.keys()) if (!plan.assets.some(asset => asset.source === key)) cache.delete(key);
  let total = 0;
  for (const spec of plan.assets) {
    if (signal.aborted) { disposeAssets(assets); throw new DOMException('Preparation cancelled.', 'AbortError'); }
    onProgress({ id: spec.id, state: 'preparing' });
    let reason: AssetProgress['reason'];
    try {
      const file = spec.kind === 'image' ? resolveLocalFile(spec.source, files, documentPath, sources) : undefined;
      const input = spec.kind === 'mermaid' ? `mermaid:${spec.code}`
        : spec.kind === 'table' ? `table:${JSON.stringify([spec.headers, spec.rows])}`
        : file || spec.source;
      let cached = cache.get(spec.source);
      if (cached?.input !== input) {
        cache.delete(spec.source);
        let blob: Blob;
        if (spec.kind === 'mermaid') blob = await renderDiagram(spec.code || '');
        else if (spec.kind === 'table') blob = await renderTable(spec.headers || [], spec.rows || []);
        else if (file) blob = file;
        else if (/^https?:\/\//i.test(spec.source)) blob = await fetchImageFile(spec.source, signal);
        else {
          reason = 'missing-file';
          throw new Error('Image file not selected. Choose the file or match its folder.');
        }
        const mime = await sniffImage(blob);
        blob = new Blob([blob], { type: mime });
        const dimensions = await imageDimensions(blob);
        cached = { input, blob, ...dimensions, sha256: await sha256(blob), base64: await toBase64(blob) };
        if (signal.aborted) throw new DOMException('Preparation cancelled.', 'AbortError');
        cache.set(spec.source, cached);
      }
      const { blob, width, height, sha256: hash, base64 } = cached;
      if (total + blob.size > MAX_TOTAL_BYTES) throw new Error('Images exceed 20 MiB in total. Resize or remove an image.');
      total += blob.size;
      const mime = blob.type;
      const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
      const fileName = `${spec.id}-${hash.slice(0, 8)}.${ext}`;
      assets.push({ spec, blob, url: URL.createObjectURL(blob), width, height, fileName, sha256: hash });
      bundleAssets.push({ source: spec.source, fileName, mime, base64, sha256: hash });
      if (width > 2400 || height > 5000) issues.push({ id: `readability-${spec.id}`, severity: 'warning', message: `Check “${spec.label}” at phone width; large images can make labels hard to read.`, line: spec.line });
      onProgress({ id: spec.id, state: 'ready' });
    } catch (error) {
      if (signal.aborted) { disposeAssets(assets); throw new DOMException('Preparation cancelled.', 'AbortError'); }
      const message = error instanceof Error ? error.message : 'Asset preparation failed.';
      issues.push({ id: `prepare-${spec.id}`, severity: 'error', message, line: spec.line });
      onProgress({ id: spec.id, state: 'error', message, reason });
    }
  }
  if (signal.aborted) { disposeAssets(assets); throw new DOMException('Preparation cancelled.', 'AbortError'); }
  return { plan, assets, issues, previewHtml: safePreview(plan, assets), bundle: { schemaVersion: 1, jobId: crypto.randomUUID(), title: plan.title, markdown: plan.markdown, assets: bundleAssets, createdAt: new Date().toISOString() } };
}

export function disposeAssets(assets: PreparedAsset[]): void { for (const asset of assets) URL.revokeObjectURL(asset.url); }

export async function exportArticle(prepared: PreparedArticle): Promise<Blob> {
  if (prepared.issues.some((i) => i.severity === 'error')) throw new Error('Resolve the blocking issues before exporting a complete article.');
  const zip = new JSZip();
  const destinations = new Map(prepared.assets.map((a) => [a.spec.source, `assets/${a.fileName}`]));
  const markdown = rewriteImageDestinations(prepared.bundle.markdown, destinations);
  for (const asset of prepared.assets) {
    zip.file(`assets/${asset.fileName}`, asset.blob);
  }
  zip.file(`${safeFileStem(prepared.plan.title)}.md`, `---\ntitle: ${JSON.stringify(prepared.plan.title)}\n---\n\n${markdown}`);
  zip.file('article-studio.json', JSON.stringify(prepared.bundle, null, 2));
  zip.file('compatibility.json', JSON.stringify({ checkedAt: prepared.bundle.createdAt, issues: prepared.issues }, null, 2));
  zip.file('README.txt', 'Prepared with Article Studio.\nThe Markdown and assets/ folder are portable. Mermaid diagrams are static PNGs.\narticle-studio.json is the companion extension handoff bundle.\nNo content has been published by exporting this archive.\n');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
