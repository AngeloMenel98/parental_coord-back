import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationEntity } from './entities/notification.entity';
import { NotificationRepository } from './repositories/notification.repository';
import { NOTIFICATION_RETENTION_QUEUE } from './retention/notifications-retention.constants';
import { NotificationsRetentionProcessor } from './retention/notifications-retention.processor';
import { NotificationsRetentionScheduler } from './retention/notifications-retention.scheduler';
import { NotificationsRetentionService } from './retention/notifications-retention.service';

/**
 * Módulo worker de notificaciones (design D1/D8).
 *
 * Proceso worker (`worker.main.ts` → `WorkerModule`): registra la cola
 * `notification-retention`, el `@Processor` que purga y el scheduler repetible
 * que la dispara. El API NO importa este módulo ⇒ la purga sólo ocurre en el
 * worker y el API no arrastra BullMQ.
 *
 * ⚠ NO importa `NotificationsModule` (eso arrastraría el controller y el
 * service del API al proceso worker). Se registra sólo lo que la ruta de
 * retención necesita: la entidad para TypeORM y `NotificationRepository`
 * (el SQL vive en el repositorio; el servicio sólo resuelve corte/política).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity]),
    BullModule.registerQueue({ name: NOTIFICATION_RETENTION_QUEUE }),
  ],
  providers: [
    NotificationRepository,
    NotificationsRetentionService,
    NotificationsRetentionScheduler,
    NotificationsRetentionProcessor,
  ],
})
export class NotificationsWorkerModule {}
