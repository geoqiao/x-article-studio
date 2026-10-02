// Resumes waiting on the page left by create.js, after a person confirmed the companion review.
async page => {
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
    if (job.status === 'completed') return { ok: true, ...job };
    if (job.status === 'failed' || job.status === 'uncertain' || job.status === 'missing') return { ok: false, stage: job.status, ...job };
    if (job.status !== 'pending') pendingSince = Date.now();
    // Still pending: the companion review is waiting for a person.
    else if (Date.now() - pendingSince > 20_000) return { ok: false, stage: 'awaiting-confirmation', ...job };
    await page.waitForTimeout(1_000);
    job = await read();
  }
  return job ? { ok: false, stage: 'timeout', ...job } : { ok: false, stage: 'no-status' };
}
