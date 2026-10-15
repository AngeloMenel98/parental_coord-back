import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';

/**
 * Catálogo de tipos de evento de webhooks (REQ-EVT-1, AC-21).
 *
 * `PRODUCED_ACTIVITY_EVENT_TYPES` se DERIVA del mapa de transiciones
 * (`ACTIVITY_EVENT`) para que el catálogo nunca se desincronice de lo que el
 * productor realmente emite: son exactamente los nueve `activity.*` de T1–T11/T15.
 */
export const PRODUCED_ACTIVITY_EVENT_TYPES: readonly string[] = Object.values(ACTIVITY_EVENT);

/**
 * `activity.state_changed` es VIRTUAL: el productor NUNCA lo emite; el dispatcher
 * lo sintetiza como match catch-all para cada transición (REQ-DISP-2, REQ-EVT-1).
 */
export const WEBHOOK_VIRTUAL_EVENT_TYPE = 'activity.state_changed';

/**
 * `activity.verify` está CATALOGADO pero NO se emite hasta que exista el flujo de
 * verificación (REQ-EVT-1, AC-19: out of scope hoy).
 */
export const WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE = 'activity.verify';

/** Cómo se ve cada tipo en `GET /event-types`. */
export interface EventCatalogEntry {
  /** El identificador estable del tipo de evento. */
  type: string;
  /** `true` si el outbox lo produce hoy. */
  emitted: boolean;
  /** `true` para el catch-all sintetizado (nunca producido). */
  virtual: boolean;
}

/**
 * Catálogo completo que sirve `GET /event-types` (T-W1.29): los nueve tipos
 * producidos, el virtual `activity.state_changed` y el catalogado-no-emitido
 * `activity.verify`.
 */
export function listEventCatalog(): EventCatalogEntry[] {
  return [
    ...PRODUCED_ACTIVITY_EVENT_TYPES.map((type) => ({ type, emitted: true, virtual: false })),
    { type: WEBHOOK_VIRTUAL_EVENT_TYPE, emitted: false, virtual: true },
    { type: WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE, emitted: false, virtual: false },
  ];
}

/** `true` si `type` es uno de los tipos que el productor emite hoy. */
export function isProducedEventType(type: string): boolean {
  return PRODUCED_ACTIVITY_EVENT_TYPES.includes(type);
}
