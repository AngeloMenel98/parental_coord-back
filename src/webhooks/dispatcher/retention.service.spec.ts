import { ConfigService } from '@nestjs/config';

import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { WebhookDeliveryAttemptRepository } from '../delivery/repositories/webhook-delivery-attempt.repository';
import { DEFAULT_RETENTION_DAYS, RetentionService } from './retention.service';

const MS_PER_DAY = 86_400_000;

function build(retentionDays?: number) {
  const attempts = { purgeOlderThan: jest.fn().mockResolvedValue(0) };
  const outbox = { purgeDispatchedBefore: jest.fn().mockResolvedValue(0) };
  const config = { get: jest.fn(() => retentionDays) } as unknown as ConfigService;

  const service = new RetentionService(
    attempts as unknown as WebhookDeliveryAttemptRepository,
    outbox as unknown as OutboxEventRepository,
    config,
  );

  return { service, attempts, outbox, config };
}

describe('RetentionService (T-W2.1, REQ-LOG-3, AC-16, D10)', () => {
  it('purges attempts and dispatched outbox older than the configured window', async () => {
    const ctx = build(30);
    ctx.attempts.purgeOlderThan.mockResolvedValue(12);
    ctx.outbox.purgeDispatchedBefore.mockResolvedValue(4);
    const now = new Date('2026-10-15T00:00:00Z');

    const result = await ctx.service.run(now);

    const expectedCutoff = new Date(now.getTime() - 30 * MS_PER_DAY);
    expect(result).toEqual({
      purgedAttempts: 12,
      purgedOutbox: 4,
      cutoff: expectedCutoff,
    });
    expect(ctx.attempts.purgeOlderThan).toHaveBeenCalledWith(expectedCutoff);
    expect(ctx.outbox.purgeDispatchedBefore).toHaveBeenCalledWith(expectedCutoff);
  });

  it('falls back to the default 30-day window when unconfigured', async () => {
    const ctx = build(undefined);
    const now = new Date('2026-10-15T00:00:00Z');

    const result = await ctx.service.run(now);

    expect(result.cutoff).toEqual(new Date(now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY));
  });

  it('respects a custom retention window', async () => {
    const ctx = build(7);
    const now = new Date('2026-10-15T00:00:00Z');

    const result = await ctx.service.run(now);

    expect(result.cutoff).toEqual(new Date(now.getTime() - 7 * MS_PER_DAY));
  });
});
