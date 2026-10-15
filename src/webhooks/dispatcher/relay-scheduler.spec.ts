import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
  WEBHOOK_RECONCILE_SCHEDULER_ID,
  WEBHOOK_RETENTION_SCHEDULER_ID,
  WebhookJobName,
} from '../webhooks.constants';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RECONCILE_INTERVAL_MS,
  DEFAULT_RETENTION_INTERVAL_MS,
  RelayScheduler,
} from './relay-scheduler';

function scheduler(
  values: { poll?: number; reconcile?: number },
  upsert = jest.fn().mockResolvedValue(undefined),
) {
  const queue = { upsertJobScheduler: upsert } as unknown as Queue;
  const config = {
    get: jest.fn((key: string) =>
      key === 'WEBHOOK_POLL_INTERVAL_MS' ? values.poll : values.reconcile,
    ),
  } as unknown as ConfigService;
  return { instance: new RelayScheduler(queue, config), upsert };
}

describe('RelayScheduler (T-W1.20/T-W1.32/T-W2.1, REQ-DISP-1, REQ-NFR-2, REQ-LOG-3, AC-16/AC-20)', () => {
  it('upserts the dispatch-poll + reconcile schedulers with configured intervals on init', async () => {
    const { instance, upsert } = scheduler({ poll: 2500, reconcile: 120_000 });

    await instance.onModuleInit();

    expect(upsert).toHaveBeenCalledWith(
      WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
      { every: 2500 },
      { name: WebhookJobName.DISPATCH_POLL, data: {} },
    );
    expect(upsert).toHaveBeenCalledWith(
      WEBHOOK_RECONCILE_SCHEDULER_ID,
      { every: 120_000 },
      { name: WebhookJobName.RECONCILE, data: {} },
    );
  });

  it('also upserts the daily retention scheduler (T-W2.1, AC-16)', async () => {
    const { instance, upsert } = scheduler({ poll: 2000, reconcile: 300_000 });

    await instance.upsertSchedulers();

    expect(upsert).toHaveBeenCalledWith(
      WEBHOOK_RETENTION_SCHEDULER_ID,
      { every: DEFAULT_RETENTION_INTERVAL_MS },
      { name: WebhookJobName.RETENTION, data: {} },
    );
    expect(DEFAULT_RETENTION_INTERVAL_MS).toBe(86_400_000);
  });

  it('falls back to the default intervals when unconfigured', async () => {
    const { instance, upsert } = scheduler({});

    await instance.upsertSchedulers();

    expect(upsert).toHaveBeenCalledWith(
      WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
      { every: DEFAULT_POLL_INTERVAL_MS },
      { name: WebhookJobName.DISPATCH_POLL, data: {} },
    );
    expect(upsert).toHaveBeenCalledWith(
      WEBHOOK_RECONCILE_SCHEDULER_ID,
      { every: DEFAULT_RECONCILE_INTERVAL_MS },
      { name: WebhookJobName.RECONCILE, data: {} },
    );
  });

  it('degrades gracefully when Redis is down (never throws)', async () => {
    const { instance } = scheduler(
      { poll: 2000, reconcile: 300000 },
      jest.fn().mockRejectedValue(new Error('no redis')),
    );

    await expect(instance.onModuleInit()).resolves.toBeUndefined();
  });
});
