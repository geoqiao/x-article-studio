import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const projectRoot = resolve(new URL('..', import.meta.url).pathname);

describe('Article Studio extension build', () => {
  it('produces an unpacked MV3 extension and downloadable archive', async () => {
    await run(process.execPath, ['scripts/build-extension.mjs'], { cwd: projectRoot });
    const manifestPath = resolve(projectRoot, 'dist-extension/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['scripting']);
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest.host_permissions).not.toContain('*://*/*');
    expect(manifest.content_scripts[0].matches).toEqual(
      expect.arrayContaining(['http://localhost:4318/*', 'http://127.0.0.1:4318/*']),
    );
    for (const file of ['app-content.js', 'background.js', 'review.html', 'review.js', 'review.css', 'x-runner.js']) {
      expect(existsSync(resolve(projectRoot, 'dist-extension', file))).toBe(true);
    }
    expect(readFileSync(resolve(projectRoot, 'dist-extension/THIRD_PARTY_NOTICES.txt'), 'utf8')).toBe(
      readFileSync(resolve(projectRoot, 'public/THIRD_PARTY_NOTICES.txt'), 'utf8'),
    );
    const archive = resolve(projectRoot, 'public/article-studio-bridge.zip');
    expect(statSync(archive).size).toBeGreaterThan(0);
  });

  it('packages matching icons and restricts the store companion to the production website', async () => {
    await run(process.execPath, ['scripts/build-extension.mjs', '--store'], {
      cwd: projectRoot, env: { ...process.env, ARTICLE_STUDIO_ORIGIN: 'https://md2xarticle.com' },
    });
    const version = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version;
    const zip = await JSZip.loadAsync(readFileSync(resolve(projectRoot, `extension/store/article-studio-${version}.zip`)));
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.host_permissions).toEqual(['https://x.com/compose/articles*', 'https://md2xarticle.com/*']);
    expect(manifest.permissions).toEqual(['scripting']);
    expect(manifest.content_scripts[0].matches).toEqual(['https://md2xarticle.com/*']);
    for (const size of [16, 32, 48, 128]) {
      const path = `icons/icon-${size}.png`;
      expect(manifest.icons[size]).toBe(path);
      expect(manifest.action.default_icon[size]).toBe(path);
      const bytes = await zip.file(path)!.async('nodebuffer');
      expect(bytes.readUInt32BE(16)).toBe(size);
      expect(bytes.readUInt32BE(20)).toBe(size);
      expect(bytes.equals(readFileSync(resolve(projectRoot, 'extension', path)))).toBe(true);
    }
  });
});
