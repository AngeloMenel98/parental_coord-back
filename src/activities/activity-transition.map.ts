import { ActivityStatus } from './entities/activity.entity';

/** Who may execute a rule. Authorization itself lives in the service (E5). */
export type TransitionActor = 'assignee' | 'bond_member' | 'system';

/** Closed set of confirmed transitions (REQ-TRANS-1). */
export type TransitionId =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T5'
  | 'T6'
  | 'T7'
  | 'T8'
  | 'T9'
  | 'T10'
  | 'T11'
  | 'T12'
  | 'T13'
  | 'T14'
  | 'T15'
  | 'T16';

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
  verifyAt?: boolean;
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
  VERIFY: 'activity.verify',
  VERIFY_EXPIRED: 'activity.verify_expired',
  CREATED_OVERDUE: 'activity.created_overdue',
  OVERDUE: 'activity.overdue',
  NOT_ASSISTING: 'activity.not_assisting',
  DONE: 'activity.done',
  CANCELLED: 'activity.cancelled',
} as const;

// Cancelar (T15) limpia la ventana que se estaba esperando: `deadline` y también
// `verify_at`, para que una fila cancelada desde `verify` no conserve la marca de
// que pasó por la ventana de verificación.
const CANCEL_EFFECTS: TransitionSideEffects = {
  deadline: 'clear',
  cancelledAt: true,
  verifyAt: false,
};

const CANCEL_SOURCES: readonly ActivityStatus[] = [
  ActivityStatus.CREATED,
  ActivityStatus.ASSIGNED,
  ActivityStatus.ASSISTING,
  ActivityStatus.NOT_ASSISTING,
  ActivityStatus.OVERDUE,
  ActivityStatus.IN_PROGRESS,
  ActivityStatus.VERIFY,
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
    // ⚠ La aceptación TARDÍA (`overdue → assisting`) SE FUERA (decisión del usuario,
    // 2026-11-03): una actividad cuya ventana de 36 h ya venció no se puede
    // confirmar tarde. Antes el botón "Confirmar" quedaba vivo en `overdue` y el
    // asignado podía rescatar la actividad — lo que pasó con "A largo plazo".
    //
    // La fila `overdue` de la matriz conserva SÓLO el "No asiste" (T8): el que no
    // aceptó en la ventana devuelve la actividad, y de ahí la reasigna cualquiera
    // (T9). Sin esa salida, una actividad vencida sería un callejón sin salida.
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
    // Reassignment starts the new assignee from a clean sheet: clear the
    // previous assignee's decline/confirm timestamps (T21).
    sideEffects: { deadline: 'set', declinedAt: false, confirmedAt: false },
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
    // T11 · cierre temprano: el miembro puede marcar la actividad como
    // TERMINADA antes de que termine su horario. El sistema ya NO cierra desde
    // `in_progress` (el timer END va a `verify`), pero la capacidad que la app
    // tenía desde antes no se le quita a nadie sin que nadie lo pida.
    id: 'T11',
    from: ActivityStatus.IN_PROGRESS,
    to: ActivityStatus.DONE,
    actors: ['bond_member'],
    sideEffects: { completedAt: true },
    event: ACTIVITY_EVENT.DONE,
  },
  {
    id: 'T12',
    from: ActivityStatus.IN_PROGRESS,
    to: ActivityStatus.VERIFY,
    actors: ['system'],
    sideEffects: { deadline: 'set', verifyAt: true },
    event: ACTIVITY_EVENT.VERIFY,
  },
  {
    id: 'T13',
    from: ActivityStatus.VERIFY,
    to: ActivityStatus.DONE,
    actors: ['bond_member'],
    sideEffects: { deadline: 'clear', completedAt: true, verifyAt: false },
    event: ACTIVITY_EVENT.DONE,
  },
  {
    id: 'T14',
    from: ActivityStatus.VERIFY,
    to: ActivityStatus.OVERDUE,
    actors: ['system'],
    sideEffects: { deadline: 'clear' },
    event: ACTIVITY_EVENT.VERIFY_EXPIRED,
  },
  {
    id: 'T16',
    from: ActivityStatus.CREATED,
    to: ActivityStatus.OVERDUE,
    actors: ['system'],
    sideEffects: { deadline: 'clear' },
    event: ACTIVITY_EVENT.CREATED_OVERDUE,
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
