import { marked, type Token, type Tokens } from 'marked';
import { parseFrontmatter } from '@kaitox/x-article';

type Edit = { start: number; end: number; text: string };
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|svg)$/i;

/**
 * Lines of a document that are inside a fenced code block (1-based, ascending).
 * Shared by the text-level scans so examples inside code are never rewritten.
 */
export function fencedLines(source: string): Set<number> {
  const lines = new Set<number>();
  let fence: string | undefined;
  source.split('\n').forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      lines.add(index + 1);
      fence = fence ? undefined : marker;
      return;
    }
    if (fence) lines.add(index + 1);
  });
  return lines;
}

/** Inline matches outside fenced code and code spans: [match, offset, line]. */
function scanText(source: string, pattern: RegExp): Array<{ match: RegExpExecArray; offset: number; line: number }> {
  const results: Array<{ match: RegExpExecArray; offset: number; line: number }> = [];
  const fenced = fencedLines(source);
  let offset = 0;
  source.split('\n').forEach((text, index) => {
    if (!fenced.has(index + 1)) {
      const scanner = new RegExp('(`+)[\\s\\S]*?\\1|' + pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      for (const match of text.matchAll(scanner)) {
        if (match[1] !== undefined) continue;
        const inner = new RegExp(pattern.source, pattern.flags.replace('g', ''));
        const exact = inner.exec(match[0]);
        if (exact) results.push({ match: exact, offset: offset + (match.index ?? 0), line: index + 1 });
      }
    }
    offset += text.length + 1;
  });
  return results;
}

const EMBED = /!\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/;
const WIKILINK = /(?<!!)\[\[([^\]\n]+?)\]\]|!\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/;

/** Obsidian image embeds, rewritten as ordinary Markdown images so they resolve like any other picture. */
function embedEdits(source: string): Edit[] {
  return scanText(source, EMBED).flatMap(({ match, offset }) => {
    const target = match[1].trim();
    if (!IMAGE_EXTENSION.test(target)) return [];
    const modifier = match[2]?.trim() ?? '';
    // Obsidian uses the modifier for a display width (300 or 300x200) or an alt text.
    const alt = /^\d+(?:x\d+)?$/.test(modifier) || !modifier ? target.split('/').pop()!.replace(IMAGE_EXTENSION, '') : modifier;
    const label = alt.replace(/[\[\]\\]/g, '');
    return [{ start: offset, end: offset + match[0].length, text: '![' + label + '](<' + target.replace(/[<>]/g, '') + '>)' }];
  });
}

/** Lines with Obsidian [[wikilinks]] or non-image ![[embeds]] that would reach X as literal text. */
export function wikilinkLines(source: string): number[] {
  const lines = new Set<number>();
  for (const { match, line } of scanText(source, WIKILINK)) {
    const embed = match[2];
    if (embed !== undefined && IMAGE_EXTENSION.test(embed.trim())) continue;
    lines.add(line);
  }
  return [...lines];
}

// Only touch parsed HTML tokens, never literal examples in code or URLs.
export function normalizeSimpleHtml(source: string) {
  const edits: Edit[] = embedEdits(source);
  function visit(tokens: Token[], raw: string, base: number, inTable = false) {
    let cursor = 0;
    for (const token of tokens) {
      const offset = raw.indexOf(token.raw, cursor);
      if (offset < 0) continue;
      cursor = offset + token.raw.length;
      const start = base + offset;
      if (token.type === 'html') {
        if (/^(?:<!--(?:(?!-->)[\s\S])*-->\s*)+$/.test(token.raw)) {
          edits.push({ start, end: start + token.raw.length, text: token.raw.replace(/[^\n]/g, '') });
        } else if (!inTable && /^<br\s*\/?>\s*$/i.test(token.raw)) {
          edits.push({ start, end: start + token.raw.length, text: token.raw.replace(/<br\s*\/?>/i, '  \n') });
        }
      } else if (token.type === 'list') {
        visit(token.items, token.raw, start, inTable);
      } else if (token.type === 'table') {
        visit([...token.header, ...token.rows.flat()].flatMap(cell => cell.tokens), token.raw, start, true);
      } else if ('tokens' in token && Array.isArray(token.tokens)) {
        visit(token.tokens, token.raw, start, inTable);
      }
    }
  }
  visit(marked.lexer(source), source, 0);
  edits.sort((a, b) => a.start - b.start);
  let cursor = 0;
  let markdown = '';
  const shifts: { start: number; end: number; original: number; delta: number }[] = [];
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    markdown += source.slice(cursor, edit.start);
    shifts.push({ start: markdown.length, end: markdown.length + edit.text.length,
      original: edit.start, delta: edit.text.length - (edit.end - edit.start) });
    markdown += edit.text;
    cursor = edit.end;
  }
  markdown += source.slice(cursor);
  return {
    markdown,
    originalOffset(offset: number) {
      let delta = 0;
      for (const shift of shifts) {
        if (offset < shift.start) break;
        if (offset < shift.end) return shift.original;
        delta += shift.delta;
      }
      return offset - delta;
    },
  };
}

