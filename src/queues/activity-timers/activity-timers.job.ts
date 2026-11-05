import { TimerKind } from './activity-timers.constants';

/**
 * Deterministic BullMQ job id: `${kind}--${activityId}--v${version}`.
 * Uses `--` (never `:`, which BullMQ forbids in custom job ids) so repeat
 * enqueues for the same activity+version collapse into one job.
 */
export function buildTimerJobId(kind: TimerKind, activityId: string, version: number): string {
  return `${kind}--${activityId}--v${version}`;
}

/**
 * Delay in milliseconds until `target`, clamped at 0. Epoch-ms diff only, so it
 * is UTC-safe and independent of the server timezone.
 * Anchor resolution (response-timeout→deadline, start→scheduled_start,
 * end→scheduled_end ?? scheduled_start) lives in the engine stream.
 */
export function computeDelayMs(target: Date, now: Date): number {
  return Math.max(0, target.getTime() - now.getTime());
}
