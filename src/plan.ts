import { marked, type Token, type Tokens } from 'marked';
import { markdownToContentState, parseFrontmatter } from '@kaitox/x-article';
import type { ArticlePlan, AssetSpec, Issue, TableMode } from './types';
import { normalizeSimpleHtml } from './normalize';

export const MAX_MARKDOWN_LENGTH = 200_000;

export function createPlan(source: string, tableMode: TableMode = 'native', titleOverride = '', documentPath = ''): ArticlePlan {
  source = source.replace(/\r\n?/g, '\n');
  const parsed = parseFrontmatter(source);
  const { fields } = parsed;
  const normalized = normalizeSimpleHtml(parsed.body);
  const body = normalized.markdown;
  const frontmatterLines = source.slice(0, source.length - parsed.body.length).split('\n').length - 1;
  const tokens = marked.lexer(body);
  const issues: Issue[] = [];
  const assets: AssetSpec[] = [];
  const counts = { images: 0, tables: 0, mermaid: 0 };
  let offset = 0;
  let markdown = '';
  let nativeMarkdownLength = 0;
  let h1Count = 0;
  const add = (id: string, severity: Issue['severity'], message: string, line: number) => {
    if (!issues.some((i) => i.id === id && i.line === line)) issues.push({ id, severity, message, line });
  };
  const imageSources = new Set<string>();
  const scan = (token: Token, line: number, context: string[] = []) => {
    if (token.type === 'html') add('html', 'error', 'Rewrite raw HTML as Markdown; the X converter cannot preserve it.', line);
    if (context.includes('list') && ['code', 'heading', 'blockquote', 'hr'].includes(token.type) && !(token.type === 'code' && /^mermaid(?:\s|$)/i.test((token as Tokens.Code).lang || ''))) add('list-block', 'error', 'Move this block out of the list; the converter only preserves text within list items.', line);
    if (token.type === 'list') {
      const list = token as Tokens.List;
      if (context.includes('list')) add('nested-list', 'error', 'Nested list items would be omitted. Convert them to one level before creating the draft.', line);
      if (list.items.some((item) => item.task)) add('task-list', 'warning', 'Task checkboxes become ordinary bullet points.', line);
      if (list.items.some((item) => item.tokens.filter((child) => ['text', 'paragraph'].includes(child.type)).length > 1)) add('list-paragraphs', 'error', 'Use one paragraph per list item; this converter joins multiple paragraphs without preserving their separation.', line);
      for (const item of list.items) for (const child of item.tokens) scan(child, line, [...context, 'list']);
      return;
    }
    if (token.type === 'image') {
      const image = token as Tokens.Image;
      if (context.some((c) => ['list', 'heading', 'blockquote', 'strong', 'em', 'link', 'table'].includes(c))) {
        add('nested-image', 'error', 'Move this image into its own paragraph so its position is preserved.', line);
      }
      if (!imageSources.has(image.href)) {
        imageSources.add(image.href);
        counts.images++;
        assets.push({ id: `image-${counts.images}`, source: image.href, label: image.text || `Image ${counts.images}`, kind: 'image', line });
      }
    }
    if (token.type === 'link' && !/^(https?:\/\/|mailto:|#)/i.test((token as Tokens.Link).href)) add('link', 'error', 'Use an absolute HTTPS/HTTP link. Relative and executable links cannot be transferred.', line);
    if (token.type === 'codespan' && !context.includes('table')) add('inline-code', 'warning', 'Inline code keeps its text, but loses its monospace styling in X.', line);
    if (token.type === 'heading') {
      const depth = (token as Tokens.Heading).depth;
      if (depth === 1 && ++h1Count > 1) add('extra-h1', 'warning', 'Only the first H1 becomes the article title; this heading stays in the body.', line);
      if (depth > 3) add('heading-depth', 'warning', 'This bridge maps H4–H6 to the same subheading level as H3.', line);
    }
    if (token.type === 'code') {
      const lang = ((token as Tokens.Code).lang || '').trim().split(/\s/)[0].toLowerCase();
      if (lang !== 'mermaid') nativeMarkdownLength += token.raw.length;
      if (lang === 'mermaid' && context.length) add('nested-mermaid', 'error', 'Move Mermaid out of the list or quote into a standalone code fence.', line);
      if (lang === 'latex' || lang === 'math') add('math', 'warning', 'Formulas stay as code. Use an image if you need rendered notation.', line);
      return;
    }
    if (token.type === 'table') {
      if (context.length) add('nested-table', 'error', 'Move the table into a standalone block before preparing.', line);
      const table = token as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) for (const child of cell.tokens) scan(child, line, [...context, 'table']);
      return;
    }
    if ((token.type === 'text' || token.type === 'link') && /\[\^[^\]]+\]/.test(token.raw)) add('footnote', 'error', 'Footnotes need to be rewritten as ordinary links or endnotes.', line);
    if (token.type === 'text' && /\$\$|\\\(|\\\[/.test(token.raw)) add('math', 'warning', 'Formulas stay as plain text. Use an image if you need rendered notation.', line);
    if ('tokens' in token && Array.isArray(token.tokens)) for (const child of token.tokens) scan(child, line, [...context, token.type]);
  };

  for (const token of tokens) {
    // Marked stores reference definitions separately, so do not rebuild a whole
    // document by joining token.raw: keep the untouched gaps between tokens.
    const found = body.indexOf(token.raw, offset);
    const start = found < 0 ? offset : found;
    const line = parsed.body.slice(0, normalized.originalOffset(start)).split('\n').length + frontmatterLines;
    scan(token, line);
    let replacement = token.raw;
    if (token.type === 'code' && (token.lang || '').trim().split(/\s/)[0].toLowerCase() === 'mermaid') {
      const id = `mermaid-${++counts.mermaid}`;
      const src = `studio-asset://${id}.png`;
      assets.push({ id, source: src, label: `Diagram ${counts.mermaid}`, kind: 'mermaid', line, code: token.text });
      replacement = `\n![Diagram ${counts.mermaid}](${src})\n\n`;
    } else if (token.type === 'table') {
      const table = token as Tokens.Table;
      counts.tables++;
      if (tableMode === 'image') {
        const id = `table-${counts.tables}`;
        const src = `studio-asset://${id}.png`;
        assets.push({ id, source: src, label: `Table ${counts.tables}`, kind: 'table', line, headers: table.header.map((c) => c.text), rows: table.rows.map((r) => r.map((c) => c.text)) });
        replacement = `\n![Table ${counts.tables}](${src})\n\n`;
        add('table-image', 'warning', 'Table exported as an image: cells and links will no longer be selectable or editable in X.', line);
      } else nativeMarkdownLength += token.raw.length;
    }
    markdown += body.slice(offset, start) + replacement;
    offset = start + token.raw.length;
  }
  markdown += body.slice(offset);
  const coverLine = fields.cover ? source.split('\n').slice(0, frontmatterLines).findIndex((text) => /^cover\s*:/.test(text)) + 1 : 0;
  const cover = fields.cover ? { source: fields.cover, line: coverLine || 1 } : undefined;
  const converted = markdownToContentState(markdown);
  const filename = documentPath.split(/[\\/]/).pop()?.replace(/\.(md|markdown|mdown)$/i, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 2_000);
  const title = titleOverride.trim() || fields.title?.trim() || converted.title || filename || 'Untitled article';
  if (title.length > 2_000 || /[\u0000-\u001f\u007f]/.test(title)) add('title-format', 'error', 'Use a single-line title of at most 2,000 characters.', 1);
  if (source.length > MAX_MARKDOWN_LENGTH) add('length', 'error', 'Split this document into articles of at most 200,000 characters.', 1);
  if (nativeMarkdownLength > 10_000) add('markdown-limit', 'error', 'Code and tables exceed this app’s 10,000-character limit. Shorten them or switch Tables to PNG images.', 1);
  if (assets.length > 40) add('asset-count', 'error', 'Split the article or remove images to stay within this app’s 40-image limit (including tables and diagrams).', 1);
  // The downstream converter only supports block-level images. Compare against
  // its actual entities so unusual nested constructions never disappear silently.
  const placeholders = Object.fromEntries(assets.map((a, i) => [a.source, String(i + 1)]));
  const probe = markdownToContentState(markdown, placeholders);
  if (!body.trim() || probe.contentState.blocks.every((b) => !b.text.trim() && b.type !== 'atomic')) add('body', 'error', 'Add body text or an image to the article.', 1);
  const resolved = new Set(probe.contentState.entity_map.flatMap((e) => e.value.type === 'MEDIA' ? e.value.data.media_items.map((m) => m.media_id) : []));
  for (const [i, asset] of assets.entries()) if (!resolved.has(String(i + 1)) && !issues.some(issue => issue.id === 'nested-image' && issue.line === asset.line)) add(`unused-${asset.id}`, 'error', `“${asset.label}” cannot be placed here. Move it into a standalone paragraph.`, asset.line);
  const wordCount = (body.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  return { title, markdown, assets, issues, counts, wordCount, cover };
}

/**
 * Lines with a command piped into a shell, the one pattern seen to make X's
 * firewall refuse an article. Used to point at likely causes after such a refusal.
 */
export function shellPipeLines(source: string, limit = 5): number[] {
  const lines: number[] = [];
  source.split(/\r\n?|\n/).forEach((text, index) => {
    if (lines.length < limit && /\|\s*(?:sudo\s+)?(?:ba|z|da|fi|k)?sh\b/.test(text)) lines.push(index + 1);
  });
  return lines;
}

export function safeFileStem(title: string): string {
  return title.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'article';
}
