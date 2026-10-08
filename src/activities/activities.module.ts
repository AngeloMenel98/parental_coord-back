import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivitiesAuditRepository } from './repositories/activities-audit.repository';
import { ActivityChildRepository } from './repositories/activity-child.repository';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { ActivityPolicyService } from './activity-policy.service';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChildrenModule } from '../children/children.module';
import { CategoriesModule } from '../categories/categories.module';
import { SystemClock } from '../common/clock/system-clock';
import { ActivitiesScheduler } from './activities.scheduler';
import { Clock } from '../common/clock/clock';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEntity, ActivityChildEntity, AuditLogEntity]),
    forwardRef(() => BondsModule),
    NotificationsModule,
    ChildrenModule,
    CategoriesModule,
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesRepository,
    ActivitiesAuditRepository,
    ActivityChildRepository,
    ActivitiesService,
    ActivityPolicyService,
    ActivitiesScheduler,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ActivitiesService, ActivitiesRepository, ActivityChildRepository],
})
export class ActivitiesModule {}
