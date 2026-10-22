import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ACTIVITY_TIMERS_QUEUE,
  ACTIVITY_SWEEP_SCHEDULER_ID,
  TimerKind,
} from './activity-timers.constants';
import { ActivityEntity, ActivityStatus } from '../../activities/entities/activity.entity';
import { ActivitiesService } from '../../activities/activities.service';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';

export const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (user-confirmed)
export const SWEEP_LIMIT = 100;

const reached = (anchor: Date | null | undefined, now: Date): boolean =>
  anchor != null && anchor.getTime() <= now.getTime();

/** Pure: the system transition a due activity needs (design D9). */
export function dueTargetFor(activity: ActivityEntity, now: Date): ActivityStatus | null {
  if (activity.status === ActivityStatus.ASSIGNED && reached(activity.deadline, now)) {
    return ActivityStatus.OVERDUE;
  }
  if (activity.status === ActivityStatus.ASSISTING && reached(activity.scheduledStart, now)) {
    return ActivityStatus.IN_PROGRESS;
  }
  if (
    activity.status === ActivityStatus.IN_PROGRESS &&
    reached(activity.scheduledEnd ?? activity.scheduledStart, now)
  ) {
    return ActivityStatus.DONE;
  }
  return null;
}

/**
 * Safety net of the timer engine (REQ-TIMER-4): a repeatable 15-min job re-queries
 * Postgres for activities whose timer was lost and applies the same system
 * transition as the fast path. CAS-safe: a race with a live job no-ops.
 *
 * Activities service/repository are resolved via `ModuleRef` (see the processor
 * note) so this worker module stays decoupled from `ActivitiesModule`.
 */
@Injectable()
export class ActivityTimersSweep implements OnModuleInit {
  private readonly logger = new Logger(ActivityTimersSweep.name);
  private activities!: ActivitiesService;
  private activitiesRepo!: ActivitiesRepository;

  constructor(
    @InjectQueue(ACTIVITY_TIMERS_QUEUE)
    private readonly queue: Queue,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    this.activities = this.moduleRef.get(ActivitiesService, { strict: false });
    this.activitiesRepo = this.moduleRef.get(ActivitiesRepository, { strict: false });

    try {
      await this.queue.upsertJobScheduler(
        ACTIVITY_SWEEP_SCHEDULER_ID,
        { every: SWEEP_INTERVAL_MS },
        { name: TimerKind.SWEEP, data: {} },
      );
      this.logger.log(`Sweep scheduler upserted (every ${SWEEP_INTERVAL_MS}ms)`);
    } catch (error) {
      this.logger.error(
        'Failed to upsert sweep job scheduler',
        error instanceof Error ? error.stack : String(error),
      );
      // Degrade gracefully if Redis is down.
    }
  }

  async runSweep(now: Date = new Date()): Promise<void> {
    const due = await this.activitiesRepo.findDueForTransition(now, SWEEP_LIMIT);
    if (due.length === 0) {
      this.logger.debug('Sweep: no due activities');
      return;
    }

    this.logger.log(`Sweep: ${due.length} activity(ies) due`);
    for (const activity of due) {
      const to = dueTargetFor(activity, now);
      if (!to) continue;
      await this.activities.applySystemTransition(activity.id, to);
    }
  }
}
