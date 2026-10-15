import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { NotificationEntity } from '../entities/notification.entity';

/** Entrada genérica de `create` (REQ-SUB-5, D11). */
export interface CreateNotificationInput {
  userId: string;
  bondId: string;
  type: string;
  title: string;
  body: string;
  refEntityType: string;
  refEntityId?: string | null;
}

/**
 * Acceso a `notification` — la tabla raíz de este módulo.
 *
 * Espeja el patrón probado de `ActivitiesAuditRepository.record(entry, manager?)`:
 * el `manager` opcional es lo que permite escribir la notificación dentro de
 * la MISMA transacción que la fila de `activity` (T2+ lo usa en create/cancel/
 * decline); sin él, escribe por la conexión normal.
 */
@Injectable()
export class NotificationRepository extends BaseRepository<NotificationEntity> {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifRepo: Repository<NotificationEntity>,
  ) {
    super(notifRepo);
  }

  /**
   * Crea una notificación GENÉRICA (REQ-SUB-5, D11).
   *
   * El `refEntityType` es libre (antes estaba hardcodeado a `'activity'`), lo que
   * habilita avisos de otros dominios (p. ej. `webhook_disabled`) sin filas
   * `coordinador`. Mismo patrón `manager?` que el resto de repos.
   *
   * ⚠ Nota: se llama `createNotification` (no `create`) porque `BaseRepository`
   * extiende `Repository`, cuyo `create()` ya existe con otra firma; sobrecargarlo
   * rompería el tipado estricto (TS2416). El contrato funcional de D11 se mantiene.
   */
  async createNotification(
    input: CreateNotificationInput,
    manager?: EntityManager,
  ): Promise<NotificationEntity> {
    const repo = manager ? manager.getRepository(NotificationEntity) : this.notifRepo;
    return repo.save(
      repo.create({
        userId: input.userId,
        bondId: input.bondId,
        type: input.type,
        title: input.title,
        body: input.body,
        refEntityType: input.refEntityType,
        refEntityId: input.refEntityId ?? null,
        isRead: false,
      }),
    );
  }

  /**
   * Notificación ligada a una `activity` (wrapper delgado sobre
   * {@link createNotification} con `refEntityType='activity'`): mantiene intactos
   * los call-sites existentes.
   */
  async createForActivity(
    input: {
      userId: string;
      bondId: string;
      type: string;
      title: string;
      body: string;
      refEntityId: string;
    },
    manager?: EntityManager,
  ): Promise<NotificationEntity> {
    return this.createNotification({ ...input, refEntityType: 'activity' }, manager);
  }
}
