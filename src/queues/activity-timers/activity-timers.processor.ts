import { Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  ACTIVITY_TIMERS_QUEUE,
  ActivityTimerJobData,
  TimerKind,
} from './activity-timers.constants';
import { ActivityStatus } from '../../activities/entities/activity.entity';
import { ActivitiesService } from '../../activities/activities.service';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { ActivityTimersSweep } from './activity-timers.sweep';

/** State that must still hold for a timer of `kind` to be valid (REQ-TIMER-2). */
export function expectedSourceFor(kind: TimerKind): ActivityStatus | null {
  switch (kind) {
    case TimerKind.RESPONSE_TIMEOUT:
      return ActivityStatus.ASSIGNED;
    case TimerKind.START:
      return ActivityStatus.ASSISTING;
    case TimerKind.END:
      return ActivityStatus.IN_PROGRESS;
    default:
      return null;
  }
}

/** Target system transition for a timer of `kind` (REQ-TIMER-8): T7/T10/T11. */
export function targetStatusFor(kind: TimerKind): ActivityStatus | null {
  switch (kind) {
    case TimerKind.RESPONSE_TIMEOUT:
      return ActivityStatus.OVERDUE;
    case TimerKind.START:
      return ActivityStatus.IN_PROGRESS;
    case TimerKind.END:
      return ActivityStatus.DONE;
    default:
      return null;
  }
}

/**
 * Fast path of the timer engine (REQ-TIMER-2/3/5). Re-reads the activity, no-ops
 * when the version or the expected source state drifted, and otherwise applies the
 * same system transition as the sweep. Never rethrows into BullMQ (`attempts:1`).
 *
 * Note: `ActivityTimersWorkerModule` is deliberately kept out of `ActivitiesModule`
 * (E9 constraint). The activities service/repository are resolved from the worker
 * graph via `ModuleRef` so the queue module needs no extra import.
 */
@Processor(ACTIVITY_TIMERS_QUEUE)
export class ActivityTimersProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ActivityTimersProcessor.name);
  private activities!: ActivitiesService;
  private activitiesRepo!: ActivitiesRepository;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly sweep: ActivityTimersSweep,
  ) {
    super();
  }

  onModuleInit(): void {
    this.activities = this.moduleRef.get(ActivitiesService, { strict: false });
    this.activitiesRepo = this.moduleRef.get(ActivitiesRepository, { strict: false });
  }

  async process(job: Job<ActivityTimerJobData>): Promise<void> {
    try {
      if (job.name === TimerKind.SWEEP) {
        await this.sweep.runSweep();
        return;
      }
      await this.handleTimer(job.data);
    } catch (error) {
      // A bad job is logged and acked — the sweep recovers anything lost.
      this.logger.error(
        `Timer job ${job.id ?? job.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleTimer(data: ActivityTimerJobData): Promise<void> {
    const activity = await this.activitiesRepo.findById(data.activityId);
    if (!activity) {
      this.logger.warn(`Activity ${data.activityId} not found; stale ${data.kind} timer no-op`);
      return;
    }

    if (activity.version !== data.version) {
      this.logger.log(
        `Stale ${data.kind} timer for ${data.activityId} (job v${data.version}, row v${activity.version}); no-op`,
      );
      return;
    }

    const expected = expectedSourceFor(data.kind);
    if (expected && activity.status !== expected) {
      this.logger.log(
        `${data.kind} timer for ${data.activityId} expects ${expected} but is ${activity.status}; no-op`,
      );
      return;
    }

    const to = targetStatusFor(data.kind);
    if (!to) {
      this.logger.warn(`Unknown timer kind ${data.kind}; no-op`);
      return;
    }

    await this.activities.applySystemTransition(activity.id, to);
  }
}
