import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { OutboxEventRepository } from '../outbox/repositories/outbox-event.repository';
import { WebhookDeliveryStatus } from './delivery/entities/webhook-delivery.entity';
import { WebhookDeliveryRepository } from './delivery/repositories/webhook-delivery.repository';
import { WebhookSubscriptionStatus } from './subscriptions/entities/webhook-subscription.entity';
import { WebhookSubscriptionRepository } from './subscriptions/repositories/webhook-subscription.repository';
import { WEBHOOK_DELIVERY_QUEUE } from './webhooks.constants';

// ---------------------------------------------------------------------------
// Structured delivery logs (REQ-NFR-3, REQ-SEC-2)
// ---------------------------------------------------------------------------

/**
 * Claves que NUNCA deben aparecer en un log estructurado de entrega:
 * material de secreto y cuerpos de respuesta/petición completos
 * (REQ-SEC-2: "secrets … NEVER appear in logs, payloads or error messages";
 * REQ-NFR-3: "never secrets or full bodies").
 */
const FORBIDDEN_LOG_KEYS: ReadonlySet<string> = new Set([
  'secret',
  'secrets',
  'secretencrypted',
  'secretprevencrypted',
  'whsec',
  'authorization',
  'webhooksignature',
  'signature',
  'headers',
  'body',
  'rawbody',
  'payload',
  'responsesnippet',
  'response',
  'errorbody',
]);

/**
 * Campos PERMITIDOS en el log estructurado de un intento de entrega
 * (REQ-NFR-3: `eventId`/`subscriptionId`/`attempt` + latencia/estado).
 *
 * Lista blanca estricta: cualquier otra clave que el llamador pase se descarta,
 * de modo que un secreto o un cuerpo completo nunca llegan al log por
 * accidente (defensa en profundidad para la prueba de redacción).
 */
const DELIVERY_LOG_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'eventId',
  'subscriptionId',
  'attempt',
  'outcome',
  'status',
  'statusCode',
  'latencyMs',
  'deliveryId',
  'bondId',
]);

/** Patrón de secreto (`whsec_…`) en texto libre, para redacción de mensajes. */
const SECRET_PATTERN = /\bwhsec_[A-Za-z0-9+/=]{4,}/g;

/**
 * Redacta material de secreto de un texto arbitrario (REQ-SEC-2).
 * Útil cuando un mensaje de error externo pudiera colar un `whsec_…`.
 */
export function redactSecrets(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(SECRET_PATTERN, '[REDACTED]');
}

/** Entrada de un intento de entrega — sólo campos de identidad/métrica. */
export interface DeliveryLogInput {
  eventId: string;
  subscriptionId: string;
  attempt: number;
  /** Resultado de la clasificación: SUCCESS / DISABLE / TERMINAL / RETRY. */
  outcome?: string;
  /** Estado resultante en `webhook_delivery` (SUCCEEDED/FAILED/RETRYING/DEAD). */
  status?: string;
  statusCode?: number | null;
  latencyMs?: number;
  deliveryId?: string;
  bondId?: string;
}

/**
 * Construye el payload del log estructurado de UN intento (REQ-NFR-3).
 *
 * Devuelve SÓLO las claves de la lista blanca: cualquier clave extra aportada
 * por el llamador (p. ej. `secret`, `body`) se descarta. Cadenas de texto se
 * pasan además por {@link redactSecrets}. Nunca contiene cuerpos de respuesta
 * ni material de secreto.
 */
export function buildDeliveryLogEntry(input: DeliveryLogInput): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const key of DELIVERY_LOG_ALLOWED_KEYS) {
    if (!(key in input)) continue;
    // Defensa en profundidad: la lista blanca y la negra no deben solaparse.
    if (FORBIDDEN_LOG_KEYS.has(key.toLowerCase())) continue;
    const value = (input as unknown as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      entry[key] = redactSecrets(value);
    } else {
      entry[key] = value;
    }
  }
  return entry;
}

/** Claves prohibidas en logs (exportada para las aserciones de la prueba). */
export function forbiddenLogKeys(): ReadonlySet<string> {
  return FORBIDDEN_LOG_KEYS;
}

