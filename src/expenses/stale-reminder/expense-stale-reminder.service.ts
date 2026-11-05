import { Injectable } from '@nestjs/common';

import { ExpenseStaleReminderRepository } from './expense-stale-reminder.repository';

@Injectable()
export class ExpenseStaleReminderService {
  constructor(private readonly reminders: ExpenseStaleReminderRepository) {}

  /** Emite los eventos faltantes para gastos pendientes con siete días de antigüedad. */
  async run(): Promise<number> {
    return this.reminders.emitStaleEvents();
  }
}
