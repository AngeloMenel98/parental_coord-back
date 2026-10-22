import { Queue } from 'bullmq';

import { OutboxEventRepository } from '../outbox/repositories/outbox-event.repository';
import { WebhookDeliveryStatus } from './delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryRepository } from './delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionRepository } from './subscriptions/repositories/webhook-subscription.repository';
import {
  DEFAULT_ALERT_THRESHOLDS,
  WebhookAlertThresholds,
  WebhookMetrics,
  WebhookObservabilityService,
  buildDeliveryLogEntry,
  evaluateWebhookAlerts,
  forbiddenLogKeys,
  redactSecrets,
} from './webhooks-observability';

const BASE_THRESHOLDS: WebhookAlertThresholds = DEFAULT_ALERT_THRESHOLDS;

describe('redactSecrets / buildDeliveryLogEntry (REQ-NFR-3, REQ-SEC-2)', () => {
  it('redacts whsec_ secrets from free text', () => {
    expect(redactSecrets('signing with whsec_ABCdef123456 failed')).toBe(
      'signing with [REDACTED] failed',
    );
    expect(redactSecrets(null)).toBe('');
  });

  it('keeps only the whitelisted keys of a delivery log entry', () => {
    const entry = buildDeliveryLogEntry({
      eventId: 'e1',
      subscriptionId: 's1',
      attempt: 2,
      outcome: 'RETRY',
      status: WebhookDeliveryStatus.RETRYING,
      statusCode: 500,
      latencyMs: 123,
      // @ts-expect-error keys outside the whitelist must be dropped
      secret: 'whsec_deadbeefdeadbeef',
      body: '{"full":"body"}',
    });

    expect(entry).toEqual({
      eventId: 'e1',
      subscriptionId: 's1',
      attempt: 2,
      outcome: 'RETRY',
      status: WebhookDeliveryStatus.RETRYING,
      statusCode: 500,
      latencyMs: 123,
    });
    expect(Object.keys(entry)).not.toContain('secret');
    expect(Object.keys(entry)).not.toContain('body');
  });

  it('never lets a forbidden key slip through the whitelist', () => {
    const forbidden = forbiddenLogKeys();
    expect(forbidden.has('secret')).toBe(true);
    expect(forbidden.has('body')).toBe(true);
    expect(forbidden.has('eventId')).toBe(false);
  });

  it('redacts a secret that leaked into an allowed key', () => {
    const entry = buildDeliveryLogEntry({
      eventId: 'whsec_leaked123456',
      subscriptionId: 's1',
      attempt: 1,
    });
    expect(entry.eventId).toBe('[REDACTED]');
  });
});

describe('WebhookMetrics (REQ-NFR-3, AC-20)', () => {
  it('counts deliveries by status and tracks latency', () => {
    const metrics = new WebhookMetrics();
    metrics.recordDeliveryOutcome(WebhookDeliveryStatus.SUCCEEDED, 100);
    metrics.recordDeliveryOutcome(WebhookDeliveryStatus.SUCCEEDED, 200);
    metrics.recordDeliveryOutcome(WebhookDeliveryStatus.DEAD, 50);

    expect(metrics.deliveriesByStatus()).toEqual({ SUCCEEDED: 2, DEAD: 1 });
    expect(metrics.attemptLatency()).toEqual({
      count: 3,
      totalMs: 350,
      maxMs: 200,
      avgMs: 350 / 3,
    });
    expect(metrics.hasData()).toBe(true);
  });

  it('counts auto-disabled subscriptions', () => {
    const metrics = new WebhookMetrics();
    metrics.recordAutoDisabled();
    metrics.recordAutoDisabled();
    expect(metrics.autoDisabledCount()).toBe(2);
  });

  it('ignores non-finite latencies', () => {
    const metrics = new WebhookMetrics();
    metrics.recordDeliveryOutcome(WebhookDeliveryStatus.SUCCEEDED, Number.NaN);
    expect(metrics.attemptLatency().count).toBe(0);
  });
});

