import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { SystemRole } from '../../users/entities/user.entity';
import { WebhookAuthzService } from './webhook-authz.service';
import { SecretCipherService } from '../delivery/secret-cipher.service';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from './entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from './repositories/webhook-subscription.repository';
import { WebhooksAuditRepository } from '../admin/webhooks-audit.repository';
import { SubscriptionsService, assertHttpsUrl, normalizeEventTypes } from './subscriptions.service';

const user = (): AuthUser =>
  ({ id: 'u1', email: 'u1@example.com', systemRole: SystemRole.USER }) as AuthUser;

function build(configValues: Record<string, unknown> = {}) {
  const subscriptions = {
    countByBond: jest.fn().mockResolvedValue(0),
    createAndSave: jest.fn(),
    findByWhere: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    updateEntity: jest.fn(),
    removeEntity: jest.fn().mockResolvedValue(undefined),
  };
  const cipher = {
    generateSecret: jest.fn().mockReturnValue('whsec_generated'),
    encrypt: jest.fn().mockReturnValue('v1:enc'),
  };
  const authz = {
    assertCanManage: jest.fn().mockResolvedValue(undefined),
    assertCanRead: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new SubscriptionsService(
    subscriptions as unknown as WebhookSubscriptionRepository,
    cipher as unknown as SecretCipherService,
    authz as unknown as WebhookAuthzService,
    audit as unknown as WebhooksAuditRepository,
    config as unknown as ConfigService,
    queue as unknown as Queue,
  );

  return { service, subscriptions, cipher, authz, audit, config, queue };
}

const entity = (overrides: Partial<WebhookSubscriptionEntity> = {}): WebhookSubscriptionEntity =>
  ({
    id: 's1',
    bondId: 'b1',
    createdBy: 'u1',
    url: 'https://receiver.example/hook',
    description: null,
    eventTypes: ['*'],
    secretEncrypted: 'v1:current',
    secretPrevEncrypted: null,
    secretPrevExpiresAt: null,
    status: WebhookSubscriptionStatus.ACTIVE,
    consecutiveFailureSince: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as WebhookSubscriptionEntity;

describe('subscriptions.service pure helpers (T-W1.25/T-W1.28)', () => {
  it('assertHttpsUrl accepts https and rejects non-https/invalid', () => {
    expect(() => assertHttpsUrl('https://x.example/hook')).not.toThrow();
    expect(() => assertHttpsUrl('http://x.example/hook')).toThrow(BadRequestException);
    expect(() => assertHttpsUrl('not a url')).toThrow(BadRequestException);
  });

  it('normalizeEventTypes defaults to ["*"] and rejects unknown types', () => {
    expect(normalizeEventTypes(undefined)).toEqual(['*']);
    expect(normalizeEventTypes([])).toEqual(['*']);
    expect(normalizeEventTypes(['activity.done'])).toEqual(['activity.done']);
    expect(normalizeEventTypes(['activity.done', 'activity.done'])).toEqual(['activity.done']);
    expect(() => normalizeEventTypes(['activity.nope'])).toThrow(BadRequestException);
  });
});

describe('SubscriptionsService (T-W1.28, REQ-SUB-1..6)', () => {
  it('creates a subscription, encrypts the secret and returns it once', async () => {
    const ctx = build();
    ctx.subscriptions.createAndSave.mockResolvedValue(entity({ eventTypes: ['activity.done'] }));

    const result = await ctx.service.create(
      'b1',
      { url: 'https://receiver.example/hook', eventTypes: ['activity.done'] },
      user(),
    );

    expect(ctx.authz.assertCanManage).toHaveBeenCalledWith('b1', user());
    expect(ctx.cipher.generateSecret).toHaveBeenCalled();
    expect(ctx.subscriptions.createAndSave).toHaveBeenCalledWith(
      expect.objectContaining({ bondId: 'b1', createdBy: 'u1', secretEncrypted: 'v1:enc' }),
    );
    expect(result.secret).toBe('whsec_generated');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 's1', action: 'webhook_create' }),
    );
  });

  it('rejects an 11th subscription without writing (AC-6)', async () => {
    const ctx = build();
    ctx.subscriptions.countByBond.mockResolvedValue(10);

    await expect(
      ctx.service.create('b1', { url: 'https://receiver.example/hook' }, user()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.subscriptions.createAndSave).not.toHaveBeenCalled();
  });

  it('honours WEBHOOK_MAX_PER_BOND from config', async () => {
    const ctx = build({ WEBHOOK_MAX_PER_BOND: 1 });
    ctx.subscriptions.countByBond.mockResolvedValue(1);

    await expect(
      ctx.service.create('b1', { url: 'https://receiver.example/hook' }, user()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown event type before writing', async () => {
    const ctx = build();
    await expect(
      ctx.service.create('b1', { url: 'https://x.example', eventTypes: ['nope'] }, user()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.subscriptions.createAndSave).not.toHaveBeenCalled();
  });

  it('lists subscriptions without exposing secrets (AC-2)', async () => {
    const ctx = build();
    ctx.subscriptions.findByWhere.mockResolvedValue([entity()]);

    const list = await ctx.service.list('b1', user());

    expect(list).toHaveLength(1);
    expect((list[0] as unknown as Record<string, unknown>).secretEncrypted).toBeUndefined();
    expect((list[0] as unknown as Record<string, unknown>).secret).toBeUndefined();
  });

  it('audits a DISABLE transition when status flips to DISABLED', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue(entity());
    ctx.subscriptions.updateEntity.mockResolvedValue(
      entity({ status: WebhookSubscriptionStatus.DISABLED }),
    );

    await ctx.service.update('b1', 's1', { status: WebhookSubscriptionStatus.DISABLED }, user());

    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook_disable' }),
    );
  });

  it('rotates the secret with a grace window and audits it (AC-3)', async () => {
    const ctx = build({ WEBHOOK_ROTATION_GRACE_HOURS: 24 });
    ctx.subscriptions.findById.mockResolvedValue(entity({ secretEncrypted: 'v1:old' }));

    const result = await ctx.service.rotateSecret('b1', 's1', user());

    expect(ctx.subscriptions.updateEntity).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ secretPrevEncrypted: 'v1:old', secretEncrypted: 'v1:enc' }),
    );
    expect(result.secret).toBe('whsec_generated');
    expect(new Date(result.previousSecretExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook_rotate' }),
    );
  });

  it('enqueues a webhook.test delivery on test ping (AC-4)', async () => {
    const ctx = build();
    ctx.subscriptions.findById.mockResolvedValue(entity());

    const result = await ctx.service.test('b1', 's1', user());

    expect(result).toEqual({ queued: true });
    expect(ctx.queue.add).toHaveBeenCalledWith(
      'delivery',
      expect.objectContaining({ subscriptionId: 's1', test: true }),
      expect.objectContaining({ jobId: expect.stringContaining('test--s1') }),
    );
  });
});
