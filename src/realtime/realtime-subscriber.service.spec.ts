import { ConfigService } from '@nestjs/config';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    subscribe: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn(),
    on: jest.fn(),
  })),
}));

import Redis from 'ioredis';

import { REALTIME_CHANNEL } from './realtime.constants';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

const RedisMock = Redis as unknown as jest.Mock;

type RedisMockInstance = {
  subscribe: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
};

/** The mocked ioredis instance returned by the last `new Redis(...)`. */
function redisClient(): RedisMockInstance {
  return RedisMock.mock.results[0].value;
}

/** Handler registered via `redis.on(event, handler)`. */
function redisHandler(event: string): (...args: unknown[]) => void {
  const call = redisClient().on.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no handler registered for "${event}"`);
  return call[1] as (...args: unknown[]) => void;
}

function config(): ConfigService {
  return { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
}

const FRAME = {
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

/** API subscriber (REQ-3/REQ-4): subscribe lifecycle + parsed frames on Subject. */
describe('RealtimeSubscriberService (REQ-3/REQ-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RedisMock.mockImplementation(() => ({
      subscribe: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn(),
      on: jest.fn(),
    }));
  });

  it('subscribes to REALTIME_CHANNEL on module init with its own dedicated client', () => {
    new RealtimeSubscriberService(config()).onModuleInit();

    expect(RedisMock).toHaveBeenCalledTimes(1);
    expect(redisClient().subscribe).toHaveBeenCalledWith(REALTIME_CHANNEL);
  });

  it('re-subscribes on the ready event (initial connect + reconnects)', () => {
    const service = new RealtimeSubscriberService(config());
    service.onModuleInit();
    const subscribeBefore = redisClient().subscribe.mock.calls.length;

    redisHandler('ready')();

    expect(redisClient().subscribe.mock.calls.length).toBe(subscribeBefore + 1);
    expect(redisClient().subscribe).toHaveBeenLastCalledWith(REALTIME_CHANNEL);
  });

  it('emits parsed frames on messages$ for the realtime channel', () => {
    const service = new RealtimeSubscriberService(config());
    const seen: unknown[] = [];
    service.messages$.subscribe((message) => seen.push(message));

    redisHandler('message')(REALTIME_CHANNEL, JSON.stringify(FRAME));

    expect(seen).toEqual([FRAME]);
  });

  it('ignores frames from other channels', () => {
    const service = new RealtimeSubscriberService(config());
    const seen: unknown[] = [];
    service.messages$.subscribe((message) => seen.push(message));

    redisHandler('message')('other:channel', JSON.stringify(FRAME));

    expect(seen).toEqual([]);
  });

  it('drops malformed JSON without emitting or throwing', () => {
    const service = new RealtimeSubscriberService(config());
    const seen: unknown[] = [];
    service.messages$.subscribe((message) => seen.push(message));

    expect(() => redisHandler('message')(REALTIME_CHANNEL, '{not json')).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('disconnects its dedicated client and completes the subject on destroy', () => {
    const service = new RealtimeSubscriberService(config());
    const completed = jest.fn();
    service.messages$.subscribe({ complete: completed });

    service.onModuleDestroy();

    expect(redisClient().disconnect).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });
});
