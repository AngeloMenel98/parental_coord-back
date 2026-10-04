import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivitiesRepository } from './repositories/activities.repository';

@Injectable()
export class ActivitiesScheduler {
  private readonly logger = new Logger(ActivitiesScheduler.name);

  constructor(private readonly activitiesRepo: ActivitiesRepository) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async markOverdueActivities(): Promise<void> {
    try {
      const res: any = await this.activitiesRepo.markOverdue();
      const affected = typeof res === 'number' ? res : (res?.affected ?? 0);
      if (affected > 0) {
        this.logger.log(`Marked ${affected} activities as overdue`);
      }
    } catch (error) {
      this.logger.error('Overdue sweep failed', error as Error);
    }
  }
}
