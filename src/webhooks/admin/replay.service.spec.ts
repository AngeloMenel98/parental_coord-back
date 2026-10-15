import { NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { SystemRole } from '../../users/entities/user.entity';
import { WebhookDeliveryStatus } from '../delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookAuthzService } from '../subscriptions/webhook-authz.service';
import { WebhooksAuditRepository } from './webhooks-audit.repository';
import { ReplayService } from './replay.service';

const user = (): AuthUser =>
  ({ id: 'u1', email: 'u1@example.com', systemRole: SystemRole.USER }) as AuthUser;

function build() {
  const subscriptions = { findById: jest.fn() };
  const deliveries = {
    findById: jest.fn(),
    findDeadBySubscription: jest.fn().mockResolvedValue([]),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const authz = { assertCanManage: jest.fn().mockResolvedValue(undefined) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const remove = jest.fn().mockResolvedValue(undefined);
  const getJob = jest.fn().mockResolvedValue(undefined);
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { getJob, add } as unknown as Queue;

  const service = new ReplayService(
    subscriptions as unknown as WebhookSubscriptionRepository,
    deliveries as unknown as WebhookDeliveryRepository,
    authz as unknown as WebhookAuthzService,
    audit as unknown as WebhooksAuditRepository,
    queue,
  );

  return { service, subscriptions, deliveries, authz, audit, queue, getJob, add, remove };
}

describe('ReplayService (T-W1.31, REQ-LOG-2, AC-14)', () => {
  it('resets a single delivery and re-enqueues the original deterministic jobId', async () => {
    const ctx = build();
    ctx.deliveries.findById.mockResolvedValue({
      id: 'd1',
      eventId: 'e1',
      subscriptionId: 's1',
    });
    ctx.subscriptions.findById.mockResolvedValue({ id: 's1', bondId: 'b1' });

    const result = await ctx.service.replayDelivery('d1', user());

    expect(result).toEqual({ queued: true });
    expect(ctx.authz.assertCanManage).toHaveBeenCalledWith('b1', user());
    expect(ctx.deliveries.updateStatus).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ status: WebhookDeliveryStatus.PENDING, attemptCount: 0 }),
    );
    expect(ctx.add).toHaveBeenCalledWith(
      'delivery',
      { eventId: 'e1', subscriptionId: 's1' },
      expect.objectContaining({ jobId: 'e1--s1' }),
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook_replay' }),
    );
  });

  it('removes a retained failed job before re-adding it', async () => {
    const ctx = build();
    ctx.deliveries.findById.mockResolvedValue({ id: 'd1', eventId: 'e1', subscriptionId: 's1' });
    ctx.subscriptions.findById.mockResolvedValue({ id: 's1', bondId: 'b1' });
    ctx.getJob.mockResolvedValue({ id: 'e1--s1', remove: ctx.remove });

    await ctx.service.replayDelivery('d1', user());

    expect(ctx.getJob).toHaveBeenCalledWith('e1--s1');
    expect(ctx.remove).toHaveBeenCalled();
    expect(ctx.add).toHaveBeenCalled();
  });

  it('replays every DEAD delivery of a subscription and audits once', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue({ id: 's1', bondId: 'b1' });
    ctx.deliveries.findDeadBySubscription.mockResolvedValue([
      { id: 'd1', eventId: 'e1', subscriptionId: 's1' },
      { id: 'd2', eventId: 'e2', subscriptionId: 's1' },
      { id: 'd3', eventId: 'e3', subscriptionId: 's1' },
    ]);

    const result = await ctx.service.replayDead('b1', 's1', user());

    expect(result).toEqual({ queued: 3 });
    expect(ctx.deliveries.updateStatus).toHaveBeenCalledTimes(3);
    expect(ctx.add).toHaveBeenCalledTimes(3);
    expect(ctx.audit.record).toHaveBeenCalledTimes(1);
  });

  it('throws 404 when the delivery does not exist', async () => {
    const ctx = build();
    ctx.deliveries.findById.mockResolvedValue(null);
    await expect(ctx.service.replayDelivery('d1', user())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
