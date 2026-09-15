import * as esbuild from 'esbuild';
import JSZip from 'jszip';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const extensionRoot = join(projectRoot, 'extension');
const outputRoot = join(projectRoot, 'dist-extension');
const publicRoot = join(projectRoot, 'public');

const DEFAULT_ORIGINS = ['http://localhost:4318', 'http://127.0.0.1:4318'];

function exactOrigin(value) {
  const raw = value.trim();
  if (!raw) throw new Error('ARTICLE_STUDIO_ORIGIN cannot be empty.');
  if (raw.includes('*')) throw new Error('ARTICLE_STUDIO_ORIGIN must name one exact host; wildcards are not allowed.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ARTICLE_STUDIO_ORIGIN is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ARTICLE_STUDIO_ORIGIN must use http or https.');
  }
  if (url.protocol === 'http:' && !DEFAULT_ORIGINS.includes(url.origin)) {
    throw new Error('ARTICLE_STUDIO_ORIGIN must use HTTPS for deployment origins; HTTP is limited to the default local origins.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ARTICLE_STUDIO_ORIGIN must be an exact origin without credentials, path, query, or hash.');
  }
  return url.origin;
}

const configuredOrigin = process.env.ARTICLE_STUDIO_ORIGIN?.trim();
const appOrigins = [...new Set([...DEFAULT_ORIGINS, ...(configuredOrigin ? [exactOrigin(configuredOrigin)] : [])])];
const appMatches = appOrigins.map((origin) => `${origin}/*`);

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
const extensionVersion = packageJson.version || sourceManifest.version;

if (sourceManifest.manifest_version !== 3) throw new Error('extension/manifest.json must be a Manifest V3 manifest.');
if (!extensionVersion) throw new Error('package.json must provide an extension version.');
if ((sourceManifest.host_permissions ?? []).some((permission) => permission === '<all_urls>' || permission.includes('*://*/*'))) {
  throw new Error('The Article Studio extension must not request broad all-website host access.');
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome110',
  legalComments: 'eof',
  sourcemap: false,
  logLevel: 'info',
  define: {
    __ARTICLE_STUDIO_ORIGINS__: JSON.stringify(appOrigins),
    __ARTICLE_STUDIO_EXTENSION_VERSION__: JSON.stringify(String(extensionVersion)),
  },
};

const entries = [
  ['extension/src/app-content.ts', 'app-content.js'],
  ['extension/src/background.ts', 'background.js'],
  ['extension/src/review.ts', 'review.js'],
  ['extension/src/x-runner.ts', 'x-runner.js'],
];

await Promise.all(
  entries.map(([entryPoint, outfile]) =>
    esbuild.build({
      ...common,
      entryPoints: [join(projectRoot, entryPoint)],
      outfile: join(outputRoot, outfile),
    }),
  ),
);

const manifest = {
  ...sourceManifest,
  version: String(extensionVersion),
  host_permissions: [...new Set([...(sourceManifest.host_permissions ?? []), ...appMatches])],
  content_scripts: (sourceManifest.content_scripts ?? []).map((script) =>
    script.js?.includes('app-content.js') ? { ...script, matches: appMatches } : script,
  ),
};

if (!manifest.content_scripts.some((script) => script.js?.includes('app-content.js'))) {
  throw new Error('extension/manifest.json must declare app-content.js.');
}

await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(extensionRoot, 'review.html'), join(outputRoot, 'review.html'));
await cp(join(extensionRoot, 'review.css'), join(outputRoot, 'review.css'));
await cp(join(extensionRoot, 'README.md'), join(outputRoot, 'README.md'));
await mkdir(publicRoot, { recursive: true });
await cp(join(publicRoot, 'THIRD_PARTY_NOTICES.txt'), join(outputRoot, 'THIRD_PARTY_NOTICES.txt'));

async function addDirectory(zip, directory, baseDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) await addDirectory(zip, absolutePath, baseDirectory);
    else zip.file(relative(baseDirectory, absolutePath), await readFile(absolutePath));
  }
}

const zip = new JSZip();
await addDirectory(zip, outputRoot, outputRoot);
const archive = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});
const archivePath = join(publicRoot, 'article-studio-bridge.zip');
await writeFile(archivePath, archive);

console.log(`✓ Article Studio extension built → ${relative(projectRoot, outputRoot)}/`);
console.log(`✓ browser download archive → ${relative(projectRoot, archivePath)}`);
