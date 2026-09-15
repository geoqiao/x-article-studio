// Run with the built extension loaded in an isolated Chromium profile.
// No signed-in X tab may exist. All X requests are aborted as an additional guard.
// playwright-cli -s=article-studio-bridge-test run-code --filename=tests/browser-bridge-smoke.js
async page => {
  const context = page.context();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(context.pages().every(p => !/^https:\/\/([^/]+\.)?x\.com\//.test(p.url())), 'Use an isolated browser without an X tab');
  const requests = [];
  await context.route(/^https:\/\/([^/]+\.)?x\.com\//, route => { requests.push(route.request().url()); return route.abort('blockedbyclient'); });
  await page.getByRole('button', { name: 'Example', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load example', exact: true }).click();
  await page.waitForFunction(() => { const button = document.querySelector('.output-actions .button-primary'); return button && !button.disabled; }, null, { timeout: 30000 });
  const reviewOpened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const review = await reviewOpened;
  await review.waitForLoadState('domcontentloaded');
  await review.getByRole('button', { name: 'Create X draft', exact: true }).waitFor();
  assert(review.url().startsWith('chrome-extension://'), 'Review does not belong to extension');
  assert(await review.getByRole('heading', { name: 'A calmer way to publish', exact: true }).count() === 1, 'Wrong title received');
  await review.waitForFunction(() => [...document.images].length === 2 && [...document.images].every(i => i.naturalWidth > 0));
  assert((await review.locator('pre').innerText()).includes('studio-asset://mermaid-1.png'), 'Missing prepared diagram mapping');
  const reviewUrl = review.url();
  await review.setViewportSize({ width: 1200, height: 1000 });
  await review.screenshot({ path: '/tmp/article-studio-companion.png', fullPage: true });

  await page.bringToFront();
  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  await review.bringToFront();
  assert(context.pages().filter(p => p.url() === reviewUrl).length === 1, 'Repeated stage duplicated the review');
  await review.getByRole('button', { name: 'Create X draft', exact: true }).click();
  await review.getByText('Open a signed-in https://x.com/compose/articles tab, then try again.', { exact: true }).waitFor();
  assert(requests.length === 0, 'Missing-X preflight attempted an X request');
  await review.getByRole('button', { name: 'Discard staged article', exact: true }).click();
  await review.getByRole('heading', { name: 'Job deleted', exact: true }).waitFor();
  await review.close();
  return { connected: true, stagedAssets: 2, extensionReview: true, repeatedStageReusesJob: true, missingXTab: 'blocked before network', discarded: true, xRequests: requests.length };
}
