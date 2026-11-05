import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationRepository } from '../repositories/notification.repository';
import {
  DEFAULT_NOTIFICATIONS_RETENTION_DAYS,
  MS_PER_DAY,
} from './notifications-retention.constants';
import { NotificationsRetentionService } from './notifications-retention.service';

/** "Ahora" congelado: el corte es determinista (30 días ⇒ 2026-09-22). */
const NOW = new Date('2026-10-22T00:00:00Z');

/**
 * Constructor del servicio con el repositorio y la configuración DOBLEADOS:
 * el spec es unitario y NUNCA toca Postgres ni Redis.
 */
function build(retentionDays?: number) {
  const notifications = { purgeOlderThan: jest.fn().mockResolvedValue(0) };
  const config = {
    get: jest.fn((key: string) =>
      key === 'NOTIFICATIONS_RETENTION_DAYS' ? retentionDays : undefined,
    ),
  } as unknown as ConfigService;

  const service = new NotificationsRetentionService(
    notifications as unknown as NotificationRepository,
    config,
  );

  return { service, notifications, config };
}

describe('NotificationsRetentionService (notifications-hygiene, slice 1 — task 4.1, R3)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('purges with the exact cutoff = now - days x MS_PER_DAY', async () => {
    const ctx = build(30);
    ctx.notifications.purgeOlderThan.mockResolvedValue(5);

    await ctx.service.run(NOW);

    const expectedCutoff = new Date('2026-09-22T00:00:00.000Z');
    expect(ctx.notifications.purgeOlderThan).toHaveBeenCalledTimes(1);
    expect(ctx.notifications.purgeOlderThan).toHaveBeenCalledWith(expectedCutoff);

    // El argumento es un `Date` real (no un string ISO ni un número).
    const [arg] = ctx.notifications.purgeOlderThan.mock.calls[0];
    expect(arg).toBeInstanceOf(Date);
    expect(arg.getTime()).toBe(expectedCutoff.getTime());
  });

  it('honours the CONFIGURED window (NOTIFICATIONS_RETENTION_DAYS = 7)', async () => {
    const ctx = build(7);

    await ctx.service.run(NOW);

    const expectedCutoff = new Date(NOW.getTime() - 7 * MS_PER_DAY);
    expect(expectedCutoff.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(ctx.notifications.purgeOlderThan).toHaveBeenCalledWith(expectedCutoff);
  });

  it('falls back to the default 30-day window when the config key is absent', async () => {
    const ctx = build(undefined);

    const result = await ctx.service.run(NOW);

    expect(result.days).toBe(DEFAULT_NOTIFICATIONS_RETENTION_DAYS);
    expect(result.days).toBe(30);
    expect(result.cutoff).toEqual(new Date('2026-09-22T00:00:00.000Z'));
    expect(ctx.notifications.purgeOlderThan).toHaveBeenCalledWith(
      new Date('2026-09-22T00:00:00.000Z'),
    );
  });

  it('purges read AND unread rows: purgeOlderThan is called WITHOUT an onlyRead option', async () => {
    const ctx = build(30);

    await ctx.service.run(NOW);

    // Ruling #1553 opción (i): la llamada tiene UN SOLO argumento ⇒ el
    // repositorio NO filtra por `is_read` y borra leídas Y no leídas.
    expect(ctx.notifications.purgeOlderThan.mock.calls[0]).toHaveLength(1);
    expect(ctx.notifications.purgeOlderThan).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
    );
  });

  it('returns the repository count with the same cutoff and window', async () => {
    const ctx = build(30);
    ctx.notifications.purgeOlderThan.mockResolvedValue(42);

    const result = await ctx.service.run(NOW);

    expect(result).toEqual({
      purged: 42,
      cutoff: new Date('2026-09-22T00:00:00.000Z'),
      days: 30,
    });
  });

  it('logs the purged count and the applied window', async () => {
    const ctx = build(30);
    ctx.notifications.purgeOlderThan.mockResolvedValue(7);

    await ctx.service.run(NOW);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const message = logSpy.mock.calls[0][0] as string;
    expect(message).toContain('purged 7');
    expect(message).toContain('2026-09-22T00:00:00.000Z');
    expect(message).toContain('(30d)');
  });

  it('does NOT swallow repository errors (D7): the failure propagates out of run()', async () => {
    const ctx = build(30);
    ctx.notifications.purgeOlderThan.mockRejectedValue(new Error('db down'));

    await expect(ctx.service.run(NOW)).rejects.toThrow('db down');
  });
});
