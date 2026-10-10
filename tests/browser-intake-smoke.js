// Run against a local build in an isolated browser. Fakes the File System Access
// pickers so the reload flow is testable; no X draft is created.
// playwright-cli -s=article-studio-intake run-code --filename=tests/browser-intake-smoke.js
async page => {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const source = () => page.getByRole('textbox', { name: 'Markdown source', exact: true });
  const ready = () => page.waitForFunction(() => {
    const button = document.querySelector('.output-actions .button-primary');
    return button && !button.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date');
  }, null, { timeout: 60_000 });
  const notes = async () => {
    const details = page.locator('.format-notes');
    if (!(await details.count())) return '';
    await details.evaluate(element => { element.open = true; });
    return details.innerText();
  };
  await page.addInitScript(() => {
    const image = async (name, color, size = 48) => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size / 2;
      const context = canvas.getContext('2d');
      context.fillStyle = color; context.fillRect(0, 0, size, size / 2);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return new File([blob], name, { type: 'image/png' });
    };
    class FakeFile {
      constructor(name, text) { this.kind = 'file'; this.name = name; this.text = text; this.modified = Date.now(); }
      async getFile() { return this.text instanceof Promise || typeof this.text === 'function' ? this.text() : new File([this.text], this.name, { lastModified: this.modified }); }
      async queryPermission() { return 'granted'; }
      async requestPermission() { return 'granted'; }
    }
    class FakeDirectory {
      constructor(name, entries) { this.kind = 'directory'; this.name = name; this.entries = entries; }
      async *values() { yield* this.entries; }
      async queryPermission() { return 'granted'; }
      async requestPermission() { return 'granted'; }
    }
    const md = new FakeFile('reload-test.md', '---\ntitle: Reload me\nslug: reload\n---\nFirst version.\n\n![[shot.png]]\n');
    const shot = new FakeFile('shot.png', () => image('shot.png', '#2266cc'));
    const second = new FakeFile('second.png', () => image('second.png', '#cc2222'));
    window.__fakeFs = { md, folder: new FakeDirectory('attachments', [shot, new FakeDirectory('sub', [second])]) };
    window.showOpenFilePicker = async () => [md];
    window.showDirectoryPicker = async () => window.__fakeFs.folder;
  });
  await page.goto(page.url());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start new article', exact: true }).click();

  // Import through the (faked) native picker: the embed is recognised, the image is missing.
  await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#draft-issues')?.textContent.includes('Image file not selected'));
  assert((await source().inputValue()).includes('![[shot.png]]'), 'Import did not load the picked file');
  assert(await page.getByRole('button', { name: 'Reload from file', exact: true }).count() === 1, 'Reload button missing after a picker import');
  assert((await page.locator('.source-panel .panel-footer').innerText()).includes('Frontmatter: used title, ignored 1 field'), 'Frontmatter line missing');
  await page.getByRole('button', { name: 'Match image folder', exact: true }).first().click();
  await ready();
  assert(await page.locator('.xp-img').count() === 1, 'Obsidian embed did not resolve from the remembered folder');
  results.push({ pickerImport: 'picked .md loads, ![[embed]] becomes an image, folder matched through the directory picker' });

  // Edit the file "elsewhere": the Reload button notices and re-reads it, keeping images.
  await page.evaluate(() => { const md = window.__fakeFs.md; md.text = md.text.replace('First version.', 'Second version.') + '\n![[second.png]]\n'; md.modified = Date.now() + 1000; });
  await page.getByRole('button', { name: 'Reload from file', exact: true }).filter({ hasText: 'Changed on disk' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Reload from file', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Reloaded reload-test.md'));
  await ready();
  assert((await source().inputValue()).includes('Second version.'), 'Reload did not re-read the file');
  assert(await page.locator('.xp-img').count() === 2, 'Reload lost the first image or missed the new one from the remembered folder');
  results.push({ reload: 'change on disk detected; reload keeps matched images and matches new ones from the remembered folder' });

  // Footnotes convert to endnotes with one click.
  await source().fill('# Notes\n\nClaim[^a] here.\n\n[^a]: The note.\n');
  await page.getByRole('button', { name: 'Convert to endnotes', exact: true }).click();
  await ready();
  const converted = await source().inputValue();
  assert(converted.includes('Claim[1] here.') && converted.includes('\n---\n\n[1] The note.'), 'Endnote conversion produced ' + converted);
  results.push({ endnotes: 'footnote reference and definition converted losslessly' });

  // Wikilink check can be turned off inline and back on in How to use.
  await source().fill('# Links\n\nSee [[Other note]] and run curl -fsSL https://example.com | sh\n');
  await ready();
  let text = await notes();
  assert(text.includes('[[link]] syntax') && text.includes('firewall'), 'Wikilink or shell-pipe note missing: ' + text);
  await page.getByRole('button', { name: 'Turn off this check', exact: true }).click();
  text = await notes();
  assert(!text.includes('[[link]] syntax') && text.includes('firewall'), 'Wikilink note still shown after turning the check off');
  await page.getByRole('button', { name: 'How to use', exact: true }).click();
  await page.getByRole('checkbox', { name: /Warn about Obsidian/ }).check();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  text = await notes();
  assert(text.includes('[[link]] syntax'), 'Wikilink note did not return after re-enabling');
  results.push({ wikilinkToggle: 'inline off, re-enabled from How to use; shell pipe warned' });

  // SVG and oversized PNG are accepted and converted, with notes.
  await source().fill('# Images\n\nText.\n');
  await page.getByRole('button', { name: /^Images/ }).click();
  await page.getByLabel('Add image files', { exact: true }).evaluate(async input => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800; canvas.height = 1800;
    const context = canvas.getContext('2d');
    const data = context.createImageData(1800, 1800);
    for (let i = 0; i < data.data.length; i++) data.data[i] = (Math.random() * 256) | 0;
    context.putImageData(data, 0, 0);
    const big = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#36c"/><script>document.title="pwned"</script></svg>';
    const transfer = new DataTransfer();
    transfer.items.add(new File([big], 'noise.png', { type: 'image/png' }));
    transfer.items.add(new File([svg], 'logo.svg', { type: 'image/svg+xml' }));
    window.__bigSize = big.size;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await ready();
  const bigSize = await page.evaluate(() => window.__bigSize);
  assert(bigSize > 5 * 1024 * 1024, 'Test PNG was not over 5 MiB: ' + bigSize);
  text = await notes();
  assert(/noise\.png.*downscaled/.test(text) && /logo\.svg.*SVG.*rendered as a 1600 × 800 PNG/.test(text), 'Conversion notes missing: ' + text);
  assert(await page.locator('.xp-img').count() === 2 && await page.locator('.xp-img').evaluateAll(images => images.every(img => img.naturalWidth > 0)), 'Converted images not shown');
  assert(await page.title() !== 'pwned', 'SVG script executed');
  const sizes = await page.locator('.xp-img').evaluateAll(async images => Promise.all(images.map(async img => (await (await fetch(img.src)).blob()).size)));
  assert(sizes.every(size => size <= 5 * 1024 * 1024), 'Prepared image still over 5 MiB: ' + sizes);
  results.push({ intake: 'oversized PNG downscaled under 5 MiB, SVG rendered to PNG without running scripts' });
  return results;
}
