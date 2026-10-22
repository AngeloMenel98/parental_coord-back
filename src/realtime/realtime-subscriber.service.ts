import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { Observable, Subject } from 'rxjs';

import { buildBullConnection } from '../queues/redis.config';
import { ActivityChangedMessageV1 } from './dto/activity-changed-message';
import { REALTIME_CHANNEL } from './realtime.constants';

/**
 * API-side realtime subscriber (REQ-3/REQ-4, design #1471).
 *
 * Owns a DEDICATED ioredis client (separate from BullMQ's and from the
 * worker's publisher): a subscriber connection is in subscriber mode and can
 * never issue normal commands, so it must not share any existing client.
 *
 * Lifecycle: `onModuleInit` creates the client, wires the `message`/`ready`
 * handlers and subscribes to `REALTIME_CHANNEL`; a `ready` re-subscribe covers
 * the initial-connect race and reconnects (ioredis also auto-resubscribes, the
 * explicit call is belt-and-braces per design). `onModuleDestroy` calls
 * `disconnect()` to release the open handle (design open-question note).
 *
 * Parsed frames are emitted through the `messages$` observable; a malformed
 * JSON frame is logged and dropped (pub/sub is at-most-once — the client
 * resyncs via REST anyway, REQ-5).
 */
@Injectable()
export class RealtimeSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeSubscriberService.name);
  private readonly redis: Redis;
  private readonly subject = new Subject<ActivityChangedMessageV1>();

  /** Parsed `activity.changed` frames pulled off the Redis channel. */
  readonly messages$: Observable<ActivityChangedMessageV1> = this.subject.asObservable();

  constructor(config: ConfigService) {
    // Dedicated client: own connection options built from the same REDIS_* env.
    this.redis = new Redis({ ...buildBullConnection(config) } as RedisOptions);

    this.redis.on('message', (channel: string, raw: string) => {
      if (channel !== REALTIME_CHANNEL) return;
      try {
        this.subject.next(JSON.parse(raw) as ActivityChangedMessageV1);
      } catch (error) {
        this.logger.warn(
          `Dropped malformed realtime frame: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    this.redis.on('ready', () => {
      void this.subscribe();
    });
  }

  onModuleInit(): void {
    void this.subscribe();
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
    this.subject.complete();
  }

  private async subscribe(): Promise<void> {
    try {
      await this.redis.subscribe(REALTIME_CHANNEL);
      this.logger.log(`Subscribed to Redis channel ${REALTIME_CHANNEL}`);
    } catch (error) {
      this.logger.error(
        `Realtime subscribe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
