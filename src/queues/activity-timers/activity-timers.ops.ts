import { ActivityStatus } from '../../activities/entities/activity.entity';
import { TimerKind } from './activity-timers.constants';

/** A single post-commit timer mutation (design D8). */
export interface TimerOp {
  action: 'enqueue' | 'cancel';
  kind: TimerKind;
}

const ALL_KINDS: readonly TimerKind[] = [
  TimerKind.RESPONSE_TIMEOUT,
  TimerKind.START,
  TimerKind.END,
];

const enqueue = (kind: TimerKind): TimerOp => ({ action: 'enqueue', kind });
const cancel = (kind: TimerKind): TimerOp => ({ action: 'cancel', kind });
const cancelAll = (): TimerOp[] => ALL_KINDS.map(cancel);

/**
 * Timer ops triggered by landing on `to` (design decision 7). Pure: it only
 * describes the ops; the producer performs them post-commit.
 */
const OPS_BY_TARGET: Partial<Record<ActivityStatus, TimerOp[]>> = {
  [ActivityStatus.ASSIGNED]: [
    enqueue(TimerKind.RESPONSE_TIMEOUT),
    enqueue(TimerKind.START),
    enqueue(TimerKind.END),
  ],
  [ActivityStatus.ASSISTING]: [
    cancel(TimerKind.RESPONSE_TIMEOUT),
    enqueue(TimerKind.START),
    enqueue(TimerKind.END),
  ],
  [ActivityStatus.IN_PROGRESS]: [enqueue(TimerKind.END)],
  [ActivityStatus.OVERDUE]: [enqueue(TimerKind.START), enqueue(TimerKind.END)],
  [ActivityStatus.DONE]: cancelAll(),
  [ActivityStatus.CANCELLED]: cancelAll(),
  [ActivityStatus.NOT_ASSISTING]: cancelAll(),
  [ActivityStatus.CREATED]: cancelAll(),
};

export function timerOpsForTransition(to: ActivityStatus): TimerOp[] {
  return OPS_BY_TARGET[to] ?? [];
}
