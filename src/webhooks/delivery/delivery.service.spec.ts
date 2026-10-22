import { Job } from 'bullmq';

import { ConfigService } from '@nestjs/config';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { WebhookPayloadBuilder } from '../events/payload-builder';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { EndpointLimiter } from './endpoint-limiter';
import { SecretCipherService } from './secret-cipher.service';
import { SigningService } from './signing.service';
import { SsrfHttpClient, SsrfHttpResult } from './ssrf-http.client';
import { WebhookDeliveryRepository } from './repositories/webhook-delivery.repository';
import { WebhookDeliveryAttemptRepository } from './repositories/webhook-delivery-attempt.repository';
import { WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { SubscriptionHealthService } from './subscription-health.service';
import { WebhookObservabilityService } from '../webhooks-observability';
import {
  DeliveryService,
  WebhookDeliveryRetryError,
  signingSecretsFor,
  statusForAttempt,
  truncateResponseSnippet,
} from './delivery.service';

function httpResult(overrides: Partial<SsrfHttpResult> = {}): SsrfHttpResult {
  return {
    status: 200,
    body: '{"ok":true}',
    blocked: false,
    networkError: false,
    error: null,
    retryAfterMs: null,
    ...overrides,
  };
}

function job(overrides: Partial<{ attemptsMade: number; attempts: number; data: object }> = {}) {
  const updateData = jest.fn().mockResolvedValue(undefined);
  const instance = {
    id: 'job1',
    name: 'delivery',
    data: { eventId: 'e1', subscriptionId: 's1', ...(overrides.data ?? {}) },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 8 },
    updateData,
  };
  return { instance: instance as unknown as Job, updateData };
}

