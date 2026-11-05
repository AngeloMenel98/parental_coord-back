import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';
import { WebhookSubscriptionEntity } from './subscriptions/entities/webhook-subscription.entity';
import { WebhookDeliveryEntity } from './delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryAttemptEntity } from './delivery/entities/webhook-delivery-attempt.entity';
import { WebhookSubscriptionRepository } from './subscriptions/repositories/webhook-subscription.repository';
import { WebhookDeliveryRepository } from './delivery/repositories/webhook-delivery.repository';
import { WebhookDeliveryAttemptRepository } from './delivery/repositories/webhook-delivery-attempt.repository';
import { SecretCipherService } from './delivery/secret-cipher.service';
import { WebhookAuthzService } from './subscriptions/webhook-authz.service';
import { WebhooksAuditRepository } from './admin/webhooks-audit.repository';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { ReplayService } from './admin/replay.service';
import { DeliveryLogService } from './admin/delivery-log.service';
import { SubscriptionsController } from './subscriptions/subscriptions.controller';
import { WebhookDeliveryLogController } from './admin/delivery-log.controller';
import { WebhookDeliveryController } from './admin/delivery.controller';

/**
 * Módulo API de webhooks (design D1/D8/D9, AC-19).
 *
 * Proceso API: registra la cola (productor) y los controladores/servicios de
 * gestión de suscripciones, log y replay. El `@Processor` vive SÓLO en el worker
 * (`WebhooksWorkerModule`), nunca aquí, para aislar la latencia del receptor
 * (REQ-DEL-1). `forwardRef(BondsModule)` inyecta `BondsService` para el seam de
 * autorización de membresía.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      WebhookSubscriptionEntity,
      WebhookDeliveryEntity,
      WebhookDeliveryAttemptEntity,
    ]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    NotificationsModule,
    forwardRef(() => BondsModule),
  ],
  controllers: [SubscriptionsController, WebhookDeliveryLogController, WebhookDeliveryController],
  providers: [
    WebhookSubscriptionRepository,
    WebhookDeliveryRepository,
    WebhookDeliveryAttemptRepository,
    SecretCipherService,
    WebhookAuthzService,
    WebhooksAuditRepository,
    SubscriptionsService,
    ReplayService,
    DeliveryLogService,
  ],
  exports: [SubscriptionsService, ReplayService, DeliveryLogService],
})
export class WebhooksModule {}
