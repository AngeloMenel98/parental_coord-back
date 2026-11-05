import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ActivitiesRepository } from './repositories/activities.repository';
import { ActsAuditRepository } from './repositories/activities-audit.repository';
import { ActivityChildRepository } from './repositories/activity-child.repository';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { ActivityPolicyService } from './activity-policy.service';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { ChildrenModule } from '../children/children.module';
import { CategoriesModule } from '../categories/categories.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ActivityTimersModule } from '../queues/activity-timers/activity-timers.module';
import { SystemClock } from '../common/clock/system-clock';
import { Clock } from '../common/clock/clock';
import { ActAttachmentEntity } from './entities/act-attachment.entity';
import { ActivityAttachmentsService } from './attachments/activity-attachments.service';
import { ActivityAttachmentsController } from './attachments/activity-attachments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEntity, ActivityChildEntity, AuditLogEntity, ActAttachmentEntity]),
    forwardRef(() => BondsModule),
    ChildrenModule,
    CategoriesModule,
    OutboxModule,
    ActivityTimersModule,
  ],
  controllers: [ActivitiesController, ActivityAttachmentsController],
  providers: [
    ActivitiesRepository,
    ActsAuditRepository,
    ActivityChildRepository,
    ActivitiesService,
    ActivityPolicyService,
    ActivityAttachmentsService,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ActivitiesService, ActivitiesRepository, ActivityChildRepository],
})
export class ActivitiesModule {}
