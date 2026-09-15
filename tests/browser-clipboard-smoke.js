// Run in isolated Chrome against a built app or standalone preview. Never opens X.
// playwright-cli -s=clipboard-test --raw run-code --filename=tests/browser-clipboard-smoke.js
async page => {
  const results = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const ready = () => page.waitForFunction(() => {
    const button = document.querySelector('.output-actions .button-primary');
    return button && !button.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date');
  });
  const readClipboard = () => page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return {
      html: await (await item.getType('text/html')).text(),
      text: await (await item.getType('text/plain')).text(),
    };
  });
  const copy = async () => {
    await page.locator('.output-actions .button-primary').click();
    await page.getByRole('button', { name: 'Copied!', exact: true }).waitFor();
    return readClipboard();
  };
  const fence = String.fromCharCode(96).repeat(3);
  const markdown = [
    '---', 'title: Separate title 标题', '---', '# Source title', '',
    'Opening **bold text** with *emphasis*, ~~removed~~ and [Visit](https://example.com/read).', '',
    '## Section heading', '', '### Detail heading', '',
    '- First bullet', '- Second bullet 中文 🚀', '',
    '1. First step', '2. Second step', '', '> A quotation', '',
    '| Name | Value |', '| --- | --- |', '| **Speed** | Fast |', '',
    fence + 'js', 'const literal = "**keep this code**";', 'console.log(literal);', fence, '',
    'Closing paragraph.',
  ].join('\n');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill(markdown);
  await ready();
  const body = await copy();
  assert(body.html.includes('<h1>Section heading</h1>') && body.html.includes('<h2>Detail heading</h2>'), 'X heading levels are wrong');
  assert(!/Separate title|Source title|xp-|data-asset|<article|<figure/.test(body.html), 'Title or preview scaffolding copied');
  assert(body.html.includes('<strong>bold text</strong>') && body.html.includes('<em>emphasis</em>') && body.html.includes('<s>removed</s>'), 'Emphasis was lost');
  assert(body.html.includes('<a href="https://example.com/read">Visit</a>'), 'Link lost its destination');
  assert(body.html.includes('<ul>') && body.html.includes('<ol>') && body.html.includes('<blockquote>'), 'Lists or quote lost their block types');
  assert(body.html.includes('<table>') && body.html.includes('<pre><code>'), 'Table or code was copied as source');
  results.push({ richBody: 'body-only HTML has X heading levels, emphasis, links, lists, quote, table, and code' });
  assert(!/title:|# Section|\*\*bold text\*\*|\[Visit\]|```|\| Name \|/.test(body.text), 'Plain clipboard contains Markdown syntax');
  assert(body.text.includes('• Second bullet 中文 🚀') && body.text.includes('2. Second step'), 'Plain clipboard lost list markers or Unicode');
  assert(body.text.includes('Visit (https://example.com/read)') && body.text.includes('Name\tValue'), 'Readable fallback lost links or table cells');
  assert(body.text.includes('const literal = "**keep this code**";\nconsole.log(literal);'), 'Literal code was incorrectly stripped');
  results.push({ readableText: 'plain-text receivers get readable prose and list markers; literal code remains intact' });

  // A real paste into an independent rich-text receiver, beyond inspecting MIME types.
  await page.evaluate(() => {
    const target = document.createElement('div');
    target.id = 'clipboard-paste-target';
    target.contentEditable = 'true';
    target.style.cssText = 'position:fixed;inset:30px;z-index:99999;background:white;overflow:auto;padding:20px';
    document.body.append(target);
  });
  await page.locator('#clipboard-paste-target').focus();
  await page.locator('#clipboard-paste-target').press('ControlOrMeta+V');
  const pasted = page.locator('#clipboard-paste-target');
  await pasted.getByText('Closing paragraph.', { exact: true }).waitFor();
  assert(await pasted.locator('h1').innerText() === 'Section heading', 'Real paste lost Heading');
  assert(await pasted.locator('h2').innerText() === 'Detail heading', 'Real paste lost Subheading');
  assert(await pasted.locator('a[href="https://example.com/read"]').count() === 1, 'Real paste lost link');
  assert(await pasted.locator('ul li').count() === 2 && await pasted.locator('ol li').count() === 2, 'Real paste lost lists');
  const bold = await pasted.getByText('bold text', { exact: true }).evaluate(el => getComputedStyle(el).fontWeight);
  assert(Number(bold) >= 600 || bold === 'bold', 'Real paste lost bold styling');
  await pasted.evaluate(el => el.remove());
  results.push({ actualPaste: 'native Chrome paste preserves heading levels, bold, links, and lists in a rich-text receiver' });

  await page.evaluate(() => {
    window.__clipboardOriginals = {
      write: navigator.clipboard.write,
      writeText: navigator.clipboard.writeText,
      execCommand: document.execCommand,
      ClipboardItem: window.ClipboardItem,
    };
    navigator.clipboard.write = async () => { throw new DOMException('Blocked for test', 'NotAllowedError'); };
  });
  const denied = await copy();
  assert(denied.html === body.html && denied.text === body.text, 'Denied API fallback changed formatting');
  results.push({ deniedPermission: 'selection-copy fallback writes the same rich HTML and readable text' });

  await page.evaluate(() => { window.ClipboardItem = undefined; });
  const unavailable = await copy();
  assert(unavailable.html === body.html && unavailable.text === body.text, 'Unavailable API fallback changed formatting');
  results.push({ unavailableApi: 'browsers without ClipboardItem retain rich output through selection copy' });

  await page.evaluate(() => {
    window.ClipboardItem = window.__clipboardOriginals.ClipboardItem;
    document.execCommand = () => false;
  });
  await page.locator('.output-actions .button-primary').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Copy formatted body', exact: true }).waitFor();
  assert(await dialog.locator('textarea').count() === 0, 'Manual body fallback still uses a plain-text box');
  assert(await dialog.locator('.manual-copy-rich h1').innerText() === 'Section heading', 'Manual body lost rich formatting');
  assert(await page.getByRole('button', { name: 'Copied!', exact: true }).count() === 0, 'Failed automatic copy reports success');
  await dialog.getByRole('button', { name: 'Select formatted body', exact: true }).click();
  await page.getByRole('textbox', { name: 'Formatted body to copy', exact: true }).press('ControlOrMeta+C');
  const manual = await readClipboard();
  assert(manual.html === body.html && manual.text === body.text, 'Manual keyboard copy lost rich body');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  results.push({ manualCopy: 'blocked automatic methods show selectable rich content; real keyboard copy preserves both clipboard types' });

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('Blocked for test', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: 'Copy title', exact: true }).click();
  await dialog.getByRole('heading', { name: 'Copy title', exact: true }).waitFor();
  assert(await dialog.getByRole('textbox', { name: 'Text to copy', exact: true }).inputValue() === 'Separate title 标题', 'Title fallback changed');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(() => {
    const original = window.__clipboardOriginals;
    navigator.clipboard.write = original.write;
    navigator.clipboard.writeText = original.writeText;
    document.execCommand = original.execCommand;
    window.ClipboardItem = original.ClipboardItem;
    delete window.__clipboardOriginals;
  });
  results.push({ titleCopy: 'title remains separate, including when automatic title copying is blocked' });
  return results;
}
