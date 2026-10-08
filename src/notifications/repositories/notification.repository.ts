import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { NotificationEntity } from '../entities/notification.entity';

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
    const repo = manager ? manager.getRepository(NotificationEntity) : this.notifRepo;
    return repo.save(repo.create({ ...input, refEntityType: 'activity', isRead: false }));
  }
}
