import { Queue } from 'bullmq';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { WebhookSubscriptionEntity } from '../subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WEBHOOK_MAX_ATTEMPTS } from '../delivery/backoff.strategy';
import { WEBHOOK_BACKOFF_TYPE } from '../delivery/delivery.job';
import { FanOutService, selectMatchedSubscriptions } from './fan-out.service';

function sub(id: string, eventTypes: string[]): WebhookSubscriptionEntity {
  return { id, bondId: 'bond1', eventTypes } as unknown as WebhookSubscriptionEntity;
}

function event(overrides: Partial<OutboxEventEntity> = {}): OutboxEventEntity {
  return {
    id: 'evt1',
    bondId: 'bond1',
    eventType: 'activity.done',
    ...overrides,
  } as unknown as OutboxEventEntity;
}

describe('selectMatchedSubscriptions (T-W1.18, REQ-DISP-2)', () => {
  it('matches the specific type', () => {
    const matched = selectMatchedSubscriptions([sub('s1', ['activity.done'])], 'activity.done');
    expect(matched.map((s) => s.id)).toEqual(['s1']);
  });

  it('matches the synthesized catch-all and the wildcard', () => {
    const matched = selectMatchedSubscriptions(
      [sub('s1', ['activity.state_changed']), sub('s2', ['*'])],
      'activity.done',
    );
    expect(matched.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('skips a subscription that does not match', () => {
    expect(
      selectMatchedSubscriptions([sub('s1', ['activity.overdue'])], 'activity.cancelled'),
    ).toEqual([]);
  });

  it('dedups a subscription matching several conditions into ONE entry', () => {
    const matched = selectMatchedSubscriptions(
      [sub('s1', ['activity.done', 'activity.state_changed', '*'])],
      'activity.done',
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('s1');
  });

  it('dedups duplicate ids defensively', () => {
    const matched = selectMatchedSubscriptions(
      [sub('s1', ['*']), sub('s1', ['activity.done'])],
      'activity.done',
    );
    expect(matched).toHaveLength(1);
  });
});

describe('FanOutService (T-W1.18, REQ-DISP-2/3/4)', () => {
  let subscriptions: { findActiveByBond: jest.Mock };
  let deliveries: {
    transaction: jest.Mock;
    insertOnConflictDoNothing: jest.Mock;
  };
  let outbox: { markDispatched: jest.Mock };
  let queue: { add: jest.Mock };
  let service: FanOutService;
  let manager: object;
  let order: string[];

  beforeEach(() => {
    order = [];
    manager = { id: 'tx-manager' };
    subscriptions = { findActiveByBond: jest.fn().mockResolvedValue([]) };
    deliveries = {
      transaction: jest.fn(async (fn: (m: object) => Promise<unknown>) => fn(manager)),
      insertOnConflictDoNothing: jest.fn().mockResolvedValue(true),
    };
    outbox = {
      markDispatched: jest.fn(async () => {
        order.push('markDispatched');
      }),
    };
    queue = { add: jest.fn(async () => undefined) };

    service = new FanOutService(
      subscriptions as unknown as WebhookSubscriptionRepository,
      deliveries as unknown as WebhookDeliveryRepository,
      outbox as unknown as OutboxEventRepository,
      queue as unknown as Queue,
    );
  });

  it('inserts one delivery per matched subscription and marks dispatched in the SAME tx', async () => {
    subscriptions.findActiveByBond.mockResolvedValue([
      sub('s1', ['activity.done']),
      sub('s2', ['*']),
      sub('s3', ['activity.overdue']),
    ]);

    const created = await service.dispatch(event());

    expect(created).toBe(2);
    expect(subscriptions.findActiveByBond).toHaveBeenCalledWith('bond1');
    expect(deliveries.transaction).toHaveBeenCalledTimes(1);

    // La inserción y el marcado reciben el manager de la transacción.
    expect(deliveries.insertOnConflictDoNothing).toHaveBeenCalledWith(
      { eventId: 'evt1', subscriptionId: 's1' },
      manager,
    );
    expect(deliveries.insertOnConflictDoNothing).toHaveBeenCalledWith(
      { eventId: 'evt1', subscriptionId: 's2' },
      manager,
    );
    expect(deliveries.insertOnConflictDoNothing).not.toHaveBeenCalledWith(
      { eventId: 'evt1', subscriptionId: 's3' },
      expect.anything(),
    );
    expect(outbox.markDispatched).toHaveBeenCalledWith('evt1', manager);
  });

  it('enqueues after commit with a deterministic jobId, 8 attempts and backoff', async () => {
    subscriptions.findActiveByBond.mockResolvedValue([sub('s1', ['*'])]);

    await service.dispatch(event());

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('delivery');
    expect(data).toEqual({ eventId: 'evt1', subscriptionId: 's1' });
    expect(opts).toMatchObject({
      jobId: 'evt1--s1',
      attempts: WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: WEBHOOK_BACKOFF_TYPE },
      removeOnFail: false,
    });
  });

  it('is idempotent: a duplicate (no insert) is neither enqueued nor double-marked twice', async () => {
    subscriptions.findActiveByBond.mockResolvedValue([sub('s1', ['*'])]);
    deliveries.insertOnConflictDoNothing.mockResolvedValue(false);

    const created = await service.dispatch(event());

    expect(created).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
    // El evento igualmente queda marcado como despachado.
    expect(outbox.markDispatched).toHaveBeenCalledWith('evt1', manager);
  });

  it('still marks dispatched when no subscription matches', async () => {
    subscriptions.findActiveByBond.mockResolvedValue([sub('s1', ['activity.overdue'])]);

    const created = await service.dispatch(event());

    expect(created).toBe(0);
    expect(outbox.markDispatched).toHaveBeenCalledWith('evt1', manager);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not throw when Redis is down at enqueue time', async () => {
    subscriptions.findActiveByBond.mockResolvedValue([sub('s1', ['*'])]);
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(service.dispatch(event())).resolves.toBe(1);
  });
});
