#!/usr/bin/env node
// Checks a Markdown article the way md2xarticle.com does, resolves its local images
// and cover, downloads remote images, applies requested lossless conversions to a
// temporary copy, then writes the playwright-cli scripts that create the X draft.
// Needs only node: the website's checks are bundled in studio-core.mjs.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFootnotesToEndnotes, createPlan, rewriteImageDestinations, simplifyNestedLists } from './studio-core.mjs';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // larger images are downscaled by the website
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 40;
const SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const IMAGE_FILE = /\.(png|jpe?g|webp|svg)$/i;

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const flag = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
};
const coverOption = option('--cover');
const imagesOption = option('--images');
const url = option('--url') ?? 'https://md2xarticle.com/';
const flattenLists = flag('--flatten-lists');
const endnotes = flag('--endnotes');
const allowWikilinks = flag('--allow-wikilinks');
const articlePath = args[0] && resolve(args[0]);
if (!articlePath || !existsSync(articlePath)) {
  console.error('Usage: prepare.mjs <article.md> [--cover <image>] [--images <folder>] [--flatten-lists] [--endnotes] [--allow-wikilinks] [--url <Article Studio URL>]');
  process.exit(2);
}
const imagesDirectory = imagesOption && resolve(imagesOption);
if (imagesOption && !existsSync(imagesDirectory)) {
  console.error(`--images folder not found: ${imagesOption}`);
  process.exit(2);
}

const source = readFileSync(articlePath, 'utf8');
const articleDirectory = dirname(articlePath);
const problems = [];
const warnings = [];
const notes = [];
const transforms = [];

// Lossless conversions the website offers as buttons, applied to a temporary copy only.
let markdown = source;
if (endnotes) {
  const converted = convertFootnotesToEndnotes(markdown);
  if (converted !== markdown) { markdown = converted; transforms.push('footnotes → endnotes'); }
  else notes.push('--endnotes: no footnote definitions found; nothing changed.');
}
if (flattenLists) {
  const converted = simplifyNestedLists(markdown);
  if (converted !== markdown) { markdown = converted; transforms.push('nested lists → one level'); }
  else notes.push('--flatten-lists: no simple nested lists found; nothing changed.');
}

// The same checks as the website, before any browser opens.
const plan = createPlan(markdown, 'native', '', basename(articlePath), { warnWikilinks: !allowWikilinks });
const hints = {
  'nested-list': ' Re-run with --flatten-lists to convert simple nested lists.',
  footnote: ' Re-run with --endnotes to convert footnotes to numbered endnotes.',
  wikilink: ' Re-run with --allow-wikilinks if the user wants them left as text.',
};
for (const issue of plan.issues) {
  const text = `Line ${issue.line}: ${issue.message}${hints[issue.id] ?? ''}`;
  (issue.severity === 'error' ? problems : warnings).push(text);
}
if (plan.frontmatter) notes.push(`Frontmatter: ${plan.frontmatter.used.length ? 'used ' + plan.frontmatter.used.join(', ') : 'no title or cover'}; ${plan.frontmatter.count - plan.frontmatter.used.length} other field(s) are ignored.`);

const isRemote = (value) => /^(?:https?:)?\/\//i.test(value);
const decode = (value) => { try { return decodeURI(value); } catch { return value; } };

/** Image files below a folder, as absolute paths, skipping dot folders. */
function listImages(directory, depth = 6, out = []) {
  if (depth < 0 || !existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) listImages(path, depth - 1, out);
    else if (IMAGE_FILE.test(entry.name)) out.push(path);
  }
  return out;
}
let searchable;
const searchImages = () => searchable ??= [...new Set([...listImages(articleDirectory, 4), ...(imagesDirectory ? listImages(imagesDirectory) : [])])];

/** A referenced image on disk: exact path first, then a unique match by path suffix or file name. */
function locate(reference, role) {
  const decoded = decode(reference.replace(/^<|>$/g, ''));
  if (decoded.startsWith('file://')) return fileURLToPath(decoded);
  const direct = isAbsolute(decoded) ? decoded : resolve(articleDirectory, decoded);
  if (existsSync(direct)) return direct;
  const wanted = decoded.replace(/\\/g, '/').replace(/^(\.\.?\/)+/, '').split('/').filter(Boolean);
  const suffix = sep + wanted.join(sep);
  let matches = searchImages().filter((path) => path.endsWith(suffix));
  if (!matches.length) matches = searchImages().filter((path) => basename(path) === wanted.at(-1));
  if (matches.length === 1) return matches[0];
  problems.push(matches.length
    ? `${role} name matches several files; use a more specific path: ${reference} → ${matches.join(', ')}`
    : `${role} not found: ${reference}${imagesDirectory ? '' : ' (pass --images <folder> to search an attachments folder)'}`);
  return undefined;
}

const files = new Map(); // absolute path → size
function addImage(path, reference, role) {
  if (!SUPPORTED.has(extname(path).toLowerCase())) return problems.push(`${role} must be PNG, JPEG, WebP or SVG; convert it first: ${reference}`), undefined;
  const { size } = statSync(path);
  if (size > MAX_SOURCE_BYTES) return problems.push(`${role} is over 40 MiB; resize it first: ${reference}`), undefined;
  if (size > MAX_IMAGE_BYTES) notes.push(`${role} is over 5 MiB and will be downscaled by the website: ${reference}`);
  files.set(path, size);
  return path;
}

