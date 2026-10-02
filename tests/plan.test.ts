import { describe, expect, it } from 'vitest';
import { markdownToContentState } from '@kaitox/x-article';
import { createPlan, shellPipeLines } from '../src/plan';
import { rewriteImageDestinations } from '../src/portable';
import { simplifyNestedLists } from '../src/normalize';

describe('Markdown to X preparation plan', () => {
  it('keeps tables native while turning Mermaid into an image at its original position', () => {
    const md = '# 标题 🚀\n\nBefore\n\n![Photo](./photo.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\ngraph LR\n A-->B\n```\n\nAfter';
    const plan = createPlan(md);
    expect(plan.title).toBe('标题 🚀');
    expect(plan.counts).toEqual({ images: 1, tables: 1, mermaid: 1 });
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(plan.assets.map((a) => a.kind)).toEqual(['image', 'mermaid']);
    const state = markdownToContentState(plan.markdown, Object.fromEntries(plan.assets.map((a, i) => [a.source, String(i + 1)]))).contentState;
    expect(state.entity_map.filter((e) => e.value.type === 'MEDIA')).toHaveLength(2);
    expect(state.entity_map.find((e) => e.value.type === 'MARKDOWN')?.value.data).toMatchObject({ markdown: expect.stringContaining('| A | B |') });
    expect(state.blocks.at(-1)?.text).toBe('After');
    expect(plan.markdown.indexOf('studio-asset://mermaid')).toBeGreaterThan(plan.markdown.indexOf('| A | B |'));
  });

  it('makes table-image loss explicit and removes its native-table payload', () => {
    const plan = createPlan('# Title\n\n| Name | Cost |\n| --- | --- |\n| One | $10 |', 'image');
    expect(plan.assets.map((a) => a.kind)).toEqual(['table']);
    expect(plan.assets[0].rows).toEqual([['One', '$10']]);
    expect(plan.markdown).not.toContain('| Name |');
    expect(plan.issues.some((i) => i.id === 'table-image' && i.severity === 'warning')).toBe(true);
  });

  it('retains reference definitions and resolves reference images after transformation', () => {
    const md = '# Reference test\n\n[Example][site]\n\n![Photo][pic]\n\n[site]: https://example.com\n[pic]: ./images/photo.png\n';
    const plan = createPlan(md);
    expect(plan.markdown).toContain('[site]: https://example.com');
    expect(plan.markdown).toContain('[pic]: ./images/photo.png');
    expect(plan.assets[0].source).toBe('./images/photo.png');
    const result = markdownToContentState(plan.markdown, { './images/photo.png': '123' });
    expect(result.skippedImages).toEqual([]);
    expect(result.contentState.entity_map.some((e) => e.value.type === 'LINK' && e.value.data.url === 'https://example.com')).toBe(true);
  });

  it('deduplicates image bytes to prepare without losing repeated placements', () => {
    const plan = createPlan('# Repeated\n\n![A](a.png)\n\nMiddle\n\n![B](a.png)');
    expect(plan.assets).toHaveLength(1);
    const result = markdownToContentState(plan.markdown, { 'a.png': '99' });
    expect(result.contentState.entity_map.filter((e) => e.value.type === 'MEDIA')).toHaveLength(2);
  });

  it.each([
    ['- Parent\n  - Child', 'nested-list'],
    ['<div>Do not lose this</div>', 'html'],
    ['- Item\n\n  ```js\n  lost()\n  ```', 'list-block'],
    ['- First paragraph\n\n  Second paragraph', 'list-paragraphs'],
    ['A note[^1]\n\n[^1]: https://example.com', 'footnote'],
    ['> ```mermaid\n> graph LR\n> A-->B\n> ```', 'nested-mermaid'],
    ['- ![Nested](a.png)', 'nested-image'],
    ['[bad](javascript:alert)', 'link'],
  ])('blocks known lossy or unsafe constructs: %s', (body, expected) => {
    const plan = createPlan('# Title\n\n' + body);
    expect(plan.issues.some((i) => i.id === expected && i.severity === 'error')).toBe(true);
  });

  it('does not treat example syntax inside code as actual images or footnotes', () => {
    const plan = createPlan('# Tutorial\n\n```md\n![example](a.png)\n[^1]\n<div>sample</div>\n```');
    expect(plan.assets).toEqual([]);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('warns about unrendered math without blocking preserved text or code', () => {
    for (const source of ['$$x^2$$', '```latex\nx^2\n```']) {
      const plan = createPlan(source);
      expect(plan.markdown).toBe(source);
      expect(plan.issues.some(i => i.id === 'math' && i.severity === 'warning')).toBe(true);
      expect(plan.issues.filter(i => i.severity === 'error')).toEqual([]);
    }
  });

  it('uses explicit title precedence and reads the frontmatter cover', () => {
    const plan = createPlan('---\ntitle: Metadata title\ncover: cover.png\n---\n# H1\n\nBody.', 'native', 'Chosen title');
    expect(plan.title).toBe('Chosen title');
    expect(plan.markdown).not.toContain('cover:');
    expect(plan.cover).toEqual({ source: 'cover.png', line: 3 });
    expect(plan.assets).toEqual([]);
    expect(createPlan('# No cover').cover).toBeUndefined();
  });

  it('points at shell pipes, the text X’s firewall is known to refuse', () => {
    const source = ['Install it:', '', '| Tool | Command |', '| --- | --- |', '| pi | `curl -fsSL https://example.com/install | sh` |', '', 'wget -qO- https://example.com | sudo bash', 'a | b and a shell script'].join('\n');
    expect(shellPipeLines(source)).toEqual([5, 7]);
  });

  it('accepts body-only documents with editable filename or untitled fallbacks', () => {
    const imported = createPlan('## Section\n\n正文。', 'native', '', 'notes/DESIGN.md');
    expect(imported.title).toBe('DESIGN');
    expect(imported.issues).toEqual([]);
    expect(markdownToContentState(imported.markdown).contentState.blocks.map(b => b.text)).toEqual(['Section', '正文。']);
    expect(createPlan('Body only.').title).toBe('Untitled article');
    expect(createPlan('Body only.', 'native', 'My title', 'DESIGN.md').title).toBe('My title');
    expect(createPlan('# Heading\n\nBody.', 'native', '', 'DESIGN.md').title).toBe('Heading');
  });

  it('normalizes simple HTML without changing literal code or reference definitions', () => {
    const source = '# Title\n\nFirst<br>Second\n\n<!-- private note -->\n\n`<br>`\n\n```html\n<!-- literal -->\n<br>\n```\n\n[Link][ref]\n\n[ref]: https://example.com';
    const plan = createPlan(source);
    expect(plan.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(plan.markdown).toContain('First  \nSecond');
    expect(plan.markdown).not.toContain('private note');
    expect(plan.markdown).toContain('`<br>`');
    expect(plan.markdown).toContain('<!-- literal -->\n<br>');
    expect(plan.markdown).toContain('[ref]: https://example.com');
  });

  it('keeps issue lines tied to the source after HTML normalization and frontmatter', () => {
    const source = '---\ntitle: Title\n---\n\nFirst<br>Second<br/>Third\n\n<div>Unsupported</div>';
    expect(createPlan(source).issues.find(i => i.id === 'html')?.line).toBe(7);
  });

  it('offers an explicit list conversion that keeps every nested item and inline format', () => {
    const source = '# Title\n\n- Parent **bold**\n  - Child [link](https://example.com)\n    1. Grandchild\n- Last\n\nAfter.';
    expect(createPlan(source).issues.some(i => i.id === 'nested-list')).toBe(true);
    const simplified = simplifyNestedLists(source);
    expect(simplified).toContain('Parent **bold**');
    expect(simplified).toContain('Child [link](https://example.com)');
    const plan = createPlan(simplified);
    expect(plan.issues.filter(i => i.severity === 'error')).toEqual([]);
    expect(markdownToContentState(plan.markdown).contentState.blocks.map(b => b.text)).toEqual([
      'Parent bold', 'Child link', 'Grandchild', 'Last', 'After.',
    ]);
  });

  it('does not rewrite code examples or complex list blocks when simplifying lists', () => {
    const source = '# Title\n\n```md\n- Parent\n  - Child\n```\n\n- Parent\n  - Child\n\n  ```js\n  work()\n  ```';
    expect(simplifyNestedLists(source)).toBe(source);
  });

  it('preserves frontmatter and link definitions during explicit list conversion', () => {
    const header = '---\ntitle: Example\ntags:\n  - Parent\n    - Child\n---\n';
    const result = simplifyNestedLists(header + '\n- Parent\n  - [Child][ref]\n\n[ref]: https://example.com');
    expect(result.startsWith(header)).toBe(true);
    expect(result).toContain('[ref]: https://example.com');
    expect(createPlan(result).issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('requires body text or an actual media block', () => {
    expect(createPlan('# Only a title').issues.some((i) => i.id === 'body')).toBe(true);
    expect(createPlan('# Image article\n\n![A](a.png)').issues.some((i) => i.id === 'body')).toBe(false);
  });
});

describe('portable Markdown export', () => {
  it('changes only real image destinations, including reference-style images', () => {
    const md = '# Title\n\nKeep photo.png in prose.\n\n![A](photo.png)\n\n![B][ref]\n\n[ref]: photo.png\n\n```md\n![A](photo.png)\n```';
    const out = rewriteImageDestinations(md, new Map([['photo.png', 'assets/photo-123.png']]));
    expect(out).toContain('Keep photo.png in prose.');
    expect(out).toContain('![A](<assets/photo-123.png>)');
    expect(out).toContain('![B](<assets/photo-123.png>)');
    expect(out).toContain('```md\n![A](photo.png)\n```');
  });
});
