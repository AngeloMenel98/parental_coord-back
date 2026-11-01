import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import {
  EXPENSE_STALE_REMINDER_JOB_NAME,
  EXPENSE_STALE_REMINDER_QUEUE,
} from './expense-stale-reminder.constants';
import { ExpenseStaleReminderService } from './expense-stale-reminder.service';

@Processor(EXPENSE_STALE_REMINDER_QUEUE)
export class ExpenseStaleReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpenseStaleReminderProcessor.name);

  constructor(private readonly service: ExpenseStaleReminderService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== EXPENSE_STALE_REMINDER_JOB_NAME) {
      this.logger.warn(`Unknown expense reminder job "${job.name}" (${job.id ?? '?'}); ignored`);
      return;
    }

    try {
      await this.service.run();
    } catch (error) {
      this.logger.error(
        `Expense stale-reminder scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      // El siguiente escaneo diario reintenta sin perder eventos ya confirmados.
    }
  }
}
