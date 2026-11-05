import { ConfigService } from '@nestjs/config';

import { OutboxEventEntity } from '../outbox/entities/outbox-event.entity';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
  })),
}));

import Redis from 'ioredis';

import { REALTIME_CHANNEL } from './realtime.constants';
import { RealtimePublisher } from './realtime-publisher.service';

const RedisMock = Redis as unknown as jest.Mock;

/** ConfigService stub returning a fixed REALTIME_PUBLISH_ENABLED value. */
function config(value: string | undefined): ConfigService {
  return { get: jest.fn().mockReturnValue(value) } as unknown as ConfigService;
}

/** The mocked ioredis instance returned by the last `new Redis(...)`. */
function redisClient(): { publish: jest.Mock; disconnect: jest.Mock } {
  return RedisMock.mock.results[0].value;
}

function event(): OutboxEventEntity {
  return {
    id: 'e1',
    aggregateId: 'a1',
    bondId: 'b1',
    eventType: 'activity.assigned',
    aggregateVersion: 2,
    payload: {
      activityId: 'a1',
      from: 'assigned',
      to: 'assisting',
      actor: { type: 'user', id: 'u1' },
      reason: null,
      occurredAt: '2026-10-16T14:22:31.412Z',
    },
    createdAt: new Date('2026-10-16T14:22:31.412Z'),
    dispatchedAt: null,
  } as unknown as OutboxEventEntity;
}

function expenseEvent(): OutboxEventEntity {
  return {
    id: 'e2',
    aggregateType: 'expense',
    aggregateId: 'exp-1',
    bondId: 'b2',
    eventType: 'expense.approved',
    aggregateVersion: 2,
    payload: {
      actor: { type: 'user', id: 'u2' },
      status: 'approved',
    },
    createdAt: new Date('2026-10-16T14:22:31.412Z'),
    dispatchedAt: null,
  } as unknown as OutboxEventEntity;
}

/**
 * Worker publisher (REQ-4): exactly one publish per event on the realtime
 * channel, a no-op when the flag is off, and Redis failures are swallowed.
 */
describe('RealtimePublisher (REQ-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RedisMock.mockImplementation(() => ({
      publish: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
    }));
  });

  it('publishes one JSON frame per event on REALTIME_CHANNEL', async () => {
    const publisher = new RealtimePublisher(config('true'));
    const redis = redisClient();

    await publisher.publish(event());

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = redis.publish.mock.calls[0];
    expect(channel).toBe(REALTIME_CHANNEL);
    expect(JSON.parse(raw as string)).toEqual({
      v: 1,
      type: 'activity.changed',
      eventId: 'e1',
      activityId: 'a1',
      bondId: 'b1',
      from: 'assigned',
      to: 'assisting',
      actor: { type: 'user', id: 'u1' },
      occurredAt: '2026-10-16T14:22:31.412Z',
    });
  });

  it('treats a missing flag as enabled', async () => {
    const publisher = new RealtimePublisher(config(undefined));
    await publisher.publish(event());

    expect(redisClient().publish).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when REALTIME_PUBLISH_ENABLED=false (no client is even created)', async () => {
    const publisher = new RealtimePublisher(config('false'));

    await publisher.publish(event());

    expect(RedisMock).not.toHaveBeenCalled();
  });

  it('swallows a Redis publish failure (never throws)', async () => {
    const publisher = new RealtimePublisher(config('true'));
    redisClient().publish.mockRejectedValueOnce(new Error('redis down'));

    await expect(publisher.publish(event())).resolves.toBeUndefined();
  });

  it('disconnects its dedicated client on module destroy', () => {
    const publisher = new RealtimePublisher(config('true'));

    publisher.onModuleDestroy();

    expect(redisClient().disconnect).toHaveBeenCalledTimes(1);
  });

  describe('expense.changed (S8, T26)', () => {
    it('publishes one JSON frame per expense event on REALTIME_CHANNEL', async () => {
      const publisher = new RealtimePublisher(config('true'));
      const redis = redisClient();

      await publisher.publishExpenseChanged(expenseEvent());

      expect(redis.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = redis.publish.mock.calls[0];
      expect(channel).toBe(REALTIME_CHANNEL);
      expect(JSON.parse(raw as string)).toEqual({
        v: 1,
        type: 'expense.changed',
        eventId: 'e2',
        expenseId: 'exp-1',
        bondId: 'b2',
        status: 'approved',
        actor: { type: 'user', id: 'u2' },
        occurredAt: '2026-10-16T14:22:31.412Z',
      });
    });

    it('is a no-op when REALTIME_PUBLISH_ENABLED=false', async () => {
      const publisher = new RealtimePublisher(config('false'));

      await publisher.publishExpenseChanged(expenseEvent());

      expect(RedisMock).not.toHaveBeenCalled();
    });

    it('swallows a Redis publish failure for an expense frame (never throws)', async () => {
      const publisher = new RealtimePublisher(config('true'));
      redisClient().publish.mockRejectedValueOnce(new Error('redis down'));

      await expect(publisher.publishExpenseChanged(expenseEvent())).resolves.toBeUndefined();
    });
  });

  describe('notification.created (slice 3)', () => {
    const created = {
      id: 'n1',
      userId: 'u2',
      type: 'activity.assigned',
      refEntityType: 'activity',
      refEntityId: 'a1',
    };

    it('publishes one minimal frame per created notification, without title/body', async () => {
      const publisher = new RealtimePublisher(config('true'));
      const redis = redisClient();

      await publisher.publishNotificationCreated(created, '2026-10-26T10:00:00.000Z');

      expect(redis.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = redis.publish.mock.calls[0];
      expect(channel).toBe(REALTIME_CHANNEL);
      expect(JSON.parse(raw as string)).toEqual({
        v: 1,
        type: 'notification.created',
        notificationId: 'n1',
        userId: 'u2',
        notificationType: 'activity.assigned',
        refEntityType: 'activity',
        refEntityId: 'a1',
        occurredAt: '2026-10-26T10:00:00.000Z',
      });
    });

    it('stamps occurredAt at publish time when the caller does not pass one', async () => {
      const publisher = new RealtimePublisher(config('true'));

      await publisher.publishNotificationCreated(created);

      const raw = redisClient().publish.mock.calls[0][1] as string;
      const frame = JSON.parse(raw) as { occurredAt: string };
      expect(Number.isNaN(Date.parse(frame.occurredAt))).toBe(false);
    });

    it('keeps a null refEntityId (notification without a target entity)', async () => {
      const publisher = new RealtimePublisher(config('true'));

      await publisher.publishNotificationCreated({ ...created, refEntityId: null });

      const raw = redisClient().publish.mock.calls[0][1] as string;
      expect(JSON.parse(raw)).toMatchObject({ refEntityId: null });
    });

    it('is a no-op when publishing is disabled', async () => {
      const publisher = new RealtimePublisher(config('false'));

      await publisher.publishNotificationCreated(created);

      expect(RedisMock).not.toHaveBeenCalled();
    });

    it('swallows a Redis failure for a notification frame (never throws)', async () => {
      const publisher = new RealtimePublisher(config('true'));
      redisClient().publish.mockRejectedValueOnce(new Error('redis down'));

      await expect(publisher.publishNotificationCreated(created)).resolves.toBeUndefined();
    });
  });
});
