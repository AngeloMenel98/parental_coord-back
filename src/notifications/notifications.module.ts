import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationEntity } from './entities/notification.entity';
import { NotificationRepository } from './repositories/notification.repository';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity])],
  providers: [NotificationRepository],
  exports: [TypeOrmModule, NotificationRepository],
})
export class NotificationsModule {}
