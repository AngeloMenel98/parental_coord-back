import { ExpenseStatus } from './entities/expense.entity';

/**
 * Catálogo CERRADO de eventos de gasto (T23, wave 2 · PRD_expense §7).
 *
 * Vive en el dominio del gasto, no en notifications, porque el productor
 * (`ExpensesService`) y el consumidor (el fan-out) tienen que hablar del mismo
 * nombre. Es el espejo de `ACTIVITY_EVENT` (`activity-transition.map.ts`): el
 * evento es un dato del aggregate, no del transporte que lo reparte.
 *
 * R8: estos eventos viajan por el outbox → fan-out existente. No hay un segundo
 * transporte.
 */
export const EXPENSE_EVENT = {
  /** Nace un gasto → avisa a quien tiene que aprobarlo. */
  CREATED: 'expense.created',
  APPROVED: 'expense.approved',
  REJECTED: 'expense.rejected',
  PAID: 'expense.paid',
  /** Recordatorio de un gasto que lleva más de 7 días pendiente. */
  STALE: 'expense.stale',
} as const;

export type ExpenseEventType = (typeof EXPENSE_EVENT)[keyof typeof EXPENSE_EVENT];

/**
 * El evento que PRODUCE cada estado al que se llega.
 *
 * Es un mapa y no un `if` por método porque `transition()` es un solo camino para
 * aprobar, rechazar y marcar pagado: con el mapa, cada transición emite sin
 * duplicar la llamada, y agregar un estado obliga al compilador a pedir su
 * evento en vez de dejar una transición muda.
 *
 * No incluye `PENDING`: el gasto no "transiciona" a pendiente, NACE pendiente, y
 * eso emite `expense.created` en el alta.
 */
export const EXPENSE_STATUS_EVENT: Record<Exclude<ExpenseStatus, 'pending'>, ExpenseEventType> = {
  [ExpenseStatus.APPROVED]: EXPENSE_EVENT.APPROVED,
  [ExpenseStatus.REJECTED]: EXPENSE_EVENT.REJECTED,
  [ExpenseStatus.PAID]: EXPENSE_EVENT.PAID,
};

/**
 * `aggregate_version` del outbox para un gasto.
 *
 * `expense` NO tiene columna `version` — T24 resolvió la concurrencia con
 * compare-and-swap sobre `status` en vez de un contador. Inventar un número
 * incremental sería mentir sobre un estado que no existe, así que la versión es
 * el ORDINAL del ciclo de vida:
 *
 *   pending → 1 · approved | rejected → 2 · paid → 3
 *
 * Es monótono porque el ciclo de vida lo es: `approved:paid` sube, y una
 * transición inválida ni siquiera llega a escribir. El lock real sigue siendo el
 * `UPDATE ... WHERE status = :expectedFrom`.
 *
 * `expense.stale` no cambia el estado del gasto (sólo recuerda que sigue
 * pendiente), así que su versión también es 1: un evento no altera la versión
 * del aggregate que describe.
 */
export function expenseAggregateVersion(status: ExpenseStatus): number {
  switch (status) {
    case ExpenseStatus.PENDING:
      return 1;
    case ExpenseStatus.APPROVED:
    case ExpenseStatus.REJECTED:
      return 2;
    case ExpenseStatus.PAID:
      return 3;
  }
}
