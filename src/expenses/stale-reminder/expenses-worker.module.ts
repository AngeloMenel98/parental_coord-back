import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExpenseEntity } from '../entities/expense.entity';
import { OutboxModule } from '../../outbox/outbox.module';
import { EXPENSE_STALE_REMINDER_QUEUE } from './expense-stale-reminder.constants';
import { ExpenseStaleReminderProcessor } from './expense-stale-reminder.processor';
import { ExpenseStaleReminderRepository } from './expense-stale-reminder.repository';
import { ExpenseStaleReminderScheduler } from './expense-stale-reminder.scheduler';
import { ExpenseStaleReminderService } from './expense-stale-reminder.service';

/** Worker aislado para publicar los recordatorios de gastos por el outbox existente. */
@Module({
  imports: [
    TypeOrmModule.forFeature([ExpenseEntity]),
    BullModule.registerQueue({ name: EXPENSE_STALE_REMINDER_QUEUE }),
    OutboxModule,
  ],
  providers: [
    ExpenseStaleReminderRepository,
    ExpenseStaleReminderService,
    ExpenseStaleReminderScheduler,
    ExpenseStaleReminderProcessor,
  ],
})
export class ExpensesWorkerModule {}
