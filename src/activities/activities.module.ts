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
import { CategoryEntity } from '../categories/entities/category.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { SystemClock } from '../common/clock/system-clock';
import { ActivitiesScheduler } from './activities.scheduler';
import { Clock } from '../common/clock/clock';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEntity,
      ActivityChildEntity,
      ActAttachmentEntity,
      NotificationEntity,
      CategoryEntity,
      ChildEntity,
    ]),
    forwardRef(() => BondsModule),
    NotificationsModule,
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesRepository,
    ActivitiesService,
    ActivitiesScheduler,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