function build() {
  const outbox = { findById: jest.fn() };
  const subscriptions = {
    findById: jest.fn(),
    updateEntity: jest.fn().mockResolvedValue(undefined),
  };
  const deliveries = {
    findByEventSub: jest.fn(),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const attempts = { insertAttempt: jest.fn().mockResolvedValue(undefined) };
  const payloadBuilder = {
    build: jest.fn().mockResolvedValue({ id: 'e1', type: 'activity.done' }),
  };
  const signing = {
    buildSignatureHeaders: jest.fn().mockReturnValue({
      'webhook-id': 'e1',
      'webhook-timestamp': '1',
      'webhook-signature': 'v1,x',
      'user-agent': 'ua',
    }),
  };
  const cipher = { decrypt: jest.fn().mockReturnValue('whsec_secret') };
  const http = { post: jest.fn().mockResolvedValue(httpResult()) };
  const limiter = {
    run: jest.fn(async (_host: string, task: () => Promise<unknown>) => task()),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const health = {
    recordFailure: jest.fn().mockResolvedValue(false),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    notifyDisabled: jest.fn().mockResolvedValue(undefined),
  };
  const observability = { recordAttempt: jest.fn() };

  const service = new DeliveryService(
    outbox as unknown as OutboxEventRepository,
    subscriptions as unknown as WebhookSubscriptionRepository,
    deliveries as unknown as WebhookDeliveryRepository,
    attempts as unknown as WebhookDeliveryAttemptRepository,
    payloadBuilder as unknown as WebhookPayloadBuilder,
    signing as unknown as SigningService,
    cipher as unknown as SecretCipherService,
    http as unknown as SsrfHttpClient,
    limiter as unknown as EndpointLimiter,
    config as unknown as ConfigService,
    health as unknown as SubscriptionHealthService,
    observability as unknown as WebhookObservabilityService,
  );

  return {
    service,
    outbox,
    subscriptions,
    deliveries,
    attempts,
    payloadBuilder,
    signing,
    cipher,
    http,
    limiter,
    config,
    health,
    observability,
  };
}

const activeSub = (): WebhookSubscriptionEntity =>
  ({
    id: 's1',
    status: WebhookSubscriptionStatus.ACTIVE,
    url: 'https://receiver.example/hook',
    secretEncrypted: 'v1:current',
    secretPrevEncrypted: null,
    secretPrevExpiresAt: null,
  }) as unknown as WebhookSubscriptionEntity;

function prime(
  ctx: ReturnType<typeof build>,
  overrides: { delivery?: object; subscription?: WebhookSubscriptionEntity | null } = {},
) {
  ctx.outbox.findById.mockResolvedValue({ id: 'e1', bondId: 'b1' } as OutboxEventEntity);
  ctx.subscriptions.findById.mockResolvedValue(
    overrides.subscription === undefined ? activeSub() : overrides.subscription,
  );
  ctx.deliveries.findByEventSub.mockResolvedValue(
    overrides.delivery ?? { id: 'd1', eventId: 'e1', subscriptionId: 's1', attemptCount: 0 },
  );
}

function lastStatus(ctx: ReturnType<typeof build>): WebhookDeliveryStatus {
  const calls = ctx.deliveries.updateStatus.mock.calls;
  return calls[calls.length - 1][1].status as WebhookDeliveryStatus;
}

describe('signingSecretsFor / truncateResponseSnippet', () => {
  it('returns only the current secret outside the rotation grace window', () => {
    expect(
      signingSecretsFor(
        {
          secretEncrypted: 'cur',
          secretPrevEncrypted: 'old',
          secretPrevExpiresAt: new Date('2000-01-01'),
        },
        new Date('2026-10-01'),
      ),
    ).toEqual(['cur']);
  });

  it('returns [previous, current] during the rotation grace window', () => {
    expect(
      signingSecretsFor(
        {
          secretEncrypted: 'cur',
          secretPrevEncrypted: 'old',
          secretPrevExpiresAt: new Date('2026-10-02'),
        },
        new Date('2026-10-01'),
      ),
    ).toEqual(['old', 'cur']);
  });

  it('truncates a response snippet to 1024 chars and nulls empty bodies', () => {
    expect(truncateResponseSnippet('x'.repeat(5000))).toHaveLength(1024);
    expect(truncateResponseSnippet(null)).toBeNull();
    expect(truncateResponseSnippet('')).toBeNull();
  });
});

describe('DeliveryService (T-W1.24, REQ-DEL-1..5)', () => {
  it('2xx → SUCCEEDED with attempt + status recorded', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 200, body: 'ok' }));

    await expect(ctx.service.handle(job().instance)).resolves.toBeUndefined();

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.SUCCEEDED);
    expect(ctx.attempts.insertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'd1',
        attemptNo: 1,
        statusCode: 200,
        responseSnippet: 'ok',
      }),
    );
  });

  it('400 → FAILED terminal (no retry, no throw)', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 400, body: 'bad' }));

    await expect(ctx.service.handle(job().instance)).resolves.toBeUndefined();

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('3xx (redirect not followed) → FAILED terminal', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 302, body: '' }));

    await ctx.service.handle(job().instance);

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('410 → subscription disabled and delivery FAILED', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 410, body: '' }));

    await ctx.service.handle(job().instance);

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.FAILED);
    expect(ctx.subscriptions.updateEntity).toHaveBeenCalledWith('s1', {
      status: WebhookSubscriptionStatus.DISABLED,
      consecutiveFailureSince: null,
    });
    expect(ctx.health.notifyDisabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      'gone',
    );
  });

  it('429 with Retry-After → RETRYING, stashes retryAfterMs and throws for BullMQ', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 429, body: '', retryAfterMs: 60_000 }));
    const { instance, updateData } = job();

    await expect(ctx.service.handle(instance)).rejects.toBeInstanceOf(WebhookDeliveryRetryError);

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.RETRYING);
    expect(updateData).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'e1', subscriptionId: 's1', retryAfterMs: 60_000 }),
    );
    const patch = ctx.deliveries.updateStatus.mock.calls.at(-1)![1];
    expect(patch.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 59_000);
  });

  it('500 → RETRYING and throws while attempts remain', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 500, error: 'server error' }));

    await expect(ctx.service.handle(job().instance)).rejects.toBeInstanceOf(
      WebhookDeliveryRetryError,
    );
    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.RETRYING);
  });

  it('500 on the final attempt → DEAD (no throw)', async () => {
    const ctx = build();
    prime(ctx, { delivery: { id: 'd1', eventId: 'e1', subscriptionId: 's1', attemptCount: 7 } });
    ctx.http.post.mockResolvedValue(httpResult({ status: 500 }));

    await expect(ctx.service.handle(job({ attemptsMade: 7 }).instance)).resolves.toBeUndefined();

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.DEAD);
  });

  it('network error → RETRYING', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(
      httpResult({ status: null, networkError: true, error: 'ECONNREFUSED' }),
    );

    await expect(ctx.service.handle(job().instance)).rejects.toBeInstanceOf(
      WebhookDeliveryRetryError,
    );
    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.RETRYING);
  });

  it('SSRF block (status null, no network error) → FAILED terminal', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(
      httpResult({ status: null, blocked: true, error: 'Blocked 10.0.0.5' }),
    );

    await ctx.service.handle(job().instance);

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('a non-ACTIVE subscription fails terminally without any POST', async () => {
    const ctx = build();
    prime(ctx, { subscription: { ...activeSub(), status: WebhookSubscriptionStatus.DISABLED } });

    await ctx.service.handle(job().instance);

    expect(lastStatus(ctx)).toBe(WebhookDeliveryStatus.FAILED);
    expect(ctx.http.post).not.toHaveBeenCalled();
  });

  it('signs with decrypted secrets from the grace window', async () => {
    const ctx = build();
    prime(ctx, {
      subscription: {
        ...activeSub(),
        secretPrevEncrypted: 'v1:previous',
        secretPrevExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    await ctx.service.handle(job().instance);

    expect(ctx.cipher.decrypt).toHaveBeenCalledWith('v1:previous');
    expect(ctx.cipher.decrypt).toHaveBeenCalledWith('v1:current');
    const secrets = ctx.signing.buildSignatureHeaders.mock.calls[0][3];
    expect(secrets).toEqual(['whsec_secret', 'whsec_secret']);
  });

  it('is a no-op when there is no delivery row', async () => {
    const ctx = build();
    ctx.deliveries.findByEventSub.mockResolvedValue(null);

    await ctx.service.handle(job().instance);

    expect(ctx.deliveries.updateStatus).not.toHaveBeenCalled();
    expect(ctx.http.post).not.toHaveBeenCalled();
  });

  it('emits an observability attempt with the resulting status (T-W2.5)', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 200, body: 'ok' }));

    await ctx.service.handle(job().instance);

    expect(ctx.observability.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'e1',
        subscriptionId: 's1',
        attempt: 1,
        outcome: 'SUCCESS',
        status: WebhookDeliveryStatus.SUCCEEDED,
        statusCode: 200,
      }),
    );
  });

  it('does not log secrets or bodies in the observability entry (REQ-SEC-2)', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 500, body: 'TOPSECRETBODY' }));

    await expect(ctx.service.handle(job().instance)).rejects.toBeInstanceOf(
      WebhookDeliveryRetryError,
    );

    const entry = JSON.stringify(ctx.observability.recordAttempt.mock.calls[0][0]);
    expect(entry).not.toContain('TOPSECRETBODY');
    expect(entry).not.toContain('whsec_secret');
  });

  it('clears the continuous-failure streak on success (REQ-SUB-5)', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 200 }));

    await ctx.service.handle(job().instance);

    expect(ctx.health.recordSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(ctx.health.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failure on the retry path before rethrowing (FR-24)', async () => {
    const ctx = build();
    prime(ctx);
    ctx.http.post.mockResolvedValue(httpResult({ status: 500 }));

    await expect(ctx.service.handle(job().instance)).rejects.toBeInstanceOf(
      WebhookDeliveryRetryError,
    );

    expect(ctx.health.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      expect.any(Date),
    );
  });

  it('records a failure when the delivery goes DEAD (FR-24)', async () => {
    const ctx = build();
    prime(ctx, { delivery: { id: 'd1', eventId: 'e1', subscriptionId: 's1', attemptCount: 7 } });
    ctx.http.post.mockResolvedValue(httpResult({ status: 500 }));

    await ctx.service.handle(job({ attemptsMade: 7 }).instance);

    expect(ctx.health.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      expect.any(Date),
    );
  });
});

