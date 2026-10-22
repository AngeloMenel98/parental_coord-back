import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { WEBHOOK_MAX_ATTEMPTS } from '../delivery/backoff.strategy';
import {
  WEBHOOK_BACKOFF_TYPE,
  WebhookDeliveryJobData,
  buildDeliveryJobId,
} from '../delivery/delivery.job';
import { WebhookDeliveryRepository } from '../delivery/repositories/webhook-delivery.repository';
import { WEBHOOK_DELIVERY_QUEUE, WebhookJobName } from '../webhooks.constants';
import { WebhookObservabilityService } from '../webhooks-observability';
import { Relay } from './relay';

/** Resultado de una pasada de reconciliación (para logs/observabilidad). */
export interface ReconcileResult {
  /** Entregas nuevas creadas al re-despachar outbox pendiente. */
  dispatchedOutbox: number;
  /** Entregas PENDING/RETRYING re-encoladas por no tener job vivo. */
  reenqueuedDeliveries: number;
}

/**
 * Reconciliación (REQ-NFR-2, AC-20, D10).
 *
 * Corre en el worker cada `WEBHOOK_RECONCILE_INTERVAL_MS`:
 *  1. re-despacha el `outbox_event` aún no marcado (`relay.run`), y
 *  2. re-encola las `webhook_delivery` en `PENDING`/`RETRYING` cuyo `jobId`
 *     determinista NO tiene job vivo en BullMQ (`queue.getJob(jobId) === null`),
 *     recuperando la pérdida de jobs tras un flush de Redis.
 *
 * Postgres es la fuente de verdad: la re-creación es idempotente por el `jobId`
 * determinista + el `UNIQUE(event_id, subscription_id)`.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly relay: Relay,
    private readonly deliveries: WebhookDeliveryRepository,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<WebhookDeliveryJobData>,
    private readonly observability: WebhookObservabilityService,
  ) {}

  async run(now: Date = new Date()): Promise<ReconcileResult> {
    const dispatchedOutbox = await this.relay.run();
    const candidates = await this.deliveries.findReconcilable(now);

    let reenqueuedDeliveries = 0;
    for (const delivery of candidates) {
      const jobId = buildDeliveryJobId(delivery.eventId, delivery.subscriptionId);
      let existing: unknown = null;
      try {
        existing = await this.queue.getJob(jobId);
      } catch (error) {
        // Redis caído: no se puede comprobar; se omite este ciclo (no se duplica).
        this.logger.error(`Reconcile could not check job ${jobId}: ${errorMessage(error)}`);
        break;
      }
      if (existing) continue;

      await this.enqueue(delivery.eventId, delivery.subscriptionId, jobId);
      reenqueuedDeliveries += 1;
    }

    if (dispatchedOutbox > 0 || reenqueuedDeliveries > 0) {
      this.logger.log(
        `Reconcile dispatchedOutbox=${dispatchedOutbox} reenqueuedDeliveries=${reenqueuedDeliveries}`,
      );
    }

    // Observabilidad (T-W2.5): evalúa los hooks de alerta (lag > 60 s, cola
    // creciente, pico de DEAD). Nunca lanza (se captura internamente).
    await this.observability.evaluateAlerts(now);

    return { dispatchedOutbox, reenqueuedDeliveries };
  }

  private async enqueue(eventId: string, subscriptionId: string, jobId: string): Promise<void> {
    try {
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
    } catch (error) {
      // Igual que el fan-out: un fallo de Redis no debe romper la reconciliación.
      this.logger.error(`Reconcile failed to enqueue ${jobId}: ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
