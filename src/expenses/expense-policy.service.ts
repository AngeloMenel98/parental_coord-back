import { Injectable } from '@nestjs/common';

import { ExpenseStatus } from './entities/expense.entity';

/**
 * Los campos que la política necesita. Deliberadamente un tipo estructural y no
 * `ExpenseEntity`: la política es PURA y no toca la base de datos, así que se
 * puede ejercitar sin TypeORM y sin contenedor.
 *
 * `counterpartId` lo resuelve el llamante a partir del bond (un gasto guarda
 * quién lo pidió, no quién es la otra parte). Es `null` mientras el bond tenga
 * un solo miembro: nadie puede aprobar un gasto que no tiene contraparte.
 */
export interface ExpensePolicySubject {
  status: ExpenseStatus;
  requestedBy: string;
  counterpartId: string | null;
}

export interface ExpensePolicyDecision {
  canApprove: boolean;
  canReject: boolean;
  canMarkPaid: boolean;
  canEdit: boolean;
  canCancel: boolean;
  isTerminal: boolean;
}

/** `Pagado` y `Rechazado` cierran el ciclo: no admiten ninguna transición. */
const TERMINAL_STATUSES: ReadonlySet<ExpenseStatus> = new Set([
  ExpenseStatus.PAID,
  ExpenseStatus.REJECTED,
]);

/**
 * T22 · Quién puede hacer qué sobre un gasto (FR-10, FR-11).
 *
 * Espeja `ActivityPolicyService`: decide sobre un sujeto estructural y devuelve
 * la decisión completa en vez de lanzar excepciones. El servicio de gastos
 * traduce `false` al 403 que corresponda; la política no sabe de HTTP.
 *
 * Las reglas del PRD, textuales:
 *   • FR-11 — "Requester can edit or cancel only while status is Pendiente."
 *   • §5.4 — `Pendiente` lo mueve el aprobador; `Aprobado` lo cierran las dos
 *     partes (quien paga marca pagado, quien cobra confirma la recepción).
 */
@Injectable()
export class ExpensePolicyService {
  isTerminal(status: ExpenseStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  evaluate(expense: ExpensePolicySubject, viewerId: string): ExpensePolicyDecision {
    const isPending = expense.status === ExpenseStatus.PENDING;
    const isApproved = expense.status === ExpenseStatus.APPROVED;
    const isRequester = expense.requestedBy === viewerId;
    const isCounterpart = expense.counterpartId !== null && expense.counterpartId === viewerId;
    const isParty = isRequester || isCounterpart;

    return {
      canApprove: isCounterpart && isPending,
      canReject: isCounterpart && isPending,
      canMarkPaid: isParty && isApproved,
      canEdit: isRequester && isPending,
      canCancel: isRequester && isPending,
      isTerminal: this.isTerminal(expense.status),
    };
  }
}
