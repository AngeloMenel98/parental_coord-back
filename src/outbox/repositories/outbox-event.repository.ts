import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { OutboxEventEntity } from '../entities/outbox-event.entity';

export interface InsertOutboxEventInput {
  activityId: string;
  bondId: string;
  eventType: string;
  aggregateVersion: number;
  payload: Record<string, unknown>;
}

/**
 * Acceso write-only a `outbox_event` (REQ-TX-3).
 *
 * Compone `Repository` en lugar de extender `BaseRepository`: el `insert()`
 * heredado de TypeORM (`Promise<InsertResult>`) choca con la firma que exige el
 * motor de transiciones (`Promise<OutboxEventEntity>`), y sobrecargarlo rompería
 * el tipado estricto (TS2416).
 *
 * El `manager` opcional espeja `NotificationRepository.createForActivity` /
 * `ActivitiesAuditRepository.record`: permite insertar la fila dentro de la
 * MISMA transacción que la `activity` (E4+); sin él, escribe por la conexión
 * normal.
 */
@Injectable()
export class OutboxEventRepository {
  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepo: Repository<OutboxEventEntity>,
  ) {}

  async insert(row: InsertOutboxEventInput, manager?: EntityManager): Promise<OutboxEventEntity> {
    const repo = manager ? manager.getRepository(OutboxEventEntity) : this.outboxRepo;
    return repo.save(
      repo.create({
        aggregateId: row.activityId,
        bondId: row.bondId,
        eventType: row.eventType,
        aggregateVersion: row.aggregateVersion,
        payload: row.payload,
        dispatchedAt: null,
      }),
    );
  }

  /**
   * Lectura de una fila por id (REQ-DISP-3, REQ-DATA-3).
   *
   * La consume la entrega para reconstruir el payload/reintentar un job; es
   * SÓLO lectura, preserva la invariante write-only del outbox.
   */
  async findById(id: string): Promise<OutboxEventEntity | null> {
    return this.outboxRepo.findOne({ where: { id } });
  }

  /**
   * Read-side extension consumida por el relay (REQ-DISP-1, AC-8).
   *
   * Devuelve las filas todavía NO despachadas (`dispatched_at IS NULL`) más
   * antiguas primero, acotadas por `limit`. La invariante write-only (REQ-DATA-3)
   * se preserva: este método SÓLO lee, nunca reescribe payload ni columnas.
   */
  async findPending(limit: number): Promise<OutboxEventEntity[]> {
    return this.outboxRepo
      .createQueryBuilder('o')
      .where('o.dispatched_at IS NULL')
      .orderBy('o.created_at', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Marca UNA fila como despachada (REQ-DISP-4, REQ-DATA-3).
   *
   * Setea EXCLUSIVAMENTE `dispatched_at`: ningún otro campo se toca, de modo que
   * el payload y el `event_type` originales quedan intactos. `manager?` sigue el
   * patrón de `insert` (permite marcar dentro de una tx ya abierta por el fan-out).
   */
  async markDispatched(id: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(OutboxEventEntity) : this.outboxRepo;
    await repo.update(id, { dispatchedAt: new Date() });
  }

  /**
   * Edad (ms) del outbox pendiente MÁS antiguo, o `null` si no hay pendientes.
   *
   * Alimenta la métrica de lag del outbox y la alerta de lag > 60 s
   * (REQ-NFR-3, AC-20). Sólo lectura.
   */
  async oldestPendingCreatedAt(): Promise<Date | null> {
    const row = await this.outboxRepo
      .createQueryBuilder('o')
      .select('o.created_at', 'created_at')
      .where('o.dispatched_at IS NULL')
      .orderBy('o.created_at', 'ASC')
      .limit(1)
      .getRawOne<{ created_at: Date }>();
    return row?.created_at ? new Date(row.created_at) : null;
  }

  /**
   * Purga el outbox ya despachado anterior a `before` (REQ-LOG-3, AC-16, D10).
   *
   * Retención de 30 días (configurable): borra SÓLO filas con `dispatched_at`
   * no nulo y anterior al corte; las pendientes (`dispatched_at IS NULL`) nunca
   * se tocan (la garantía de no-perdida se preserva). Devuelve las filas
   * borradas. La FK `webhook_delivery.event_id → outbox_event` es `ON DELETE
   * CASCADE`, de modo que la entrega asociada también se purga.
   */
  async purgeDispatchedBefore(before: Date): Promise<number> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .delete()
      .from(OutboxEventEntity)
      .where('dispatched_at IS NOT NULL')
      .andWhere('dispatched_at < :before', { before })
      .execute();
    return result.affected ?? 0;
  }
}
