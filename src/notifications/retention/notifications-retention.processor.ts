import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  NOTIFICATION_RETENTION_QUEUE,
  NotificationRetentionJobName,
} from './notifications-retention.constants';
import { NotificationsRetentionService } from './notifications-retention.service';

/**
 * Worker de la cola `notification-retention` (spec "Dispatch safety", design D7).
 *
 * Switch por `job.name` (espeja `WebhookDeliveryProcessor`):
 *  - `retention` → `NotificationsRetentionService.run` (purga de la ventana de
 *    retención configurada).
 *
 * El `default:` (nombre desconocido) sólo AVISA y no lanza nada: es la red de
 * seguridad de un rollback, porque el estado de Redis (el repeatable scheduler)
 * sobrevive al código ⇒ un job con el nombre viejo no debe producir errores.
 *
 * Los errores de la purga se capturan y registran (NO se propagan): el job se
 * confirma (ack) y la próxima pasada diaria vuelve a intentarlo. Es la misma
 * política que la ruta `retention` del `WebhookDeliveryProcessor`
 * (`runRetention`), que captura y loguea sin relanzar; el reintento de BullMQ
 * se reserva allí para los errores de ENTREGA (que sí deben reintentarse).
 */
@Processor(NOTIFICATION_RETENTION_QUEUE)
export class NotificationsRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsRetentionProcessor.name);

  constructor(private readonly service: NotificationsRetentionService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case NotificationRetentionJobName.RETENTION:
        await this.runRetention();
        return;
      default:
        this.logger.warn(`Unknown notification job "${job.name}" (${job.id ?? '?'}); ignored`);
    }
  }

  private async runRetention(): Promise<void> {
    try {
      await this.service.run();
    } catch (error) {
      this.logger.error(
        `Notification retention purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
