/**
 * v1 `notification.created` realtime frame (slice 3).
 *
 * Minimal by design: the socket carries an identity + a "go read" hint, never the
 * notification text. The client fetches the row over REST (DB is the source of
 * truth) so a frame can never leak more than the recipient is allowed to read.
 *
 * `userId` is the ROUTING key, not content: the publisher needs it to pick the
 * sockets (a single Redis channel is shared by every user), and the gateway
 * strips it before the socket write — the owner already knows who they are, and
 * no other user ever sees the frame.
 */
export interface NotificationCreatedMessageV1 {
  v: 1;
  type: 'notification.created';
  notificationId: string;
  userId: string;
  notificationType: string;
  refEntityType: string;
  refEntityId: string | null;
  occurredAt: string;
}

/**
 * What the fan-out knows about a row it actually inserted. `null` from the
 * repository means the `ON CONFLICT DO NOTHING` collapsed a re-dispatch: that
 * row is never turned into a ref, so no frame is emitted for it.
 */
export interface CreatedNotificationRef {
  id: string;
  userId: string;
  type: string;
  refEntityType: string;
  refEntityId: string | null;
}

/**
 * Builds the frame for one created notification.
 *
 * `occurredAt` is stamped by the caller at publish time: `createFromEvent` only
 * returns the generated id, so the row's `created_at` is not available here and
 * re-reading it would add a query per recipient for a purely cosmetic field.
 */
export function buildNotificationCreatedMessage(
  notification: CreatedNotificationRef,
  occurredAt: string,
): NotificationCreatedMessageV1 {
  return {
    v: 1,
    type: 'notification.created',
    notificationId: notification.id,
    userId: notification.userId,
    notificationType: notification.type,
    refEntityType: notification.refEntityType,
    refEntityId: notification.refEntityId,
    occurredAt,
  };
}
