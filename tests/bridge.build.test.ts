import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const projectRoot = resolve(new URL('..', import.meta.url).pathname);

describe('Article Studio extension build', () => {
  it('produces an unpacked MV3 extension and downloadable archive', async () => {
    await run(process.execPath, ['scripts/build-extension.mjs'], { cwd: projectRoot });
    const manifestPath = resolve(projectRoot, 'dist-extension/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(expect.arrayContaining(['scripting', 'tabs']));
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
});
