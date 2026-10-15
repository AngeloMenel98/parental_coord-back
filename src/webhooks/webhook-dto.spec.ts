import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  WebhookDeliveryLogQueryDto,
  PaginatedWebhookDeliveriesDto,
} from './admin/dto/webhook-delivery-log.dto';
import {
  WebhookSecretRotationResponseDto,
  WebhookSubscriptionCreatedDto,
  WebhookSubscriptionResponseDto,
} from './subscriptions/dto/webhook-subscription-response.dto';

describe('webhook DTO serialization (REQ-SUB-2/3, REQ-LOG-1, AC-2/3/16)', () => {
  it('never leaks the secret from the read view', () => {
    const view = plainToInstance(
      WebhookSubscriptionResponseDto,
      {
        id: 's1',
        bondId: 'b1',
        url: 'https://x.example',
        description: 'd',
        eventTypes: ['*'],
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        secretEncrypted: 'v1:secret',
        secretPrevEncrypted: 'v1:prev',
      },
      { excludeExtraneousValues: true },
    );

    expect(view).not.toHaveProperty('secretEncrypted');
    expect(view).not.toHaveProperty('secretPrevEncrypted');
    expect(view).not.toHaveProperty('secret');
    expect(view.id).toBe('s1');
  });

  it('includes the secret exactly once on the created/rotated views', () => {
    const created = plainToInstance(
      WebhookSubscriptionCreatedDto,
      { id: 's1', bondId: 'b1', secret: 'whsec_x', secretEncrypted: 'v1:secret' },
      { excludeExtraneousValues: true },
    );
    expect(created.secret).toBe('whsec_x');
    expect(created).not.toHaveProperty('secretEncrypted');

    const rotated = plainToInstance(
      WebhookSecretRotationResponseDto,
      { id: 's1', secret: 'whsec_y', previousSecretExpiresAt: '2026-01-02T00:00:00Z' },
      { excludeExtraneousValues: true },
    );
    expect(rotated.secret).toBe('whsec_y');
    expect(rotated.previousSecretExpiresAt).toBe('2026-01-02T00:00:00Z');
  });

  it('nests attempt DTOs inside the paginated log', () => {
    const page = plainToInstance(
      PaginatedWebhookDeliveriesDto,
      {
        page: 1,
        limit: 20,
        total: 1,
        data: [
          {
            id: 'd1',
            eventId: 'e1',
            subscriptionId: 's1',
            status: 'SUCCEEDED',
            attemptCount: 1,
            createdAt: '2026-01-01T00:00:00Z',
            attempts: [
              {
                attemptNo: 1,
                statusCode: 200,
                durationMs: 5,
                responseSnippet: 'ok',
                error: null,
                startedAt: '2026-01-01T00:00:00Z',
              },
            ],
            secretEncrypted: 'v1:secret',
          },
        ],
      },
      { excludeExtraneousValues: true },
    );

    expect(page.data[0].attempts[0]).toBeInstanceOf(Object);
    expect(page.data[0].attempts[0].statusCode).toBe(200);
    expect(page.data[0]).not.toHaveProperty('secretEncrypted');
  });

  it('coerces page/limit query strings and enforces limits', () => {
    const ok = plainToInstance(WebhookDeliveryLogQueryDto, { page: '2', limit: '50' });
    expect(validateSync(ok)).toHaveLength(0);
    expect(ok.page).toBe(2);
    expect(ok.limit).toBe(50);

    const bad = plainToInstance(WebhookDeliveryLogQueryDto, { page: '0', limit: '101' });
    expect(validateSync(bad).length).toBeGreaterThan(0);
  });
});
