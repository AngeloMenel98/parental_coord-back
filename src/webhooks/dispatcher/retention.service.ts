import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { WebhookDeliveryAttemptRepository } from '../delivery/repositories/webhook-delivery-attempt.repository';

/** Días de retención por defecto de logs/outbox (REQ-LOG-3, D12). */
export const DEFAULT_RETENTION_DAYS = 30;

/** Milisegundos de un día, para convertir la ventana en un corte de fecha. */
const MS_PER_DAY = 86_400_000;

/** Resultado de una pasada de purga (para logs/observabilidad). */
export interface RetentionResult {
  /** Intentos de entrega purgados (log de entregas). */
  purgedAttempts: number;
  /** Filas de outbox ya despachadas purgadas. */
  purgedOutbox: number;
  /** Corte usado (`now - RETENTION_DAYS`). */
  cutoff: Date;
}

/**
 * Retención (REQ-LOG-3, AC-16, D10).
 *
 * Corre en el worker cada 24 h vía `upsertJobScheduler('webhooks-retention')`:
 *  1. `DELETE webhook_delivery_attempt WHERE started_at < now - N días`, y
 *  2. `DELETE outbox_event WHERE dispatched_at < now - N días` (sólo despachado;
 *     las filas pendientes nunca se tocan). La FK en cascada
 *     `webhook_delivery.event_id → outbox_event` purga la entrega asociada.
 *
 * Sin cron/`@nestjs/schedule`: el scheduler lo registra `RelayScheduler` y lo
 * dispara el `WebhookDeliveryProcessor` por `job.name`.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly attempts: WebhookDeliveryAttemptRepository,
    private readonly outbox: OutboxEventRepository,
    private readonly config: ConfigService,
  ) {}

  /** Purga todo lo anterior a la ventana de retención configurada. */
  async run(now: Date = new Date()): Promise<RetentionResult> {
    const days = this.config.get<number>('WEBHOOK_RETENTION_DAYS') ?? DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY);

    const purgedAttempts = await this.attempts.purgeOlderThan(cutoff);
    const purgedOutbox = await this.outbox.purgeDispatchedBefore(cutoff);

    if (purgedAttempts > 0 || purgedOutbox > 0) {
      this.logger.log(
        `Retention purged attempts=${purgedAttempts} outbox=${purgedOutbox} (older than ${days}d)`,
      );
    }

    return { purgedAttempts, purgedOutbox, cutoff };
  }
}
