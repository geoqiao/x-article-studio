import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  armUncertainRetry,
  claimJobState,
  completeJob,
  makeJobRecord,
  markUncertain,
  recoverInterruptedJob,
} from '../extension/src/state';
import type { DraftBundle } from '../src/types';

function pendingBundle(): DraftBundle {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    schemaVersion: 1,
    jobId: 'state-job',
    title: 'State test',
    markdown: '![image](image-a)',
    assets: [
      {
        source: 'image-a',
        fileName: 'image-a.png',
        mime: 'image/png',
        base64: Buffer.from(bytes).toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Article Studio job state', () => {
  it('atomically treats a second click as busy', () => {
    const first = claimJobState(makeJobRecord(pendingBundle()), 'attempt-a', '2026-01-01T00:00:01.000Z');
    expect(first.kind).toBe('claimed');
    if (first.kind !== 'claimed') return;
    const second = claimJobState(first.job, 'attempt-b', '2026-01-01T00:00:02.000Z');
    expect(second.kind).toBe('busy');
    if (second.kind !== 'busy') return;
    expect(second.job.attemptId).toBe('attempt-a');
  });

  it('turns an interrupted attempt into a manual review gate', () => {
    const claimed = claimJobState(makeJobRecord(pendingBundle()), 'attempt-a');
    expect(claimed.kind).toBe('claimed');
    if (claimed.kind !== 'claimed') return;
    const recovered = recoverInterruptedJob(claimed.job, '2026-01-01T00:01:00.000Z');
    expect(recovered.status).toBe('uncertain');
    expect(claimJobState(recovered, 'attempt-b').kind).toBe('review-required');
    const armed = armUncertainRetry(recovered, '2026-01-01T00:02:00.000Z');
    expect(armed.status).toBe('pending');
    expect(claimJobState(armed, 'attempt-b').kind).toBe('claimed');
  });

  it('removes pending content once a definitive draft id exists', () => {
    const record = makeJobRecord(pendingBundle());
    const completed = completeJob(record, '123', 'https://x.com/compose/articles/edit/123');
    expect(completed.status).toBe('completed');
    expect(completed.bundle).toBeUndefined();
    expect(completed.restId).toBe('123');
    expect(markUncertain(record, 'check X').bundle).toBeDefined();
  });
});
