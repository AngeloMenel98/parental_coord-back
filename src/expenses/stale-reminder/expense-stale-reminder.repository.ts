import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ExpenseEntity, ExpenseStatus } from '../entities/expense.entity';
import { EXPENSE_EVENT, expenseAggregateVersion } from '../expense-events';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';

/** Selecciona gastos vencidos y publica el recordatorio de forma idempotente. */
@Injectable()
export class ExpenseStaleReminderRepository {
  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
    private readonly outbox: OutboxEventRepository,
  ) {}

  /**
   * Bloquea las filas elegibles y emite el evento dentro de la misma transacción.
   * El anti-join evita repetir recordatorios ya confirmados; el lock con
   * `SKIP LOCKED` evita que dos workers simultáneos reclamen el mismo gasto.
   */
  async emitStaleEvents(): Promise<number> {
    return this.expenses.manager.transaction(async (manager) => {
      const staleExpenses = await manager
        .getRepository(ExpenseEntity)
        .createQueryBuilder('expense')
        .select(['expense.id', 'expense.bondId'])
        .where('expense.status = :status', { status: ExpenseStatus.PENDING })
        .andWhere('expense.deletedAt IS NULL')
        .andWhere("expense.expenseDate <= CURRENT_DATE - INTERVAL '7 days'")
        .andWhere(
          `NOT EXISTS (
            SELECT 1
            FROM outbox_event stale_event
            WHERE stale_event.aggregate_type = 'expense'
              AND stale_event.aggregate_id = expense.id
              AND stale_event.event_type = :staleType
          )`,
          { staleType: EXPENSE_EVENT.STALE },
        )
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const expense of staleExpenses) {
        await this.outbox.insert(
          {
            aggregateType: 'expense',
            aggregateId: expense.id,
            bondId: expense.bondId,
            eventType: EXPENSE_EVENT.STALE,
            aggregateVersion: expenseAggregateVersion(ExpenseStatus.PENDING),
            payload: { actor: { type: 'system' }, status: ExpenseStatus.PENDING },
          },
          manager,
        );
      }

      return staleExpenses.length;
    });
  }
}
