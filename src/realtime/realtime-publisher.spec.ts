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
});
