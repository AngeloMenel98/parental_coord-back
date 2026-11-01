import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfig } from '../../config/app-config';
import { ExpenseEntity } from '../../expenses/entities/expense.entity';
import { ExpensesRepository } from '../../expenses/repositories/expenses.repository';
import { NotificationEntity } from '../entities/notification.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesModule } from '../../activities/activities.module';
import { BondsModule } from '../../bonds/bonds.module';
import { NotificationFanOutService } from './notification-fan-out.service';

@Module({
  imports: [
    // `ExpenseEntity` se registra acá en vez de importar `ExpensesModule`: ese
    // módulo declara el controller del API, y el fan-out también corre en el
    // worker (mismo criterio que `NotificationsWorkerModule`, que evita
    // arrastrar controllers al proceso worker). Sólo se necesita el acceso a
    // datos de `expense` para que la rama de gastos resuelva concept/monto.
    TypeOrmModule.forFeature([NotificationEntity, ExpenseEntity]),
    ActivitiesModule,
    BondsModule,
  ],
  providers: [
    NotificationRepository,
    ExpensesRepository,
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
