import { EXPENSE_EVENT, ExpenseEventType } from '../../expenses/expense-events';

/**
 * Mapping PURO `outbox_event.event_type` → notificación de GASTO (T23, PRD §7).
 *
 * Es el hermano de `activity-notification.map.ts` y comparte su disciplina: este
 * módulo no toca TypeORM ni Nest — no consulta el gasto, ni el bond, ni escribe
 * nada. El `NotificationFanOutService` resuelve los datos y decide los
 * destinatarios ANTES del primer INSERT, así que una regla mal escrita falla sin
 * abrir SQL.
 *
 * Por qué un archivo aparte y no una rama más dentro del mapa de actividades:
 * los dos dominios tienen destinatarios, textos y campos de referencia distintos.
 * Mezclarlos habría dejado un `switch` de aggregate dentro de un módulo cuyas
 * reglas son todas de actividad. El fan-out elige el mapa por `aggregate_type`;
 * cada mapa sigue siendo puro.
 */

/** Tipos de notificación que produce el fan-out de gastos (`notification.type`). */
export type ExpenseNotificationType =
  'expense_created' | 'expense_approved' | 'expense_rejected' | 'expense_paid' | 'expense_stale';

/**
 * Candidato a destinatario, antes de deduplicar y de excluir al actor.
 *
 * `counterpart` es "la otra parte del vínculo": quien aprueba y, por lo tanto,
 * quien tiene que enterarse de que hay algo para aprobar. `requester` es quien
 * cargó el gasto y quien recibe el resultado de su propia solicitud.
 */
export type ExpenseRecipientSlot = 'requester' | 'counterpart';

/** Datos del gasto ya resueltos, listos para renderizar el cuerpo. */
export interface ExpenseRenderContext {
  /** `expense.concept` — el DTO lo acota a 255, el cuerpo a 100. */
  concept: string;
  /** `expense.amount` ya convertido de `numeric` (el driver lo devuelve string). */
  amount: number;
}

export interface ExpenseNotificationRule {
  eventType: ExpenseEventType;
  /** `notification.type` — un único tipo por evento (límite del índice único). */
  type: ExpenseNotificationType;
  /** QUÉ pasó (≤ 40 caracteres), igual que en actividades: title ≠ body. */
  title: string;
  /** Cuerpo con el detalle (≤ 100 caracteres). */
  body: (ctx: ExpenseRenderContext) => string;
  /** Slots candidatos, todavía sin deduplicar ni excluir al actor. */
  recipients: readonly ExpenseRecipientSlot[];
}

const TITLE_CREATED = 'Nuevo gasto';
const TITLE_APPROVED = 'Gasto aprobado';
const TITLE_REJECTED = 'Gasto rechazado';
const TITLE_PAID = 'Gasto pagado';
const TITLE_STALE = 'Gasto sin aprobar';

// El límite de 40 caracteres de los títulos NO se verifica con el truco de
// tipos del mapa de actividades: ese truco necesita un array que sólo se usa
// como tipo y este repo lo marca como `no-unused-vars`. Se verifica en el spec
// (`every rule has a title ≤ 40 chars`), que además corre en CI.

/**
 * Monto en formato es-AR: `$15.000,50`.
 *
 * Se formatea a mano en vez de `toLocaleString` porque el resultado del cuerpo
 * de una notificación es parte del contrato observable (y de los tests): no
 * puede cambiar según el ICU del runtime. `expense.amount` es `numeric(12,2)`,
 * así que siempre hay exactamente dos decimales.
 */
