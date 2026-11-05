import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_NOTIFICATIONS_RETENTION_INTERVAL_MS,
  NOTIFICATION_RETENTION_QUEUE,
  NOTIFICATIONS_RETENTION_SCHEDULER_ID,
  NotificationRetentionJobName,
} from './notifications-retention.constants';

/**
 * Scheduler repetible de la purga de retención (spec "Worker scheduler", D7/D8).
 *
 * Registra en `OnModuleInit` (espejando `RelayScheduler`):
 *  - `upsertJobScheduler('notifications-retention', { every }, { name:'retention' })`
 *
 * Sin `setInterval`/cron y sin `@nestjs/schedule` (la purga es este repeatable
 * scheduler de BullMQ). Sólo se registra en el proceso worker (el API no
 * importa este módulo). `upsertJobScheduler` es idempotente ⇒ se puede llamar
 * en cada arranque sin duplicar schedulers.
 *
 * Si Redis está caído al arrancar se DEGRADA con un log: el worker sigue
 * arrancando y el próximo arranque sano registra el scheduler.
 *
 * ⚠ Rollback (design D7): quitar el código NO quita el estado de Redis. Un
 * rollback del release debe ejecutar `queue.removeJobScheduler('notifications-retention')`
 * (o `redis-cli` sobre la key del repeatable) para eliminar el scheduler
 * huérfano; el `default:` del processor es la red de seguridad para ese
 * scheduler residual.
 */
@Injectable()
export class NotificationsRetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationsRetentionScheduler.name);

  constructor(
    @InjectQueue(NOTIFICATION_RETENTION_QUEUE)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.upsertScheduler();
  }

  /** Upsert idempotente del scheduler de purga (idempotente entre reinicios). */
  private async upsertScheduler(): Promise<void> {
    const every =
      this.config.get<number>('NOTIFICATIONS_RETENTION_INTERVAL_MS') ??
      DEFAULT_NOTIFICATIONS_RETENTION_INTERVAL_MS;

    try {
      await this.queue.upsertJobScheduler(
        NOTIFICATIONS_RETENTION_SCHEDULER_ID,
        { every },
        { name: NotificationRetentionJobName.RETENTION, data: {} },
      );
      this.logger.log(`notifications retention scheduler upserted (every ${every}ms)`);
    } catch (error) {
      this.logger.error(
        'Failed to upsert notifications retention scheduler',
        error instanceof Error ? error.stack : String(error),
      );
      // Degradar sin romper el arranque si Redis no está disponible.
    }
  }
}
