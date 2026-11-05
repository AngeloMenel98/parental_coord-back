import { ConfigService } from '@nestjs/config';

import { DEFAULT_ENDPOINT_CONCURRENCY, EndpointLimiter, endpointHost } from './endpoint-limiter';

function limiterWithCap(cap: number | undefined): EndpointLimiter {
  const config = { get: jest.fn().mockReturnValue(cap) } as unknown as ConfigService;
  return new EndpointLimiter(config);
}

/** Tarea controlable: resuelve cuando se llama a `release`. */
function deferredTask() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('endpointHost (REQ-DEL-5)', () => {
  it('returns host including port', () => {
    expect(endpointHost('https://receiver.example:8443/hook?x=1')).toBe('receiver.example:8443');
  });

  it('returns the raw value for an invalid URL (never throws)', () => {
    expect(endpointHost('not a url')).toBe('not a url');
  });
});

describe('EndpointLimiter (T-W1.23, REQ-DEL-5, OQ-B)', () => {
  it('defaults to 5 when the config is absent', () => {
    expect(limiterWithCap(undefined).limit).toBe(DEFAULT_ENDPOINT_CONCURRENCY);
  });

  it('reads the configured cap', () => {
    expect(limiterWithCap(3).limit).toBe(3);
  });

  it('never exceeds the cap for the same host', async () => {
    const limiter = limiterWithCap(2);
    const first = deferredTask();
    const second = deferredTask();
    const third = deferredTask();
    let started = 0;

    const tasks = [first, second, third].map((task) =>
      limiter.run('h', async () => {
        started += 1;
        await task.promise;
      }),
    );

    await flush();
    // Sólo dos arrancan; el tercero espera su slot.
    expect(started).toBe(2);
    expect(limiter.activeCount('h')).toBe(2);

    first.release();
    await flush();
    expect(started).toBe(3);

    second.release();
    third.release();
    await Promise.all(tasks);
    expect(limiter.activeCount('h')).toBe(0);
  });

  it('applies the cap per host independently', async () => {
    const limiter = limiterWithCap(1);
    const other = deferredTask();
    const otherRun = limiter.run('other', async () => {
      await other.promise;
    });

    await flush();
    // 'other' ocupa su único slot, pero 'a' sigue libre.
    await limiter.run('a', async () => undefined);
    expect(limiter.activeCount('a')).toBe(0);

    other.release();
    await otherRun;
  });

  it('releases the slot even when the task throws', async () => {
    const limiter = limiterWithCap(1);
    await expect(
      limiter.run('h', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(limiter.activeCount('h')).toBe(0);
  });
});
