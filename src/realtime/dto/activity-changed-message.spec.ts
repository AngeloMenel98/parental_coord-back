import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { buildActivityChangedMessage } from './activity-changed-message';

function outboxEvent(overrides: Partial<OutboxEventEntity>): OutboxEventEntity {
  return {
    id: 'evt-1',
    aggregateId: 'act-1',
    bondId: 'bond-1',
    eventType: 'activity.assigned',
    aggregateVersion: 2,
    payload: {},
    createdAt: new Date('2026-10-16T14:22:31.412Z'),
    dispatchedAt: null,
    ...overrides,
  } as OutboxEventEntity;
}

/**
 * `activity.changed` mapping (REQ-2, spec appendix): field-for-field from the
 * outbox payload, `from:'new'` kept as-is for creation, and `payloadExtra`
 * passthrough (`deleted`, `reason`).
 */
describe('buildActivityChangedMessage (REQ-2)', () => {
  it('maps a canonical transition and drops the null reason', () => {
    const message = buildActivityChangedMessage(
      outboxEvent({
        payload: {
          activityId: 'act-1',
          from: 'assigned',
          to: 'assisting',
          actor: { type: 'user', id: 'u-1', role: 'child' },
          reason: null,
          occurredAt: '2026-10-16T14:22:31.412Z',
        },
      }),
    );

    expect(message).toEqual({
      v: 1,
      type: 'activity.changed',
      eventId: 'evt-1',
      activityId: 'act-1',
      bondId: 'bond-1',
      from: 'assigned',
      to: 'assisting',
      actor: { type: 'user', id: 'u-1', role: 'child' },
      occurredAt: '2026-10-16T14:22:31.412Z',
    });
    expect('reason' in message).toBe(false);
  });

  it("keeps from:'new' for activity.created and falls back to aggregateId", () => {
    const message = buildActivityChangedMessage(
      outboxEvent({
        eventType: 'activity.created',
        payload: {
          from: 'new',
          to: 'created',
          actor: { type: 'user', id: 'u-1' },
          occurredAt: '2026-10-16T09:00:00.000Z',
        },
      }),
    );

    expect(message.from).toBe('new');
    expect(message.to).toBe('created');
    // The create path omits `activityId` from the payload → canonical aggregateId.
    expect(message.activityId).toBe('act-1');
    expect(message.occurredAt).toBe('2026-10-16T09:00:00.000Z');
  });

  it('passes payloadExtra through top-level (reason + deleted)', () => {
    const message = buildActivityChangedMessage(
      outboxEvent({
        eventType: 'activity.cancelled',
        payload: {
          activityId: 'act-1',
          from: 'assigned',
          to: 'cancelled',
          actor: { type: 'user', id: 'u-1', role: 'parent' },
          reason: 'Conflicto de horario',
          occurredAt: '2026-10-16T15:10:00.000Z',
          deleted: true,
        },
      }),
    );

    expect(message).toEqual({
      v: 1,
      type: 'activity.changed',
      eventId: 'evt-1',
      activityId: 'act-1',
      bondId: 'bond-1',
      from: 'assigned',
      to: 'cancelled',
      actor: { type: 'user', id: 'u-1', role: 'parent' },
      occurredAt: '2026-10-16T15:10:00.000Z',
      reason: 'Conflicto de horario',
      deleted: true,
    });
  });

  it('never lets payload extras clobber reserved contract keys', () => {
    const message = buildActivityChangedMessage(
      outboxEvent({
        payload: {
          activityId: 'act-1',
          from: 'assigned',
          to: 'assisting',
          actor: { type: 'user', id: 'u-1', role: 'child' },
          occurredAt: '2026-10-16T14:22:31.412Z',
          // Forged envelope keys that would otherwise ride the extras spread.
          v: 99,
          type: 'evil.changed',
          eventId: 'evt-forged',
          bondId: 'bond-forged',
          deleted: true,
        },
      }),
    );

    expect(message.v).toBe(1);
    expect(message.type).toBe('activity.changed');
    expect(message.eventId).toBe('evt-1');
    expect(message.bondId).toBe('bond-1');
    // Payload-mapped reserved keys stay authoritative too.
    expect(message.to).toBe('assisting');
    // Non-colliding extras still pass through alongside the forged keys.
    expect(message.deleted).toBe(true);
  });
});
