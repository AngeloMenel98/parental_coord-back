import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { BondsModule } from '../bonds/bonds.module';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSubscriberService } from './realtime-subscriber.service';

/**
 * Realtime module for the API process (design #1471).
 *
 * Provides the gateway, the Redis subscriber and the handshake auth service.
 * Imports `BondsModule` (connect-time 4403 gate + per-message recipient
 * resolution) and `JwtModule.registerAsync` with the SAME factory as
 * `auth.module.ts:14-25`, so handshakes verify tokens against the identical
 * secret/contract as REST. The worker process must NEVER import this module —
 * it gets only the publisher via `RealtimeWorkerModule`.
 */
@Module({
  imports: [
    BondsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '24h',
        },
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeSubscriberService, RealtimeAuthService],
})
export class RealtimeModule {}
