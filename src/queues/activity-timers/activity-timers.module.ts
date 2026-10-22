import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ACTIVITY_TIMERS_QUEUE } from './activity-timers.constants';
import { ActivityTimersProducer } from './activity-timers.producer';

@Module({
  imports: [BullModule.registerQueue({ name: ACTIVITY_TIMERS_QUEUE })],
  providers: [ActivityTimersProducer],
  exports: [ActivityTimersProducer],
})
export class ActivityTimersModule {}
