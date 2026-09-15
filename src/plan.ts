import { marked, type Token, type Tokens } from 'marked';
import { markdownToContentState, parseFrontmatter } from '@kaitox/x-article';
import type { ArticlePlan, AssetSpec, Issue, TableMode } from './types';

export const MAX_MARKDOWN_LENGTH = 200_000;

export function createPlan(source: string, tableMode: TableMode = 'native', titleOverride = ''): ArticlePlan {
  const { fields, body } = parseFrontmatter(source.replace(/\r\n?/g, '\n'));
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
    if (context.includes('list') && ['code', 'heading', 'blockquote', 'hr'].includes(token.type)) add('list-block', 'error', 'Move this block out of the list; the converter only preserves text within list items.', line);
    if (token.type === 'list') {
      const list = token as Tokens.List;
      if (context.includes('list')) add('nested-list', 'error', 'Flatten nested lists first. This importer would lose the nested items.', line);
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
      if (lang === 'latex' || lang === 'math') add('math', 'error', 'Math rendering is not implemented in this bridge. X’s official API has a separate LaTeX entity.', line);
      return;
    }
    if (token.type === 'table') {
      if (context.length) add('nested-table', 'error', 'Move the table into a standalone block before preparing.', line);
      const table = token as Tokens.Table;
      for (const cell of [...table.header, ...table.rows.flat()]) for (const child of cell.tokens) scan(child, line, [...context, 'table']);
      return;
    }
    if ((token.type === 'text' || token.type === 'link') && /\[\^[^\]]+\]/.test(token.raw)) add('footnote', 'error', 'Footnotes need to be rewritten as ordinary links or endnotes.', line);
    if (token.type === 'text' && /\$\$|\\\(|\\\[/.test(token.raw)) add('math', 'error', 'Math formulas need manual conversion; this version does not render LaTeX.', line);
    if ('tokens' in token && Array.isArray(token.tokens)) for (const child of token.tokens) scan(child, line, [...context, token.type]);
  };

  for (const token of tokens) {
    // Marked stores reference definitions separately, so do not rebuild a whole
    // document by joining token.raw: keep the untouched gaps between tokens.
    const found = body.indexOf(token.raw, offset);
    const start = found < 0 ? offset : found;
    const line = body.slice(0, start).split('\n').length + (source.length - body.length ? source.slice(0, source.length - body.length).split('\n').length - 1 : 0);
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
  if (fields.cover) add('cover', 'warning', 'Frontmatter cover is not imported in this version. Set the cover in X after creating the draft.', 1);
  const converted = markdownToContentState(markdown);
  const title = titleOverride.trim() || fields.title?.trim() || converted.title || '';
  if (!title) add('title', 'error', 'Add an H1 title, frontmatter title, or fill in the title field.', 1);
  if (title.length > 2_000 || /[\u0000-\u001f\u007f]/.test(title)) add('title-format', 'error', 'Use a single-line title of at most 2,000 characters in this version.', 1);
  if (source.length > MAX_MARKDOWN_LENGTH) add('length', 'error', 'This version supports Markdown documents up to 200,000 characters.', 1);
  if (nativeMarkdownLength > 10_000) add('markdown-limit', 'error', 'Code and native-table source exceeds the 10,000-character preflight budget. Shorten it or use table images.', 1);
  if (assets.length > 40) add('asset-count', 'error', 'This version supports up to 40 prepared assets per article.', 1);
  // The downstream converter only supports block-level images. Compare against
  // its actual entities so unusual nested constructions never disappear silently.
  const placeholders = Object.fromEntries(assets.map((a, i) => [a.source, String(i + 1)]));
  const probe = markdownToContentState(markdown, placeholders);
  if (!body.trim() || probe.contentState.blocks.every((b) => !b.text.trim() && b.type !== 'atomic')) add('body', 'error', 'Add some article body content below the title.', 1);
  const resolved = new Set(probe.contentState.entity_map.flatMap((e) => e.value.type === 'MEDIA' ? e.value.data.media_items.map((m) => m.media_id) : []));
  for (const [i, asset] of assets.entries()) if (!resolved.has(String(i + 1))) add(`unused-${asset.id}`, 'error', `“${asset.label}” cannot be placed here. Move it into a standalone paragraph.`, asset.line);
  const wordCount = (body.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  return { title, markdown, assets, issues, counts, wordCount };
}

export function safeFileStem(title: string): string {
  return title.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'article';
}