// ---------------------------------------------------------------------------
// Metrics (lightweight, in-process — no metrics stack in the project)
// ---------------------------------------------------------------------------

/** Latencia acumulada de los intentos (REQ-NFR-3: "attempt latency"). */
export interface AttemptLatencyMetrics {
  count: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
}

/** Métricas en proceso: entregas por estado + latencia (REQ-NFR-3). */
export class WebhookMetrics {
  private readonly byStatus = new Map<WebhookDeliveryStatus, number>();
  private latencyCount = 0;
  private latencyTotalMs = 0;
  private latencyMaxMs = 0;
  private autoDisabled = 0;

  /** Registra el resultado de UN intento de entrega. */
  recordDeliveryOutcome(status: WebhookDeliveryStatus, latencyMs?: number): void {
    this.byStatus.set(status, (this.byStatus.get(status) ?? 0) + 1);
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
      this.latencyCount += 1;
      this.latencyTotalMs += latencyMs;
      this.latencyMaxMs = Math.max(this.latencyMaxMs, latencyMs);
    }
  }

  /** Cada auto-deshabilitación se cuenta aparte (métrica nominal de AC-20). */
  recordAutoDisabled(): void {
    this.autoDisabled += 1;
  }

  deliveriesByStatus(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [status, count] of this.byStatus) out[status] = count;
    return out;
  }

  attemptLatency(): AttemptLatencyMetrics {
    return {
      count: this.latencyCount,
      totalMs: this.latencyTotalMs,
      maxMs: this.latencyMaxMs,
      avgMs: this.latencyCount > 0 ? this.latencyTotalMs / this.latencyCount : 0,
    };
  }

  autoDisabledCount(): number {
    return this.autoDisabled;
  }

  /** `true` si alguna métrica ha avanzado (útil en pruebas/inspección). */
  hasData(): boolean {
    return this.latencyCount > 0 || this.byStatus.size > 0 || this.autoDisabled > 0;
  }
}

// ---------------------------------------------------------------------------
// Alerts (REQ-NFR-3: lag > 60 s, growing queue depth, DEAD-rate spikes)
// ---------------------------------------------------------------------------

/** Códigos de alerta del relay de webhooks (hooks, no una plataforma de alertas). */
export type WebhookAlertCode = 'OUTBOX_LAG' | 'QUEUE_GROWING' | 'DEAD_RATE_SPIKE';

export interface WebhookAlert {
  code: WebhookAlertCode;
  message: string;
  value: number;
  threshold: number;
}

/** Umbral configurable de las alertas (defaults razonables para v1). */
export interface WebhookAlertThresholds {
  /** Lag máximo tolerado del outbox antes de alertar (default 60 s). */
  outboxLagMs: number;
  /** Profundidad mínima de cola para que el crecimiento sea significativo. */
  queueGrowMinDepth: number;
  /** Proporción de `DEAD` sobre el total disparada como pico. */
  deadRateRatio: number;
  /** Mínimo absoluto de entregas `DEAD` para considerar pico. */
  deadMinCount: number;
}

/** Defaults: lag 60 s (REQ-NFR-3), cola creciente ≥100, DEAD-rate 20 % ≥5. */
export const DEFAULT_ALERT_THRESHOLDS: Readonly<WebhookAlertThresholds> = Object.freeze({
  outboxLagMs: 60_000,
  queueGrowMinDepth: 100,
  deadRateRatio: 0.2,
  deadMinCount: 5,
});

/** Instantánea de las magnitudes evaluadas por las alertas. */
export interface WebhookAlertSnapshot {
  /** Edad (ms) del outbox pendiente más antiguo, o `null` si no hay pendientes. */
  oldestPendingOutboxAgeMs: number | null;
  /** Profundidad actual de la cola, o `null` si Redis no respondió. */
  queueDepth: number | null;
  /** Profundidad de la evaluación anterior (para detectar crecimiento). */
  previousQueueDepth: number | null;
  /** Entregas en estado `DEAD`. */
  deadDeliveries: number;
  /** Total de entregas conocidas (todas las combinaciones de estado). */
  totalDeliveries: number;
}

