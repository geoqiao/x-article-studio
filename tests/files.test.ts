import { describe, expect, it, vi } from 'vitest';
import { allowedRemoteUrl, fetchImageFile, normalizePath, resolveLocalFile, sniffImage } from '../src/files';

describe('local image resolution', () => {
  it('resolves relative and URI-encoded paths against the selected Markdown folder', () => {
    const image = new File(['a'], 'hello world.png');
    const files = new Map([['notes/images/hello world.png', image]]);
    expect(resolveLocalFile('../images/hello%20world.png', files, 'notes/posts/article.md')).toBe(image);
    expect(normalizePath('./images\\photo.png')).toBe('images/photo.png');
  });
  it('rejects ambiguous names instead of selecting an arbitrary picture', () => {
    const files = new Map([['a/photo.png', new File(['a'], 'photo.png')], ['b/photo.png', new File(['b'], 'photo.png')]]);
    expect(() => resolveLocalFile('photo.png', files)).toThrow('More than one');
  });
  it('supports explicit replacement of a blocked remote URL', () => {
    const url = 'https://private.example/photo.png';
    const file = new File(['a'], 'photo.png');
    expect(resolveLocalFile(url, new Map([[url, file]]))).toBe(file);
  });
  it('matches an individual image to a longer Obsidian relative path', () => {
    const file = new File(['a'], 'screen shot.png');
    expect(resolveLocalFile('assets/article/screen%20shot.png', new Map([['screen shot.png', file]]), 'article.md')).toBe(file);
  });
  it('matches the innermost image folder as well as its parents', () => {
    const file = new File(['a'], 'photo.png');
    for (const key of ['article/photo.png', 'assets/article/photo.png', 'notes/posts/assets/article/photo.png']) {
      expect(resolveLocalFile('assets/article/photo.png', new Map([[key, file]]), 'post.md')).toBe(file);
    }
  });
  it('prefers a matching subfolder over an unrelated image with the same basename', () => {
    const correct = new File(['a'], 'photo.png');
    const other = new File(['b'], 'photo.png');
    expect(resolveLocalFile('assets/article/photo.png', new Map([['root/other/photo.png', other], ['article/photo.png', correct]]))).toBe(correct);
  });
  it('does not guess between duplicate filenames or distinct targets for a flat selection', () => {
    const file = new File(['a'], 'photo.png');
    const other = new File(['b'], 'photo.png');
    expect(() => resolveLocalFile('assets/photo.png', new Map([['a/photo.png', file], ['b/photo.png', other]]))).toThrow('More than one');
    expect(() => resolveLocalFile('a/photo.png', new Map([['photo.png', file]]), 'post.md', ['a/photo.png', 'b/photo.png'])).toThrow('Several image paths');
  });
  it('retains explicit choices and deduplicates aliases of one selected file', () => {
    const chosen = new File(['a'], 'wrong-name.png');
    const original = new File(['b'], 'photo.png');
    expect(resolveLocalFile('assets/photo.png', new Map([['assets/photo.png', chosen], ['photo.png', original]]))).toBe(chosen);
    expect(resolveLocalFile('assets/photo.png', new Map([['a/photo.png', original], ['b/photo.png', original]]))).toBe(original);
  });
  it('rejects traversal outside selected folder and executable schemes', () => {
    expect(() => normalizePath('../../private.png')).toThrow('escapes');
    expect(() => resolveLocalFile('javascript:alert(1)', new Map())).toThrow('relative image path');
  });
});

describe('image input validation', () => {
  it('recognizes PNG bytes and rejects a fake MIME type', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await sniffImage(new Blob([bytes], { type: 'application/octet-stream' }))).toBe('image/png');
    await expect(sniffImage(new Blob(['<svg onload="bad()"/>'], { type: 'image/png' }))).rejects.toThrow('PNG, JPEG, or WebP');
  });
  it.each(['http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://172.17.0.1/a', 'http://192.168.1.1/a', 'http://[::1]/a', 'file:///tmp/a', 'https://name:pass@example.com/a'])('does not fetch private or credential-bearing URL %s', (url) => {
    expect(() => allowedRemoteUrl(url)).toThrow();
  });
  it('accepts a public HTTPS image URL', () => {
    expect(allowedRemoteUrl('https://images.example.com/a.png').hostname).toBe('images.example.com');
  });

  it('offers a recovery action when a download times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    try {
      const request = expect(fetchImageFile('https://images.example.com/a.png')).rejects.toThrow('Image download timed out. Retry or attach a local file.');
      await vi.advanceTimersByTimeAsync(15_000);
      await request;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
