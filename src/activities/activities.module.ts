import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ActAttachmentEntity } from './entities/act-attachment.entity';
import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivitiesAuditRepository } from './repositories/activities-audit.repository';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { ActivityPolicyService } from './activity-policy.service';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { AuditLogEntity } from '../audit/entities/audit-log.entity';
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
      // La tabla `audit_log` ya existía (R11); sólo faltaba registrar la entidad
      // aquí para que las actividades pudieran escribir en ella.
      AuditLogEntity,
    ]),
    forwardRef(() => BondsModule),
    NotificationsModule,
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesRepository,
    ActivitiesAuditRepository,
    ActivitiesService,
    ActivityPolicyService,
    ActivitiesScheduler,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
