import { marked, type Token, type Tokens } from 'marked';

/** Rewrite parsed image destinations only; leave matching text/code untouched. */
export function rewriteImageDestinations(markdown: string, destinations: Map<string, string>): string {
  function replaceChildren(raw: string, children: Token[]): string {
    let out = '';
    let cursor = 0;
    for (const child of children) {
      const start = raw.indexOf(child.raw, cursor);
      if (start < 0) continue;
      out += raw.slice(cursor, start) + rewrite(child);
      cursor = start + child.raw.length;
    }
    return out + raw.slice(cursor);
  }
  function rewrite(token: Token): string {
    if (token.type === 'image') {
      const image = token as Tokens.Image;
      const target = destinations.get(image.href);
      if (!target) return token.raw;
      const label = image.text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
      return `![${label}](<${target}>)`;
    }
    if (token.type === 'code' || token.type === 'codespan') return token.raw;
    if ('tokens' in token && Array.isArray(token.tokens)) return replaceChildren(token.raw, token.tokens);
    return token.raw;
  }
  return replaceChildren(markdown, marked.lexer(markdown));
}