describe('evaluateWebhookAlerts (pure, REQ-NFR-3, AC-20)', () => {
  const base = {
    oldestPendingOutboxAgeMs: null as number | null,
    queueDepth: null as number | null,
    previousQueueDepth: null as number | null,
    deadDeliveries: 0,
    totalDeliveries: 0,
  };

  it('flags OUTBOX_LAG once the lag exceeds 60 s', () => {
    const alerts = evaluateWebhookAlerts({ ...base, oldestPendingOutboxAgeMs: 61_000 });
    expect(alerts.map((a) => a.code)).toEqual(['OUTBOX_LAG']);
  });

  it('does not flag OUTBOX_LAG below the threshold', () => {
    expect(evaluateWebhookAlerts({ ...base, oldestPendingOutboxAgeMs: 59_000 })).toEqual([]);
  });

  it('flags QUEUE_GROWING only when the queue grew past the minimum depth', () => {
    expect(
      evaluateWebhookAlerts({ ...base, previousQueueDepth: 50, queueDepth: 120 }).map(
        (a) => a.code,
      ),
    ).toEqual(['QUEUE_GROWING']);
    expect(evaluateWebhookAlerts({ ...base, previousQueueDepth: 120, queueDepth: 100 })).toEqual(
      [],
    );
    expect(evaluateWebhookAlerts({ ...base, previousQueueDepth: 10, queueDepth: 50 })).toEqual([]);
  });

  it('flags DEAD_RATE_SPIKE above the ratio with enough dead deliveries', () => {
    const alerts = evaluateWebhookAlerts({
      ...base,
      deadDeliveries: 40,
      totalDeliveries: 100,
    });
    expect(alerts.map((a) => a.code)).toEqual(['DEAD_RATE_SPIKE']);
  });

  it('does not flag DEAD_RATE_SPIKE without the minimum dead count', () => {
    expect(evaluateWebhookAlerts({ ...base, deadDeliveries: 3, totalDeliveries: 5 })).toEqual([]);
  });

  it('honours custom thresholds', () => {
    const alerts = evaluateWebhookAlerts(
      { ...base, oldestPendingOutboxAgeMs: 5_000 },
      { ...BASE_THRESHOLDS, outboxLagMs: 1_000 },
    );
    expect(alerts.map((a) => a.code)).toEqual(['OUTBOX_LAG']);
  });
});

describe('WebhookObservabilityService (T-W2.5, REQ-NFR-3, AC-20)', () => {
  function build() {
    const deliveries = {
      countByStatus: jest.fn().mockResolvedValue(0),
    };
    const subscriptions = { countByStatus: jest.fn().mockResolvedValue(0) };
    const outbox = { oldestPendingCreatedAt: jest.fn().mockResolvedValue(null) };
    const queue = {
      getWaitingCount: jest.fn().mockResolvedValue(1),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getDelayedCount: jest.fn().mockResolvedValue(3),
    } as unknown as Queue;

    const service = new WebhookObservabilityService(
      deliveries as unknown as WebhookDeliveryRepository,
      subscriptions as unknown as WebhookSubscriptionRepository,
      outbox as unknown as OutboxEventRepository,
      queue,
    );

    return { service, deliveries, subscriptions, outbox, queue };
  }

  it('builds a snapshot from Postgres gauges + queue depth', async () => {
    const ctx = build();
    ctx.deliveries.countByStatus.mockImplementation((status: WebhookDeliveryStatus) =>
      Promise.resolve(status === WebhookDeliveryStatus.DEAD ? 7 : 1),
    );
    ctx.subscriptions.countByStatus.mockResolvedValue(2);
    ctx.outbox.oldestPendingCreatedAt.mockResolvedValue(new Date('2026-10-14T00:00:00Z'));
    const now = new Date('2026-10-14T00:01:00Z');

    const snap = await ctx.service.snapshot(now);

    expect(snap.queueDepth).toBe(6);
    expect(snap.deadDeliveries).toBe(7);
    expect(snap.autoDisabledSubscriptions).toBe(2);
    expect(snap.oldestPendingOutboxAgeMs).toBe(60_000);
    expect(snap.totalDeliveries).toBeGreaterThan(0);
  });

  it('degrades queue depth to null when Redis is unavailable', async () => {
    const ctx = build();
    (ctx.queue.getWaitingCount as jest.Mock).mockRejectedValue(new Error('no redis'));

    const snap = await ctx.service.snapshot(new Date());

    expect(snap.queueDepth).toBeNull();
  });

  it('logs and returns alerts without throwing, remembering the previous depth', async () => {
    const ctx = build();
    let waiting = 200;
    (ctx.queue.getWaitingCount as jest.Mock).mockImplementation(() => Promise.resolve(waiting));
    (ctx.queue.getActiveCount as jest.Mock).mockResolvedValue(0);
    (ctx.queue.getDelayedCount as jest.Mock).mockResolvedValue(0);

    // First pass records the depth (no previous depth yet → no growth alert).
    await expect(ctx.service.evaluateAlerts(new Date())).resolves.toEqual([]);
    // Second pass sees the queue grow → QUEUE_GROWING.
    waiting = 300;
    const alerts = await ctx.service.evaluateAlerts(new Date());
    expect(alerts.map((a) => a.code)).toContain('QUEUE_GROWING');
  });

  it('never throws when the snapshot itself fails', async () => {
    const ctx = build();
    ctx.outbox.oldestPendingCreatedAt.mockRejectedValue(new Error('db down'));

    await expect(ctx.service.evaluateAlerts(new Date())).resolves.toEqual([]);
  });

  it('records an attempt into the in-process metrics', () => {
    const ctx = build();
    ctx.service.recordAttempt({
      eventId: 'e1',
      subscriptionId: 's1',
      attempt: 1,
      status: WebhookDeliveryStatus.SUCCEEDED,
      latencyMs: 10,
    });
    expect(ctx.service.metrics.deliveriesByStatus()).toEqual({ SUCCEEDED: 1 });
  });
});
