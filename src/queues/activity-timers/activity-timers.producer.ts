import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ACTIVITY_TIMERS_QUEUE,
  ActivityTimerJobData,
  TimerKind,
} from './activity-timers.constants';
import { buildTimerJobId, computeDelayMs } from './activity-timers.job';

@Injectable()
export class ActivityTimersProducer {
  private readonly logger = new Logger(ActivityTimersProducer.name);

  constructor(
    @InjectQueue(ACTIVITY_TIMERS_QUEUE)
    private readonly queue: Queue<ActivityTimerJobData>,
  ) {}

  /** Post-commit enqueue. Never throws: a Redis failure is logged and the sweep recovers. */
  async enqueue(
    kind: TimerKind,
    activityId: string,
    version: number,
    target: Date,
    now: Date = new Date(),
  ): Promise<void> {
    const jobId = buildTimerJobId(kind, activityId, version);
    try {
      await this.queue.add(
        kind,
        { activityId, version, kind },
        {
          jobId,
          delay: computeDelayMs(target, now),
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { count: 1000 },
        },
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue ${kind} timer ${jobId}: ${(error as Error).message}`);
    }
  }

  async cancel(kind: TimerKind, activityId: string, version: number): Promise<void> {
    await this.cancelById(buildTimerJobId(kind, activityId, version));
  }

  async cancelById(jobId: string): Promise<void> {
    try {
      await this.queue.remove(jobId);
    } catch (error) {
      this.logger.error(`Failed to remove timer ${jobId}: ${(error as Error).message}`);
    }
  }

  /** Removes the old deterministic id explicitly so the new one is not deduped. */
  async reschedule(
    kind: TimerKind,
    activityId: string,
    oldVersion: number,
    newVersion: number,
    target: Date,
    now: Date = new Date(),
  ): Promise<void> {
    await this.cancel(kind, activityId, oldVersion);
    await this.enqueue(kind, activityId, newVersion, target, now);
  }
}