function canFlatten(list: Tokens.List): boolean {
  return list.items.every(item => item.tokens.every(token =>
    ['text', 'paragraph', 'space'].includes(token.type) ||
    (token.type === 'list' && canFlatten(token as Tokens.List))));
}

function flatten(list: Tokens.List): string {
  return list.items.map((item, index) => {
    const marker = list.ordered ? (Number(list.start) + index) + '.' : '-';
    const task = item.task ? '[' + (item.checked ? 'x' : ' ') + '] ' : '';
    const parts = item.tokens.filter(token => token.type !== 'space');
    return parts.map((token, part) => {
      if (token.type === 'list') return flatten(token as Tokens.List);
      // Separate paragraphs remain separate items; inline syntax stays intact.
      return marker + ' ' + (part === 0 ? task : '') + token.raw.trim().replace(/\n/g, ' ') + '\n';
    }).join('');
  }).join('');
}

/** An explicit user action: flatten simple lists without dropping child items. */
export function simplifyNestedLists(source: string): string {
  const { body } = parseFrontmatter(source);
  const prefix = source.slice(0, source.length - body.length);
  source = body;
  let cursor = 0;
  let result = '';
  for (const token of marked.lexer(source)) {
    const start = source.indexOf(token.raw, cursor);
    if (start < 0) continue;
    result += source.slice(cursor, start);
    const nested = token.type === 'list' && (token as Tokens.List).items.some(item => item.tokens.some(child => child.type === 'list'));
    result += nested && canFlatten(token as Tokens.List) ? flatten(token as Tokens.List) + '\n' : token.raw;
    cursor = start + token.raw.length;
  }
  return prefix + result + source.slice(cursor);
}

const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/**
 * An explicit user action: turn footnotes into numbered endnotes. References
 * become [n] and the definitions move to the end after a divider, so nothing is
 * lost in a converter that has no footnote support. References without a
 * definition are left untouched and still reported.
 */
export function convertFootnotesToEndnotes(source: string): string {
  const { body } = parseFrontmatter(source);
  const prefix = source.slice(0, source.length - body.length);
  const lines = body.split('\n');
  const fenced = fencedLines(body);
  const definitions = new Map<string, string>();
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const definition = fenced.has(index + 1) ? undefined : FOOTNOTE_DEFINITION.exec(lines[index]);
    if (!definition) { kept.push(lines[index]); continue; }
    const text = [definition[2]];
    // Indented lines continue the note until a blank line or the next definition.
    while (index + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[index + 1]) && !FOOTNOTE_DEFINITION.test(lines[index + 1])) text.push(lines[++index].trim());
    if (!definitions.has(definition[1])) definitions.set(definition[1], text.join(' ').trim());
    // Drop one blank line that separated this definition from the next block.
    if (kept.length && kept[kept.length - 1] === '' && lines[index + 1] === '') index++;
  }
  if (!definitions.size) return source;
  let remaining = kept.join('\n');
  const numbers = new Map<string, number>();
  const edits: Edit[] = [];
  for (const { match, offset } of scanText(remaining, /\[\^([^\]\s]+)\]/)) {
    if (!definitions.has(match[1])) continue;
    if (!numbers.has(match[1])) numbers.set(match[1], numbers.size + 1);
    edits.push({ start: offset, end: offset + match[0].length, text: '[' + numbers.get(match[1]) + ']' });
  }
  for (const id of definitions.keys()) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  let cursor = 0;
  let result = '';
  for (const edit of edits) { result += remaining.slice(cursor, edit.start) + edit.text; cursor = edit.end; }
  remaining = result + remaining.slice(cursor);
  const notes = [...numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id, number]) => '[' + number + '] ' + definitions.get(id)).join('\n\n');
  return prefix + remaining.replace(/\s+$/, '') + '\n\n---\n\n' + notes + '\n';
}
