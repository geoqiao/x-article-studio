// Filled in by prepare.mjs. Run with: playwright-cli -s=<session> run-code --filename=<this file>
async page => {
  const config = __CONFIG__;
  // Embedded files are uploaded by content; a plain string is a path.
  const payload = (file) => typeof file === 'string' ? file : { name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.base64, 'base64') };
  await page.goto(config.url);
  await page.getByRole('textbox', { name: 'Markdown source', exact: true }).waitFor();
  // One selection carries the Markdown and every local image it references.
  await page.getByLabel('Import Markdown file').setInputFiles(config.files.map(payload));
  if (config.coverInput) await page.getByLabel('Choose cover image').setInputFiles(payload(config.coverInput));

  const settled = await page.waitForFunction(() => {
    if (document.querySelector('#draft-issues')) return 'issues';
    const button = document.querySelector('.output-actions .button-primary');
    const upToDate = document.querySelector('.preview-state')?.textContent.includes('Preview up to date');
    return button && !button.disabled && upToDate ? 'ready' : false;
  }, null, { timeout: 90_000 }).then((handle) => handle.jsonValue());
  const title = await page.getByLabel('Article title').inputValue().catch(() => '');
  if (settled === 'issues') {
    return { ok: false, stage: 'issues', title, issues: await page.locator('#draft-issues').innerText() };
  }

  let cover = 'none';
  if (config.expectsCover) {
    const figure = page.locator('#article-cover');
    await page.waitForSelector('#article-cover[data-state="ready"], #article-cover[data-state="error"]', { timeout: 60_000 }).catch(() => undefined);
    cover = (await figure.count()) ? await figure.getAttribute('data-state') : 'unsupported-site';
    if (cover !== 'ready') return { ok: false, stage: 'cover', title, cover, detail: (await figure.count()) ? await figure.innerText() : '' };
  }

  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const outcome = await Promise.race([
    page.waitForSelector('#draft-status', { timeout: 20_000 }).then(() => 'job'),
    page.waitForSelector('dialog[open]', { timeout: 20_000 }).then(() => 'dialog'),
  ]).catch(() => 'none');
  const notice = (await page.locator('.toast').allInnerTexts()).join(' ');
  if (outcome === 'dialog') return { ok: false, stage: 'companion-missing', title, detail: 'The companion extension is not connected in this Chrome.' };
  if (outcome === 'none') return { ok: false, stage: 'companion-outdated', title, cover, notice };

  // Follow the draft status the page shows until the companion reports an outcome.
  const read = () => page.evaluate(() => {
    const element = document.querySelector('#draft-status');
    return element && {
      status: element.dataset.status,
      draftUrl: element.dataset.draftUrl ?? null,
      errorCode: element.dataset.errorCode ?? null,
      message: element.querySelector('span')?.textContent ?? '',
    };
  });
  const deadline = Date.now() + 180_000;
  let job = await read();
  let pendingSince = Date.now();
  while (job && Date.now() < deadline) {
    if (job.status === 'completed') return { ok: true, title, cover, notice, ...job };
    if (job.status === 'failed' || job.status === 'uncertain' || job.status === 'missing') return { ok: false, stage: job.status, title, cover, notice, ...job };
    if (job.status !== 'pending') pendingSince = Date.now();
    // Still pending: the companion review is waiting for a person.
    else if (Date.now() - pendingSince > 20_000) return { ok: false, stage: 'awaiting-confirmation', title, cover, notice, ...job };
    await page.waitForTimeout(1_000);
    job = await read();
  }
  return job ? { ok: false, stage: 'timeout', ...job } : { ok: false, stage: 'no-status' };
}
