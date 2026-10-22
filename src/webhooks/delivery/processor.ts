import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { BackoffStrategy, Job } from 'bullmq';

import { ReconcileService } from '../dispatcher/reconcile.service';
import { Relay } from '../dispatcher/relay';
import { RetentionService } from '../dispatcher/retention.service';
import { WEBHOOK_DELIVERY_QUEUE, WebhookJobName } from '../webhooks.constants';
import { resolveBackoffMs } from './backoff.strategy';
import { WEBHOOK_DELIVERY_CONCURRENCY, WebhookDeliveryJobData } from './delivery.job';
import { DeliveryService } from './delivery.service';

/**
 * Backoff custom (FR-22) con preferencia por `Retry-After` (D6). BullMQ la
 * registra vía `settings.backoffStrategy` y la invoca con `attemptsMade + 1`.
 */
const webhookBackoffStrategy: BackoffStrategy = (attemptsMade, _type, _err, job) =>
  resolveBackoffMs(attemptsMade, (job?.data as WebhookDeliveryJobData | undefined)?.retryAfterMs);

/**
 * Worker de la cola `webhook-delivery` (REQ-DEL-1/3, REQ-LOG-3, AC-16/AC-20, D6/D10).
 *
 * `@Processor` con `concurrency: 20` y una `backoffStrategy` custom que aplica
 * FR-22 (T-W1.22) prefiriendo `job.data.retryAfterMs` cuando el destino envió
 * `Retry-After`. Switch por `job.name` (espeja `ActivityTimersProcessor`):
 *  - `delivery`      → `DeliveryService.handle` (payload→sign→POST→classify).
 *  - `dispatch-poll` → `Relay.run` (poll del outbox en el worker, OQ-C).
 *  - `reconcile`     → `ReconcileService.run` (recupera outbox no despachado y
 *                      jobs perdidos tras un flush de Redis, REQ-NFR-2).
 *  - `retention`     → `RetentionService.run` (purga el log de entregas y el
 *                      outbox despachado con más de N días, REQ-LOG-3).
 *
 * El poll/reconcile/retention NUNCA deben romper el scheduler: sus errores se
 * capturan y loguean. Los errores de entrega se propagan para que BullMQ
 * aplique el reintento.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE, {
  concurrency: WEBHOOK_DELIVERY_CONCURRENCY,
  settings: { backoffStrategy: webhookBackoffStrategy },
})
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly relay: Relay,
    private readonly delivery: DeliveryService,
    private readonly reconcile: ReconcileService,
    private readonly retention: RetentionService,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    switch (job.name) {
      case WebhookJobName.DELIVERY:
        await this.delivery.handle(job);
        return;
      case WebhookJobName.DISPATCH_POLL:
        await this.runPoll();
        return;
      case WebhookJobName.RECONCILE:
        await this.runReconcile();
        return;
      case WebhookJobName.RETENTION:
        await this.runRetention();
        return;
      default:
        this.logger.warn(`Unknown webhook job "${job.name}" (${job.id ?? '?'}); ignored`);
    }
  }

  private async runPoll(): Promise<void> {
    try {
      await this.relay.run();
    } catch (error) {
      this.logger.error(
        `Dispatch poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runReconcile(): Promise<void> {
    try {
      await this.reconcile.run();
    } catch (error) {
      this.logger.error(
        `Reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runRetention(): Promise<void> {
    try {
      await this.retention.run();
    } catch (error) {
      this.logger.error(
        `Retention purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
