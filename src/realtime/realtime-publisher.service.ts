import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

import { OutboxEventEntity } from '../outbox/entities/outbox-event.entity';
import { buildBullConnection } from '../queues/redis.config';
import { buildActivityChangedMessage } from './dto/activity-changed-message';
import { REALTIME_CHANNEL } from './realtime.constants';

/**
 * Worker-side realtime publisher (REQ-4, design #1471).
 *
 * Owns a dedicated ioredis client (separate from BullMQ's) and publishes one
 * `activity.changed` frame per dispatched outbox event to `REALTIME_CHANNEL`.
 * Keeping the client separate means a realtime hiccup can never touch the
 * webhook delivery pipeline.
 *
 * Failure policy: `publish` NEVER throws — a Redis failure is logged and
 * swallowed so it cannot abort the webhook fan-out that already ran before it.
 * The relay additionally wraps the call in its own log-only try/catch (defence
 * in depth), but a publish is deliberately unable to bubble up.
 */
@Injectable()
export class RealtimePublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimePublisher.name);
  private readonly enabled: boolean;
  private readonly redis: Redis | null;

  constructor(config: ConfigService) {
    // Read once at construction: the flag is not expected to change at runtime.
    this.enabled = (config.get<string>('REALTIME_PUBLISH_ENABLED') ?? 'true') !== 'false';
    this.redis = this.enabled
      ? new Redis({ ...buildBullConnection(config) } as RedisOptions)
      : null;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Realtime publishing disabled (REALTIME_PUBLISH_ENABLED=false)');
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  /** Publishes one frame to the realtime channel; no-op when disabled; never throws. */
  async publish(event: OutboxEventEntity): Promise<void> {
    if (!this.enabled || !this.redis) return;

    try {
      const message = buildActivityChangedMessage(event);
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.error(
        `Realtime publish failed for outbox event ${event.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