// Remote images are downloaded here so the website does not depend on the host's CORS policy.
const workDirectory = mkdtempSync(join(tmpdir(), 'md2xarticle-'));
const destinations = new Map();
async function download(reference, index) {
  const target = new URL(reference.startsWith('//') ? 'https:' + reference : reference);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(target, { signal: controller.signal, redirect: 'follow', headers: { accept: 'image/*' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('over 40 MiB');
    const type = (response.headers.get('content-type') || '').split(';')[0];
    const ext = type === 'image/jpeg' ? '.jpg' : type === 'image/webp' ? '.webp' : type === 'image/svg+xml' ? '.svg' : type === 'image/png' ? '.png' : extname(target.pathname).toLowerCase();
    if (!SUPPORTED.has(ext)) throw new Error(`unsupported type ${type || ext || 'unknown'}`);
    const name = `remote-${index}-${basename(decode(target.pathname)).replace(/[^\w.-]+/g, '-').replace(/\.[^.]*$/, '') || 'image'}${ext}`;
    mkdirSync(join(workDirectory, 'remote'), { recursive: true });
    const path = join(workDirectory, 'remote', name);
    writeFileSync(path, bytes);
    files.set(path, bytes.byteLength);
    destinations.set(reference, 'remote/' + name);
  } catch (error) {
    problems.push(`Remote image could not be downloaded (${error instanceof Error ? error.message : String(error)}): ${reference}`);
  } finally { clearTimeout(timer); }
}

const bodySources = plan.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.source);
let remoteIndex = 0;
for (const reference of bodySources) {
  if (isRemote(reference)) await download(reference, ++remoteIndex);
  else if (/^data:/i.test(reference)) problems.push(`Inline data: images are not supported; save the image as a file: ${reference.slice(0, 40)}…`);
  else { const path = locate(reference, 'Image'); if (path) addImage(path, reference, 'Image'); }
}

// Cover: --cover, then frontmatter, then cover.* beside the article. Otherwise list
// candidates for the agent to confirm with the user; never guess a cover.
let coverInput;
let cover;
let coverCandidates = [];
const frontmatterCover = plan.cover?.source.replace(/^\[\[|\]\]$/g, '');
if (coverOption) {
  const path = locate(coverOption, 'Cover');
  if (path) cover = coverInput = addImage(path, coverOption, 'Cover');
} else if (frontmatterCover) {
  if (isRemote(frontmatterCover)) cover = frontmatterCover;
  else { const path = locate(frontmatterCover, 'Cover'); if (path) cover = coverInput = addImage(path, frontmatterCover, 'Cover'); }
} else {
  const sibling = ['png', 'jpg', 'jpeg', 'webp'].map((extension) => join(articleDirectory, `cover.${extension}`)).find(existsSync);
  if (sibling) cover = coverInput = addImage(sibling, basename(sibling), 'Cover');
  else {
    // Only the folders holding this article's own images: a shared assets tree has other articles' covers.
    const near = new Set([...files.keys()].map(dirname).filter((directory) => !directory.startsWith(workDirectory)));
    coverCandidates = [...near].flatMap((directory) => listImages(directory, 0))
      .filter((path) => /cover/i.test(basename(path)) && !files.has(path));
    notes.push(coverCandidates.length
      ? `No cover set. Possible covers found: ${coverCandidates.join(', ')}. Confirm with the user, then re-run with --cover <path>.`
      : 'No cover: none in frontmatter, no cover.png/jpg/webp beside the article, and no file named *cover* in the article’s image folders. Ask the user whether to add one with --cover.');
  }
}

const bodyImages = [...files.keys()].filter((path) => path !== coverInput);
// The website matches selected files to Markdown paths by file name.
const names = new Map();
for (const path of bodyImages) {
  const name = basename(path);
  if (names.has(name)) problems.push(`Two images share the file name ${name}; rename one: ${names.get(name)} and ${path}`);
  names.set(name, path);
}
if (bodyImages.length > MAX_IMAGES) problems.push(`The article has ${bodyImages.length} local images; the limit is ${MAX_IMAGES}.`);
if ([...files.values()].reduce((total, size) => total + Math.min(size, MAX_IMAGE_BYTES), 0) > MAX_TOTAL_BYTES) problems.push('Images total more than 20 MiB after downscaling.');

// The website loads a temporary copy only when the text had to change; the user's file is never edited.
let loaded = articlePath;
if (transforms.length || destinations.size) {
  const rewritten = destinations.size ? rewriteImageDestinations(markdown, destinations) : markdown;
  loaded = join(workDirectory, basename(articlePath));
  writeFileSync(loaded, rewritten);
  if (destinations.size) transforms.push(`${destinations.size} remote image(s) downloaded`);
}

const result = { article: articlePath, loaded, url, images: bodyImages, cover: cover ?? null, coverCandidates, transforms, problems, warnings, notes };
if (!problems.length) {
  const template = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
  const config = JSON.stringify({ url, files: [loaded, ...bodyImages], coverInput: coverInput ?? null, expectsCover: Boolean(cover) });
  writeFileSync(join(workDirectory, 'create.js'), template('./create.template.js').replace('__CONFIG__', () => config));
  writeFileSync(join(workDirectory, 'wait.js'), template('./wait.template.js'));
  result.create = join(workDirectory, 'create.js');
  result.wait = join(workDirectory, 'wait.js');
}
console.log(JSON.stringify(result, null, 2));
process.exit(problems.length ? 1 : 0);
