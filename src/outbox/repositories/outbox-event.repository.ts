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
}
