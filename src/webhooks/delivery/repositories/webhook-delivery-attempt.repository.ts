import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, Repository } from 'typeorm';

import { BaseRepository } from '../../../common/repositories/base.repository';
import { WebhookDeliveryAttemptEntity } from '../entities/webhook-delivery-attempt.entity';

export interface InsertDeliveryAttemptInput {
  deliveryId: string;
  attemptNo: number;
  startedAt: Date;
  durationMs?: number | null;
  statusCode?: number | null;
  /** Ya truncado a ≤1 KB por el llamador (REQ-LOG-1, REQ-SEC-5). */
  responseSnippet?: string | null;
  error?: string | null;
}

/**
 * Acceso a `webhook_delivery_attempt` (REQ-DATA-1, REQ-LOG-1).
 *
 * `responseSnippet` se guarda crudo y truncado; el llamador ES responsable del
 * límite de 1 KB (la columna es `varchar(1024)`).
 */
@Injectable()
export class WebhookDeliveryAttemptRepository extends BaseRepository<WebhookDeliveryAttemptEntity> {
  constructor(
    @InjectRepository(WebhookDeliveryAttemptEntity)
    private readonly attemptRepo: Repository<WebhookDeliveryAttemptEntity>,
  ) {
    super(attemptRepo);
  }

  /** Persiste un intento (misma tx opcional que la transición de la entrega). */
  async insertAttempt(
    input: InsertDeliveryAttemptInput,
    manager?: EntityManager,
  ): Promise<WebhookDeliveryAttemptEntity> {
    const repo = manager ? manager.getRepository(WebhookDeliveryAttemptEntity) : this.attemptRepo;
    return repo.save(
      repo.create({
        deliveryId: input.deliveryId,
        attemptNo: input.attemptNo,
        startedAt: input.startedAt,
        durationMs: input.durationMs ?? null,
        statusCode: input.statusCode ?? null,
        responseSnippet: input.responseSnippet ?? null,
        error: input.error ?? null,
      }),
    );
  }

  /** Intentos de una entrega, ordenados por número de intento. */
  async findByDelivery(deliveryId: string): Promise<WebhookDeliveryAttemptEntity[]> {
    return this.attemptRepo.find({
      where: { deliveryId },
      order: { attemptNo: 'ASC' },
    });
  }

  /**
   * Intentos de varias entregas en una sola query (evita N+1 en el log
   * paginado, REQ-LOG-1/D9).
   */
  async findByDeliveryIds(deliveryIds: string[]): Promise<WebhookDeliveryAttemptEntity[]> {
    if (deliveryIds.length === 0) return [];
    return this.attemptRepo.find({
      where: { deliveryId: In(deliveryIds) },
      order: { attemptNo: 'ASC' },
    });
  }

  /**
   * Purga los intentos anteriores a `before` (REQ-LOG-3, AC-16, D10).
   *
   * Retención de 30 días (configurable): borra SÓLO las filas del log de
   * entregas cuyo `started_at` quedó por detrás del corte. Devuelve las filas
   * borradas. Las entregas (`webhook_delivery`) NO se borran aquí; se purgan vía
   * cascada cuando su `outbox_event` envejece (misma ventana).
   */
  async purgeOlderThan(before: Date): Promise<number> {
    const result = await this.attemptRepo.delete({ startedAt: LessThan(before) });
    return result.affected ?? 0;
  }
}
