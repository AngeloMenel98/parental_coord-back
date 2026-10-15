import { ActivityStatus } from '../entities/activity.entity';
import {
  ACTIVITY_EVENT,
  InitialTransition,
  resolveInitial,
  resolveTransition,
  TransitionId,
} from '../activity-transition.map';
import {
  ACTIVITY_ERROR_CODES,
  CodedException,
  activityInvalidTransition,
} from '../../common/errors/coded.exception';
import { TimerKind } from '../../queues/activity-timers/activity-timers.constants';
import { timerOpsForTransition } from '../../queues/activity-timers/activity-timers.ops';

const {
  CREATED,
  ASSIGNED,
  ASSISTING,
  IN_PROGRESS,
  DONE,
  OVERDUE,
  NOT_ASSISTING,
  CANCELLED,
  VERIFY,
} = ActivityStatus;

describe('activity-transition map — resolveTransition (confirmed rules)', () => {
  const confirmed: ReadonlyArray<readonly [TransitionId, ActivityStatus, ActivityStatus, string]> =
    [
      ['T3', CREATED, ASSIGNED, ACTIVITY_EVENT.ASSIGNED],
      ['T4', ASSIGNED, CREATED, ACTIVITY_EVENT.UNASSIGNED],
      ['T5', ASSIGNED, ASSISTING, ACTIVITY_EVENT.ASSISTING],
      ['T6', ASSIGNED, NOT_ASSISTING, ACTIVITY_EVENT.NOT_ASSISTING],
      ['T7', ASSIGNED, OVERDUE, ACTIVITY_EVENT.OVERDUE],
      ['T8', OVERDUE, ASSISTING, ACTIVITY_EVENT.ASSISTING],
      ['T8', OVERDUE, NOT_ASSISTING, ACTIVITY_EVENT.NOT_ASSISTING],
      ['T9', NOT_ASSISTING, ASSIGNED, ACTIVITY_EVENT.ASSIGNED],
      ['T10', ASSISTING, IN_PROGRESS, ACTIVITY_EVENT.IN_PROGRESS],
      ['T11', IN_PROGRESS, DONE, ACTIVITY_EVENT.DONE],
      ['T15', CREATED, CANCELLED, ACTIVITY_EVENT.CANCELLED],
      ['T15', ASSIGNED, CANCELLED, ACTIVITY_EVENT.CANCELLED],
      ['T15', ASSISTING, CANCELLED, ACTIVITY_EVENT.CANCELLED],
      ['T15', NOT_ASSISTING, CANCELLED, ACTIVITY_EVENT.CANCELLED],
      ['T15', OVERDUE, CANCELLED, ACTIVITY_EVENT.CANCELLED],
      ['T15', IN_PROGRESS, CANCELLED, ACTIVITY_EVENT.CANCELLED],
    ];

  for (const [id, from, to, event] of confirmed) {
    it(`${id}: ${from} -> ${to} resolves with event ${event}`, () => {
      const rule = resolveTransition(from, to);
      expect(rule).toBeDefined();
      expect(rule?.id).toBe(id);
      expect(rule?.from).toBe(from);
      expect(rule?.to).toBe(to);
      expect(rule?.event).toBe(event);
    });
  }

  it('T5/T6/T8 are assignee-only and require the assignee', () => {
    for (const [from, to] of [
      [ASSIGNED, ASSISTING],
      [ASSIGNED, NOT_ASSISTING],
      [OVERDUE, ASSISTING],
      [OVERDUE, NOT_ASSISTING],
    ] as const) {
      const rule = resolveTransition(from, to);
      expect(rule?.actors).toEqual(['assignee']);
      expect(rule?.requireAssignee).toBe(true);
    }
  });

  it('T3/T4/T9/T15 admit bond members', () => {
    for (const [from, to] of [
      [CREATED, ASSIGNED],
      [ASSIGNED, CREATED],
      [NOT_ASSISTING, ASSIGNED],
      [ASSIGNED, CANCELLED],
    ] as const) {
      expect(resolveTransition(from, to)?.actors).toEqual(['bond_member']);
    }
  });

  it('T7/T10 are system-only; T11 admits system and bond members', () => {
    expect(resolveTransition(ASSIGNED, OVERDUE)?.actors).toEqual(['system']);
    expect(resolveTransition(ASSISTING, IN_PROGRESS)?.actors).toEqual(['system']);
    expect(resolveTransition(IN_PROGRESS, DONE)?.actors).toEqual(['system', 'bond_member']);
  });

  it('encodes the confirmed side-effects', () => {
    expect(resolveTransition(CREATED, ASSIGNED)?.sideEffects).toEqual({ deadline: 'set' });
    expect(resolveTransition(ASSIGNED, CREATED)?.sideEffects).toEqual({
      deadline: 'clear',
      confirmedAt: false,
    });
    expect(resolveTransition(ASSIGNED, ASSISTING)?.sideEffects).toEqual({
      deadline: 'clear',
      confirmedAt: true,
    });
    expect(resolveTransition(ASSIGNED, NOT_ASSISTING)?.sideEffects).toEqual({
      deadline: 'clear',
      declinedAt: true,
    });
    expect(resolveTransition(ASSIGNED, OVERDUE)?.sideEffects).toEqual({});
    expect(resolveTransition(OVERDUE, ASSISTING)?.sideEffects).toEqual({ confirmedAt: true });
    expect(resolveTransition(OVERDUE, NOT_ASSISTING)?.sideEffects).toEqual({ declinedAt: true });
    expect(resolveTransition(NOT_ASSISTING, ASSIGNED)?.sideEffects).toEqual({ deadline: 'set' });
    expect(resolveTransition(ASSISTING, IN_PROGRESS)?.sideEffects).toEqual({});
    expect(resolveTransition(IN_PROGRESS, DONE)?.sideEffects).toEqual({ completedAt: true });
    expect(resolveTransition(ASSIGNED, CANCELLED)?.sideEffects).toEqual({
      deadline: 'clear',
      cancelledAt: true,
    });
  });

  it('keeps the deadline on T8 (late response keeps the historical expiry)', () => {
    expect(resolveTransition(OVERDUE, ASSISTING)?.sideEffects.deadline).toBeUndefined();
    expect(resolveTransition(OVERDUE, NOT_ASSISTING)?.sideEffects.deadline).toBeUndefined();
  });
});

