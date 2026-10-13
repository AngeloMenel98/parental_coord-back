import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ACTIVITY_TIMERS_QUEUE, ActivityTimerJobData } from './activity-timers.constants';

/**
 * Timer consumer skeleton (no-op SEAM).
 *
 * Real flow: re-read the activity → no-op when state/version drifted
 * (REQ-TIMER-2/5) → `ActivitiesService.transition(..., actor='system')`
 * (REQ-TIMER-3). `transition()` lands in the engine stream, so for now the
 * handler only logs.
 */
@Processor(ACTIVITY_TIMERS_QUEUE)
export class ActivityTimersProcessor extends WorkerHost {
  private readonly logger = new Logger(ActivityTimersProcessor.name);

  async process(job: Job<ActivityTimerJobData>): Promise<void> {
    // SEAM: re-read → stale-check by version/state → transition(actor='system').
    this.logger.log(
      `Timer received: ${job.name} activity=${job.data.activityId} v${job.data.version}`,
    );
  }
}
