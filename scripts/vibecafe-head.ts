import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// The local client enforces the production origin and browser privacy signals.
const script = '<script defer src="/telemetry.js" data-vc-product-id="cmu4b884000000agmn23vud8y"></script>';

function sharedHead(html: string): string {
  // Replace an existing integration rather than accumulating script tags.
  const withoutTelemetry = html.replace(
    /<script\b[^>]*(?:data-vc-product-id|https:\/\/vibecafe\.ai\/telemetry\/)[^>]*>[\s\S]*?<\/script\s*>/gi,
    '',
  );
  if (!/<\/head\s*>/i.test(withoutTelemetry)) {
    throw new Error('VibeCafé telemetry requires an HTML document head.');
  }
  return withoutTelemetry.replace(/<\/head\s*>/i, `${script}\n</head>`);
}

export function vibeCafeHead(): Plugin {
  let publicDir: string;
  let outputDir: string;
  return {
    name: 'vibecafe-shared-head',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
      outputDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: sharedHead,
    async writeBundle() {
      // Vite copies public HTML without running transformIndexHtml on it.
      if (!publicDir) return;
      const pages = (await readdir(publicDir, { recursive: true }))
        .filter(file => file.endsWith('.html'));
      await Promise.all(pages.map(async file => {
        const path = resolve(outputDir, file);
        await writeFile(path, sharedHead(await readFile(path, 'utf8')));
      }));
    },
  };
}
