/**
 * Estrategia de backoff FR-22 (REQ-DEL-3, AC-13, D6).
 *
 * Schedule determinista: inmediato, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h.
 * El índice del array es el número de intento (1-based) menos uno: con
 * `attempts: 8` BullMQ invoca la estrategia con `attemptsMade + 1` tras cada
 * fallo, es decir 1..7 (7 reintentos). El octavo valor queda como tope si algún
 * día se sube `attempts`.
 *
 * Un `Retry-After` presente en la respuesta tiene prioridad sobre el schedule
 * (el llamador lo escribe en `job.data.retryAfterMs`; D6).
 */
export const WEBHOOK_BACKOFF_MS: readonly number[] = [
  0, // intento 1 → 2: inmediato
  5_000, // 5 s
  300_000, // 5 min
  1_800_000, // 30 min
  7_200_000, // 2 h
  18_000_000, // 5 h
  36_000_000, // 10 h
  36_000_000, // 10 h
];

/** Número total de intentos (incluye el primero): 8 (REQ-DEL-3). */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_MS.length;

/** Delay del schedule FR-22 para un intento (1-based), con tope en el último valor. */
export function webhookBackoffForAttempt(attemptsMade: number): number {
  const index = Math.min(Math.max(Math.trunc(attemptsMade) - 1, 0), WEBHOOK_BACKOFF_MS.length - 1);
  return WEBHOOK_BACKOFF_MS[index];
}

/**
 * Delay efectivo de reintento: `Retry-After` si es un valor válido ≥ 0, si no el
 * schedule FR-22 (REQ-DEL-2/3).
 */
export function resolveBackoffMs(attemptsMade: number, retryAfterMs?: number | null): number {
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.trunc(retryAfterMs);
  }
  return webhookBackoffForAttempt(attemptsMade);
}
