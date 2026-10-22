import { ConfigService } from '@nestjs/config';
import { ConnectionOptions } from 'bullmq';

/** Builds the BullMQ/ioredis connection from optional REDIS_* env vars. */
export function buildBullConnection(config: ConfigService): ConnectionOptions {
  return {
    host: config.get<string>('REDIS_HOST') ?? 'localhost',
    port: config.get<number>('REDIS_PORT') ?? 6379,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: config.get<number>('REDIS_DB') ?? 0,
    tls: config.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
