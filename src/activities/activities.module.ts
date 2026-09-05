import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ActAttachmentEntity } from './entities/act-attachment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEntity,
      ActivityChildEntity,
      ActAttachmentEntity,
    ]),
  ],
})
export class ActivitiesModule {}