describe('statusForAttempt (T-W2.3, pure)', () => {
  it('maps a success to SUCCEEDED', () => {
    expect(statusForAttempt('SUCCESS', 1, 8)).toBe(WebhookDeliveryStatus.SUCCEEDED);
  });

  it('maps terminal outcomes to FAILED', () => {
    expect(statusForAttempt('TERMINAL', 1, 8)).toBe(WebhookDeliveryStatus.FAILED);
    expect(statusForAttempt('DISABLE', 1, 8)).toBe(WebhookDeliveryStatus.FAILED);
  });

  it('maps a retry to RETRYING while attempts remain, DEAD once exhausted', () => {
    expect(statusForAttempt('RETRY', 3, 8)).toBe(WebhookDeliveryStatus.RETRYING);
    expect(statusForAttempt('RETRY', 8, 8)).toBe(WebhookDeliveryStatus.DEAD);
  });
});

describe('DeliveryService test ping (T-W1.29, REQ-SUB-4, AC-4)', () => {
  it('routes a test job to handleTest without touching outbox or delivery rows', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue(activeSub());
    const { instance } = job({ data: { test: true } });

    await expect(ctx.service.handle(instance)).resolves.toBeUndefined();

    expect(ctx.outbox.findById).not.toHaveBeenCalled();
    expect(ctx.deliveries.findByEventSub).not.toHaveBeenCalled();
    expect(ctx.deliveries.updateStatus).not.toHaveBeenCalled();
    expect(ctx.http.post).toHaveBeenCalledTimes(1);
  });

  it('signs and sends a webhook.test payload', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue(activeSub());

    await ctx.service.handleTest('s1');

    expect(ctx.http.post).toHaveBeenCalledWith(
      'https://receiver.example/hook',
      expect.any(Buffer),
      expect.objectContaining({ 'content-type': 'application/json' }),
    );
    const [, rawBody] = ctx.http.post.mock.calls[0];
    expect(JSON.parse(rawBody.toString())).toEqual(
      expect.objectContaining({ type: 'webhook.test' }),
    );
    expect(ctx.signing.buildSignatureHeaders).toHaveBeenCalled();
  });

  it('never throws when the receiver fails (fire-and-forget)', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue(activeSub());
    ctx.http.post.mockResolvedValue(
      httpResult({ status: null, networkError: true, error: 'ECONNREFUSED' }),
    );

    await expect(ctx.service.handleTest('s1')).resolves.toBeUndefined();
  });

  it('skips without POST when the subscription is not ACTIVE', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue({
      ...activeSub(),
      status: WebhookSubscriptionStatus.DISABLED,
    });

    await expect(ctx.service.handleTest('s1')).resolves.toBeUndefined();
    expect(ctx.http.post).not.toHaveBeenCalled();
  });
});
