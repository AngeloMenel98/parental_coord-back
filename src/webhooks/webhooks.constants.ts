/**
 * Estables del pipeline de webhooks salientes (design D1/D3/D6).
 *
 * El productor de la cola vive en el proceso API; el `@Processor` sólo se
 * registra en el worker (`worker.main.ts` → `WorkerModule`), de modo que la
 * latencia del receptor nunca afecta al API (REQ-DEL-1, OQ-C).
 */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

/**
 * Job names que resuelve el switch por `job.name` del delivery processor
 * (design D3/D10): `delivery` es el fan-out por (evento, suscripción);
 * `dispatch-poll` el relay; `reconcile` recupera jobs perdidos tras un flush de
 * Redis; `retention` purga logs/outbox viejos.
 */
export enum WebhookJobName {
  DELIVERY = 'delivery',
  DISPATCH_POLL = 'dispatch-poll',
  RECONCILE = 'reconcile',
  RETENTION = 'retention',
}

/** IDs de los `upsertJobScheduler` (BullMQ repeatable schedulers, no cron). */
export const WEBHOOK_DISPATCH_POLL_SCHEDULER_ID = 'webhooks-dispatch-poll';
export const WEBHOOK_RECONCILE_SCHEDULER_ID = 'webhooks-reconcile';
export const WEBHOOK_RETENTION_SCHEDULER_ID = 'webhooks-retention';

/** `User-Agent` obligatorio de cada delivery (REQ-SIGN-3, AC-12). */
export const WEBHOOK_USER_AGENT = 'CoparentAgenda-Webhooks/1.0';

/**
 * Prefijo estable del secreto de firma (Standard Webhooks, REQ-SIGN-1): el valor
 * almacenado/enviado es `whsec_<base64 32 bytes>`. La firma usa la parte base64
 * decodificada como clave HMAC (REQ-SIGN-1/D5).
 */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
