import type { LocalAssetMap } from './types';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function normalizePath(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { decoded = value; }
  const parts: string[] = [];
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('Image path escapes the selected folder.'); parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

export function resolveLocalFile(source: string, files: LocalAssetMap, documentPath = '', imageSources: string[] = []): File | undefined {
  // Explicit per-image replacement takes precedence, including a remote URL.
  if (files.has(source)) return files.get(source);
  if (/^https?:\/\//i.test(source)) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) throw new Error('Use a relative image path, an HTTPS URL, or attach a replacement file.');
  const directory = documentPath.includes('/') ? documentPath.slice(0, documentPath.lastIndexOf('/') + 1) : '';
  const candidates = new Set<string>();
  if (directory) candidates.add(normalizePath(directory + source));
  try { candidates.add(normalizePath(source)); } catch (error) { if (!candidates.size) throw error; }
  for (const candidate of candidates) if (files.has(candidate)) return files.get(candidate);
  // A file picker exposes only the name; a folder picker includes the selected
  // root, which may be above or below the root used in the Markdown path.
  // Prefer the longest matching path suffix and never guess between equal matches.
  let best = 0;
  let matches: File[] = [];
  for (const [key, file] of files) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(key)) continue;
    const parts = normalizePath(key).split('/').reverse();
    for (const candidate of candidates) {
      const expected = candidate.split('/').reverse();
      let score = 0;
      while (score < Math.min(parts.length, expected.length) && parts[score] === expected[score]) score++;
      if (!score || score < best) continue;
      if (score > best) { best = score; matches = []; }
      matches.push(file);
    }
  }
  if (best === 1) {
    const basename = [...candidates][0].split('/').pop();
    const competing = new Set(imageSources.filter((path) => !/^[a-z][a-z0-9+.-]*:/i.test(path)).filter((path) => {
      try { return normalizePath(directory + path).split('/').pop() === basename; } catch { return false; }
    }).map((path) => normalizePath(directory + path)));
    if (competing.size > 1) throw new Error('Several image paths use this filename. Select their parent folder or choose each image with Replace.');
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) throw new Error('More than one selected file matches this path. Attach the correct image using Replace.');
  return unique[0];
}

export function allowedRemoteUrl(source: string): URL {
  const url = new URL(source);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP/HTTPS image URL without embedded credentials.');
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '[::1]' || h.startsWith('[') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^\d+$/.test(h)) throw new Error('Private-network image URLs are not fetched. Attach the image as a local file.');
  return url;
}

export async function fetchImageFile(source: string, signal?: AbortSignal): Promise<Blob> {
  const url = allowedRemoteUrl(source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'error', signal: controller.signal, referrerPolicy: 'no-referrer' });
    if (!response.ok || !response.body) throw new Error(`Image server returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image is larger than 5 MiB.');
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image is larger than 5 MiB.'); }
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type: response.headers.get('content-type')?.split(';')[0] || '' });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Image download timed out. Retry or attach a local file.');
    if (error instanceof TypeError) throw new Error('Could not download this image (network, CORS or login restriction). Retry or attach a local file.');
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function sniffImage(blob: Blob): Promise<string> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds this version’s 5 MiB limit. Resize it before attaching.');
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('Attach a PNG, JPEG, or WebP image. GIF, SVG, and other formats are not supported in this version.');
}

export async function sha256(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16_384) binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(binary);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
