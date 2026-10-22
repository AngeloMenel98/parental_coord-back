import { Module } from '@nestjs/common';

import { RealtimePublisher } from './realtime-publisher.service';

/**
 * Realtime module for the WORKER process (REQ-4, design #1471).
 *
 * Provides only the publisher: the worker never opens the gateway nor the
 * subscriber (those live in the API process via `RealtimeModule`). Imported by
 * `WebhooksWorkerModule` so `Relay` can publish after a successful fan-out.
 */
@Module({
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimeWorkerModule {}
