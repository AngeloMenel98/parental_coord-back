import { parseRealtimeFrame } from './realtime-message';

const ACTIVITY = {
  v: 1,
  type: 'activity.changed',
  eventId: 'e1',
  activityId: 'a1',
  bondId: 'b1',
  from: 'assigned',
  to: 'assisting',
  actor: { type: 'user', id: 'u1' },
  occurredAt: '2026-10-16T14:22:31.412Z',
};

const NOTIFICATION = {
  v: 1,
  type: 'notification.created',
  notificationId: 'n1',
  userId: 'u2',
  notificationType: 'activity_assigned',
  refEntityType: 'activity',
  refEntityId: 'a1',
  occurredAt: '2026-10-26T10:00:00.000Z',
};

/**
 * Frame discriminator (slice 3, S5): one channel carries every frame type, so
 * the subscriber must never forward something the gateway cannot route.
 */
describe('parseRealtimeFrame', () => {
  it('parses an activity.changed frame', () => {
    expect(parseRealtimeFrame(JSON.stringify(ACTIVITY))).toEqual(ACTIVITY);
  });

  it('parses a notification.created frame', () => {
    expect(parseRealtimeFrame(JSON.stringify(NOTIFICATION))).toEqual(NOTIFICATION);
  });

  it('accepts a notification without a reference entity', () => {
    const frame = { ...NOTIFICATION, refEntityId: null };
    expect(parseRealtimeFrame(JSON.stringify(frame))).toEqual(frame);
  });

  it('drops an unknown frame type', () => {
    expect(parseRealtimeFrame(JSON.stringify({ ...ACTIVITY, type: 'bond.deleted' }))).toBeNull();
  });

  it('drops a frame with a wrong protocol version', () => {
    expect(parseRealtimeFrame(JSON.stringify({ ...ACTIVITY, v: 2 }))).toBeNull();
  });

  it('drops an activity frame without a bondId (nothing to resolve an audience from)', () => {
    const { bondId, ...withoutBond } = ACTIVITY;
    expect(parseRealtimeFrame(JSON.stringify(withoutBond))).toBeNull();
  });

  it('drops a notification frame without the recipient (nothing to route it to)', () => {
    const { userId, ...withoutUser } = NOTIFICATION;
    expect(parseRealtimeFrame(JSON.stringify(withoutUser))).toBeNull();
  });

  it('throws on invalid JSON so the caller can log the reason', () => {
    expect(() => parseRealtimeFrame('{not json')).toThrow();
  });
});
