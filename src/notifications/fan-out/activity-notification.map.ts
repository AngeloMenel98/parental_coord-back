import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';

/**
 * Mapping PURO `outbox_event.event_type` → notificación (REQ-FAN-004).
 *
 * Este módulo no toca TypeORM ni Nest: no consulta la activity, ni el bond, ni
 * escribe nada. El `NotificationFanOutService` resuelve los datos y usa
 * `buildRecipientIds()` para decidir destinatarios ANTES del primer INSERT
 * (defensivo, design D6). Así una regla mal escrita falla sin abrir SQL.
 */

/** Los 12 eventos de la actividad (catálogo cerrado, `activity-transition.map.ts`). */
export type ActivityNotificationEventType = (typeof ACTIVITY_EVENT)[keyof typeof ACTIVITY_EVENT];

/** Tipos de notificación que produce el fan-out (columna `notification.type`). */
export type ActivityNotificationType =
  | 'activity_created'
  | 'activity_assigned'
  | 'activity_assisting'
  | 'activity_in_progress'
  | 'activity_verify'
  | 'activity_verify_expired'
  | 'activity_created_overdue'
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

/** Datos de la activity ya disponibles para renderizar el cuerpo. */
export interface RenderContext {
  /** `activity.title` (máx. 80 caracteres en el DTO de creación). */
  activityTitle: string;
  /** `activity.scheduled_start`, cuando la activity lo tiene. */
  scheduledStart?: Date | null;
}

