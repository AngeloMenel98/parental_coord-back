import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Job } from 'bullmq';

import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { DEFAULT_WEBHOOK_API_VERSION, WebhookPayloadBuilder } from '../events/payload-builder';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from '../subscriptions/repositories/webhook-subscription.repository';
import { classify, DeliveryOutcome } from './classify';
import { resolveBackoffMs, WEBHOOK_MAX_ATTEMPTS } from './backoff.strategy';
import { WebhookDeliveryJobData } from './delivery.job';
import { EndpointLimiter, endpointHost } from './endpoint-limiter';
import { SecretCipherService } from './secret-cipher.service';
import { SigningService } from './signing.service';
import { SsrfHttpClient, SsrfHttpResult } from './ssrf-http.client';
import { WebhookDeliveryRepository } from './repositories/webhook-delivery.repository';
import { WebhookDeliveryAttemptRepository } from './repositories/webhook-delivery-attempt.repository';
import { WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { SubscriptionHealthService } from './subscription-health.service';
import { WebhookObservabilityService } from '../webhooks-observability';

/** Tope de la porción de respuesta guardada en el log (REQ-LOG-1, REQ-SEC-5). */
export const WEBHOOK_RESPONSE_SNIPPET_MAX_CHARS = 1024;

/** Tipo del payload de un ping de prueba (REQ-SUB-4, AC-4). */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test';

/**
 * Señal de reintento: la entrega quedó `RETRYING` y BullMQ debe reprogramarla.
 * Se lanza DESPUÉS de persistir el estado para que la cola aplique el backoff.
 */
export class WebhookDeliveryRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookDeliveryRetryError';
  }
}

/** Trunca el cuerpo de respuesta a ≤1 KB antes de persistirlo (REQ-LOG-1). */
export function truncateResponseSnippet(
  body: string | null | undefined,
  max: number = WEBHOOK_RESPONSE_SNIPPET_MAX_CHARS,
): string | null {
  if (!body) return null;
  return body.length > max ? body.slice(0, max) : body;
}

/**
 * Secretos de firma vigentes de una suscripción (REQ-SIGN-2, REQ-SUB-3).
 *
 * Durante la ventana de rotación (dentro de `secretPrevExpiresAt`) devuelve
 * [viejo, actual] para firmar con AMBOS (el header los une con espacios). Fuera
 * de la ventana devuelve sólo el actual.
 */
export function signingSecretsFor(
  subscription: Pick<
    WebhookSubscriptionEntity,
    'secretEncrypted' | 'secretPrevEncrypted' | 'secretPrevExpiresAt'
  >,
  now: Date,
): string[] {
  const secrets: string[] = [];
  const previous = subscription.secretPrevEncrypted;
  const expiresAt = subscription.secretPrevExpiresAt;
  if (previous != null && expiresAt != null && expiresAt.getTime() > now.getTime()) {
    secrets.push(previous);
  }
  secrets.push(subscription.secretEncrypted);
  return secrets;
}

/**
 * Estado que quedará en `webhook_delivery` para un intento dado (REQ-DEL-2/4).
 *
 * Pura y compartida: las métricas (T-W2.5) y la transición de estado se
 * calculan con la MISMA función para que nunca diverjan.
 */
export function statusForAttempt(
  outcome: DeliveryOutcome,
  attemptNo: number,
  maxAttempts: number,
): WebhookDeliveryStatus {
  if (outcome === 'SUCCESS') return WebhookDeliveryStatus.SUCCEEDED;
  if (outcome === 'DISABLE' || outcome === 'TERMINAL') return WebhookDeliveryStatus.FAILED;
  return attemptNo >= maxAttempts ? WebhookDeliveryStatus.DEAD : WebhookDeliveryStatus.RETRYING;
}

