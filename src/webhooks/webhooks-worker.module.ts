import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivitiesModule } from '../activities/activities.module';
import { OutboxModule } from '../outbox/outbox.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeWorkerModule } from '../realtime/realtime-worker.module';
import { WebhookSubscriptionEntity } from './subscriptions/entities/webhook-subscription.entity';
import { WebhookDeliveryEntity } from './delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryAttemptEntity } from './delivery/entities/webhook-delivery-attempt.entity';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';
import { WebhookSubscriptionRepository } from './subscriptions/repositories/webhook-subscription.repository';
import { WebhookDeliveryRepository } from './delivery/repositories/webhook-delivery.repository';
import { WebhookDeliveryAttemptRepository } from './delivery/repositories/webhook-delivery-attempt.repository';
import { SecretCipherService } from './delivery/secret-cipher.service';
import { SigningService } from './delivery/signing.service';
import { SsrfHttpClient } from './delivery/ssrf-http.client';
import { EndpointLimiter } from './delivery/endpoint-limiter';
import { WebhookPayloadBuilder } from './events/payload-builder';
import { FanOutService } from './dispatcher/fan-out.service';
import { Relay } from './dispatcher/relay';
import { ReconcileService } from './dispatcher/reconcile.service';
import { RelayScheduler } from './dispatcher/relay-scheduler';
import { RetentionService } from './dispatcher/retention.service';
import { DeliveryService } from './delivery/delivery.service';
import { SubscriptionHealthService } from './delivery/subscription-health.service';
import { WebhookDeliveryProcessor } from './delivery/processor';
import { WebhookObservabilityService } from './webhooks-observability';

/**
 * Módulo worker de webhooks (design D1/D3/D10, AC-20).
 *
 * Proceso worker (`worker.main.ts` → `WorkerModule`): registra el `@Processor`
 * de la cola de entregas y los schedulers repetibles (relay poll + reconcile +
 * retención). Reutiliza `OutboxModule` (lectura + purga del outbox),
 * `NotificationsModule` (aviso al `created_by`, T-W2.3/T-W2.4) y `ActivitiesModule`
 * (snapshot del payload, D4). `RealtimeWorkerModule` aporta el `RealtimePublisher`
 * que el relay usa para emitir la señal de realtime tras un fan-out exitoso (REQ-4).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebhookSubscriptionEntity,
      WebhookDeliveryEntity,
      WebhookDeliveryAttemptEntity,
    ]),
    BullModule.registerQueue({ name: WEBHOOK_DELIVERY_QUEUE }),
    OutboxModule,
    NotificationsModule,
    ActivitiesModule,
    RealtimeWorkerModule,
  ],
  providers: [
    WebhookSubscriptionRepository,
    WebhookDeliveryRepository,
    WebhookDeliveryAttemptRepository,
    SecretCipherService,
    SigningService,
    SsrfHttpClient,
    EndpointLimiter,
    WebhookPayloadBuilder,
    FanOutService,
    Relay,
    ReconcileService,
    RetentionService,
    WebhookObservabilityService,
    SubscriptionHealthService,
    DeliveryService,
    WebhookDeliveryProcessor,
    RelayScheduler,
  ],
})
export class WebhooksWorkerModule {}
