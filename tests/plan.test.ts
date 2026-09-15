import { describe, expect, it } from 'vitest';
import { markdownToContentState } from '@kaitox/x-article';
import { createPlan } from '../src/plan';
import { rewriteImageDestinations } from '../src/portable';

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
    ['Before<br>After', 'html'],
    ['- Item\n\n  ```js\n  lost()\n  ```', 'list-block'],
    ['- First paragraph\n\n  Second paragraph', 'list-paragraphs'],
    ['A note[^1]\n\n[^1]: https://example.com', 'footnote'],
    ['> ```mermaid\n> graph LR\n> A-->B\n> ```', 'nested-mermaid'],
    ['- ![Nested](a.png)', 'nested-image'],
    ['[bad](javascript:alert)', 'link'],
    ['$$x^2$$', 'math'],
  ])('blocks known lossy or unsafe constructs: %s', (body, expected) => {
    const plan = createPlan('# Title\n\n' + body);
    expect(plan.issues.some((i) => i.id === expected && i.severity === 'error')).toBe(true);
  });

  it('does not treat example syntax inside code as actual images or footnotes', () => {
    const plan = createPlan('# Tutorial\n\n```md\n![example](a.png)\n[^1]\n<div>sample</div>\n```');
    expect(plan.assets).toEqual([]);
    expect(plan.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('uses explicit title precedence and warns about the unimplemented cover', () => {
    const plan = createPlan('---\ntitle: Metadata title\ncover: cover.png\n---\n# H1\n\nBody.', 'native', 'Chosen title');
    expect(plan.title).toBe('Chosen title');
    expect(plan.markdown).not.toContain('cover:');
    expect(plan.issues.some((i) => i.id === 'cover')).toBe(true);
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
