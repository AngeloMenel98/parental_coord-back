import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { WEBHOOK_MAX_ATTEMPTS } from '../delivery/backoff.strategy';
import {
  WEBHOOK_BACKOFF_TYPE,
  WebhookDeliveryJobData,
  buildDeliveryJobId,
} from '../delivery/delivery.job';
import { WebhookDeliveryStatus } from '../delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookAuthzService } from '../subscriptions/webhook-authz.service';
import { WEBHOOK_DELIVERY_QUEUE, WebhookJobName } from '../webhooks.constants';
import { WEBHOOK_AUDIT_ACTIONS, WebhooksAuditRepository } from './webhooks-audit.repository';

/**
 * Replay manual de entregas (REQ-LOG-2, AC-14, D9).
 *
 * Un replay resetea la entrega a `PENDING` (con `attemptCount=0`, para que el
 * worker vuelva a intentar de verdad) y la re-encola con el MISMO `jobId`
 * determinista `{eventId}--{subscriptionId}`, de modo que el `webhook-id` sigue
 * siendo el `outbox_event.id` original (REQ-DISP-4). Todo replay queda auditado.
 *
 * Antes de re-encolar se elimina el job previo con ese `jobId` si aún existe
 * (BullMQ conserva los fallidos por `removeOnFail:false`); el par
 * (jobId determinista + `UNIQUE(event_id, subscription_id)`) mantiene la
 * idempotencia.
 */
@Injectable()
export class ReplayService {
  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly authz: WebhookAuthzService,
    private readonly audit: WebhooksAuditRepository,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<WebhookDeliveryJobData>,
  ) {}

  /** Replay de UNA entrega por id (POST /webhooks/deliveries/:id/replay). */
  async replayDelivery(deliveryId: string, user: AuthUser): Promise<{ queued: boolean }> {
    const delivery = await this.deliveries.findById(deliveryId);
    if (!delivery) {
      throw new NotFoundException(`Webhook delivery "${deliveryId}" not found`);
    }

    const subscription = await this.subscriptions.findById(delivery.subscriptionId);
    if (!subscription) {
      throw new NotFoundException(`Webhook delivery "${deliveryId}" has no subscription`);
    }

    await this.authz.assertCanManage(subscription.bondId, user);
    await this.resetAndEnqueue(delivery.id, delivery.eventId, delivery.subscriptionId);

    await this.audit.record({
      bondId: subscription.bondId,
      userId: user.id,
      entityId: delivery.id,
      action: WEBHOOK_AUDIT_ACTIONS.REPLAY,
      detail: `Replayed delivery ${delivery.id} for subscription ${subscription.id}`,
    });

    return { queued: true };
  }

  /** Replay de TODAS las entregas `DEAD` de una suscripción (REQ-LOG-2). */
  async replayDead(
    bondId: string,
    subscriptionId: string,
    user: AuthUser,
  ): Promise<{ queued: number }> {
    await this.authz.assertCanManage(bondId, user);

    const subscription = await this.subscriptions.findById(subscriptionId);
    if (!subscription || subscription.bondId !== bondId) {
      throw new NotFoundException(`Webhook subscription "${subscriptionId}" not found`);
    }

    const dead = await this.deliveries.findDeadBySubscription(subscriptionId);
    for (const delivery of dead) {
      await this.resetAndEnqueue(delivery.id, delivery.eventId, delivery.subscriptionId);
    }

    if (dead.length > 0) {
      await this.audit.record({
        bondId,
        userId: user.id,
        entityId: subscriptionId,
        action: WEBHOOK_AUDIT_ACTIONS.REPLAY,
        detail: `Replayed ${dead.length} DEAD deliveries for subscription ${subscriptionId}`,
      });
    }

    return { queued: dead.length };
  }

  private async resetAndEnqueue(
    deliveryId: string,
    eventId: string,
    subscriptionId: string,
  ): Promise<void> {
    await this.deliveries.updateStatus(deliveryId, {
      status: WebhookDeliveryStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: null,
      lastStatusCode: null,
      lastError: null,
      completedAt: null,
    });
    await this.enqueue(eventId, subscriptionId);
  }

  private async enqueue(eventId: string, subscriptionId: string): Promise<void> {
    const jobId = buildDeliveryJobId(eventId, subscriptionId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      try {
        await existing.remove();
      } catch {
        // Job activo/completado: no se puede eliminar; el `add` con el mismo
        // jobId es idempotente y no duplica la entrega.
      }
    }

    await this.queue.add(
      WebhookJobName.DELIVERY,
      { eventId, subscriptionId },
      {
        jobId,
        attempts: WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: WEBHOOK_BACKOFF_TYPE },
        removeOnFail: false,
        removeOnComplete: { age: 3600 },
      },
    );
  }
}
