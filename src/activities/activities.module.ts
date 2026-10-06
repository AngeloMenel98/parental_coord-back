import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ActAttachmentEntity } from './entities/act-attachment.entity';
import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { BondsModule } from '../bonds/bonds.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEntity,
      ActivityChildEntity,
      ActAttachmentEntity,
      NotificationEntity,
    ]),
    forwardRef(() => BondsModule),
    NotificationsModule,
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesRepository, ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
