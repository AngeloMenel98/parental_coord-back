import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import {
  ACTIVITY_TIMERS_QUEUE,
  ACTIVITY_SWEEP_SCHEDULER_ID,
  TimerKind,
} from './activity-timers.constants';

@Injectable()
export class ActivityTimersSweep implements OnModuleInit {
  private readonly logger = new Logger(ActivityTimersSweep.name);
  private readonly SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectQueue(ACTIVITY_TIMERS_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        ACTIVITY_SWEEP_SCHEDULER_ID,
        { every: this.SWEEP_INTERVAL_MS },
        { name: TimerKind.SWEEP, data: {} },
      );
      this.logger.log(`Sweep scheduler upserted (every ${this.SWEEP_INTERVAL_MS}ms)`);
    } catch (error) {
      this.logger.error(
        'Failed to upsert sweep job scheduler',
        error instanceof Error ? error.stack : String(error),
      );
      // Degrade gracefully if Redis is down
    }
  }

  /**
   * No-op seam for reconciliation sweep.
   * Future: re-query Postgres for activities whose timers are missing/stale
   * and re-enqueue or apply transitions (lands in engine stream).
   */
  async handleSweep(job?: Job): Promise<void> {
    this.logger.debug(`Sweep job received${job ? ` (id: ${job.id})` : ''}`);
    return;
  }
}
