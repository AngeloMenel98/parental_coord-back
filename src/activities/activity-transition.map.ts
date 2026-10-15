import { ActivityStatus } from './entities/activity.entity';

/** Who may execute a rule. Authorization itself lives in the service (E5). */
export type TransitionActor = 'assignee' | 'bond_member' | 'system';

/** Closed set of confirmed transitions (REQ-TRANS-1). */
export type TransitionId =
  'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T15';

/**
 * Column effects applied inside the transition tx.
 * `deadline` is tri-state ('set' = now+X, 'clear' = null). The timestamp flags
 * read: `true` = set to now, `false` = clear to null, `undefined` = untouched.
 */
export interface TransitionSideEffects {
  deadline?: 'set' | 'clear';
  confirmedAt?: boolean;
  cancelledAt?: boolean;
  declinedAt?: boolean;
  completedAt?: boolean;
}

export interface TransitionRule {
  id: TransitionId;
  from: ActivityStatus;
  to: ActivityStatus;
  actors: TransitionActor[];
  requireAssignee?: boolean;
  sideEffects: TransitionSideEffects;
  event: string;
}

export interface InitialTransition {
  status: ActivityStatus;
  event: string;
}

export const ACTIVITY_EVENT = {
  CREATED: 'activity.created',
  ASSIGNED: 'activity.assigned',
  UNASSIGNED: 'activity.unassigned',
  ASSISTING: 'activity.assisting',
  IN_PROGRESS: 'activity.in_progress',
  OVERDUE: 'activity.overdue',
  NOT_ASSISTING: 'activity.not_assisting',
  DONE: 'activity.done',
  CANCELLED: 'activity.cancelled',
} as const;

const CANCEL_EFFECTS: TransitionSideEffects = { deadline: 'clear', cancelledAt: true };

const CANCEL_SOURCES: readonly ActivityStatus[] = [
  ActivityStatus.CREATED,
  ActivityStatus.ASSIGNED,
  ActivityStatus.ASSISTING,
  ActivityStatus.NOT_ASSISTING,
  ActivityStatus.OVERDUE,
  ActivityStatus.IN_PROGRESS,
];

/**
 * T1/T2 (`(new) -> created|assigned`) are NOT keyed here: a new row is not an
 * update, so they are served by `resolveInitial`. Terminal `done`/`cancelled`
 * have no outgoing rule, so `resolveTransition` returns `undefined` (=> 409).
 */
const RULES: readonly TransitionRule[] = [
  {
    id: 'T3',
    from: ActivityStatus.CREATED,
    to: ActivityStatus.ASSIGNED,
    actors: ['bond_member'],
    sideEffects: { deadline: 'set' },
    event: ACTIVITY_EVENT.ASSIGNED,
  },
  {
    id: 'T4',
    from: ActivityStatus.ASSIGNED,
    to: ActivityStatus.CREATED,
    actors: ['bond_member'],
    sideEffects: { deadline: 'clear', confirmedAt: false },
    event: ACTIVITY_EVENT.UNASSIGNED,
  },
  {
    id: 'T5',
    from: ActivityStatus.ASSIGNED,
    to: ActivityStatus.ASSISTING,
    actors: ['assignee'],
    requireAssignee: true,
    sideEffects: { deadline: 'clear', confirmedAt: true },
    event: ACTIVITY_EVENT.ASSISTING,
  },
  {
    id: 'T6',
    from: ActivityStatus.ASSIGNED,
    to: ActivityStatus.NOT_ASSISTING,
    actors: ['assignee'],
    requireAssignee: true,
    sideEffects: { deadline: 'clear', declinedAt: true },
    event: ACTIVITY_EVENT.NOT_ASSISTING,
  },
  {
    id: 'T7',
    from: ActivityStatus.ASSIGNED,
    to: ActivityStatus.OVERDUE,
    actors: ['system'],
    sideEffects: {},
    event: ACTIVITY_EVENT.OVERDUE,
  },
  {
    id: 'T8',
    from: ActivityStatus.OVERDUE,
    to: ActivityStatus.ASSISTING,
    actors: ['assignee'],
    requireAssignee: true,
    sideEffects: { confirmedAt: true },
    event: ACTIVITY_EVENT.ASSISTING,
  },
  {
    id: 'T8',
    from: ActivityStatus.OVERDUE,
    to: ActivityStatus.NOT_ASSISTING,
    actors: ['assignee'],
    requireAssignee: true,
    sideEffects: { declinedAt: true },
    event: ACTIVITY_EVENT.NOT_ASSISTING,
  },
  {
    id: 'T9',
    from: ActivityStatus.NOT_ASSISTING,
    to: ActivityStatus.ASSIGNED,
    actors: ['bond_member'],
    sideEffects: { deadline: 'set' },
    event: ACTIVITY_EVENT.ASSIGNED,
  },
  {
    id: 'T10',
    from: ActivityStatus.ASSISTING,
    to: ActivityStatus.IN_PROGRESS,
    actors: ['system'],
    sideEffects: {},
    event: ACTIVITY_EVENT.IN_PROGRESS,
  },
  {
    id: 'T11',
    from: ActivityStatus.IN_PROGRESS,
    to: ActivityStatus.DONE,
    actors: ['system', 'bond_member'],
    sideEffects: { completedAt: true },
    event: ACTIVITY_EVENT.DONE,
  },
  ...CANCEL_SOURCES.map<TransitionRule>((from) => ({
    id: 'T15',
    from,
    to: ActivityStatus.CANCELLED,
    actors: ['bond_member'],
    sideEffects: CANCEL_EFFECTS,
    event: ACTIVITY_EVENT.CANCELLED,
  })),
];

const TRANSITIONS: ReadonlyMap<string, TransitionRule> = new Map(
  RULES.map((rule) => [`${rule.from}->${rule.to}`, rule]),
);

/** Looks up the confirmed rule for `from -> to`, or `undefined` (=> 409). */
export function resolveTransition(
  from: ActivityStatus,
  to: ActivityStatus,
): TransitionRule | undefined {
  return TRANSITIONS.get(`${from}->${to}`);
}

/** Initial state for `create`: T1 without assignee, T2 with one. */
export function resolveInitial(hasAssignee: boolean): InitialTransition {
  return hasAssignee
    ? { status: ActivityStatus.ASSIGNED, event: ACTIVITY_EVENT.ASSIGNED }
    : { status: ActivityStatus.CREATED, event: ACTIVITY_EVENT.CREATED };
}
