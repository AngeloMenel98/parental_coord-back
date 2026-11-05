import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
  WEBHOOK_RECONCILE_SCHEDULER_ID,
  WEBHOOK_RETENTION_SCHEDULER_ID,
  WebhookJobName,
} from '../webhooks.constants';

/** Intervalo por defecto del poll del relay (D12). */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

/** Intervalo por defecto de la reconciliación (D12). */
export const DEFAULT_RECONCILE_INTERVAL_MS = 300_000;

/** Cadencia de la purga de retención: una vez al día (REQ-LOG-3, D10). */
export const DEFAULT_RETENTION_INTERVAL_MS = 86_400_000;

/**
 * Schedulers repetibles del worker (REQ-DISP-1, REQ-NFR-2, REQ-LOG-3, AC-16/AC-20, D3/D10, OQ-C).
 *
 * Registra en `OnModuleInit`, espejando el patrón de `ActivityTimersSweep`:
 *  - `upsertJobScheduler('webhooks-dispatch-poll', { every }, { name:'dispatch-poll' })`
 *  - `upsertJobScheduler('webhooks-reconcile', { every }, { name:'reconcile' })`
 *  - `upsertJobScheduler('webhooks-retention', { every }, { name:'retention' })`
 *
 * Sin `setInterval`/cron y sin `@nestjs/schedule` (la purga es este repeatable
 * scheduler). Sólo se registra en el proceso worker (el módulo worker importa
 * este provider; el API no). Si Redis está caído al arrancar se degrada con un
 * log: el primer poll/reconcile de un arranque sano recupera los pendientes.
 */
@Injectable()
export class RelayScheduler implements OnModuleInit {
  private readonly logger = new Logger(RelayScheduler.name);

  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.upsertSchedulers();
  }

  /** Upsert idempotente de los schedulers (idempotente entre reinicios). */
  async upsertSchedulers(): Promise<void> {
    const pollEvery =
      this.config.get<number>('WEBHOOK_POLL_INTERVAL_MS') ?? DEFAULT_POLL_INTERVAL_MS;
    const reconcileEvery =
      this.config.get<number>('WEBHOOK_RECONCILE_INTERVAL_MS') ?? DEFAULT_RECONCILE_INTERVAL_MS;

    await this.upsert(
      WEBHOOK_DISPATCH_POLL_SCHEDULER_ID,
      pollEvery,
      WebhookJobName.DISPATCH_POLL,
      'dispatch-poll',
    );
    await this.upsert(
      WEBHOOK_RECONCILE_SCHEDULER_ID,
      reconcileEvery,
      WebhookJobName.RECONCILE,
      'reconcile',
    );
    await this.upsert(
      WEBHOOK_RETENTION_SCHEDULER_ID,
      DEFAULT_RETENTION_INTERVAL_MS,
      WebhookJobName.RETENTION,
      'retention',
    );
  }

  private async upsert(
    id: string,
    every: number,
    name: WebhookJobName,
    label: string,
  ): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(id, { every }, { name, data: {} });
      this.logger.log(`${label} scheduler upserted (every ${every}ms)`);
    } catch (error) {
      this.logger.error(
        `Failed to upsert ${label} scheduler`,
        error instanceof Error ? error.stack : String(error),
      );
      // Degradar sin romper el arranque si Redis no está disponible.
    }
  }
}
