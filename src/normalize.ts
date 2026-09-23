import { marked, type Token, type Tokens } from 'marked';
import { parseFrontmatter } from '@kaitox/x-article';

// Only touch parsed HTML tokens, never literal examples in code or URLs.
export function normalizeSimpleHtml(source: string) {
  const edits: { start: number; end: number; text: string }[] = [];
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
    const marker = list.ordered ? `${Number(list.start) + index}.` : '-';
    const task = item.task ? `[${item.checked ? 'x' : ' '}] ` : '';
    const parts = item.tokens.filter(token => token.type !== 'space');
    return parts.map((token, part) => {
      if (token.type === 'list') return flatten(token as Tokens.List);
      // Separate paragraphs remain separate items; inline syntax stays intact.
      return `${marker} ${part === 0 ? task : ''}${token.raw.trim().replace(/\n/g, ' ')}\n`;
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
