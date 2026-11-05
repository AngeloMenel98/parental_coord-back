import { Job } from 'bullmq';

import { ReconcileService } from '../dispatcher/reconcile.service';
import { Relay } from '../dispatcher/relay';
import { RetentionService } from '../dispatcher/retention.service';
import { WebhookJobName } from '../webhooks.constants';
import { DeliveryService } from './delivery.service';
import { WebhookDeliveryProcessor } from './processor';

function makeJob(name: string): Job {
  return { id: 'j1', name, data: { eventId: 'e1', subscriptionId: 's1' } } as unknown as Job;
}

describe('WebhookDeliveryProcessor (T-W1.19/T-W1.24/T-W1.32/T-W2.1)', () => {
  let relay: { run: jest.Mock };
  let delivery: { handle: jest.Mock };
  let reconcile: { run: jest.Mock };
  let retention: { run: jest.Mock };
  let processor: WebhookDeliveryProcessor;

  beforeEach(() => {
    relay = { run: jest.fn().mockResolvedValue(0) };
    delivery = { handle: jest.fn().mockResolvedValue(undefined) };
    reconcile = {
      run: jest.fn().mockResolvedValue({ dispatchedOutbox: 0, reenqueuedDeliveries: 0 }),
    };
    retention = {
      run: jest.fn().mockResolvedValue({ purgedAttempts: 0, purgedOutbox: 0, cutoff: new Date(0) }),
    };
    processor = new WebhookDeliveryProcessor(
      relay as unknown as Relay,
      delivery as unknown as DeliveryService,
      reconcile as unknown as ReconcileService,
      retention as unknown as RetentionService,
    );
  });

  it('routes a delivery job to the delivery service', async () => {
    const job = makeJob(WebhookJobName.DELIVERY);
    await processor.process(job);
    expect(delivery.handle).toHaveBeenCalledWith(job);
    expect(relay.run).not.toHaveBeenCalled();
  });

  it('routes a dispatch-poll job to the relay', async () => {
    await processor.process(makeJob(WebhookJobName.DISPATCH_POLL));
    expect(relay.run).toHaveBeenCalledTimes(1);
    expect(delivery.handle).not.toHaveBeenCalled();
  });

  it('routes a reconcile job to the reconcile service', async () => {
    await processor.process(makeJob(WebhookJobName.RECONCILE));
    expect(reconcile.run).toHaveBeenCalledTimes(1);
  });

  it('swallows relay errors: a failed poll must not kill the scheduler', async () => {
    relay.run.mockRejectedValue(new Error('db down'));
    await expect(processor.process(makeJob(WebhookJobName.DISPATCH_POLL))).resolves.toBeUndefined();
  });

  it('swallows reconcile errors: a failed reconcile must not kill the scheduler', async () => {
    reconcile.run.mockRejectedValue(new Error('db down'));
    await expect(processor.process(makeJob(WebhookJobName.RECONCILE))).resolves.toBeUndefined();
  });

  it('routes a retention job to the retention service (T-W2.1)', async () => {
    await processor.process(makeJob(WebhookJobName.RETENTION));
    expect(retention.run).toHaveBeenCalledTimes(1);
    expect(reconcile.run).not.toHaveBeenCalled();
  });

  it('swallows retention errors: a failed purge must not kill the scheduler', async () => {
    retention.run.mockRejectedValue(new Error('db down'));
    await expect(processor.process(makeJob(WebhookJobName.RETENTION))).resolves.toBeUndefined();
  });

  it('propagates delivery errors so BullMQ can retry', async () => {
    delivery.handle.mockRejectedValue(new Error('retry me'));
    await expect(processor.process(makeJob(WebhookJobName.DELIVERY))).rejects.toThrow('retry me');
  });

  it('ignores an unknown job name without throwing', async () => {
    await expect(processor.process(makeJob('unknown'))).resolves.toBeUndefined();
    expect(relay.run).not.toHaveBeenCalled();
    expect(delivery.handle).not.toHaveBeenCalled();
  });
});
