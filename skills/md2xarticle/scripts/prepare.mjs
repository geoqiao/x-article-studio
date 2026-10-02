#!/usr/bin/env node
// Checks a Markdown article's local images and cover, then writes the playwright-cli
// scripts that load it into Article Studio and create the X draft. No dependencies.
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 40;
const SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const coverOption = option('--cover');
const url = option('--url') ?? 'https://md2xarticle.com/';
const articlePath = args[0] && resolve(args[0]);
if (!articlePath || !existsSync(articlePath)) {
  console.error('Usage: prepare.mjs <article.md> [--cover <image>] [--url <Article Studio URL>]');
  process.exit(2);
}

const source = readFileSync(articlePath, 'utf8');
const articleDirectory = dirname(articlePath);
const problems = [];
const notes = [];

const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)?.[1] ?? '';
const frontmatterCover = /^cover\s*:\s*(.+)$/m.exec(frontmatter)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');

// Image destinations outside fenced code, as the website reads them.
const references = [];
let fence;
for (const line of source.split(/\r?\n/)) {
  const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if (marker) {
    if (!fence) fence = marker[0];
    else if (marker[0] === fence) fence = undefined;
    continue;
  }
  if (fence) continue;
  for (const match of line.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+["'][^)]*["'])?\s*\)/g)) references.push(match[1] ?? match[2]);
}

const isRemote = (value) => /^(?:https?:)?\/\//i.test(value) || /^data:/i.test(value);
const toPath = (value) => {
  let decoded = value;
  try { decoded = decodeURI(value); } catch { /* keep the literal path */ }
  if (decoded.startsWith('file://')) return fileURLToPath(decoded);
  return isAbsolute(decoded) ? decoded : resolve(articleDirectory, decoded);
};

const files = new Map(); // absolute path → size
function addImage(reference, role) {
  const path = toPath(reference);
  if (!existsSync(path)) return problems.push(`${role} not found: ${reference}`), undefined;
  if (!SUPPORTED.has(extname(path).toLowerCase())) return problems.push(`${role} must be PNG, JPEG or WebP; convert it first: ${reference}`), undefined;
  const { size } = statSync(path);
  if (size > MAX_IMAGE_BYTES) return problems.push(`${role} is over 5 MiB; resize or recompress it: ${reference}`), undefined;
  files.set(path, size);
  return path;
}

for (const reference of new Set(references)) if (!isRemote(reference)) addImage(reference, 'Image');
if (references.some(isRemote)) notes.push('Remote images are fetched by the website and need CORS permission from their host.');

// Cover: --cover, then frontmatter, then a cover.* file beside the article.
let coverInput;
let cover;
if (coverOption) {
  cover = coverInput = addImage(coverOption, 'Cover');
} else if (frontmatterCover) {
  cover = isRemote(frontmatterCover) ? frontmatterCover : addImage(frontmatterCover, 'Cover');
} else {
  const sibling = ['png', 'jpg', 'jpeg', 'webp'].map((extension) => join(articleDirectory, `cover.${extension}`)).find(existsSync);
  if (sibling) cover = coverInput = addImage(sibling, 'Cover');
  else notes.push('No cover: none in frontmatter and no cover.png/jpg/webp beside the article.');
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
if ([...files.values()].reduce((total, size) => total + size, 0) > MAX_TOTAL_BYTES) problems.push('Images total more than 20 MiB.');

const result = { article: articlePath, url, images: bodyImages, cover: cover ?? null, problems, notes };
if (!problems.length) {
  const directory = mkdtempSync(join(tmpdir(), 'md2xarticle-'));
  const template = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
  const config = JSON.stringify({ url, files: [articlePath, ...bodyImages], coverInput: coverInput ?? null, expectsCover: Boolean(cover) });
  writeFileSync(join(directory, 'create.js'), template('./create.template.js').replace('__CONFIG__', () => config));
  writeFileSync(join(directory, 'wait.js'), template('./wait.template.js'));
  result.create = join(directory, 'create.js');
  result.wait = join(directory, 'wait.js');
}
console.log(JSON.stringify(result, null, 2));
process.exit(problems.length ? 1 : 0);
