import {
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  resolveBackoffMs,
  webhookBackoffForAttempt,
} from './backoff.strategy';

/**
 * Schedule FR-22 (T-W1.22, REQ-DEL-3, AC-13).
 */
describe('backoff strategy FR-22 (REQ-DEL-3)', () => {
  it('has the deterministic schedule [0, 5s, 5min, 30min, 2h, 5h, 10h, 10h]', () => {
    expect(WEBHOOK_BACKOFF_MS).toEqual([
      0, 5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 36_000_000,
    ]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });

  it.each([
    [1, 0],
    [2, 5_000],
    [3, 300_000],
    [4, 1_800_000],
    [5, 7_200_000],
    [6, 18_000_000],
    [7, 36_000_000],
    [8, 36_000_000],
  ])('attempt %i waits %ims', (attempt, expected) => {
    expect(webhookBackoffForAttempt(attempt)).toBe(expected);
  });

  it('clamps out-of-range attempts to the schedule bounds', () => {
    expect(webhookBackoffForAttempt(0)).toBe(0);
    expect(webhookBackoffForAttempt(99)).toBe(36_000_000);
  });

  describe('Retry-After preference (REQ-DEL-2)', () => {
    it('prefers a valid Retry-After over the schedule', () => {
      expect(resolveBackoffMs(3, 60_000)).toBe(60_000);
    });

    it('falls back to the schedule when Retry-After is absent', () => {
      expect(resolveBackoffMs(3, null)).toBe(300_000);
      expect(resolveBackoffMs(3, undefined)).toBe(300_000);
    });

    it('ignores negative or non-finite Retry-After values', () => {
      expect(resolveBackoffMs(2, -1)).toBe(5_000);
      expect(resolveBackoffMs(2, Number.NaN)).toBe(5_000);
    });
  });
});