/**
 * Servicio de entrega (REQ-DEL-1..5, AC-12/13/14/15, D6).
 *
 * Ejecuta UN intento: arma el payload (T-W1.13), lo firma (T-W1.15), lo POSTea
 * por el cliente SSRF-safe (T-W1.16) respetando el cap por endpoint (T-W1.23),
 * registra el intento truncado a 1 KB y aplica el resultado (T-W1.21/22):
 *  - `SUCCESS` → `SUCCEEDED` (+ limpia la racha de fallo continuo).
 *  - `DISABLE` (410) → deshabilita la suscripción + `FAILED` + aviso al dueño.
 *  - `TERMINAL`   → `FAILED` (sin reintento) + registra la racha de fallo.
 *  - `RETRY`      → `RETRYING` + throw (BullMQ reprograma con backoff); si se
 *                   agotaron los intentos → `DEAD`. En ambos casos registra la
 *                   racha y, si supera 5 días continuos, auto-deshabilita.
 *
 * Cada intento además emite su structured log/métrica (T-W2.5) con lista blanca
 * — nunca secretos ni cuerpos (REQ-NFR-3, REQ-SEC-2).
 *
 * Nunca reintenta redirects (el cliente no los sigue).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly outbox: OutboxEventRepository,
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly attempts: WebhookDeliveryAttemptRepository,
    private readonly payloadBuilder: WebhookPayloadBuilder,
    private readonly signing: SigningService,
    private readonly cipher: SecretCipherService,
    private readonly http: SsrfHttpClient,
    private readonly limiter: EndpointLimiter,
    private readonly config: ConfigService,
    private readonly health: SubscriptionHealthService,
    private readonly observability: WebhookObservabilityService,
  ) {}

  /** Procesa un job de entrega (puede lanzar para forzar el reintento de BullMQ). */
  async handle(job: Job<WebhookDeliveryJobData>): Promise<void> {
    if (job.data.test) {
      await this.handleTest(job.data.subscriptionId);
      return;
    }

    const { eventId, subscriptionId } = job.data;

    const delivery = await this.deliveries.findByEventSub(eventId, subscriptionId);
    if (!delivery) {
      this.logger.warn(`No delivery row for (${eventId}, ${subscriptionId}); nothing to do`);
      return;
    }

    const attemptNo = (delivery.attemptCount ?? 0) + 1;

    const subscription = await this.subscriptions.findById(subscriptionId);
    if (!subscription) {
      await this.fail(delivery.id, attemptNo, 'Subscription not found');
      return;
    }
    if (subscription.status !== WebhookSubscriptionStatus.ACTIVE) {
      await this.fail(delivery.id, attemptNo, `Subscription is ${subscription.status}, not ACTIVE`);
      return;
    }

    const event = await this.outbox.findById(eventId);
    if (!event) {
      await this.fail(delivery.id, attemptNo, 'Outbox event not found');
      return;
    }

    let rawBody: Buffer;
    try {
      const payload = await this.payloadBuilder.build(event);
      rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    } catch (error) {
      await this.fail(delivery.id, attemptNo, `Payload build failed: ${errorMessage(error)}`);
      return;
    }

    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    let headers: Record<string, string>;
    try {
      const secrets = signingSecretsFor(subscription, now).map((secret) =>
        this.cipher.decrypt(secret),
      );
      headers = {
        ...this.signing.buildSignatureHeaders(event.id, timestamp, rawBody, secrets),
        'content-type': 'application/json',
      };
    } catch (error) {
      await this.fail(delivery.id, attemptNo, `Signing failed: ${errorMessage(error)}`);
      return;
    }

    const startedAt = new Date();
    const result = await this.limiter.run(endpointHost(subscription.url), () =>
      this.http.post(subscription.url, rawBody, headers),
    );
    const durationMs = Math.max(Date.now() - startedAt.getTime(), 0);

    await this.attempts.insertAttempt({
      deliveryId: delivery.id,
      attemptNo,
      startedAt,
      durationMs,
      statusCode: result.status,
      responseSnippet: truncateResponseSnippet(result.body),
      error: result.error,
    });

    const outcome = classify(result.status, result.networkError);
    const maxAttempts = job.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS;
    const nextStatus = statusForAttempt(outcome, attemptNo, maxAttempts);

    // Observabilidad (T-W2.5): lista blanca, nunca secretos ni cuerpos.
    this.observability.recordAttempt({
      eventId,
      subscriptionId,
      attempt: attemptNo,
      outcome,
      status: nextStatus,
      statusCode: result.status,
      latencyMs: durationMs,
      deliveryId: delivery.id,
      bondId: subscription.bondId,
    });

    await this.applyOutcome(job, delivery.id, subscription, outcome, result, attemptNo);
  }

  /**
   * Ping de prueba `webhook.test` (REQ-SUB-4, AC-4).
   *
   * No hay `outbox_event` ni fila de entrega: arma un payload mínimo, lo firma
   * con los secretos vigentes y lo POSTea por el mismo cliente SSRF-safe +
   * limiter. Es fire-and-forget: nunca lanza (no tiene sentido reintentar un
   * ping sin estado persistido); sólo loguea el resultado.
   */
  async handleTest(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptions.findById(subscriptionId);
    if (!subscription) {
      this.logger.warn(`Test ping skipped: subscription ${subscriptionId} not found`);
      return;
    }
    if (subscription.status !== WebhookSubscriptionStatus.ACTIVE) {
      this.logger.warn(
        `Test ping skipped: subscription ${subscriptionId} is ${subscription.status}, not ACTIVE`,
      );
      return;
    }

    const webhookId = randomUUID();
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    const rawBody = Buffer.from(
      JSON.stringify({
        id: webhookId,
        type: WEBHOOK_TEST_EVENT_TYPE,
        apiVersion: this.config.get<string>('WEBHOOK_API_VERSION') ?? DEFAULT_WEBHOOK_API_VERSION,
        occurredAt: now.toISOString(),
        data: { test: true },
      }),
      'utf8',
    );

    let headers: Record<string, string>;
    try {
      const secrets = signingSecretsFor(subscription, now).map((secret) =>
        this.cipher.decrypt(secret),
      );
      headers = {
        ...this.signing.buildSignatureHeaders(webhookId, timestamp, rawBody, secrets),
        'content-type': 'application/json',
      };
    } catch (error) {
      this.logger.error(`Test ping signing failed for ${subscriptionId}: ${errorMessage(error)}`);
      return;
    }

    const result = await this.limiter.run(endpointHost(subscription.url), () =>
      this.http.post(subscription.url, rawBody, headers),
    );

    if (result.status === null || result.status >= 400) {
      this.logger.warn(
        `Test ping to subscription ${subscriptionId} failed: status=${result.status ?? 'none'} error=${result.error ?? 'n/a'}`,
      );
    }
  }

  private async applyOutcome(
    job: Job<WebhookDeliveryJobData>,
    deliveryId: string,
    subscription: WebhookSubscriptionEntity,
    outcome: DeliveryOutcome,
    result: SsrfHttpResult,
    attemptNo: number,
  ): Promise<void> {
    const now = new Date();

    if (outcome === 'SUCCESS') {
      await this.deliveries.updateStatus(deliveryId, {
        status: WebhookDeliveryStatus.SUCCEEDED,
        attemptCount: attemptNo,
        nextAttemptAt: null,
        lastStatusCode: result.status,
        lastError: null,
        completedAt: now,
      });
      // Éxito: no hubo fallo continuo → se limpia la racha (REQ-SUB-5).
      await this.health.recordSuccess(subscription);
      return;
    }

    if (outcome === 'DISABLE') {
      await this.deliveries.updateStatus(deliveryId, {
        status: WebhookDeliveryStatus.FAILED,
        attemptCount: attemptNo,
        nextAttemptAt: null,
        lastStatusCode: result.status,
        lastError: result.error ?? 'Endpoint returned 410 Gone',
        completedAt: now,
      });
      // 410 → deshabilita INMEDIATAMENTE + aviso al `created_by` (T-W2.4, AC-5).
      await this.disableSubscription(subscription.id);
      await this.health.notifyDisabled(subscription, 'gone');
      return;
    }

    if (outcome === 'TERMINAL') {
      await this.deliveries.updateStatus(deliveryId, {
        status: WebhookDeliveryStatus.FAILED,
        attemptCount: attemptNo,
        nextAttemptAt: null,
        lastStatusCode: result.status,
        lastError: result.error ?? `Terminal response ${result.status ?? 'blocked'}`,
        completedAt: now,
      });
      // También cuenta como fallo continuo (el endpoint sigue sin servir).
      await this.health.recordFailure(subscription, now);
      return;
    }

    // RETRY: agotado → DEAD en Postgres; si no, RETRYING + throw para BullMQ.
    const maxAttempts = job.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS;
    if (attemptNo >= maxAttempts) {
      await this.deliveries.updateStatus(deliveryId, {
        status: WebhookDeliveryStatus.DEAD,
        attemptCount: attemptNo,
        nextAttemptAt: null,
        lastStatusCode: result.status,
        lastError: result.error ?? `Exhausted after ${attemptNo} attempts`,
        completedAt: now,
      });
      await this.health.recordFailure(subscription, now);
      return;
    }

    const delayMs = resolveBackoffMs(attemptNo, result.retryAfterMs);
    await this.deliveries.updateStatus(deliveryId, {
      status: WebhookDeliveryStatus.RETRYING,
      attemptCount: attemptNo,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      lastStatusCode: result.status,
      lastError: result.error,
      completedAt: null,
    });
    await this.health.recordFailure(subscription, now);
    await this.stashRetryAfter(job, result.retryAfterMs);
    throw new WebhookDeliveryRetryError(
      `Delivery ${deliveryId} failed on attempt ${attemptNo}; retrying`,
    );
  }

  /** Persiste el `Retry-After` en `job.data` para que la backoffStrategy lo prefiera. */
  private async stashRetryAfter(
    job: Job<WebhookDeliveryJobData>,
    retryAfterMs: number | null,
  ): Promise<void> {
    const nextData: WebhookDeliveryJobData = {
      ...job.data,
      retryAfterMs: retryAfterMs ?? undefined,
    };
    await job.updateData(nextData);
  }

  private async fail(deliveryId: string, attemptNo: number, error: string): Promise<void> {
    await this.deliveries.updateStatus(deliveryId, {
      status: WebhookDeliveryStatus.FAILED,
      attemptCount: attemptNo,
      nextAttemptAt: null,
      completedAt: new Date(),
      lastError: error,
    });
  }

  private async disableSubscription(subscriptionId: string): Promise<void> {
    await this.subscriptions.updateEntity(subscriptionId, {
      status: WebhookSubscriptionStatus.DISABLED,
      // La racha queda cerrada: si se rehabilita, la cuenta arranca de cero.
      consecutiveFailureSince: null,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
