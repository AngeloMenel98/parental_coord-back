import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';

/**
 * Mapping PURO `outbox_event.event_type` → notificación (REQ-FAN-004).
 *
 * Este módulo no toca TypeORM ni Nest: no consulta la activity, ni el bond, ni
 * escribe nada. El futuro `NotificationFanOutService` resuelve los datos y usa
 * `buildRecipientIds()` para decidir destinatarios ANTES del primer INSERT
 * (defensivo, design D6). Así una regla mal escrita falla sin abrir SQL.
 */

/** Los 9 eventos de la actividad (catálogo cerrado, `activity-transition.map.ts`). */
export type ActivityNotificationEventType = (typeof ACTIVITY_EVENT)[keyof typeof ACTIVITY_EVENT];

/** Tipos de notificación que produce el fan-out (columna `notification.type`). */
export type ActivityNotificationType =
  | 'activity_created'
  | 'activity_assigned'
  | 'activity_assisting'
  | 'activity_in_progress'
  | 'activity_overdue'
  | 'activity_not_assisting'
  | 'activity_done'
  | 'activity_cancelled';

/**
 * Fuente de un candidato a destinatario (antes de deduplicar/excluir actor).
 *
 * `members` = miembros activos del bond; se usa sólo en `activity.created`,
 * donde ambos progenitores deben ver la actividad recién creada.
 */
export type RecipientSlot = 'assignee' | 'creator' | 'coordinator' | 'members';

export interface NotificationFanOutRule {
  eventType: ActivityNotificationEventType;
  /** `notification.type` — un único tipo por evento (límite del índice único). */
  type: ActivityNotificationType;
  /**
   * Plantilla de título Y cuerpo (`title = body`). `{title}` se sustituye por
   * `activity.title`. `activity.title` ≤ 80 caracteres en el DTO de creación,
   * así que el resultado siempre cabe en `notification.title` (varchar 255).
   */
  template: string;
  /** Slots candidatos, todavía sin deduplicar ni excluir al actor. */
  recipients: readonly RecipientSlot[];
  /**
   * Quitar al coordinador del conjunto candidato. Sólo `created` (está dentro
   * de `members`) y `assigned` (el coordinador no debe recibir el aviso de
   * asignación) lo activan; el resto lo incluye de forma aditiva.
   */
  excludeCoordinator: boolean;
  /** El servicio debe resolver `findCoordinator(bondId)`. */
  needsCoordinator: boolean;
  /** El servicio debe resolver `findActiveMemberIds(bondId)`. */
  needsMembers: boolean;
}

/**
 * Las 8 reglas entregables. `activity.unassigned` NO está aquí a propósito:
 * no existe productor y el payload aún no lleva `previousAssignedTo`, así que
 * se omite en este cambio (REQ-FAN-004). `resolveNotificationRule` devuelve
 * `null` para él y para cualquier tipo desconocido.
 */
export const NOTIFICATION_FAN_OUT_RULES: readonly NotificationFanOutRule[] = [
  {
    eventType: ACTIVITY_EVENT.CREATED,
    type: 'activity_created',
    template: 'New activity: {title}',
    recipients: ['members'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: true,
  },
  {
    eventType: ACTIVITY_EVENT.ASSIGNED,
    type: 'activity_assigned',
    template: 'New activity assigned: {title}',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.ASSISTING,
    type: 'activity_assisting',
    template: 'Activity accepted: {title}',
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.IN_PROGRESS,
    type: 'activity_in_progress',
    template: 'Activity started: {title}',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.OVERDUE,
    type: 'activity_overdue',
    template: 'Activity overdue: {title}',
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.NOT_ASSISTING,
    type: 'activity_not_assisting',
    template: 'Activity declined: {title}',
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.DONE,
    type: 'activity_done',
    template: 'Activity completed: {title}',
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.CANCELLED,
    type: 'activity_cancelled',
    template: 'Activity cancelled: {title}',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
];

/**
 * Datos ya resueltos desde la BD (o sus equivalentes en tests). Todos son
 * opcionales a propósito: un coordinator ausente es normal (el flujo de admin
 * crea dos `PROGENITOR` y ningún `COORDINATOR`), no un error.
 */
export interface RecipientContext {
  assignedTo?: string | null;
  createdBy?: string | null;
  coordinatorId?: string | null;
  memberIds?: readonly string[] | null;
  /** `payload.actor.id` sólo cuando `actor.type === 'user'`; sistema ⇒ `null`. */
  actorId?: string | null;
}

/**
 * Resuelve la regla de un `event_type`.
 *
 * @returns la regla, o `null` para `activity.unassigned` (omitido a propósito)
 *          y para cualquier tipo desconocido — ambos son no-ops, nunca throws.
 */
export function resolveNotificationRule(eventType: string): NotificationFanOutRule | null {
  return NOTIFICATION_FAN_OUT_RULES.find((rule) => rule.eventType === eventType) ?? null;
}

/**
 * Destinatarios finales: candidatos → `Set` (dedupe) → quitar `null`/`''` →
 * excluir coordinador (si la regla lo pide) → excluir SIEMPRE al actor → orden
 * determinista.
 *
 * Es puro y se ejecuta antes del primer INSERT: si una regla o un dato están
 * mal, el fallo ocurre sin SQL (la tx de dispatch queda intacta).
 */
export function buildRecipientIds(
  rule: NotificationFanOutRule,
  context: RecipientContext,
): string[] {
  const candidates: Array<string | null | undefined> = [];

  for (const slot of rule.recipients) {
    switch (slot) {
      case 'assignee':
        candidates.push(context.assignedTo);
        break;
      case 'creator':
        candidates.push(context.createdBy);
        break;
      case 'coordinator':
        candidates.push(context.coordinatorId);
        break;
      case 'members':
        candidates.push(...(context.memberIds ?? []));
        break;
    }
  }

  const excluded = new Set<string>();
  if (rule.excludeCoordinator && context.coordinatorId) {
    excluded.add(context.coordinatorId);
  }
  // R2: el actor nunca recibe una notificación de su propia acción. Un actor
  // de sistema no tiene `id` ⇒ no excluye a nadie.
  if (context.actorId) {
    excluded.add(context.actorId);
  }

  const recipients = new Set<string>();
  for (const candidate of candidates) {
    if (candidate && !excluded.has(candidate)) {
      recipients.add(candidate);
    }
  }

  return [...recipients].sort();
}

export interface RenderedNotificationText {
  title: string;
  body: string;
}

/**
 * Renderiza la plantilla. `title` y `body` son idénticos por diseño (spec
 * REQ-FAN-004), pero se devuelven por separado para que el servicio no tenga
 * que saberlo.
 */
export function renderNotificationText(
  rule: Pick<NotificationFanOutRule, 'template'>,
  activityTitle: string,
): RenderedNotificationText {
  // Función de reemplazo (no string): un título con `$&`/`$1` se inserta
  // literalmente en vez de interpretarse como patrón de `String.replace`.
  const text = rule.template.replace('{title}', () => activityTitle);
  return { title: text, body: text };
}