/**
 * Evaluación PURA de las alertas del relay (REQ-NFR-3, AC-20).
 *
 * Devuelve todas las alertas que aplican a la instantánea (puede haber varias):
 *  - `OUTBOX_LAG`     — el outbox pendiente más antiguo supera 60 s.
 *  - `QUEUE_GROWING`  — la cola creció respecto a la evaluación anterior y ya
 *                        alcanza `queueGrowMinDepth`.
 *  - `DEAD_RATE_SPIKE`— la proporción de `DEAD` supera `deadRateRatio` con al
 *                        menos `deadMinCount` entregas muertas.
 */
export function evaluateWebhookAlerts(
  snapshot: WebhookAlertSnapshot,
  thresholds: WebhookAlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): WebhookAlert[] {
  const alerts: WebhookAlert[] = [];

  if (
    snapshot.oldestPendingOutboxAgeMs !== null &&
    snapshot.oldestPendingOutboxAgeMs >= thresholds.outboxLagMs
  ) {
    alerts.push({
      code: 'OUTBOX_LAG',
      message: `Outbox lag ${snapshot.oldestPendingOutboxAgeMs}ms exceeds ${thresholds.outboxLagMs}ms`,
      value: snapshot.oldestPendingOutboxAgeMs,
      threshold: thresholds.outboxLagMs,
    });
  }

  if (
    snapshot.queueDepth !== null &&
    snapshot.previousQueueDepth !== null &&
    snapshot.queueDepth > snapshot.previousQueueDepth &&
    snapshot.queueDepth >= thresholds.queueGrowMinDepth
  ) {
    alerts.push({
      code: 'QUEUE_GROWING',
      message: `Queue depth grew from ${snapshot.previousQueueDepth} to ${snapshot.queueDepth}`,
      value: snapshot.queueDepth,
      threshold: thresholds.queueGrowMinDepth,
    });
  }

  if (snapshot.totalDeliveries > 0) {
    const deadRate = snapshot.deadDeliveries / snapshot.totalDeliveries;
    if (snapshot.deadDeliveries >= thresholds.deadMinCount && deadRate > thresholds.deadRateRatio) {
      alerts.push({
        code: 'DEAD_RATE_SPIKE',
        message: `DEAD rate ${(deadRate * 100).toFixed(1)}% exceeds ${(thresholds.deadRateRatio * 100).toFixed(0)}%`,
        value: snapshot.deadDeliveries,
        threshold: thresholds.deadMinCount,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Service (wiring)
// ---------------------------------------------------------------------------

/** Instantánea completa de métricas del relay (REQ-NFR-3, AC-20). */
export interface WebhookObservabilitySnapshot {
  /** Contadores en proceso desde el arranque: entregas por estado. */
  deliveriesByStatus: Record<string, number>;
  /** Gauge desde Postgres: entregas por estado (histórico completo). */
  deliveriesByStatusTotal: Record<string, number>;
  /** Suma de {@link deliveriesByStatusTotal}. */
  totalDeliveries: number;
  /** Latencia de intento acumulada. */
  attemptLatency: AttemptLatencyMetrics;
  /** Profundidad de la cola (waiting+active+delayed), `null` si Redis cae. */
  queueDepth: number | null;
  /** Edad del outbox pendiente más antiguo en ms, `null` si no hay pendientes. */
  oldestPendingOutboxAgeMs: number | null;
  /** Entregas `DEAD` (gauge desde Postgres). */
  deadDeliveries: number;
  /** Suscripciones `AUTO_DISABLED` (gauge desde Postgres). */
  autoDisabledSubscriptions: number;
}

/**
 * Observabilidad del relay de webhooks (REQ-NFR-3, AC-20).
 *
 * No introduce ninguna plataforma de métricas: el proyecto no tiene una, así
 * que implementa un contador ligero en proceso ({@link WebhookMetrics}),
 * structured logs con lista blanca ({@link buildDeliveryLogEntry}) y hooks de
 * alerta puros ({@link evaluateWebhookAlerts}) evaluados en cada reconciliación.
 *
 * Los gauges (cola, lag del outbox, `DEAD`, `AUTO_DISABLED`) se calculan
 * consultando Postgres/Redis en `snapshot()`, de modo que sobreviven a los
 * reinicios del proceso.
 */
@Injectable()
export class WebhookObservabilityService {
  private readonly logger = new Logger(WebhookObservabilityService.name);
  readonly metrics = new WebhookMetrics();

  private previousQueueDepth: number | null = null;

  constructor(
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly outbox: OutboxEventRepository,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Registra UN intento de entrega: contador + structured log con lista blanca
   * (nunca secretos ni cuerpos, REQ-NFR-3/REQ-SEC-2).
   */
  recordAttempt(input: DeliveryLogInput): void {
    if (input.status) {
      this.metrics.recordDeliveryOutcome(input.status as WebhookDeliveryStatus, input.latencyMs);
    }
    this.log('log', 'webhook.delivery.attempt', buildDeliveryLogEntry(input));
  }

  /** Cada auto-deshabilitación se registra y se cuenta (AC-5/AC-20). */
  recordAutoDisabled(subscriptionId: string): void {
    this.metrics.recordAutoDisabled();
    this.log('warn', 'webhook.subscription.auto_disabled', { subscriptionId });
  }

  /** Instantánea de métricas (contadores en proceso + gauges desde DB/Redis). */
  async snapshot(now: Date = new Date()): Promise<WebhookObservabilitySnapshot> {
    const queueDepth = await this.readQueueDepth();
    const oldest = await this.outbox.oldestPendingCreatedAt();

    const byStatusDb: Record<string, number> = {};
    let totalDeliveries = 0;
    for (const status of Object.values(WebhookDeliveryStatus)) {
      const count = await this.deliveries.countByStatus(status);
      byStatusDb[status] = count;
      totalDeliveries += count;
    }
    const deadDeliveries = byStatusDb[WebhookDeliveryStatus.DEAD] ?? 0;
    const autoDisabledSubscriptions = await this.subscriptions.countByStatus(
      WebhookSubscriptionStatus.AUTO_DISABLED,
    );

    return {
      deliveriesByStatus: this.metrics.deliveriesByStatus(),
      deliveriesByStatusTotal: byStatusDb,
      totalDeliveries,
      attemptLatency: this.metrics.attemptLatency(),
      queueDepth,
      oldestPendingOutboxAgeMs: oldest ? now.getTime() - oldest.getTime() : null,
      deadDeliveries,
      autoDisabledSubscriptions,
    };
  }

  /**
   * Evalúa los hooks de alerta y loguea las que aplican (REQ-NFR-3, AC-20).
   *
   * Nunca lanza: si Redis/Postgres no responden se degrada a un log de error
   * (la observabilidad no debe tumbar la reconciliación).
   */
  async evaluateAlerts(now: Date = new Date()): Promise<WebhookAlert[]> {
    try {
      const snap = await this.snapshot(now);
      const alerts = evaluateWebhookAlerts({
        oldestPendingOutboxAgeMs: snap.oldestPendingOutboxAgeMs,
        queueDepth: snap.queueDepth,
        previousQueueDepth: this.previousQueueDepth,
        deadDeliveries: snap.deadDeliveries,
        totalDeliveries: snap.totalDeliveries,
      });
      this.previousQueueDepth = snap.queueDepth;

      for (const alert of alerts) {
        this.log('warn', `webhook.alert.${alert.code}`, {
          value: alert.value,
          threshold: alert.threshold,
        });
      }
      return alerts;
    } catch (error) {
      this.logger.error(
        `Alert evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /** Profundidad de la cola (waiting+active+delayed); `null` si Redis cae. */
  private async readQueueDepth(): Promise<number | null> {
    try {
      const [waiting, active, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getDelayedCount(),
      ]);
      return waiting + active + delayed;
    } catch {
      return null;
    }
  }

  private log(
    level: 'log' | 'warn' | 'error',
    message: string,
    fields: Record<string, unknown>,
  ): void {
    const line = JSON.stringify({ ...fields, severity: message });
    if (level === 'warn') this.logger.warn(line);
    else if (level === 'error') this.logger.error(line);
    else this.logger.log(line);
  }
}
