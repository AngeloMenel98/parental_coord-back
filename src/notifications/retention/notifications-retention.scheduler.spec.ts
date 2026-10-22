import { readFileSync } from 'fs';
import { join } from 'path';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_NOTIFICATIONS_RETENTION_INTERVAL_MS,
  NOTIFICATIONS_RETENTION_SCHEDULER_ID,
  NotificationRetentionJobName,
} from './notifications-retention.constants';
import { NotificationsRetentionScheduler } from './notifications-retention.scheduler';

/**
 * Constructor del scheduler con la COLA y la configuración DOBLEADAS:
 * el spec es unitario y NUNCA toca Redis.
 */
function scheduler(intervalMs?: number, upsert = jest.fn().mockResolvedValue(undefined)) {
  const queue = { upsertJobScheduler: upsert } as unknown as Queue;
  const config = {
    get: jest.fn((key: string) =>
      key === 'NOTIFICATIONS_RETENTION_INTERVAL_MS' ? intervalMs : undefined,
    ),
  } as unknown as ConfigService;
  return { instance: new NotificationsRetentionScheduler(queue, config), upsert };
}

describe('NotificationsRetentionScheduler (notifications-hygiene, slice 1 — task 4.2, R4)', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('upserts the scheduler on init with the FULL three-argument shape', async () => {
    const { instance, upsert } = scheduler(3_600_000);

    await instance.onModuleInit();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      NOTIFICATIONS_RETENTION_SCHEDULER_ID,
      { every: 3_600_000 },
      { name: NotificationRetentionJobName.RETENTION, data: {} },
    );
    // El nombre del job es 'retention' y el id del scheduler NO es un cron.
    expect(upsert.mock.calls[0][2].name).toBe('retention');
    expect(NOTIFICATIONS_RETENTION_SCHEDULER_ID).toBe('notifications-retention');
  });

  it('uses the CONFIGURED interval', async () => {
    const { instance, upsert } = scheduler(600_000);

    await instance.onModuleInit();

    expect(upsert).toHaveBeenCalledWith(
      NOTIFICATIONS_RETENTION_SCHEDULER_ID,
      { every: 600_000 },
      { name: NotificationRetentionJobName.RETENTION, data: {} },
    );
  });

  it('falls back to the default 24h interval when the config key is absent', async () => {
    const { instance, upsert } = scheduler(undefined);

    await instance.onModuleInit();

    expect(DEFAULT_NOTIFICATIONS_RETENTION_INTERVAL_MS).toBe(86_400_000);
    expect(upsert).toHaveBeenCalledWith(
      NOTIFICATIONS_RETENTION_SCHEDULER_ID,
      { every: 86_400_000 },
      { name: NotificationRetentionJobName.RETENTION, data: {} },
    );
  });

  it('is idempotent: two inits issue two IDENTICAL upserts and never throw', async () => {
    const { instance, upsert } = scheduler(3_600_000);

    await expect(instance.onModuleInit()).resolves.toBeUndefined();
    await expect(instance.onModuleInit()).resolves.toBeUndefined();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]).toEqual(upsert.mock.calls[1]);
    expect(upsert.mock.calls[0]).toEqual([
      NOTIFICATIONS_RETENTION_SCHEDULER_ID,
      { every: 3_600_000 },
      { name: NotificationRetentionJobName.RETENTION, data: {} },
    ]);
  });

  it('degrades gracefully when Redis is down (never throws) and logs the error', async () => {
    const { instance } = scheduler(3_600_000, jest.fn().mockRejectedValue(new Error('no redis')));

    await expect(instance.onModuleInit()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(String(message)).toContain('Failed to upsert notifications retention scheduler');
  });

  it('never registers anything with @nestjs/schedule/cron: only the queue is touched', async () => {
    const { instance, upsert } = scheduler(3_600_000);

    await instance.onModuleInit();

    expect(upsert).toHaveBeenCalledTimes(1);
    // El repeatable es por INTERVALO, no por patrón cron.
    const [, repeatOpts] = upsert.mock.calls[0];
    expect(repeatOpts).toEqual({ every: 3_600_000 });
    expect(repeatOpts).not.toHaveProperty('pattern');
  });

  it('does not use @nestjs/schedule, cron or setInterval (static scan of the source)', () => {
    const source = readFileSync(join(__dirname, 'notifications-retention.scheduler.ts'), 'utf8');
    // Se descartan los comentarios (el doc los MENCIONA para explicar que no
    // se usan) ⇒ el escaneo mira sólo el código real.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/@nestjs\/schedule/);
    expect(code).not.toMatch(/@Cron\(/);
    expect(code).not.toMatch(/setInterval/);
    expect(code).not.toMatch(/CronExpression/);
  });
});
