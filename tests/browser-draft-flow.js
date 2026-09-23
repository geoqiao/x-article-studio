// Run with playwright-cli in an isolated browser against a local build.
// The companion is mocked; no requests or drafts are sent to X.
async page => {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const source = () => page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const draft = () => page.getByRole('button', { name: 'Create X draft', exact: true });
  const ready = () => page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Create X draft'));
    return button && !button.disabled;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start new article', exact: true }).click();
  await source().fill('## Section\n\nBody without a level-one heading.');
  await ready();
  assert(await page.getByLabel('Article title', { exact: true }).inputValue() === 'Untitled article', 'Missing fallback title');
  await page.getByLabel('Article title', { exact: true }).fill('Editable title');
  await ready();
  await page.evaluate(() => {
    window.__staged = [];
    window.__mockCompanion = event => {
      const request = event.data;
      if (request?.source !== 'md2x-article-studio' || request.type !== 'request') return;
      if (request.action === 'stage') window.__staged.push(request.bundle);
      window.postMessage({ source: request.source, version: 1, type: 'response',
        requestId: request.requestId, action: request.action, ok: true,
        data: request.action === 'status' ? { available: true, version: 'test' }
          : { reviewOpened: true, jobId: request.bundle.jobId } }, location.origin);
    };
    window.addEventListener('message', window.__mockCompanion);
  });
  await draft().click();
  await page.waitForFunction(() => window.__staged.length === 1);
  const staged = await page.evaluate(() => window.__staged[0]);
  assert(staged.title === 'Editable title' && staged.markdown.includes('Body without'), 'Fallback title/body failed companion handoff');
  await page.evaluate(() => window.removeEventListener('message', window.__mockCompanion));
  results.push('No H1 required; visible title and body reach the mocked companion');

  await page.getByLabel('Import Markdown file', { exact: true }).setInputFiles('tests/fixtures/body-only.md');
  await ready();
  assert(await page.getByLabel('Article title', { exact: true }).inputValue() === 'body-only', 'Filename not used as title');
  await source().fill('First<br>Second\n\n<!-- hidden note -->\n\nLast.');
  await ready();
  const preview = await page.locator('.rendered-article').innerText();
  assert(preview.includes('First') && preview.includes('Second') && !preview.includes('hidden note'), 'Safe HTML normalization failed');
  assert((await source().inputValue()).includes('<!-- hidden note -->'), 'Normalization rewrote the original source');
  results.push('Filename fallback, line breaks and comments work without blockers');

  await source().fill('- Parent **bold**\n  - Child [link](https://example.com)\n    - Grandchild\n- Last');
  await page.getByRole('button', { name: 'Convert to one level', exact: true }).waitFor();
  assert(await draft().isDisabled(), 'Lossy nested list was allowed');
  await page.getByRole('button', { name: 'Convert to one level', exact: true }).click();
  await ready();
  const items = await page.locator('.rendered-article li').allTextContents();
  assert(items.join('|') === 'Parent bold|Child link|Grandchild|Last', `Nested content lost: ${items}`);
  assert(await page.locator('.rendered-article li strong').count() === 1, 'List conversion lost inline formatting');
  results.push('Explicit flatten preserves every nested item and inline formatting');

  await source().fill('Body remains usable.\n\n![Missing](not-selected.png)');
  await page.getByRole('button', { name: 'Match image folder', exact: true }).waitFor();
  assert(await draft().isDisabled(), 'Incomplete media can create a draft');
  assert(await page.getByRole('button', { name: 'Copy body', exact: true }).isEnabled(), 'Missing media blocked body copy');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy body', exact: true }).click();
  await page.getByRole('button', { name: 'Copied!', exact: true }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('Body remains usable.') && copied.includes('[Image: Missing — add from the Images panel]'), `Missing image marker: ${copied}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  assert((await download).suggestedFilename().endsWith('-source-backup.zip'), 'Incomplete export not identified as source backup');
  results.push('Missing images block only handoff; body copy and source backup remain available');

  await page.route('https://images.example.test/blocked.png', route => route.abort('accessdenied'));
  await source().fill('Body.\n\n![Remote](https://images.example.test/blocked.png)');
  await page.locator('.preview-alert').getByText(/CORS/).waitFor();
  assert(await page.getByRole('button', { name: 'Match image folder', exact: true }).count() === 0, 'Remote download failure mislabeled as missing file');
  results.push('Remote failures retain download guidance instead of missing-file instructions');

  const lines = Array.from({ length: 90 }, (_, i) => i % 3 === 0 ? `Line ${i + 1}: ` + 'wrapped words 中文 '.repeat(12) : `Line ${i + 1}`);
  lines.push('', '<div>Unsupported block</div>', '', '- Parent', '  - Child');
  await source().fill(lines.join('\n'));
  await page.getByRole('button', { name: 'Line 92 · Go to line', exact: true }).waitFor();
  assert(await page.locator('.blocking-issue').count() === 2, 'Not all blockers are visible');
  assert(await page.locator('.line-gutter span').count() === lines.length, 'Logical line numbers are incomplete');
  await page.getByRole('button', { name: 'Line 92 · Go to line', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.line-gutter .highlighted-line')?.textContent === '92');
  const position = await source().evaluate(el => {
    const gutter = document.querySelector('.line-gutter');
    const label = gutter.querySelector('.highlighted-line');
    const box = label.getBoundingClientRect();
    const area = el.getBoundingClientRect();
    return { selected: el.value.slice(el.selectionStart, el.selectionEnd), top: el.scrollTop,
      gutterTop: gutter.scrollTop, visible: box.top >= area.top && box.bottom <= area.bottom };
  });
  assert(position.selected === '<div>Unsupported block</div>' && position.visible, `Line jump failed: ${JSON.stringify(position)}`);
  assert(Math.abs(position.top - position.gutterTop) < 2, 'Gutter scroll diverged');
  const heights = await page.evaluate(() => ({
    gutter: document.querySelector('.line-gutter').scrollHeight,
    source: document.querySelector('textarea').scrollHeight,
  }));
  assert(Math.abs(heights.gutter - heights.source) < 3, `Wrapped line alignment drifted: ${JSON.stringify(heights)}`);
  await page.screenshot({ path: '/tmp/article-flow-errors-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '2 items to fix', exact: true }).click();
  assert(await page.locator('#draft-issues').isVisible(), 'Mobile draft issues cannot be reached');
  await page.getByRole('button', { name: 'Line 92 · Go to line', exact: true }).click();
  assert(await source().isVisible(), 'Mobile jump did not switch to editor');
  await page.waitForFunction(() => document.querySelector('.line-gutter .highlighted-line')?.textContent === '92');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow');
  await page.screenshot({ path: '/tmp/article-flow-line-mobile.png' });
  results.push('All blockers visible; wrapped line gutter, late-line jumps and mobile navigation verified');
  await page.setViewportSize({ width: 1440, height: 1000 });
  return results;
}
