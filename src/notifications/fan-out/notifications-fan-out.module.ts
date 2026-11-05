import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfig } from '../../config/app-config';
import { ExpenseAttachmentEntity } from '../../expenses/entities/expense-attachment.entity';
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
    //
    // ⚠ `ExpenseAttachmentEntity` va con él: `ExpensesRepository` pide LOS DOS
    // repositorios (el gasto y su adjunto), y este módulo provee el repository a
    // mano para no arrastrar el `ExpensesModule` entero. Si la lista de
    // `forFeature` no sigue a la del `ExpensesModule`, el WORKER no arranca:
    // Nest no puede resolver `ExpenseAttachmentEntityRepository` y el proceso
    // queda en un crash-loop — SIN timers, SIN barrido y SIN fan-out. Es el mismo
    // modo de fallo que el `StorageModule` del `WorkerModule`: un módulo que
    // provee a mano tiene que replicar la lista de `forFeature` del módulo real.
    TypeOrmModule.forFeature([NotificationEntity, ExpenseEntity, ExpenseAttachmentEntity]),
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
