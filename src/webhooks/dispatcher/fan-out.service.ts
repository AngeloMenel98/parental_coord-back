import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { WebhookSubscriptionEntity } from '../subscriptions/entities/webhook-subscription.entity';
import {
  WebhookSubscriptionRepository,
  subscriptionMatchesEventType,
} from '../subscriptions/repositories/webhook-subscription.repository';
import { WEBHOOK_DELIVERY_QUEUE, WebhookJobName } from '../webhooks.constants';
import { WEBHOOK_MAX_ATTEMPTS } from '../delivery/backoff.strategy';
import {
  WEBHOOK_BACKOFF_TYPE,
  WebhookDeliveryJobData,
  buildDeliveryJobId,
} from '../delivery/delivery.job';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';

/**
 * Selección PURA de suscripciones que matchean un evento (REQ-DISP-2, AC-9).
 *
 * Una suscripción matchea si su `event_types` incluye el tipo específico, el
 * catch-all sintetizado `activity.state_changed` (que el productor NUNCA emite)
 * o `*`. El `Set` de ids garantiza el DEDUP: aunque matcheen varias condiciones,
 * cada suscripción aparece UNA sola vez (a lo sumo una entrega por suscripción).
 */
export function selectMatchedSubscriptions(
  subscriptions: readonly WebhookSubscriptionEntity[],
  eventType: string,
): WebhookSubscriptionEntity[] {
  const seen = new Set<string>();
  const matched: WebhookSubscriptionEntity[] = [];
  for (const subscription of subscriptions) {
    if (seen.has(subscription.id)) continue;
    if (!subscriptionMatchesEventType(subscription.eventTypes ?? [], eventType)) continue;
    seen.add(subscription.id);
    matched.push(subscription);
  }
  return matched;
}

/**
 * Fan-out de un evento de outbox a las suscripciones ACTIVE del mismo bond
 * (REQ-DISP-2/3/4, AC-9/AC-10, D3).
 *
 * Por cada evento: selecciona las suscripciones que matchean (dedup in-memory),
 * inserta UNA fila `webhook_delivery` por suscripción con `ON CONFLICT DO NOTHING`
 * (el `UNIQUE(event_id, subscription_id)` colapsa un re-dispatch) y marca el
 * outbox como despachado — AMBAS operaciones en la MISMA transacción. Recién
 * después del commit encola un job por entrega con `jobId` determinista
 * `{eventId}--{subscriptionId}` (idempotente).
 *
 * La invariante write-only del outbox se preserva: sólo se setea `dispatched_at`.
 */
@Injectable()
export class FanOutService {
  private readonly logger = new Logger(FanOutService.name);

  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly outbox: OutboxEventRepository,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<WebhookDeliveryJobData>,
  ) {}

  /** Despacha un evento; devuelve cuántas entregas nuevas se encolaron. */
  async dispatch(event: OutboxEventEntity): Promise<number> {
    const active = await this.subscriptions.findActiveByBond(event.bondId);
    const matched = selectMatchedSubscriptions(active, event.eventType);

    const enqueued: WebhookDeliveryJobData[] = [];
    await this.deliveries.transaction(async (manager) => {
      for (const subscription of matched) {
        const created = await this.deliveries.insertOnConflictDoNothing(
          { eventId: event.id, subscriptionId: subscription.id },
          manager,
        );
        if (created) {
          enqueued.push({ eventId: event.id, subscriptionId: subscription.id });
        }
      }
      await this.outbox.markDispatched(event.id, manager);
    });

    // Encolar SÓLO tras el commit: si la tx falla, nada queda en Redis.
    for (const data of enqueued) {
      await this.enqueue(data);
    }
    return enqueued.length;
  }

  private async enqueue(data: WebhookDeliveryJobData): Promise<void> {
    const jobId = buildDeliveryJobId(data.eventId, data.subscriptionId);
    try {
      await this.queue.add(WebhookJobName.DELIVERY, data, {
        jobId,
        attempts: WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: WEBHOOK_BACKOFF_TYPE },
        removeOnFail: false,
        removeOnComplete: { age: 3600 },
      });
    } catch (error) {
      // Igual que el productor de timers: nunca romper el fan-out por Redis;
      // la reconciliación (T-W1.32) recupera los jobs perdidos.
      this.logger.error(`Failed to enqueue delivery ${jobId}: ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
