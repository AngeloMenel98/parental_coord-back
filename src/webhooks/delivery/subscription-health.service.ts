import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationRepository } from '../../notifications/repositories/notification.repository';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { WebhookObservabilityService } from '../webhooks-observability';

/** Ventana por defecto de fallo continuo antes del auto-deshabilitado (FR-24, D12). */
export const DEFAULT_WEBHOOK_AUTO_DISABLE_DAYS = 5;

/** `type` de la notificación al dueño (D11: `type='webhook_disabled'`, ≤50). */
export const WEBHOOK_DISABLED_NOTIFICATION_TYPE = 'webhook_disabled';

/** `refEntityType` de la notificación enlazada a la suscripción. */
export const WEBHOOK_SUBSCRIPTION_REF_ENTITY_TYPE = 'webhook_subscription';

const MS_PER_DAY = 86_400_000;

/** Por qué se deshabilitó la suscripción (para el texto del aviso). */
export type WebhookDisableReason = 'gone' | 'sustained-failure';

/** Subconjunto de la suscripción que la salud necesita (sin secretos). */
export type HealthSubscription = Pick<
  WebhookSubscriptionEntity,
  'id' | 'bondId' | 'createdBy' | 'status' | 'consecutiveFailureSince'
>;

/** Texto del aviso al dueño — sin secretos ni cuerpos (REQ-SEC-2, REQ-SUB-5). */
export function disableNotificationText(
  subscriptionId: string,
  reason: WebhookDisableReason,
  autoDisableDays?: number,
): { title: string; body: string } {
  if (reason === 'gone') {
    return {
      title: 'Webhook subscription disabled',
      body:
        `Your webhook subscription ${subscriptionId} was disabled automatically: ` +
        `the endpoint answered 410 Gone. Re-enable it from the webhooks screen to resume deliveries.`,
    };
  }
  return {
    title: 'Webhook subscription auto-disabled',
    body:
      `Your webhook subscription ${subscriptionId} was auto-disabled after ` +
      `${autoDisableDays ?? DEFAULT_WEBHOOK_AUTO_DISABLE_DAYS} days of continuous delivery failures. ` +
      `Re-enable it from the webhooks screen once the endpoint is healthy again.`,
  };
}

/**
 * Ciclo de vida del fallo continuo de una suscripción (REQ-SUB-5, AC-5, D11).
 *
 * Lleva la cuenta de `consecutive_failure_since`:
 *  - primer fallo → se fija el inicio de la racha;
 *  - primer éxito → la racha se limpia (no hubo fallo CONTINUO de 5 días);
 *  - racha ≥ `WEBHOOK_AUTO_DISABLE_DAYS` → status `AUTO_DISABLED` + aviso al
 *    `created_by` (no hay filas `coordinador`, D11/Q6).
 *
 * También emite el aviso inmediato de deshabilitación por `410 Gone`
 * (REQ-DEL-2, T-W2.4). Los avisos nunca rompen la entrega: se capturan.
 */
@Injectable()
export class SubscriptionHealthService {
  private readonly logger = new Logger(SubscriptionHealthService.name);

  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly notifications: NotificationRepository,
    private readonly config: ConfigService,
    private readonly observability: WebhookObservabilityService,
  ) {}

  /**
   * Registra UN fallo de entrega. Devuelve `true` si alcanzó el umbral y la
   * suscripción acabó en `AUTO_DISABLED`.
   */
  async recordFailure(subscription: HealthSubscription, now: Date = new Date()): Promise<boolean> {
    if (subscription.status !== WebhookSubscriptionStatus.ACTIVE) return false;

    const since = subscription.consecutiveFailureSince ?? now;
    if (!subscription.consecutiveFailureSince) {
      await this.subscriptions.updateEntity(subscription.id, { consecutiveFailureSince: now });
    }

    const thresholdMs = this.autoDisableDays() * MS_PER_DAY;
    if (now.getTime() - since.getTime() < thresholdMs) return false;

    await this.subscriptions.updateEntity(subscription.id, {
      status: WebhookSubscriptionStatus.AUTO_DISABLED,
      // La racha queda cerrada: si se rehabilita, una nueva racha empieza desde cero.
      consecutiveFailureSince: null,
    });
    this.observability.recordAutoDisabled(subscription.id);
    await this.notifyDisabled(subscription, 'sustained-failure');
    this.logger.warn(
      JSON.stringify({
        subscriptionId: subscription.id,
        since: since.toISOString(),
        autoDisableDays: this.autoDisableDays(),
      }),
    );
    return true;
  }

  /** Registra UN éxito y limpia la racha de fallo continuo si había una. */
  async recordSuccess(subscription: HealthSubscription): Promise<void> {
    if (!subscription.consecutiveFailureSince) return;
    await this.subscriptions.updateEntity(subscription.id, { consecutiveFailureSince: null });
  }

  /**
   * Notifica al `created_by` que la suscripción se deshabilitó (REQ-SUB-5, AC-5).
   * Nunca lanza: un fallo de la tabla de notificaciones no debe romper la entrega.
   */
  async notifyDisabled(
    subscription: HealthSubscription,
    reason: WebhookDisableReason,
  ): Promise<void> {
    const { title, body } = disableNotificationText(
      subscription.id,
      reason,
      this.config.get<number>('WEBHOOK_AUTO_DISABLE_DAYS'),
    );
    try {
      await this.notifications.createNotification({
        userId: subscription.createdBy,
        bondId: subscription.bondId,
        type: WEBHOOK_DISABLED_NOTIFICATION_TYPE,
        title,
        body,
        refEntityType: WEBHOOK_SUBSCRIPTION_REF_ENTITY_TYPE,
        refEntityId: subscription.id,
      });
    } catch (error) {
      this.logger.error(
        `Failed to notify owner about disabled subscription ${subscription.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private autoDisableDays(): number {
    return (
      this.config.get<number>('WEBHOOK_AUTO_DISABLE_DAYS') ?? DEFAULT_WEBHOOK_AUTO_DISABLE_DAYS
    );
  }
}
