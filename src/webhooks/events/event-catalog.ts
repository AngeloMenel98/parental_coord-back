import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';

/**
 * Catálogo de tipos de evento de webhooks (REQ-EVT-1, AC-21).
 *
 * `PRODUCED_ACTIVITY_EVENT_TYPES` se DERIVA del mapa de transiciones
 * (`ACTIVITY_EVENT`) para que el catálogo nunca se desincronice de lo que el
 * productor realmente emite: son los `activity.*` de T1–T16 excepto los
 * catalogados pero no emitidos.
 */
export const PRODUCED_ACTIVITY_EVENT_TYPES: readonly string[] = Object.values(
  ACTIVITY_EVENT,
).filter((type) => type !== ACTIVITY_EVENT.UNASSIGNED);

/**
 * `activity.state_changed` es VIRTUAL: el productor NUNCA lo emite; el dispatcher
 * lo sintetiza como match catch-all para cada transición (REQ-DISP-2, REQ-EVT-1).
 */
export const WEBHOOK_VIRTUAL_EVENT_TYPE = 'activity.state_changed';

/**
 * Eventos catalogados pero NO emitidos hoy. `activity.unassigned` sobrevive como
 * constante pública de contrato de webhooks (un suscriptor puede filtrar por él)
 * aunque T4 fue removido y ya no hay productor (REQ-EVT-1, AC-21).
 */
export const WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPES: readonly string[] = [
  ACTIVITY_EVENT.UNASSIGNED,
];

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
 * Catálogo completo que sirve `GET /event-types` (T-W1.29): los tipos
 * producidos, el virtual `activity.state_changed` y los catalogados-no-emitidos.
 */
export function listEventCatalog(): EventCatalogEntry[] {
  return [
    ...PRODUCED_ACTIVITY_EVENT_TYPES.map((type) => ({ type, emitted: true, virtual: false })),
    { type: WEBHOOK_VIRTUAL_EVENT_TYPE, emitted: false, virtual: true },
    ...WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPES.map((type) => ({
      type,
      emitted: false,
      virtual: false,
    })),
  ];
}

/** `true` si `type` es uno de los tipos que el productor emite hoy. */
export function isProducedEventType(type: string): boolean {
  return PRODUCED_ACTIVITY_EVENT_TYPES.includes(type);
}
