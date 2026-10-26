import { buildNotificationCreatedMessage } from './notification-created-message';

/**
 * `notification.created` v1 frame (slice 3, S1).
 *
 * The frame is identity + a refetch hint. Above all it must NEVER carry the
 * notification text: the recipient reads the row over REST, so the socket can
 * never become a second, unguarded read path.
 */
describe('buildNotificationCreatedMessage', () => {
  const occurredAt = '2026-10-26T10:00:00.000Z';

  it('maps a created notification to the exact v1 frame', () => {
    const message = buildNotificationCreatedMessage(
      {
        id: 'n1',
        userId: 'u2',
        type: 'activity_assigned',
        refEntityType: 'activity',
        refEntityId: 'a1',
      },
      occurredAt,
    );

    expect(message).toEqual({
      v: 1,
      type: 'notification.created',
      notificationId: 'n1',
      userId: 'u2',
      notificationType: 'activity_assigned',
      refEntityType: 'activity',
      refEntityId: 'a1',
      occurredAt,
    });
  });

  it('keeps a notification without a reference entity (refEntityId null)', () => {
    const message = buildNotificationCreatedMessage(
      {
        id: 'n1',
        userId: 'u2',
        type: 'webhook_disabled',
        refEntityType: 'webhook_subscription',
        refEntityId: null,
      },
      occurredAt,
    );

    expect(message.refEntityId).toBeNull();
  });

  it('never leaks title/body even if the source object carries them', () => {
    const message = buildNotificationCreatedMessage(
      {
        id: 'n1',
        userId: 'u2',
        type: 'activity_assigned',
        refEntityType: 'activity',
        refEntityId: 'a1',
        title: 'New activity: Ir al pediatra',
        body: 'New activity: Ir al pediatra',
      } as never,
      occurredAt,
    );

    expect(message).not.toHaveProperty('title');
    expect(message).not.toHaveProperty('body');
  });
});
