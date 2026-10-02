// Run after browser-bridge-smoke.js setup (fixtures/README.md), in the same isolated profile.
// Covers the cover image, job status on the page, the firewall refusal, and automatic creation.
// playwright-cli -s=<session> run-code --filename=tests/browser-auto-create.js
async page => {
  const context = page.context();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const fixtureState = async () => (await context.request.get('https://127.0.0.1:18443/__fixture_state__', { ignoreHTTPSErrors: true })).json();
  await context.request.post('https://127.0.0.1:18443/__fixture_reset__', { ignoreHTTPSErrors: true });
  await context.addCookies([{ name: 'ct0', value: 'isolated-fixture-only', domain: 'x.com', path: '/', secure: true }]);
  const png = async (width, height, color) => Buffer.from(await page.evaluate(([w, h, c]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const context2d = canvas.getContext('2d');
    context2d.fillStyle = c;
    context2d.fillRect(0, 0, w, h);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [width, height, color]), 'base64');
  const ready = () => page.waitForFunction(() => !document.querySelector('.output-actions .button-primary')?.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date'), null, { timeout: 30000 });
  const status = (value) => page.waitForSelector('#draft-status[data-status="' + value + '"]', { timeout: 30000 });
  const create = page.getByRole('button', { name: 'Create X draft', exact: true });

  // One file selection brings the Markdown, its body image, and the frontmatter cover.
  const markdown = ['---', 'title: Cover article', 'cover: assets/cover.png', '---', '', 'Intro.', '', '![Chart](assets/chart.png)', ''].join('\n');
  await page.getByLabel('Import Markdown file').setInputFiles([
    { name: 'article.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) },
    { name: 'chart.png', mimeType: 'image/png', buffer: await png(400, 300, '#2a6') },
    { name: 'cover.png', mimeType: 'image/png', buffer: await png(1500, 600, '#136') },
  ]);
  await page.waitForSelector('#article-cover[data-state="ready"]', { timeout: 30000 });
  await ready();
  assert(await page.locator('.rendered-article img').count() === 1, 'The cover file was also inserted into the body');

  // First run: the review opens. The automatic setting is off until a person ticks it there.
  const reviewOpened = context.waitForEvent('page');
  await create.click();
  const review = await reviewOpened;
  await review.getByRole('button', { name: 'Create X draft', exact: true }).waitFor();
  assert(await review.getByText(/^Cover · cover-/).count() === 1, 'Review does not show the cover');
  await status('pending');
  const setting = review.getByRole('checkbox', { name: 'Create drafts without this review' });
  assert(!(await setting.isChecked()), 'Automatic creation must start disabled');
  const xOpened = context.waitForEvent('page');
  await review.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const xTab = await xOpened;
  await review.getByRole('link', { name: 'Open the created X draft', exact: true }).waitFor();
  let state = await fixtureState();
  assert(state.media === 2 && state.drafts === 1, 'Expected one body image, one cover upload, and one draft');
  assert(state.covers.length === 1 && state.covers[0][0] === 'fixture-draft-1' && state.covers[0][1] === 'fixture-media-2', 'Cover was not set on the new draft: ' + JSON.stringify(state.covers));
  await page.bringToFront();
  const done = await status('completed');
  assert(await done.getAttribute('data-draft-url') === 'https://x.com/compose/articles/edit/fixture-draft-1', 'Page did not learn the draft URL');

  await review.bringToFront();
  await review.getByRole('checkbox', { name: 'Create drafts without this review' }).check();
  await review.waitForFunction(() => document.querySelector('.setting input')?.checked);
  await review.close();

  // A firewall refusal is a definite failure: no draft, the lines to edit, and the review for recovery.
  await page.bringToFront();
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.fill('# Install guide\n\nRun this:\n\n```\ncurl -fsSL https://example.com/install | sh\n```\n');
  await ready();
  const recoveryOpened = context.waitForEvent('page');
  await create.click();
  const failed = await status('failed');
  assert(await failed.getAttribute('data-error-code') === 'X_FIREWALL_BLOCKED', 'Firewall refusal was not classified');
  assert(await page.locator('#draft-status').getByRole('button', { name: /Line 6/ }).count() === 1, 'No link to the shell pipe line');
  const recovery = await recoveryOpened;
  await recovery.getByText(/firewall blocked this request/).waitFor();
  await recovery.close();
  state = await fixtureState();
  assert(state.blocked === 1 && state.drafts === 1, 'A refused request must not create a draft');

  // With the setting on and clean text, one click on the website creates the draft.
  await page.bringToFront();
  await source.fill('# Install guide\n\nRun the installer from the project page.\n');
  await ready();
  const pagesBefore = context.pages().length;
  await create.click();
  const created = await status('completed');
  assert(await created.getAttribute('data-draft-url') === 'https://x.com/compose/articles/edit/fixture-draft-2', 'Automatic creation did not report its draft');
  assert(context.pages().length === pagesBefore, 'Automatic creation opened a review');
  state = await fixtureState();
  assert(state.drafts === 2 && state.covers.length === 1, 'Wrong draft or cover count: ' + JSON.stringify(state));
  assert(state.unexpected.length === 0, 'Unexpected fixture requests: ' + state.unexpected.join(', '));
  await page.screenshot({ path: '/tmp/article-studio-auto-create.png' });
  await xTab.close();
  await context.clearCookies();
  return { cover: 'uploaded and set', pageSeesJob: true, firewall: 'failed, retryable, no draft', autoCreate: 'one click, no review', titles: state.titles, realXRequests: 0 };
}
