import { Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { WebhookDeliveryAttemptEntity } from '../delivery/entities/webhook-delivery-attempt.entity';
import { WebhookDeliveryAttemptRepository } from '../delivery/repositories/webhook-delivery-attempt.repository';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookAuthzService } from '../subscriptions/webhook-authz.service';
import {
  PaginatedWebhookDeliveriesDto,
  WEBHOOK_DELIVERY_LOG_DEFAULT_LIMIT,
  WebhookDeliveryLogQueryDto,
} from './dto/webhook-delivery-log.dto';

/**
 * Log paginado de entregas de una suscripción (REQ-LOG-1, AC-16, D9).
 *
 * Cada entrega llega con su `attempts[]` unidos en UNA sola query
 * (`findByDeliveryIds`) para evitar N+1. La lectura está abierta a los miembros
 * activos del bond (REQ-SEC-4).
 */
@Injectable()
export class DeliveryLogService {
  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly attempts: WebhookDeliveryAttemptRepository,
    private readonly authz: WebhookAuthzService,
  ) {}

  async getLog(
    bondId: string,
    subscriptionId: string,
    query: WebhookDeliveryLogQueryDto,
    user: AuthUser,
  ): Promise<PaginatedWebhookDeliveriesDto> {
    await this.authz.assertCanRead(bondId, user);

    const subscription = await this.subscriptions.findById(subscriptionId);
    if (!subscription || subscription.bondId !== bondId) {
      throw new NotFoundException(`Webhook subscription "${subscriptionId}" not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? WEBHOOK_DELIVERY_LOG_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.deliveries.findBySubscriptionPaginated(subscriptionId, skip, limit),
      this.deliveries.countBySubscription(subscriptionId),
    ]);

    const attemptRows = await this.attempts.findByDeliveryIds(rows.map((row) => row.id));
    const attemptsByDelivery = new Map<string, WebhookDeliveryAttemptEntity[]>();
    for (const attempt of attemptRows) {
      const list = attemptsByDelivery.get(attempt.deliveryId) ?? [];
      list.push(attempt);
      attemptsByDelivery.set(attempt.deliveryId, list);
    }

    const data = rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      subscriptionId: row.subscriptionId,
      status: row.status,
      attemptCount: row.attemptCount,
      nextAttemptAt: row.nextAttemptAt ? row.nextAttemptAt.toISOString() : null,
      lastStatusCode: row.lastStatusCode,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      attempts: (attemptsByDelivery.get(row.id) ?? []).map((attempt) => ({
        attemptNo: attempt.attemptNo,
        statusCode: attempt.statusCode,
        durationMs: attempt.durationMs,
        responseSnippet: attempt.responseSnippet,
        error: attempt.error,
        startedAt: attempt.startedAt.toISOString(),
      })),
    }));

    return plainToInstance(
      PaginatedWebhookDeliveriesDto,
      { data, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }
}
