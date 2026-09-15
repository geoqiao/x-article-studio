// Run in an isolated persistent Chromium profile with dist-extension-store loaded.
// Route X to an inert local response; never use a real signed-in profile.
async page => {
  const context = page.context();
  if (context.pages().some(p => /^https:\/\/([^/]+\.)?x\.com\//.test(p.url()))) throw new Error('Use an isolated profile');
  await context.route(/^https:\/\/([^/]+\.)?x\.com\//, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated X preflight fixture</title>' }));
  await page.getByRole('button', { name: 'Example', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Load example', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0) && document.querySelector('.output-actions .button-primary')?.disabled === false);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: 'extension/store/screenshot-editor.png' });
  const nextPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const review = await nextPage;
  await review.getByRole('heading', { name: 'A calmer way to publish', exact: true }).waitFor();
  await review.waitForFunction(() => document.querySelectorAll('.asset img').length === 2 && [...document.querySelectorAll('.asset img')].every(i => i.naturalWidth > 0));
  await review.screenshot({ path: '/tmp/md2x-store-review-full.png', fullPage: true });
  const xFixture = await context.newPage();
  await xFixture.goto('https://x.com/compose/articles');
  await review.getByRole('button', { name: 'Create X draft', exact: true }).click();
  await review.getByText('No ct0 cookie was found. Sign in to x.com and try again.', { exact: true }).waitFor();
  await review.getByRole('button', { name: 'Discard staged article', exact: true }).click();
  await review.getByRole('heading', { name: 'Job deleted', exact: true }).waitFor();
  await xFixture.close();
  await review.close();
  return { productionBridge: true, imagesReviewed: 2, xTabDetectedWithoutTabsPermission: true, mainWorldPreflight: true, xNetwork: 'intercepted locally; no X service contacted', discarded: true };
}
