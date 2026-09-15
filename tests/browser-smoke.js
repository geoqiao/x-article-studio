// Run against a local build or the standalone HTML in an isolated browser.
// playwright-cli -s=article-studio-ux run-code --filename=tests/browser-smoke.js
// Clipboard checks use this test browser's permissions. No X draft is created.
async page => {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const standalone = await page.locator('html').getAttribute('data-preview') === 'standalone';
  const source = () => page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const ready = () => page.waitForFunction(() => {
    const button = document.querySelector('.output-actions .button-primary');
    return button && !button.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date');
  }, null, { timeout: 30000 });
  const closeDialog = () => page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const loadExample = async () => {
    await page.getByRole('button', { name: 'Example', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Load example', exact: true }).click();
    await ready();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadExample();
  assert(await page.getByRole('button', { name: 'Prepare article', exact: true }).count() === 0, 'Manual preparation still required');
  await page.waitForFunction(() => [...document.querySelectorAll('.xp-img')].length === 2 && [...document.querySelectorAll('.xp-img')].every(i => i.naturalWidth > 0));
  assert(await page.locator('.rendered-article table').count() === 1, 'Native table missing');
  results.push({ automaticPreview: 'sample images, native table, and Mermaid visible without an extra click' });

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy body', exact: true }).click();
  await page.getByRole('button', { name: 'Copied!', exact: true }).waitFor();
  const copiedBody = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const html = await items[0].getType('text/html');
    const plain = await items[0].getType('text/plain');
    return { html: await html.text(), plain: await plain.text() };
  });
  assert(copiedBody.html.includes('<strong>'), 'Rich clipboard lost bold');
  assert(!copiedBody.html.includes('A calmer way to publish') && !copiedBody.html.includes('blob:'), 'Clipboard contains title or invalid local image URLs');
  assert(copiedBody.html.includes('<h1>Keep your writing workflow</h1>'), 'Clipboard heading does not map to X Heading');
  assert(!/Replace image|Undo change|Fix image/.test(copiedBody.html), 'Preview editing controls leaked into clipboard');
  assert(copiedBody.plain.includes('[Image:') && copiedBody.html.includes('<table'), 'Clipboard missing placement markers or table');
  await page.getByRole('button', { name: 'Copy title', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.output-actions button')?.textContent === 'Copied!');
  assert(await page.evaluate(() => navigator.clipboard.readText()) === 'A calmer way to publish', 'Title copy failed');
  results.push({ clipboard: 'real HTML/plaintext body and separate title copied; images have explicit markers' });

  const nativeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  await (await nativeDownload).saveAs('/tmp/article-studio-native.zip');
  await page.getByLabel('Table format', { exact: true }).selectOption('image');
  await ready();
  await page.waitForFunction(() => [...document.querySelectorAll('.xp-img')].length === 3 && [...document.querySelectorAll('.xp-img')].every(i => i.naturalWidth > 0));
  assert(await page.locator('.rendered-article table').count() === 0, 'Table mode did not update automatically');
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  await (await pngDownload).saveAs('/tmp/article-studio-png.zip');
  await page.getByRole('button', { name: /^Images/ }).click();
  const tableDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Table 1', exact: true }).click();
  await (await tableDownload).saveAs('/tmp/article-studio-table.png');
  const photoDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download From first draft to finished article', exact: true }).click();
  await (await photoDownload).saveAs('/tmp/article-studio-photo.png');
  await page.getByRole('button', { name: 'Copy From first draft to finished article', exact: true }).click();
  await page.getByText('Image copied. Paste it into X.', { exact: true }).waitFor();
  assert((await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).includes('image/png'), 'PNG clipboard copy failed');
  await closeDialog();
  results.push({ tablesAndDownloads: 'native/PNG switch, ZIPs, individual PNG download and copy all work' });

  const imageControlsMarkdown = '# Image controls\n\n![First](assets/review/first.png)\n\nBetween.\n\n![Second](assets/review/second.png)\n\n![First again](assets/review/first.png)';
  await source().fill(imageControlsMarkdown);
  await page.waitForFunction(() => document.querySelectorAll('.editable-image').length === 3);
  await page.getByLabel('Preview replace First', { exact: true }).first().setInputFiles('/tmp/article-studio-photo.png');
  await page.waitForFunction(() => document.querySelectorAll('.editable-image img').length === 2);
  await page.getByRole('button', { name: 'Undo change to First', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.editable-image img').length === 0);
  await page.getByLabel('Preview replace First', { exact: true }).first().setInputFiles('/tmp/article-studio-photo.png');
  await page.waitForFunction(() => document.querySelector('.editable-image img')?.naturalWidth === 1200);
  await page.getByLabel('Preview replace First', { exact: true }).first().setInputFiles('/tmp/article-studio-table.png');
  await page.waitForFunction(() => document.querySelector('.editable-image img')?.naturalWidth > 0 && document.querySelector('.editable-image img').naturalWidth !== 1200);
  await page.getByRole('button', { name: 'Undo change to First', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('.editable-image img')?.naturalWidth === 1200);
  await page.getByLabel('Preview replace Second', { exact: true }).setInputFiles('/tmp/article-studio-table.png');
  await ready();
  await page.getByRole('button', { name: 'Fix image Second', exact: true }).click();
  assert(await page.getByRole('dialog').locator('#asset-image-2').isVisible(), 'Direct Fix image lost the original drawer');
  await closeDialog();
  assert(await source().inputValue() === imageControlsMarkdown, 'Replacing or undoing altered Markdown');
  results.push({ imageControls: 'every image occurrence has direct replacement; undo restores missing/previous file; Fix image opens the correct card' });

  // Simulate a parent-folder FileList, including one unrelated Markdown file and
  // an oversized unreferenced image. Real directory selection is also checked
  // locally with the reported Obsidian article, without storing it in this repo.
  await page.evaluate(async () => {
    const photo = await (await fetch(document.querySelector('.editable-image img').src)).blob();
    const transfer = new DataTransfer();
    for (const [name, body] of [['first.png', photo], ['second.png', photo], ['unrelated.png', new Uint8Array(21 * 1024 * 1024)], ['other.md', '# Do not import this document']]) {
      const file = new File([body], name);
      Object.defineProperty(file, 'webkitRelativePath', { value: 'parent/assets/review/' + name });
      transfer.items.add(file);
    }
    const input = document.querySelector('input[aria-label="Choose image folder"]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByText('Matched 2 of 2 article images. Your Markdown is unchanged.', { exact: true }).waitFor();
  await ready();
  assert(await source().inputValue() === imageControlsMarkdown, 'Folder picker replaced or modified Markdown');
  assert(await page.locator('.editable-image img').count() === 3, 'Folder matching lost repeated image placement');
  results.push({ imageFolder: 'matches referenced files only; ignores unrelated large images and Markdown; preserves repeated placements' });

  await source().fill('# Pasted image\n\nPaste below.\n\n');
  await source().press('ControlOrMeta+End');
  await source().press('ControlOrMeta+V');
  await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('!['));
  await ready();
  assert(await page.locator('.xp-img').count() === 1, 'Pasted image was not inserted');
  results.push({ imagePaste: 'real clipboard PNG inserts Markdown and renders automatically' });

  await source().fill('# Added image\n\nBody.\n\n');
  await ready();
  await source().press('ControlOrMeta+End');
  await page.getByLabel('Add image files', { exact: true }).setInputFiles('/tmp/article-studio-photo.png');
  await ready();
  assert((await source().inputValue()).includes('article-studio-photo.png'), 'Adding an image only attached it without inserting');
  await page.waitForFunction(() => document.querySelector('.xp-img')?.naturalWidth > 0);
  results.push({ addImage: 'file picker inserts new image at the editor selection' });

  await source().fill('# Missing image\n\nKeep this text.\n\n![Missing](not-here.png)');
  await page.getByRole('button', { name: 'Add / fix images', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Export ZIP', exact: true }).isDisabled(), 'Incomplete article can be exported');
  await page.getByRole('button', { name: 'Add / fix images', exact: true }).click();
  await page.getByLabel('Replace Missing', { exact: true }).setInputFiles('/tmp/article-studio-photo.png');
  await ready();
  await closeDialog();
  assert((await source().inputValue()).includes('Keep this text.'), 'Resolving image changed the document');
  results.push({ missingImage: 'inline action opens chooser; replacing file resolves error automatically' });

  await source().fill('# Invalid diagram\n\n' + String.fromCharCode(96).repeat(3) + 'mermaid\nflowchart LR\n A--?>???\n' + String.fromCharCode(96).repeat(3));
  await page.getByRole('button', { name: 'Edit source', exact: true }).waitFor();
  assert((await page.locator('.preview-alert').innerText()).includes('Mermaid'), 'Diagram error mislabeled as missing file');
  assert(await page.getByRole('button', { name: 'Create X draft', exact: true }).isDisabled(), 'Malformed diagram can be sent');
  await page.getByRole('button', { name: 'Edit source', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Markdown source');
  assert(await source().evaluate(el => document.activeElement === el), 'Fix action did not focus source');
  results.push({ invalidMermaid: 'specific error and direct source-edit action' });

  await page.route('https://images.example.test/blocked.png', route => route.abort('accessdenied'));
  await source().fill('# Remote photo\n\nBody.\n\n![Remote](https://images.example.test/blocked.png)');
  await page.getByRole('button', { name: 'Add / fix images', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add / fix images', exact: true }).click();
  assert((await page.locator('.asset-state.error').innerText()).includes('CORS'), 'Remote-image guidance missing');
  await page.getByLabel('Replace Remote', { exact: true }).setInputFiles('/tmp/article-studio-photo.png');
  await ready();
  await closeDialog();
  results.push({ remoteImage: 'CORS error remains replaceable' });

  await source().fill('# Latest draft\n\nFirst text');
  await source().fill('# Latest draft\n\nSecond text');
  await source().fill('# Latest draft\n\n**中文内容 🚀**\n\n- Parent\n  - Nested child');
  await page.getByRole('button', { name: 'Go to line', exact: true }).waitFor();
  assert((await page.locator('.preview-alert').innerText()).includes('nested'), 'Known content loss not blocked');
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved locally');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled);
  assert((await source().inputValue()).includes('中文内容'), 'Latest draft did not persist');
  results.push({ persistence: 'latest edited CJK/emoji content survives reload; nested content blocked' });

  await page.getByLabel('Import Markdown file', { exact: true }).setInputFiles('tests/fixtures/import.markdown');
  await ready();
  assert(await page.getByRole('heading', { name: 'Imported Markdown', exact: true }).count() === 1, '.markdown import failed');
  await source().press('ControlOrMeta+End');
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await ready();
  assert(await page.locator('.xp-img').count() === 1, 'Diagram toolbar did not insert and render');
  results.push({ importAndToolbar: '.markdown import and diagram insertion update immediately' });

  await page.getByRole('button', { name: 'How to use', exact: true }).click();
  assert(await page.getByRole('dialog').locator('.setup-steps li').count() === 3, 'Missing short instructions');
  await closeDialog();
  await page.getByRole('button', { name: 'Format support', exact: true }).click();
  assert(await page.getByRole('dialog').getByRole('table').count() === 1, 'Missing support guide');
  await closeDialog();
  await loadExample();
  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert(await page.getByRole('link', { name: standalone ? 'Open full app' : 'Download companion', exact: true }).count() === 1, 'Missing connection path');
  await closeDialog();
  results.push({ helpAndConnection: 'short instructions, format matrix, and concrete X setup' });

  await page.getByRole('button', { name: 'Phone preview', exact: true }).click();
  assert((await page.locator('.preview-paper').boundingBox()).width <= 362, 'Phone preview is not constrained');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await source().isVisible(), 'Mobile Write view missing');
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  assert(await page.locator('.rendered-article').isVisible(), 'Mobile Preview view missing');
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  assert(widths.document <= widths.viewport, 'Mobile horizontal overflow');
  await page.screenshot({ path: '/tmp/article-studio-mobile.png' });
  results.push({ mobile: widths });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Desktop preview', exact: true }).click();
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.count()) await dismiss.click();
  await page.screenshot({ path: '/tmp/article-studio-desktop.png' });
  return results;
}