export interface NotificationFanOutRule {
  eventType: ActivityNotificationEventType;
  /** `notification.type` — un único tipo por evento (límite del índice único). */
  type: ActivityNotificationType;
  /**
   * Título de la notificación: QUÉ pasó (≤ 40 caracteres).
   *
   * N-2: title y body son cadenas DISTINTAS; el front las renderiza tal cual.
   */
  title: string;
  /**
   * Cuerpo de la notificación: quién/qué/cuándo + siguiente paso (≤ 100
   * caracteres). Recibe el contexto resuelto por el servicio.
   */
  body: (ctx: RenderContext) => string;
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

const TITLE_CREATED = 'Nueva actividad';
const TITLE_ASSIGNED = 'Nueva actividad asignada';
const TITLE_ASSISTING = 'Actividad aceptada';
const TITLE_IN_PROGRESS = 'Actividad en curso';
const TITLE_VERIFY = 'Actividad por verificar';
const TITLE_VERIFY_EXPIRED = 'La verificación venció';
const TITLE_CREATED_OVERDUE = 'Actividad sin asignar';
const TITLE_OVERDUE = 'Actividad vencida';
const TITLE_NOT_ASSISTING = 'Actividad declinada';
const TITLE_DONE = 'Actividad finalizada';
const TITLE_CANCELLED = 'Actividad cancelada';

/** Todos los títulos deben cumplir el límite de 40 caracteres (N-2). */
const RULE_TITLES = [
  TITLE_CREATED,
  TITLE_ASSIGNED,
  TITLE_ASSISTING,
  TITLE_IN_PROGRESS,
  TITLE_VERIFY,
  TITLE_VERIFY_EXPIRED,
  TITLE_CREATED_OVERDUE,
  TITLE_OVERDUE,
  TITLE_NOT_ASSISTING,
  TITLE_DONE,
  TITLE_CANCELLED,
] as const;

// Verificación estática en tiempo de compilación: si algún título supera los
// 40 caracteres, este tipo falla y el build se detiene.
type AssertTitleLength<T extends string> =
  T extends `${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}${string}`
    ? never
    : T;
type _TitleLengthCheck = AssertTitleLength<(typeof RULE_TITLES)[number]>;

function formatActivityDateTime(date: Date): string {
  // Se usa la zona horaria de Argentina porque el producto está pensado para
  // ese contexto; el formato es determinista y no depende del TZ del servidor.
  const local = new Date(
    date.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
  );
  const day = String(local.getDate()).padStart(2, '0');
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const hour = String(local.getHours()).padStart(2, '0');
  const minute = String(local.getMinutes()).padStart(2, '0');
  return `${day}/${month} a las ${hour}:${minute}`;
}

/**
 * Inserta el título de la actividad en la plantilla garantizando que el
 * resultado no supere `maxLength`. Si el título es demasiado largo se trunca
 * con ellipsis; nunca se inventa texto.
 */
function renderWithTitle(template: string, ctx: RenderContext, maxLength = 100): string {
  const maxTitleLength = maxLength - template.replace('{title}', '').length;
  const rawTitle = ctx.activityTitle;
  const title =
    maxTitleLength >= rawTitle.length
      ? rawTitle
      : `${rawTitle.slice(0, Math.max(0, maxTitleLength - 1))}…`;

  // Función de reemplazo (no string): un título con `$&`/`$1` se inserta
  // literalmente en vez de interpretarse como patrón de `String.replace`.
  return template.replace('{title}', () => title);
}

/**
 * Las 11 reglas entregables. `activity.unassigned` NO está aquí a propósito:
 * T4 fue removido y no hay productor, así que se omite (REQ-FAN-004).
 * `resolveNotificationRule` devuelve `null` para él y para cualquier tipo
 * desconocido.
 */
export const NOTIFICATION_FAN_OUT_RULES: readonly NotificationFanOutRule[] = [
  {
    eventType: ACTIVITY_EVENT.CREATED,
    type: 'activity_created',
    title: TITLE_CREATED,
    body: (ctx) => {
      const date = ctx.scheduledStart ? formatActivityDateTime(ctx.scheduledStart) : null;
      return date
        ? renderWithTitle(`Se creó "{title}" para el ${date}.`, ctx)
        : renderWithTitle('Se creó "{title}".', ctx);
    },
    recipients: ['members'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: true,
  },
  {
    eventType: ACTIVITY_EVENT.ASSIGNED,
    type: 'activity_assigned',
    title: TITLE_ASSIGNED,
    body: (ctx) => {
      const date = ctx.scheduledStart ? formatActivityDateTime(ctx.scheduledStart) : null;
      return date
        ? renderWithTitle(`Te asignaron "{title}" para el ${date}.`, ctx)
        : renderWithTitle('Te asignaron "{title}".', ctx);
    },
    recipients: ['assignee', 'creator'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.ASSISTING,
    type: 'activity_assisting',
    body: (ctx) => {
      const date = ctx.scheduledStart ? formatActivityDateTime(ctx.scheduledStart) : null;
      return date
        ? renderWithTitle(`Se confirmó "{title}" para el ${date}.`, ctx)
        : renderWithTitle('Se confirmó "{title}".', ctx);
    },
    title: TITLE_ASSISTING,
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.IN_PROGRESS,
    type: 'activity_in_progress',
    title: TITLE_IN_PROGRESS,
    body: (ctx) => {
      const date = ctx.scheduledStart ? formatActivityDateTime(ctx.scheduledStart) : null;
      return date
        ? renderWithTitle(`Comenzó "{title}" el ${date}.`, ctx)
        : renderWithTitle('Comenzó "{title}".', ctx);
    },
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.VERIFY,
    type: 'activity_verify',
    title: TITLE_VERIFY,
    body: (ctx) => renderWithTitle('"{title}" terminó y espera tu confirmación.', ctx),
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.VERIFY_EXPIRED,
    type: 'activity_verify_expired',
    title: TITLE_VERIFY_EXPIRED,
    body: (ctx) => renderWithTitle('"{title}" quedó sin confirmar y venció.', ctx),
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.CREATED_OVERDUE,
    type: 'activity_created_overdue',
    title: TITLE_CREATED_OVERDUE,
    body: (ctx) => renderWithTitle('"{title}" quedó sin asignar y venció.', ctx),
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.OVERDUE,
    type: 'activity_overdue',
    title: TITLE_OVERDUE,
    body: (ctx) =>
      renderWithTitle('"{title}" venció. Reprográmala o márcala como finalizada.', ctx),
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.NOT_ASSISTING,
    type: 'activity_not_assisting',
    title: TITLE_NOT_ASSISTING,
    body: (ctx) => renderWithTitle('El responsable declinó "{title}".', ctx),
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.DONE,
    type: 'activity_done',
    title: TITLE_DONE,
    body: (ctx) => renderWithTitle('Se finalizó "{title}".', ctx),
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: ACTIVITY_EVENT.CANCELLED,
    type: 'activity_cancelled',
    title: TITLE_CANCELLED,
    body: (ctx) => renderWithTitle('Se canceló "{title}".', ctx),
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
 * Renderiza el par title/body en español a partir del contexto resuelto.
 *
 * N-2: title y body son siempre cadenas diferentes. N-3: incluye el nombre de
 * la actividad y, cuando el dato está disponible, la fecha/hora. El actor se
 * omite si sólo se dispone de su UUID (no se inventan nombres).
 */
export function renderNotificationText(
  rule: Pick<NotificationFanOutRule, 'title' | 'body'>,
  ctx: RenderContext,
): RenderedNotificationText {
  return {
    title: rule.title,
    body: rule.body(ctx),
  };
}
