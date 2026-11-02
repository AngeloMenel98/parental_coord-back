import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';

/** Actor of the change (`system` carries no id/role). */
export interface ExpenseChangedActor {
  type: string;
  id?: string;
  role?: string;
}

/**
 * v1 `expense.changed` realtime signal frame (S8, T26).
 *
 * The client treats it as a generic "refetch" hint: it never branches on the
 * payload, it only uses `v`/`type` to accept the frame and then runs a full
 * REST resync of the expense summary and list (DB is the source of truth).
 * The index signature covers any `payloadExtra` passthrough keys that the
 * outbox spreads into `payload` at write time.
 */
export interface ExpenseChangedMessageV1 {
  v: 1;
  type: 'expense.changed';
  eventId: string;
  expenseId: string;
  bondId: string;
  status: string;
  actor: ExpenseChangedActor;
  occurredAt: string;
  [extra: string]: unknown;
}

/**
 * ALL reserved top-level keys of the frame (envelope + payload-mapped
 * fields). Extras coming from the outbox payload are denylisted against this
 * set so a buggy/malicious payload can never clobber the contract fields.
 */
const RESERVED_MESSAGE_KEYS = new Set([
  'v',
  'type',
  'eventId',
  'bondId',
  'expenseId',
  'status',
  'actor',
  'occurredAt',
]);

/**
 * Maps one expense outbox event to the single `expense.changed` frame.
 *
 * Field-for-field from `e.payload`, with `eventId` from `e.id`, `expenseId`
 * from `e.aggregateId`, `bondId` from `e.bondId`, and `occurredAt` from
 * `e.createdAt` (the expense payload does not carry its own timestamp).
 * Null/undefined payload keys are dropped.
 */
export function buildExpenseChangedMessage(e: OutboxEventEntity): ExpenseChangedMessageV1 {
  const payload = e.payload ?? {};

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_MESSAGE_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    extras[key] = value;
  }

  return {
    v: 1,
    type: 'expense.changed',
    eventId: e.id,
    expenseId: e.aggregateId,
    bondId: e.bondId,
    status: payload.status as string,
    actor: payload.actor as ExpenseChangedActor,
    occurredAt: e.createdAt.toISOString(),
    ...extras,
  };
}
