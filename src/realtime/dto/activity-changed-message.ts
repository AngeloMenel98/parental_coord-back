import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';

/** Actor of the transition (`system` carries no id/role). */
export interface ActivityChangedActor {
  type: string;
  id?: string;
  role?: string;
}

/**
 * v1 realtime signal frame (spec appendix, REQ-2).
 *
 * The client treats it as a generic "refetch" hint: it never branches on the
 * event type, it only uses `v`/`type` to accept the frame and then runs a full
 * REST resync (DB is the source of truth). The index signature covers the
 * `payloadExtra` passthrough keys (`deleted`, `reason`, …) that the outbox
 * spreads into `payload` at write time.
 */
export interface ActivityChangedMessageV1 {
  v: 1;
  type: 'activity.changed';
  eventId: string;
  activityId: string;
  bondId: string;
  from: string;
  to: string;
  actor: ActivityChangedActor;
  reason?: string | null;
  deleted?: boolean;
  occurredAt: string;
  [extra: string]: unknown;
}

/**
 * ALL reserved top-level keys of the frame (envelope + payload-mapped
 * fields). Extras coming from the outbox payload are denylisted against this
 * set so a buggy/malicious payload (e.g. `{ eventId: 'x' }`) can never clobber
 * the contract fields.
 */
const RESERVED_MESSAGE_KEYS = new Set([
  'v',
  'type',
  'eventId',
  'bondId',
  'activityId',
  'from',
  'to',
  'actor',
  'occurredAt',
  'reason',
]);

/**
 * Maps one outbox event to the single `activity.changed` frame (REQ-2).
 *
 * Field-for-field from `e.payload` (the outbox row already carries
 * `from`/`to`/`actor`/`occurredAt` plus any `payloadExtra`), with `eventId`
 * from `e.id` and `bondId` from `e.bondId`. `activity.created` events omit
 * `activityId` from the payload, so it falls back to `aggregateId` (the
 * canonical activity reference). Null/undefined payload keys are dropped so
 * the emitted frame matches the exact examples in the spec appendix — notably a
 * plain transition carries `reason: null` in the payload but the frame omits it.
 */
export function buildActivityChangedMessage(e: OutboxEventEntity): ActivityChangedMessageV1 {
  const payload = e.payload ?? {};

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_MESSAGE_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    extras[key] = value;
  }

  const message: ActivityChangedMessageV1 = {
    v: 1,
    type: 'activity.changed',
    eventId: e.id,
    activityId: (payload.activityId as string | undefined) ?? e.aggregateId,
    bondId: e.bondId,
    from: payload.from as string,
    to: payload.to as string,
    actor: payload.actor as ActivityChangedActor,
    occurredAt: payload.occurredAt as string,
    ...extras,
  };

  if (payload.reason !== null && payload.reason !== undefined) {
    message.reason = payload.reason as string;
  }

  return message;
}
