import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';

describe('Cloudflare static asset redirects', () => {
  let assets: string;
  let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
  let origin: URL;

  beforeAll(async () => {
    assets = await mkdtemp(join(tmpdir(), 'article-studio-redirects-'));
    // Assemble the HTML and redirect assets without requiring a production build before tests.
    const publicFiles = ['_redirects', 'support.html', 'privacy.html', 'x-article-agent-skill.html'];
    await Promise.all([
      copyFile(new URL('../index.html', import.meta.url), join(assets, 'index.html')),
      ...publicFiles.map(file => copyFile(new URL(`../public/${file}`, import.meta.url), join(assets, file))),
    ]);
    worker = await unstable_startWorker({
      config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
      assets,
      build: { custom: { command: '' } },
      dev: { server: { port: 0 }, inspector: { enabled: false }, persist: false },
    });
    origin = await worker.url;
  }, 15_000);

  afterAll(async () => {
    await worker?.dispose();
    if (assets) await rm(assets, { recursive: true, force: true });
  });

  it.each([
    ['/index.html', '/'],
    ['/support.html', '/support'],
    ['/privacy.html', '/privacy'],
    ['/x-article-agent-skill/', '/x-article-agent-skill'],
    ['/support.html?utm_source=guide&next=a%2Fb', '/support?utm_source=guide&next=a%2Fb'],
  ])('permanently redirects %s directly to %s', async (alias, destination) => {
    const response = await worker.fetch(new URL(alias, origin), { redirect: 'manual' });
    await response.body?.cancel();
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(destination);

    const target = await worker.fetch(new URL(destination, origin), { redirect: 'manual' });
    await target.body?.cancel();
    expect(target.status).toBe(200);
  });
});
