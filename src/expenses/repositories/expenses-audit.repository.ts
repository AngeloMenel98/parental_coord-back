import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { ExpenseStatus } from '../entities/expense.entity';

/**
 * Acciones estables del audit de gastos. Son CONTRATO, no texto libre: se fijan
 * acá para que el filtro y la observabilidad no dependan de strings dispersos.
 */
export const EXPENSE_AUDIT_ACTIONS = {
  CREATE: 'expense_create',
  UPDATE: 'expense_update',
  STATUS_CHANGE: 'expense_status_change',
  APPROVE: 'expense_approve',
  REJECT: 'expense_reject',
  PAY: 'expense_pay',
  DELETE: 'expense_delete',
} as const;

export type ExpenseAuditAction = (typeof EXPENSE_AUDIT_ACTIONS)[keyof typeof EXPENSE_AUDIT_ACTIONS];

export interface ExpenseAuditEntryInput {
  bondId: string;
  userId: string;
  /** `expense.id`. */
  expenseId: string;
  action: ExpenseAuditAction;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  detail?: string | null;
}

export interface ExpenseStatusChangeInput {
  bondId: string;
  /** Quién hizo el cambio. FR-10 exige que el usuario quede registrado. */
  userId: string;
  expenseId: string;
  from: ExpenseStatus;
  to: ExpenseStatus;
  detail?: string | null;
}

/**
 * La acción se DERIVA del par de estados, no la elige el llamante. Así el audit
 * no puede mentir sobre qué transición ocurrió, y el mapa queda en un solo lugar.
 */
const TRANSITION_ACTIONS: Readonly<Record<string, ExpenseAuditAction>> = {
  [`${ExpenseStatus.PENDING}:${ExpenseStatus.APPROVED}`]: EXPENSE_AUDIT_ACTIONS.APPROVE,
  [`${ExpenseStatus.PENDING}:${ExpenseStatus.REJECTED}`]: EXPENSE_AUDIT_ACTIONS.REJECT,
  [`${ExpenseStatus.APPROVED}:${ExpenseStatus.PAID}`]: EXPENSE_AUDIT_ACTIONS.PAY,
};

/**
 * Acceso a `audit_log` para el dominio de gastos (FR-10).
 *
 * Espeja `ActsAuditRepository` y `WebhooksAuditRepository`: reutiliza la tabla
 * polimórfica existente con `entity_type = 'expense'`. No hay DDL ni columna
 * propia: el estado anterior y el nuevo van en `old_value` / `new_value`, el
 * motivo legible en `detail`, y el usuario y el timestamp en sus columnas.
 */
@Injectable()
export class ExpensesAuditRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  /**
   * Escribe una entrada de audit.
   *
   * `manager` es opcional y tiene una razón: una transición de gasto escribe la
   * fila de `expense`, su audit y su notificación en UNA transacción, así que la
   * llamada pasa el `EntityManager` de la transacción. Sin él la escritura del
   * audit saldría por otra conexión y un rollback del gasto dejaría el audit
   * mintiendo sobre algo que no ocurrió.
   */
  async record(entry: ExpenseAuditEntryInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLogEntity) : this.auditRepo;
    await repo.save(
      repo.create({
        bondId: entry.bondId,
        userId: entry.userId,
        entityType: 'expense',
        entityId: entry.expenseId,
        action: entry.action,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        detail: entry.detail ?? null,
        ipAddress: null,
        userAgent: null,
      }),
    );
  }

  /**
   * Registra un cambio de estado (FR-10). Deja el par `from`/`to` en el audit y
   * deriva la acción de ese par.
   */
  async recordStatusChange(
    input: ExpenseStatusChangeInput,
    manager?: EntityManager,
  ): Promise<void> {
    const action =
      TRANSITION_ACTIONS[`${input.from}:${input.to}`] ?? EXPENSE_AUDIT_ACTIONS.STATUS_CHANGE;

    await this.record(
      {
        bondId: input.bondId,
        userId: input.userId,
        expenseId: input.expenseId,
        action,
        oldValue: { status: input.from },
        newValue: { status: input.to },
        detail: input.detail ?? null,
      },
      manager,
    );
  }
}
