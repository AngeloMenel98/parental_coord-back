import { ActivityChangedMessageV1 } from './activity-changed-message';
import { ExpenseChangedMessageV1 } from './expense-changed-message';
import { NotificationCreatedMessageV1 } from './notification-created-message';

/**
 * Every frame the API subscriber can receive from `REALTIME_CHANNEL` (slice 3).
 *
 * One channel, many frame types: consumers MUST branch on `type` instead of
 * assuming an `activity.changed` shape. That assumption is exactly what made an
 * unknown frame reach the gateway with `bondId === undefined`.
 */
export type RealtimeMessageV1 =
  ActivityChangedMessageV1 | ExpenseChangedMessageV1 | NotificationCreatedMessageV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** `activity.changed` needs a bond: delivery resolves its audience from that id. */
function isActivityChanged(value: Record<string, unknown>): boolean {
  return isString(value.bondId) && isString(value.eventId);
}

/** `expense.changed` needs a bond: delivery resolves its audience from that id. */
function isExpenseChanged(value: Record<string, unknown>): boolean {
  return isString(value.bondId) && isString(value.eventId) && isString(value.expenseId);
}

/** `notification.created` needs the recipient: delivery is per-user, not per-bond. */
function isNotificationCreated(value: Record<string, unknown>): boolean {
  return (
    isString(value.notificationId) &&
    isString(value.userId) &&
    isString(value.notificationType) &&
    isString(value.refEntityType) &&
    (value.refEntityId === null || isString(value.refEntityId)) &&
    isString(value.occurredAt)
  );
}

/**
 * Parses one raw channel payload into a typed frame.
 *
 * - Invalid JSON throws (the caller logs the reason it could not be parsed).
 * - An unknown `type`, a wrong `v`, or a known type missing its required
 *   identity fields returns `null`: the frame is dropped instead of being
 *   forwarded with fields the gateway would later read as `undefined`.
 */
export function parseRealtimeFrame(raw: string): RealtimeMessageV1 | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== 1) return null;

  switch (parsed.type) {
    case 'activity.changed':
      return isActivityChanged(parsed) ? (parsed as unknown as ActivityChangedMessageV1) : null;
    case 'expense.changed':
      return isExpenseChanged(parsed) ? (parsed as unknown as ExpenseChangedMessageV1) : null;
    case 'notification.created':
      return isNotificationCreated(parsed)
        ? (parsed as unknown as NotificationCreatedMessageV1)
        : null;
    default:
      return null;
  }
}
