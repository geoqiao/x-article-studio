// Run in an isolated browser against the production app or standalone HTML.
// playwright-cli -s=article-studio-reimport --raw run-code --filename=tests/browser-reimport-smoke.js
async page => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const ready = () => page.waitForFunction(() => !document.querySelector('.output-actions .button-primary')?.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date'));
  const saved = () => page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved locally');
  const fixture = 'tests/fixtures/reimport.md';
  const importDocument = () => page.getByLabel('Import Markdown file', { exact: true }).setInputFiles(fixture);
  const pickImage = (label, color) => page.getByLabel('Preview replace ' + label, { exact: true }).evaluate(async (input, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, 48, 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'chosen.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
  const assertMissing = async () => {
    await page.waitForFunction(() => document.querySelector('.preview-alert strong')?.textContent.includes('2 images'));
    assert(await page.locator('.xp-img').count() === 0, 'Old image bytes survived Markdown re-import');
    assert(await page.getByRole('button', { name: 'Export ZIP', exact: true }).isDisabled(), 'Export enabled with stale images');
    assert(await page.getByRole('button', { name: 'Create X draft', exact: true }).isDisabled(), 'Draft handoff enabled with stale images');
    assert(await page.getByRole('button', { name: /^Undo change to / }).count() === 0, 'Old replacement undo survived re-import');
    await page.getByRole('button', { name: /^Images/ }).click();
    assert(await page.getByRole('dialog').locator('.asset-thumbnail img').count() === 0, 'Old drawer thumbnails survived re-import');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  };
  const hashes = () => page.locator('.editable-image img').evaluateAll(async images => Promise.all(images.map(async img => {
    const bytes = await (await fetch(img.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  })));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start new article', exact: true }).click();
  await importDocument();
  await assertMissing();
  const original = await source.inputValue();
  await pickImage('First', '#ff0000');
  await pickImage('Second', '#0000ff');
  await ready();
  const oldHashes = await hashes();
  await saved();
  await page.reload();
  await ready();
  assert(JSON.stringify(await hashes()) === JSON.stringify(oldHashes), 'Page reload failed to restore the current draft');
  results.push({ reload: 'saved current draft restores its image bytes' });

  await importDocument();
  // A paint after the import must not reuse the previous article's image URLs.
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Opened reimport.md'));
  assert(await page.locator('.xp-img').count() === 0, 'Old preview flashed after re-import');
  await assertMissing();
  assert(await source.inputValue() === original, 'Re-import changed Markdown');
  await saved();
  await page.reload();
  await assertMissing();
  results.push({ reimport: 'identical file clears persisted attachments, overrides, thumbnails, undo, and export/handoff readiness; reload does not resurrect them' });

  await pickImage('First', '#00ff00');
  await pickImage('Second', '#ffff00');
  await ready();
  const newHashes = await hashes();
  assert(newHashes.every((hash, index) => hash !== oldHashes[index]), 'New selections still show old image bytes');
  await saved();
  await page.reload();
  await ready();
  assert(JSON.stringify(await hashes()) === JSON.stringify(newHashes), 'Fresh attachments did not persist');
  results.push({ freshAttachments: 'replacement images have new hashes and survive reload' });

  // Keep ordinary images in view while editing text, but match them by source
  // when image-1/image-2 IDs change after reordering.
  await source.fill('# Reordered\n\n![Second](assets/second.png)\n\n![First](assets/shared.png)');
  assert(JSON.stringify(await hashes()) === JSON.stringify([...newHashes].reverse()), 'Reordering mapped images by ordinal ID instead of source');
  await page.getByRole('button', { name: /^Images/ }).click();
  const thumbHashes = await page.getByRole('dialog').locator('.asset-thumbnail img').evaluateAll(async images => Promise.all(images.map(async img => {
    const bytes = await (await fetch(img.src)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  })));
  assert(JSON.stringify(thumbHashes) === JSON.stringify([...newHashes].reverse()), 'Drawer showed thumbnails from another source');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await ready();
  results.push({ reorder: 'preview and drawer preserve each image source during reordering' });

  // Import a different document containing identical relative image paths.
  await page.getByLabel('Import Markdown file', { exact: true }).evaluate(input => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['# Different article\n\n![First](assets/shared.png)\n\n![Second](assets/second.png)'], 'different.md'));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await assertMissing();
  results.push({ differentArticle: 'same relative paths do not share attachments across imported documents' });

  // A slow File.text() must not overwrite a newer import or a New action.
  await page.evaluate(() => {
    const read = File.prototype.text;
    window.__restoreFileText = () => { File.prototype.text = read; };
    File.prototype.text = function () {
      if (this.name !== 'reimport.md') return read.call(this);
      return new Promise(resolve => { window.__finishOldImport = () => read.call(this).then(resolve); });
    };
  });
  await importDocument();
  await page.waitForFunction(() => typeof window.__finishOldImport === 'function');
  await page.getByLabel('Import Markdown file', { exact: true }).setInputFiles('tests/fixtures/import.markdown');
  await ready();
  await page.evaluate(async () => { await window.__finishOldImport(); window.__restoreFileText(); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert((await source.inputValue()).startsWith('# Imported Markdown'), 'An earlier file read replaced the newer import');
  results.push({ importRace: 'last selected document wins when earlier reading finishes late' });

  const fence = String.fromCharCode(96).repeat(3);
  await source.fill('# Diagram\n\n' + fence + 'mermaid\nflowchart LR\n A-->B\n' + fence);
  await ready();
  const previousDiagramUrl = await page.locator('.xp-img').getAttribute('src');
  await source.fill('# Diagram\n\n' + fence + 'mermaid\nsequenceDiagram\n A->>B: Changed\n' + fence);
  assert(!(await page.locator('.xp-img').evaluateAll(images => images.map(img => img.src))).includes(previousDiagramUrl), 'Changed Mermaid source reused the previous diagram');
  await ready();
  results.push({ generatedImage: 'changed Mermaid source invalidates the old rendered PNG immediately' });
  return results;
}
