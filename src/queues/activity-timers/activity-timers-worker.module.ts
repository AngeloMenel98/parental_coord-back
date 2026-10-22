import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ACTIVITY_TIMERS_QUEUE } from './activity-timers.constants';
import { ActivityTimersProcessor } from './activity-timers.processor';
import { ActivityTimersSweep } from './activity-timers.sweep';

@Module({
  imports: [BullModule.registerQueue({ name: ACTIVITY_TIMERS_QUEUE })],
  providers: [ActivityTimersProcessor, ActivityTimersSweep],
})
export class ActivityTimersWorkerModule {}
