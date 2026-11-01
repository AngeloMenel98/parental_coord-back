import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  DEFAULT_EXPENSE_STALE_REMINDER_INTERVAL_MS,
  EXPENSE_STALE_REMINDER_JOB_NAME,
  EXPENSE_STALE_REMINDER_QUEUE,
  EXPENSE_STALE_REMINDER_SCHEDULER_ID,
} from './expense-stale-reminder.constants';

/** Registra el escaneo diario como scheduler repetible de BullMQ. */
@Injectable()
export class ExpenseStaleReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(ExpenseStaleReminderScheduler.name);

  constructor(
    @InjectQueue(EXPENSE_STALE_REMINDER_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        EXPENSE_STALE_REMINDER_SCHEDULER_ID,
        { every: DEFAULT_EXPENSE_STALE_REMINDER_INTERVAL_MS },
        { name: EXPENSE_STALE_REMINDER_JOB_NAME, data: {} },
      );
    } catch (error) {
      this.logger.error(
        'Failed to register the expense stale-reminder scheduler',
        error instanceof Error ? error.stack : String(error),
      );
      // Igual que el scheduler de retención, Redis caído no impide arrancar el worker.
    }
  }
}
