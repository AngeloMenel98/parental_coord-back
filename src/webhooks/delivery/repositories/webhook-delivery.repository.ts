import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  FindManyOptions,
  IsNull,
  LessThanOrEqual,
  QueryDeepPartialEntity,
  Repository,
} from 'typeorm';

import { BaseRepository } from '../../../common/repositories/base.repository';
import { WebhookDeliveryEntity, WebhookDeliveryStatus } from '../entities/webhook-delivery.entity';

export interface InsertDeliveryInput {
  eventId: string;
  subscriptionId: string;
  status?: WebhookDeliveryStatus;
  nextAttemptAt?: Date | null;
}

/** Campos que una transición de estado puede escribir (REQ-DEL-2/4). */
export interface DeliveryStatusPatch {
  status: WebhookDeliveryStatus;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
  completedAt?: Date | null;
}

/**
 * Acceso a `webhook_delivery` (REQ-DATA-1/2, REQ-DISP-3, REQ-LOG-1).
 *
 * `insertOnConflictDoNothing` apoya el dedup del fan-out: el `UNIQUE(event_id,
 * subscription_id)` colapsa un re-dispatch y devuelve `false` sin excepción.
 */
@Injectable()
export class WebhookDeliveryRepository extends BaseRepository<WebhookDeliveryEntity> {
  constructor(
    @InjectRepository(WebhookDeliveryEntity)
    private readonly deliveryRepo: Repository<WebhookDeliveryEntity>,
  ) {
    super(deliveryRepo);
  }

  /**
   * Inserta una entrega nueva o no-op si ya existe la fila `(event_id,
   * subscription_id)`. Devuelve `true` sólo cuando se creó una fila.
   */
  async insertOnConflictDoNothing(
    input: InsertDeliveryInput,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(WebhookDeliveryEntity) : this.deliveryRepo;
    const result = await repo
      .createQueryBuilder()
      .insert()
      .into(WebhookDeliveryEntity)
      .values({
        eventId: input.eventId,
        subscriptionId: input.subscriptionId,
        status: input.status ?? WebhookDeliveryStatus.PENDING,
        nextAttemptAt: input.nextAttemptAt ?? null,
      })
      .orIgnore()
      .returning('id')
      .execute();

    const rows = (result.raw as Array<{ id: string }>) ?? [];
    return rows.length > 0;
  }

  /** Entrega por par (evento, suscripción) o `null`. */
  async findByEventSub(
    eventId: string,
    subscriptionId: string,
  ): Promise<WebhookDeliveryEntity | null> {
    return this.deliveryRepo.findOne({ where: { eventId, subscriptionId } });
  }

  /** Página del log de un suscripción (más recientes primero). */
  async findBySubscriptionPaginated(
    subscriptionId: string,
    skip: number,
    take: number,
    options?: Omit<FindManyOptions<WebhookDeliveryEntity>, 'where' | 'skip' | 'take'>,
  ): Promise<WebhookDeliveryEntity[]> {
    return this.deliveryRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      skip,
      take,
      ...options,
    });
  }

  /** Total de entregas de una suscripción (paginación, REQ-LOG-1). */
  async countBySubscription(subscriptionId: string): Promise<number> {
    return this.deliveryRepo.count({ where: { subscriptionId } });
  }

  /**
   * Total de entregas en un estado (métrica `deliveries by status` y conteo de
   * `DEAD`, REQ-NFR-3/AC-20). Sólo lectura.
   */
  async countByStatus(status: WebhookDeliveryStatus): Promise<number> {
    return this.deliveryRepo.count({ where: { status } });
  }

  /** Aplica una transición de estado (PENDING/RETRYING/SUCCEEDED/FAILED/DEAD). */
  async updateStatus(
    id: string,
    patch: DeliveryStatusPatch,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(WebhookDeliveryEntity) : this.deliveryRepo;
    await repo.update(id, patch as QueryDeepPartialEntity<WebhookDeliveryEntity>);
  }

  /**
   * Entregas `DEAD` de una suscripción (replay masivo, REQ-LOG-2, AC-14).
   */
  async findDeadBySubscription(subscriptionId: string): Promise<WebhookDeliveryEntity[]> {
    return this.deliveryRepo.find({
      where: { subscriptionId, status: WebhookDeliveryStatus.DEAD },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Entregas re-encolables por la reconciliación (REQ-NFR-2, AC-20, D10).
   *
   * `PENDING`/`RETRYING` cuyo `next_attempt_at` es nulo o ya venció. El llamador
   * descarta después las que aún tienen un job vivo en BullMQ (`getJob !== null`).
   */
  async findReconcilable(now: Date = new Date()): Promise<WebhookDeliveryEntity[]> {
    return this.deliveryRepo.find({
      where: [
        { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: IsNull() },
        {
          status: WebhookDeliveryStatus.PENDING,
          nextAttemptAt: LessThanOrEqual(now),
        },
        {
          status: WebhookDeliveryStatus.RETRYING,
          nextAttemptAt: LessThanOrEqual(now),
        },
      ],
      order: { createdAt: 'ASC' },
    });
  }
}
