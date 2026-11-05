import { TimerKind } from './activity-timers.constants';
import { buildTimerJobId, computeDelayMs } from './activity-timers.job';

describe('buildTimerJobId', () => {
  it('uses the exact {kind}--{activityId}--v{version} format', () => {
    expect(buildTimerJobId(TimerKind.RESPONSE_TIMEOUT, 'act-1', 3)).toBe(
      'response-timeout--act-1--v3',
    );
    expect(buildTimerJobId(TimerKind.START, 'abc', 1)).toBe('start--abc--v1');
    expect(buildTimerJobId(TimerKind.END, 'xyz', 42)).toBe('end--xyz--v42');
  });

  it('never contains a colon (BullMQ forbids it in custom job ids)', () => {
    const id = buildTimerJobId(TimerKind.RESPONSE_TIMEOUT, 'act-1', 1);
    expect(id).not.toContain(':');
  });

  it('produces distinct ids for distinct kinds, activityIds and versions', () => {
    const ids = new Set([
      buildTimerJobId(TimerKind.START, 'act-1', 1),
      buildTimerJobId(TimerKind.END, 'act-1', 1),
      buildTimerJobId(TimerKind.START, 'act-2', 1),
      buildTimerJobId(TimerKind.START, 'act-1', 2),
    ]);
    expect(ids.size).toBe(4);
  });

  it('is deterministic (same inputs, same id)', () => {
    expect(buildTimerJobId(TimerKind.START, 'act-1', 1)).toBe(
      buildTimerJobId(TimerKind.START, 'act-1', 1),
    );
  });
});

describe('computeDelayMs', () => {
  it('returns a positive delay for a future target', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const target = new Date('2026-10-01T13:00:00Z');
    expect(computeDelayMs(target, now)).toBe(60 * 60 * 1000);
  });

  it('returns 0 when the target is exactly now', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    expect(computeDelayMs(new Date(now.getTime()), now)).toBe(0);
  });

  it('clamps a past target to 0 (never negative)', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const target = new Date('2026-10-01T11:00:00Z');
    expect(computeDelayMs(target, now)).toBe(0);
  });

  it('is timezone-independent (epoch-ms diff only)', () => {
    const now = new Date('2026-10-01T12:00:00Z');
    const target = new Date('2026-10-01T13:00:00Z');
    // Same instant expressed with an explicit offset must yield the same delay.
    const nowOffset = new Date('2026-10-01T09:00:00-03:00');
    const targetOffset = new Date('2026-10-01T10:00:00-03:00');
    expect(computeDelayMs(targetOffset, nowOffset)).toBe(computeDelayMs(target, now));
  });
});
