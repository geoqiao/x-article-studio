import { marked, type Token } from 'marked';
import { MERMAID_INIT_CONFIG, renderMermaidPng } from '@kaitox/x-article';

let renderer: Promise<typeof import('mermaid')['default']> | undefined;
let queue = Promise.resolve();

export async function renderDiagram(code: string): Promise<Blob> {
  if (code.length > 30_000) throw new Error('Diagram source is too large. Split it into smaller diagrams.');
  // Mermaid has global configuration and render state. Serialize all invocations,
  // including an outdated preparation that is being replaced by a newer one.
  let release!: () => void;
  const previous = queue;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    renderer ??= import('mermaid').then(({ default: mermaid }) => {
      // Mermaid 11 reads the root htmlLabels (default true) before Kaitox's deprecated
      // flowchart.htmlLabels. HTML labels are sized with wrapping, then rasterized as
      // one unwrapped SVG line that overflows its node and is clipped at the canvas edge.
      mermaid.initialize({ ...MERMAID_INIT_CONFIG, htmlLabels: false, maxTextSize: 30_000, maxEdges: 500, suppressErrorRendering: true });
      return mermaid;
    });
    await document.fonts.ready;
    const result = await renderMermaidPng(await renderer, code);
    return new Blob([new Uint8Array(result.bytes)], { type: result.mimeType });
  } catch (error) {
    const line = error instanceof Error ? /(?:parse error on|syntax error in text.*) line (\d+)/i.exec(error.message)?.[1] : undefined;
    throw new Error(line ? `Mermaid syntax error near diagram line ${line}. Check this code block.` : 'Mermaid could not render. Check the diagram syntax or try a smaller diagram.');
  } finally { release(); }
}

function cellText(source: string): string {
  const walk = (tokens: Token[]): string => tokens.map((token) => {
    if ('tokens' in token && Array.isArray(token.tokens)) return walk(token.tokens);
    if (token.type === 'br') return '\n';
    if (token.type === 'html') return /^<br\s*\/?>/i.test(token.raw) ? '\n' : token.raw;
    return 'text' in token ? token.text : token.raw;
  }).join('');
  return walk(marked.lexer(source)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export async function renderTable(headers: string[], rows: string[][]): Promise<Blob> {
  if (!headers.length || headers.length > 10 || rows.length > 150) throw new Error('For tables over 10 columns or 150 rows, choose Native tables or split the table.');
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable in this browser.');
  const font = '17px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
  ctx.font = font;
  const cells = [headers, ...rows].map((row) => row.map(cellText));
  const widths = headers.map((_, col) => Math.min(330, Math.max(125, ...cells.map((r) => Math.min(280, ctx.measureText(r[col] || '').width) + 34))));
  const total = widths.reduce((a, b) => a + b, 0);
  const scaleWidth = Math.min(1, 1400 / total);
  for (let i = 0; i < widths.length; i++) widths[i] *= scaleWidth;
  const wrap = (text: string, width: number) => {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > width - 30) { lines.push(line); line = char; }
        else line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  const wrapped = cells.map((row) => widths.map((width, i) => wrap(row[i] || '', width)));
  const heights = wrapped.map((row) => Math.max(...row.map((c) => c.length)) * 25 + 28);
  const width = Math.ceil(widths.reduce((a, b) => a + b, 0) + 2);
  const height = heights.reduce((a, b) => a + b, 0) + 2;
  if (height > 7000 || width * height > 6_000_000) throw new Error('This table is too tall for a readable image. Split it or use Native tables.');
  canvas.width = width * 2;
  canvas.height = height * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 1;
  wrapped.forEach((row, ri) => {
    ctx.fillStyle = ri === 0 ? '#e6efeb' : ri % 2 ? '#ffffff' : '#f7f8f5';
    ctx.fillRect(1, y, width - 2, heights[ri]);
    ctx.font = (ri === 0 ? '600 ' : '') + font;
    ctx.fillStyle = '#203c35';
    let x = 1;
    row.forEach((lines, col) => { lines.forEach((line, li) => ctx.fillText(line, x + 15, y + 31 + li * 25)); x += widths[col]; });
    y += heights[ri];
    ctx.strokeStyle = '#d9e2dc'; ctx.beginPath(); ctx.moveTo(1, y); ctx.lineTo(width - 1, y); ctx.stroke();
  });
  ctx.strokeStyle = '#d9e2dc'; ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Table PNG export failed.')), 'image/png'));
}
