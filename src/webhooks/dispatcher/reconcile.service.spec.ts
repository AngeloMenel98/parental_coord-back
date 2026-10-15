import { Queue } from 'bullmq';

import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WebhookObservabilityService } from '../webhooks-observability';
import { ReconcileService } from './reconcile.service';
import { Relay } from './relay';

function build() {
  const relay = { run: jest.fn().mockResolvedValue(0) };
  const deliveries = { findReconcilable: jest.fn().mockResolvedValue([]) };
  const getJob = jest.fn().mockResolvedValue(undefined);
  const add = jest.fn().mockResolvedValue(undefined);
  const queue = { getJob, add } as unknown as Queue;
  const observability = { evaluateAlerts: jest.fn().mockResolvedValue([]) };

  const service = new ReconcileService(
    relay as unknown as Relay,
    deliveries as unknown as WebhookDeliveryRepository,
    queue,
    observability as unknown as WebhookObservabilityService,
  );

  return { service, relay, deliveries, getJob, add, observability };
}

describe('ReconcileService (T-W1.32, REQ-NFR-2, AC-20)', () => {
  it('re-dispatches pending outbox via the relay and re-enqueues deliveries without a live job', async () => {
    const ctx = build();
    ctx.relay.run.mockResolvedValue(2);
    ctx.deliveries.findReconcilable.mockResolvedValue([
      { id: 'd1', eventId: 'e1', subscriptionId: 's1' },
      { id: 'd2', eventId: 'e2', subscriptionId: 's2' },
    ]);
    ctx.getJob.mockResolvedValue(undefined);

    const result = await ctx.service.run();

    expect(ctx.relay.run).toHaveBeenCalled();
    expect(result).toEqual({ dispatchedOutbox: 2, reenqueuedDeliveries: 2 });
    expect(ctx.add).toHaveBeenCalledWith(
      'delivery',
      { eventId: 'e1', subscriptionId: 's1' },
      expect.objectContaining({ jobId: 'e1--s1' }),
    );
  });

  it('skips deliveries that still have a live job (idempotent recovery)', async () => {
    const ctx = build();
    ctx.deliveries.findReconcilable.mockResolvedValue([
      { id: 'd1', eventId: 'e1', subscriptionId: 's1' },
    ]);
    ctx.getJob.mockResolvedValue({ id: 'e1--s1' });

    const result = await ctx.service.run();

    expect(result.reenqueuedDeliveries).toBe(0);
    expect(ctx.add).not.toHaveBeenCalled();
  });

  it('breaks out of the loop when Redis is unreachable (never throws)', async () => {
    const ctx = build();
    ctx.deliveries.findReconcilable.mockResolvedValue([
      { id: 'd1', eventId: 'e1', subscriptionId: 's1' },
    ]);
    ctx.getJob.mockRejectedValue(new Error('no redis'));

    await expect(ctx.service.run()).resolves.toEqual({
      dispatchedOutbox: 0,
      reenqueuedDeliveries: 0,
    });
  });

  it('evaluates observability alerts at the end of every pass (T-W2.5)', async () => {
    const ctx = build();

    const now = new Date('2026-10-15T00:00:00Z');
    await ctx.service.run(now);

    expect(ctx.observability.evaluateAlerts).toHaveBeenCalledWith(now);
  });
});
