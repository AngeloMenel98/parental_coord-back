import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationEntity } from '../entities/notification.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesModule } from '../../activities/activities.module';
import { BondsModule } from '../../bonds/bonds.module';
import { NotificationFanOutService } from './notification-fan-out.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity]), ActivitiesModule, BondsModule],
  providers: [NotificationRepository, NotificationFanOutService],
  exports: [NotificationFanOutService],
})
export class NotificationsFanOutModule {}
