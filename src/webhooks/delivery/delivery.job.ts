/**
 * Contrato de los jobs de la cola `webhook-delivery` (design D3/D6).
 *
 * El `jobId` es determinista `{eventId}--{subscriptionId}` (REQ-DISP-3, AC-10):
 * re-encolar el mismo par colapsa en BullMQ, y la fila `webhook_delivery` tiene
 * `UNIQUE(event_id, subscription_id)` (REQ-DATA-2), de modo que el fan-out y el
 * replay son idempotentes.
 */
export interface WebhookDeliveryJobData {
  /** `outbox_event.id` — también es el `webhook-id` estable (OQ-E). */
  eventId: string;
  /** `webhook_subscription.id` destino. */
  subscriptionId: string;
  /**
   * Delay preferido (ms) tomado de `Retry-After` de la respuesta anterior; lo
   * escribe el servicio de entrega y lo consume la `backoffStrategy` (D6).
   */
  retryAfterMs?: number;
  /**
   * Marca de ping de prueba (`POST /subscriptions/:id/test`, REQ-SUB-4). No hay
   * `outbox_event` ni fila de entrega: el worker arma el payload `webhook.test`,
   * lo firma y lo POSTea. `eventId` queda vacío en este caso.
   */
  test?: boolean;
}

/** Tipo de backoff custom registrado en la `backoffStrategy` del worker (D6). */
export const WEBHOOK_BACKOFF_TYPE = 'webhook-schedule';

/** Concurrencia del worker de entregas (design D6). */
export const WEBHOOK_DELIVERY_CONCURRENCY = 20;

/** `jobId` determinista del fan-out/replay (REQ-DISP-3, AC-10). */
export function buildDeliveryJobId(eventId: string, subscriptionId: string): string {
  return `${eventId}--${subscriptionId}`;
}
