import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfig } from '../../config/app-config';
import { NotificationEntity } from '../entities/notification.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesModule } from '../../activities/activities.module';
import { BondsModule } from '../../bonds/bonds.module';
import { NotificationFanOutService } from './notification-fan-out.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity]), ActivitiesModule, BondsModule],
  providers: [
    NotificationRepository,
    NotificationFanOutService,
    {
      // Provider-only module (design D2) with no ConfigModule of its own:
      // ConfigModule is global in both the API and the worker, so ConfigService
      // is injectable here. Only the fan-out kill switch is read; any new
      // AppConfig key used by NotificationFanOutService must be copied here.
      provide: AppConfig,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = new AppConfig();
        config.NOTIFICATIONS_FANOUT_ENABLED =
          configService.get<string>('NOTIFICATIONS_FANOUT_ENABLED') ??
          config.NOTIFICATIONS_FANOUT_ENABLED;
        return config;
      },
    },
  ],
  exports: [NotificationFanOutService],
})
export class NotificationsFanOutModule {}
