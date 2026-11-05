import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { ActivitiesModule } from './activities/activities.module';
import { ExpensesWorkerModule } from './expenses/stale-reminder/expenses-worker.module';
import { UsersModule } from './users/users.module';
import { StorageModule } from './storage/storage.module';
import { ActivityTimersWorkerModule } from './queues/activity-timers/activity-timers-worker.module';
import { WebhooksWorkerModule } from './webhooks/webhooks-worker.module';
import { NotificationsWorkerModule } from './notifications/notifications-worker.module';
import { validateConfig } from './config/app-config';
import { buildBullConnection } from './queues/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 🔴 `ENV_FILE` se respeta como en `AppModule`: sin esta línea el worker leía
      // SIEMPRE `.env` (el Postgres local) y no había forma de apuntarlo al mismo
      // entorno que la API — con `ENV_FILE=.env.prod` seguía conectando a 127.0.0.1.
      envFilePath: process.env.ENV_FILE ?? '.env',
      validate: validateConfig,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        type: 'postgres',
        host: cs.getOrThrow<string>('DB_HOST'),
        port: cs.getOrThrow<number>('DB_PORT'),
        username: cs.getOrThrow<string>('DB_USER'),
        password: cs.getOrThrow<string>('DB_PASSWORD'),
        database: cs.getOrThrow<string>('DB_NAME'),
        ssl: cs.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({ connection: buildBullConnection(cs) }),
    }),
    ActivitiesModule,
    ExpensesWorkerModule,
    // 🔴 `StorageModule` es `@Global()`, pero un módulo global sólo EXISTE si alguien lo
    // importa: sin esta línea el worker no arrancaba ("Nest can't resolve dependencies of
    // the ActivityAttachmentsService ... StorageService") y, por lo tanto, el relay de
    // notifications y el motor de timers NUNCA se ejecutaron en ningún host — tampoco en
    // el de Vercel. La API no lo sufría porque `AppModule` sí lo importa.
    StorageModule,
    UsersModule,
    ActivityTimersWorkerModule,
    WebhooksWorkerModule,
    NotificationsWorkerModule,
  ],
})
export class WorkerModule {}