export function formatExpenseAmount(amount: number): string {
  const fixed = Math.abs(amount).toFixed(2);
  const [integerPart, decimalPart] = fixed.split('.');
  const withThousands = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 ? '-' : ''}$${withThousands},${decimalPart}`;
}

/**
 * Inserta el concepto del gasto garantizando que el resultado no supere
 * `maxLength`. Si es demasiado largo se trunca con ellipsis; nunca se inventa
 * texto ni se corta el monto.
 */
function renderWithConcept(template: string, ctx: ExpenseRenderContext, maxLength = 100): string {
  const amount = formatExpenseAmount(ctx.amount);
  const skeleton = template.replace('{concept}', '').replace('{amount}', amount);
  const maxConceptLength = maxLength - skeleton.length;
  const raw = ctx.concept;
  const concept =
    maxConceptLength >= raw.length ? raw : `${raw.slice(0, Math.max(0, maxConceptLength - 1))}…`;

  // Función de reemplazo (no string): un concepto con `$&`/`$1` se inserta
  // literalmente en vez de interpretarse como patrón de `String.replace`.
  return template.replace('{concept}', () => concept).replace('{amount}', () => amount);
}

/**
 * Las 5 reglas de §7.
 *
 * **`expense.created` avisa a la contraparte, no a "todos".** El gasto nace
 * `pending` y la única acción posible es aprobarlo o rechazarlo, que la política
 * reserva a la contraparte. Notificar a quien no puede hacer nada sería ruido.
 *
 * **`expense.paid` notifica al solicitante, y eso puede no notificar a nadie.**
 * §7 dice "Expense marked paid → Requester", pero `canMarkPaid` es para
 * CUALQUIERA de las dos partes: si el propio solicitante marca el pago, el
 * destinatario es el actor y la regla universal R2 (el actor nunca recibe el
 * aviso de su propia acción) lo descarta. Es el comportamiento correcto para la
 * regla escrita; si el producto quiere además avisar a la contraparte en ese
 * caso, es una decisión de producto y no se inventa acá.
 */
export const EXPENSE_NOTIFICATION_RULES: readonly ExpenseNotificationRule[] = [
  {
    eventType: EXPENSE_EVENT.CREATED,
    type: 'expense_created',
    title: TITLE_CREATED,
    body: (ctx) => renderWithConcept('"{concept}" por {amount} espera tu aprobación.', ctx),
    recipients: ['counterpart'],
  },
  {
    eventType: EXPENSE_EVENT.APPROVED,
    type: 'expense_approved',
    title: TITLE_APPROVED,
    body: (ctx) => renderWithConcept('Se aprobó "{concept}" por {amount}.', ctx),
    recipients: ['requester'],
  },
  {
    eventType: EXPENSE_EVENT.REJECTED,
    type: 'expense_rejected',
    title: TITLE_REJECTED,
    body: (ctx) => renderWithConcept('Se rechazó "{concept}" por {amount}.', ctx),
    recipients: ['requester'],
  },
  {
    eventType: EXPENSE_EVENT.PAID,
    type: 'expense_paid',
    title: TITLE_PAID,
    body: (ctx) => renderWithConcept('Se marcó como pagado "{concept}" por {amount}.', ctx),
    recipients: ['requester'],
  },
  {
    eventType: EXPENSE_EVENT.STALE,
    type: 'expense_stale',
    title: TITLE_STALE,
    body: (ctx) => renderWithConcept('"{concept}" lleva más de 7 días pendiente.', ctx),
    recipients: ['counterpart'],
  },
];

/**
 * Resuelve la regla de un `event_type` de gasto.
 *
 * @returns la regla, o `null` para cualquier tipo desconocido — un no-op, nunca
 *          un throw: un evento huérfano no puede tumbar al relay.
 */
export function resolveExpenseNotificationRule(eventType: string): ExpenseNotificationRule | null {
  return EXPENSE_NOTIFICATION_RULES.find((rule) => rule.eventType === eventType) ?? null;
}

/** Datos ya resueltos desde la BD (o sus equivalentes en tests). */
export interface ExpenseRecipientContext {
  /** `expense.requested_by`. */
  requestedBy?: string | null;
  /** La otra parte del vínculo; `null` si el vínculo tiene un solo miembro. */
  counterpartId?: string | null;
  /** `payload.actor.id` sólo cuando `actor.type === 'user'`; sistema ⇒ `null`. */
  actorId?: string | null;
}

/**
 * Destinatarios finales: candidatos → `Set` (dedupe) → quitar `null`/`''` →
 * excluir SIEMPRE al actor → orden determinista.
 *
 * R2: el actor nunca recibe una notificación de su propia acción. Un actor de
 * sistema (el recordatorio de 7 días) no tiene `id`, así que no excluye a nadie.
 */
export function buildExpenseRecipientIds(
  rule: ExpenseNotificationRule,
  context: ExpenseRecipientContext,
): string[] {
  const candidates: Array<string | null | undefined> = [];

  for (const slot of rule.recipients) {
    switch (slot) {
      case 'requester':
        candidates.push(context.requestedBy);
        break;
      case 'counterpart':
        candidates.push(context.counterpartId);
        break;
    }
  }

  const excluded = new Set<string>();
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

export interface RenderedExpenseNotificationText {
  title: string;
  body: string;
}

/** Renderiza el par title/body en español a partir del contexto resuelto. */
export function renderExpenseNotificationText(
  rule: Pick<ExpenseNotificationRule, 'title' | 'body'>,
  ctx: ExpenseRenderContext,
): RenderedExpenseNotificationText {
  return {
    title: rule.title,
    body: rule.body(ctx),
  };
}