describe('activity-transition map — invalid pairs return undefined', () => {
  const invalid: ReadonlyArray<readonly [ActivityStatus, ActivityStatus]> = [
    [DONE, ASSIGNED],
    [DONE, CANCELLED],
    [DONE, IN_PROGRESS],
    [CANCELLED, DONE],
    [CANCELLED, ASSIGNED],
    [CREATED, DONE],
    [ASSIGNED, DONE],
    [ASSIGNED, IN_PROGRESS],
    [ASSISTING, OVERDUE],
    [ASSISTING, DONE],
    [IN_PROGRESS, ASSIGNED],
    [NOT_ASSISTING, DONE],
    [OVERDUE, DONE],
    [CREATED, OVERDUE],
    [VERIFY, DONE],
    [VERIFY, CANCELLED],
  ];

  for (const [from, to] of invalid) {
    it(`${from} -> ${to} is not part of the closed map`, () => {
      expect(resolveTransition(from, to)).toBeUndefined();
    });
  }

  it('terminal states have no outgoing rule for any target', () => {
    for (const to of Object.values(ActivityStatus)) {
      expect(resolveTransition(DONE, to)).toBeUndefined();
      expect(resolveTransition(CANCELLED, to)).toBeUndefined();
    }
  });
});

describe('activity-transition map — resolveInitial (T1/T2)', () => {
  it('lands on created without an assignee (T1)', () => {
    const initial: InitialTransition = resolveInitial(false);
    expect(initial).toEqual({ status: CREATED, event: ACTIVITY_EVENT.CREATED });
  });

  it('lands on assigned with an assignee (T2)', () => {
    const initial: InitialTransition = resolveInitial(true);
    expect(initial).toEqual({ status: ASSIGNED, event: ACTIVITY_EVENT.ASSIGNED });
  });

  it('does not expose T1/T2 through the keyed table (create is not an update)', () => {
    expect(resolveTransition(CREATED, ASSIGNED)?.id).toBe('T3');
  });
});

describe('timerOpsForTransition (design decision 7)', () => {
  it('-> assigned enqueues response-timeout, start and end', () => {
    expect(timerOpsForTransition(ASSIGNED)).toEqual([
      { action: 'enqueue', kind: TimerKind.RESPONSE_TIMEOUT },
      { action: 'enqueue', kind: TimerKind.START },
      { action: 'enqueue', kind: TimerKind.END },
    ]);
  });

  it('-> assisting cancels response-timeout and enqueues start and end', () => {
    expect(timerOpsForTransition(ASSISTING)).toEqual([
      { action: 'cancel', kind: TimerKind.RESPONSE_TIMEOUT },
      { action: 'enqueue', kind: TimerKind.START },
      { action: 'enqueue', kind: TimerKind.END },
    ]);
  });

  it('-> in_progress enqueues end only', () => {
    expect(timerOpsForTransition(IN_PROGRESS)).toEqual([
      { action: 'enqueue', kind: TimerKind.END },
    ]);
  });

  it('-> overdue re-enqueues start and end (late T8 flow)', () => {
    expect(timerOpsForTransition(OVERDUE)).toEqual([
      { action: 'enqueue', kind: TimerKind.START },
      { action: 'enqueue', kind: TimerKind.END },
    ]);
  });

  it('done/cancelled/not_assisting/created cancel every timer', () => {
    const cancellations = [
      { action: 'cancel', kind: TimerKind.RESPONSE_TIMEOUT },
      { action: 'cancel', kind: TimerKind.START },
      { action: 'cancel', kind: TimerKind.END },
    ];
    for (const to of [DONE, CANCELLED, NOT_ASSISTING, CREATED]) {
      expect(timerOpsForTransition(to)).toEqual(cancellations);
    }
  });

  it('returns no ops for out-of-scope targets', () => {
    expect(timerOpsForTransition(VERIFY)).toEqual([]);
  });
});

describe('activityInvalidTransition (409)', () => {
  it('is a 409 CodedException with the stable code and {from,to} context', () => {
    const error = activityInvalidTransition('assigned', 'done');
    expect(error).toBeInstanceOf(CodedException);
    expect(error.getStatus()).toBe(409);
    const body = error.getResponse() as Record<string, unknown>;
    expect(body.code).toBe(ACTIVITY_ERROR_CODES.INVALID_TRANSITION);
    expect(body.code).toBe('ACTIVITY_INVALID_TRANSITION');
    expect(body.details).toEqual({ from: 'assigned', to: 'done' });
  });

  it('accepts a custom message', () => {
    const error = activityInvalidTransition('done', 'assigned', 'frozen');
    const body = error.getResponse() as Record<string, unknown>;
    expect(body.message).toBe('frozen');
  });
});
