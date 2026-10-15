/**
 * Clasificación PURA del resultado de un intento de entrega (REQ-DEL-2, AC-13, D6).
 *
 * No tiene I/O: recibe el código HTTP y el flag de error de red y devuelve el
 * destino del intento. Reglas (spec rev 3 + OQ-F):
 *  - `2xx`                          → `SUCCESS`
 *  - `410 Gone`                     → `DISABLE` (deshabilita la suscripción, terminal)
 *  - `408` / `429` / `5xx` / red    → `RETRY`
 *  - `3xx` (redirect NO seguido)    → `TERMINAL` (FAILED, nunca se reintenta; OQ-F)
 *  - resto de `4xx` / `1xx`         → `TERMINAL`
 *
 * Un resultado bloqueado por SSRF (sin status, sin error de red) es TERMINAL:
 * reintentar una IP privada no tiene sentido dentro de la ventana de backoff.
 */
export type DeliveryOutcome = 'SUCCESS' | 'DISABLE' | 'TERMINAL' | 'RETRY';

export function classify(status: number | null, networkError: boolean): DeliveryOutcome {
  // DNS/timeout/ECONNREFUSED: transitorio, se reintenta con backoff.
  if (networkError) return 'RETRY';
  // Bloqueo SSRF: no hubo respuesta HTTP y no es un fallo de red reintentable.
  if (status === null) return 'TERMINAL';
  if (status >= 200 && status < 300) return 'SUCCESS';
  if (status === 410) return 'DISABLE';
  if (status === 408 || status === 429) return 'RETRY';
  if (status >= 500) return 'RETRY';
  // 1xx, 3xx (redirect no seguido, OQ-F) y 4xx no reintentables.
  return 'TERMINAL';
}
