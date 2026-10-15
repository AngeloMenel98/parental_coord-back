import { ConfigService } from '@nestjs/config';

import { NotificationRepository } from '../../notifications/repositories/notification.repository';
import { WebhookSubscriptionStatus } from '../subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookObservabilityService } from '../webhooks-observability';
import {
  DEFAULT_WEBHOOK_AUTO_DISABLE_DAYS,
  HealthSubscription,
  SubscriptionHealthService,
  WEBHOOK_DISABLED_NOTIFICATION_TYPE,
  WEBHOOK_SUBSCRIPTION_REF_ENTITY_TYPE,
  disableNotificationText,
} from './subscription-health.service';

const MS_PER_DAY = 86_400_000;

function healthSub(overrides: Partial<HealthSubscription> = {}): HealthSubscription {
  return {
    id: 's1',
    bondId: 'b1',
    createdBy: 'u1',
    status: WebhookSubscriptionStatus.ACTIVE,
    consecutiveFailureSince: null,
    ...overrides,
  };
}

function build(autoDisableDays?: number) {
  const subscriptions = { updateEntity: jest.fn().mockResolvedValue(undefined) };
  const notifications = { createNotification: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn(() => autoDisableDays) } as unknown as ConfigService;
  const observability = { recordAutoDisabled: jest.fn() };

  const service = new SubscriptionHealthService(
    subscriptions as unknown as WebhookSubscriptionRepository,
    notifications as unknown as NotificationRepository,
    config,
    observability as unknown as WebhookObservabilityService,
  );

  return { service, subscriptions, notifications, config, observability };
}

describe('SubscriptionHealthService (T-W2.3, REQ-SUB-5, AC-5, D11)', () => {
  it('starts the failure streak on the first failure', async () => {
    const ctx = build(5);
    const now = new Date('2026-10-15T00:00:00Z');

    const disabled = await ctx.service.recordFailure(healthSub(), now);

    expect(disabled).toBe(false);
    expect(ctx.subscriptions.updateEntity).toHaveBeenCalledWith('s1', {
      consecutiveFailureSince: now,
    });
    expect(ctx.observability.recordAutoDisabled).not.toHaveBeenCalled();
  });

  it('keeps the streak when a failure comes within the window', async () => {
    const ctx = build(5);
    const since = new Date('2026-10-13T00:00:00Z');
    const now = new Date('2026-10-15T00:00:00Z');

    const disabled = await ctx.service.recordFailure(
      healthSub({ consecutiveFailureSince: since }),
      now,
    );

    expect(disabled).toBe(false);
    // No se reescribe la racha existente.
    expect(ctx.subscriptions.updateEntity).not.toHaveBeenCalled();
  });

  it('auto-disables + notifies the owner once the 5-day streak is reached', async () => {
    const ctx = build(5);
    const since = new Date('2026-10-10T00:00:00Z');
    const now = new Date('2026-10-15T00:00:00Z');

    const disabled = await ctx.service.recordFailure(
      healthSub({ consecutiveFailureSince: since }),
      now,
    );

    expect(disabled).toBe(true);
    expect(ctx.subscriptions.updateEntity).toHaveBeenCalledWith('s1', {
      status: WebhookSubscriptionStatus.AUTO_DISABLED,
      consecutiveFailureSince: null,
    });
    expect(ctx.observability.recordAutoDisabled).toHaveBeenCalledWith('s1');
    expect(ctx.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        bondId: 'b1',
        type: WEBHOOK_DISABLED_NOTIFICATION_TYPE,
        refEntityType: WEBHOOK_SUBSCRIPTION_REF_ENTITY_TYPE,
        refEntityId: 's1',
      }),
    );
  });

  it('uses the default 5-day threshold when unconfigured', async () => {
    const ctx = build(undefined);
    const since = new Date(Date.now() - (DEFAULT_WEBHOOK_AUTO_DISABLE_DAYS - 1) * MS_PER_DAY);

    const disabled = await ctx.service.recordFailure(healthSub({ consecutiveFailureSince: since }));

    expect(disabled).toBe(false);
  });

  it('ignores failures for a subscription that is not ACTIVE', async () => {
    const ctx = build(5);

    const disabled = await ctx.service.recordFailure(
      healthSub({ status: WebhookSubscriptionStatus.DISABLED }),
    );

    expect(disabled).toBe(false);
    expect(ctx.subscriptions.updateEntity).not.toHaveBeenCalled();
  });

  it('clears the streak on success', async () => {
    const ctx = build(5);

    await ctx.service.recordSuccess(
      healthSub({ consecutiveFailureSince: new Date('2026-10-01T00:00:00Z') }),
    );

    expect(ctx.subscriptions.updateEntity).toHaveBeenCalledWith('s1', {
      consecutiveFailureSince: null,
    });
  });

  it('does not write on success when there was no streak', async () => {
    const ctx = build(5);

    await ctx.service.recordSuccess(healthSub());

    expect(ctx.subscriptions.updateEntity).not.toHaveBeenCalled();
  });

  it('never throws when the notification write fails', async () => {
    const ctx = build(5);
    ctx.notifications.createNotification.mockRejectedValue(new Error('db down'));

    await expect(ctx.service.notifyDisabled(healthSub(), 'gone')).resolves.toBeUndefined();
  });
});

describe('disableNotificationText (REQ-SUB-5, REQ-SEC-2)', () => {
  it('describes the 410 Gone case without leaking secrets', () => {
    const { title, body } = disableNotificationText('s1', 'gone');
    expect(title).toMatch(/disabled/i);
    expect(body).toContain('s1');
    expect(body).toContain('410');
  });

  it('describes the sustained-failure case with the configured window', () => {
    const { body } = disableNotificationText('s1', 'sustained-failure', 5);
    expect(body).toContain('5 days');
  });
});
