import { NotFoundException } from '@nestjs/common';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { SystemRole } from '../../users/entities/user.entity';
import { WebhookDeliveryAttemptRepository } from '../delivery/repositories/webhook-delivery-attempt.repository';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookAuthzService } from '../subscriptions/webhook-authz.service';
import { DeliveryLogService } from './delivery-log.service';

const user = (): AuthUser =>
  ({ id: 'u1', email: 'u1@example.com', systemRole: SystemRole.USER }) as AuthUser;

function build() {
  const subscriptions = { findById: jest.fn().mockResolvedValue({ id: 's1', bondId: 'b1' }) };
  const deliveries = {
    findBySubscriptionPaginated: jest.fn().mockResolvedValue([]),
    countBySubscription: jest.fn().mockResolvedValue(0),
  };
  const attempts = { findByDeliveryIds: jest.fn().mockResolvedValue([]) };
  const authz = { assertCanRead: jest.fn().mockResolvedValue(undefined) };

  const service = new DeliveryLogService(
    subscriptions as unknown as WebhookSubscriptionRepository,
    deliveries as unknown as WebhookDeliveryRepository,
    attempts as unknown as WebhookDeliveryAttemptRepository,
    authz as unknown as WebhookAuthzService,
  );

  return { service, subscriptions, deliveries, attempts, authz };
}

describe('DeliveryLogService (T-W1.30, REQ-LOG-1, AC-16)', () => {
  it('paginates deliveries and joins their attempts in one query', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue({ id: 's1', bondId: 'b1' });
    ctx.deliveries.findBySubscriptionPaginated.mockResolvedValue([
      {
        id: 'd1',
        eventId: 'e1',
        subscriptionId: 's1',
        status: 'SUCCEEDED',
        attemptCount: 2,
        nextAttemptAt: null,
        lastStatusCode: 200,
        lastError: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        completedAt: new Date('2026-01-01T00:00:01Z'),
      },
    ]);
    ctx.deliveries.countBySubscription.mockResolvedValue(3);
    ctx.attempts.findByDeliveryIds.mockResolvedValue([
      {
        deliveryId: 'd1',
        attemptNo: 1,
        statusCode: 500,
        durationMs: 10,
        responseSnippet: 'oops',
        error: null,
        startedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        deliveryId: 'd1',
        attemptNo: 2,
        statusCode: 200,
        durationMs: 12,
        responseSnippet: 'ok',
        error: null,
        startedAt: new Date('2026-01-01T00:00:01Z'),
      },
    ]);

    const page = await ctx.service.getLog('b1', 's1', { page: 2, limit: 1 }, user());

    expect(ctx.authz.assertCanRead).toHaveBeenCalledWith('b1', user());
    expect(ctx.deliveries.findBySubscriptionPaginated).toHaveBeenCalledWith('s1', 1, 1);
    expect(page.total).toBe(3);
    expect(page.page).toBe(2);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].attempts).toHaveLength(2);
    expect(page.data[0].attempts[0].statusCode).toBe(500);
  });

  it('defaults page/limit when the query is empty', async () => {
    const ctx = build();
    await ctx.service.getLog('b1', 's1', {}, user());
    expect(ctx.deliveries.findBySubscriptionPaginated).toHaveBeenCalledWith('s1', 0, 20);
  });

  it('throws 404 when the subscription is not in the bond', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue({ id: 's1', bondId: 'other' });
    await expect(ctx.service.getLog('b1', 's1', {}, user())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
