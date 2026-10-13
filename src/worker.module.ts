import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { ActivitiesModule } from './activities/activities.module';
import { UsersModule } from './users/users.module';
import { ActivityTimersWorkerModule } from './queues/activity-timers/activity-timers-worker.module';
import { validateConfig } from './config/app-config';
import { buildBullConnection } from './queues/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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
    UsersModule,
    ActivityTimersWorkerModule,
  ],
})
export class WorkerModule {}
