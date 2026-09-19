// Run with the built extension loaded in an isolated Chromium profile.
// Requires the local HTTPS fixture and isolated DNS routing in fixtures/README.md.
// playwright-cli -s=article-studio-bridge-test run-code --filename=tests/browser-bridge-smoke.js
async page => {
  const context = page.context();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(context.pages().every(p => !/^https:\/\/([^/]+\.)?x\.com\//.test(p.url())), 'Use an isolated browser without an X tab');
  const fixtureState = async () => (await context.request.get('https://127.0.0.1:18443/__fixture_state__', { ignoreHTTPSErrors: true })).json();
  await context.request.post('https://127.0.0.1:18443/__fixture_reset__', { ignoreHTTPSErrors: true });
  await context.clearCookies();
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
  await page.getByText('Review opened in the companion. Confirm there to upload images and create your draft.', { exact: true }).waitFor();
  await review.bringToFront();
  assert(context.pages().filter(p => p.url() === reviewUrl).length === 1, 'Repeated stage duplicated the review');
  let state = await fixtureState();
  assert(state.documents === 0 && state.drafts === 0, 'Staging contacted X before confirmation');
  const xOpened = context.waitForEvent('page');
  await review.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const xTab = await xOpened;
  await xTab.waitForURL('https://x.com/compose/articles');
  assert(await xTab.title() === 'Isolated X fixture', 'X navigation did not reach the local fixture; stop the test');
  await review.getByText('Sign in to X in the X Articles tab, then return here and choose Create X draft. Your account needs Articles access.', { exact: true }).waitFor();
  state = await fixtureState();
  assert(state.documents === 1 && state.media === 0 && state.drafts === 0, 'Signed-out preflight attempted an upload or draft');

  // A synthetic CSRF cookie exercises the packaged runner against local API fixtures only.
  await context.addCookies([{ name: 'ct0', value: 'isolated-fixture-only', domain: 'x.com', path: '/', secure: true }]);
  await review.getByRole('button', { name: 'Create X draft', exact: true }).click();
  await review.getByRole('link', { name: 'Open the created X draft', exact: true }).waitFor();
  state = await fixtureState();
  assert(state.documents === 1, 'Retry opened another X tab instead of reusing it');
  assert(state.media === 2 && state.drafts === 1, 'Image handoff did not create exactly one fixture draft');
  await review.getByRole('button', { name: 'Delete stored job', exact: true }).click();
  await review.getByRole('heading', { name: 'Job deleted', exact: true }).waitFor();
  await review.close();
  await xTab.close();

  // A signed-in fixture with no existing X tab completes on the first confirmation.
  await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('# Automatic X tab\n\nA fresh article.');
  await page.waitForFunction(() => !document.querySelector('.output-actions .button-primary')?.disabled && document.querySelector('.preview-state')?.textContent.includes('Preview up to date'));
  const nextReviewOpened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const nextReview = await nextReviewOpened;
  await nextReview.getByRole('button', { name: 'Create X draft', exact: true }).waitFor();
  const nextXOpened = context.waitForEvent('page');
  await nextReview.getByRole('button', { name: 'Create X draft', exact: true }).click();
  const nextX = await nextXOpened;
  const resultLink = nextReview.getByRole('link', { name: 'Open the created X draft', exact: true });
  await resultLink.waitFor();
  assert(await resultLink.getAttribute('href') === 'https://x.com/compose/articles/edit/fixture-draft-2', 'Wrong automatic draft result');
  state = await fixtureState();
  assert(state.documents === 2 && state.drafts === 2, 'Signed-in first confirmation did not complete once');
  assert(state.titles.join('|') === 'A calmer way to publish|Automatic X tab', 'Wrong draft content sent');
  assert(state.unexpected.length === 0, 'Unexpected fixture requests: ' + state.unexpected.join(', '));
  await nextReview.getByRole('button', { name: 'Delete stored job', exact: true }).click();
  await nextReview.getByRole('heading', { name: 'Job deleted', exact: true }).waitFor();
  await nextReview.close();
  await nextX.close();
  await context.clearCookies();
  return { connected: true, stagedAssets: 2, extensionReview: true, repeatedStageReusesJob: true, opensXAutomatically: true, signedOut: 'stopped before uploads', retryReusesTab: true, signedInFixture: 'one confirmation creates draft', fixtureDrafts: state.drafts, realXRequests: 0 };
}
