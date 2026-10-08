import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityChildEntity } from '../entities/activity-child.entity';

/**
 * Acceso a `activity_child` — la tabla join Actividad↔Hijo.
 *
 * La lectura por proyección (array de childIds) vive en ActivitiesRepository
 * (`findByBondIdOrdered`); este repositorio sólo escribe el vínculo.
 */
@Injectable()
export class ActivityChildRepository extends BaseRepository<ActivityChildEntity> {
  constructor(
    @InjectRepository(ActivityChildEntity)
    private readonly activityChildRepo: Repository<ActivityChildEntity>,
  ) {
    super(activityChildRepo);
  }

  /**
   * Vincula los hijos indicados a la actividad.
   *
   * `manager` opcional: en `create()` el vínculo se guarda con la misma
   * transacción que la actividad y la notificación; con un error en cualquier
   * escritura, el rollback deja las tres tablas coherentes.
   */
  async saveChildrenFor(
    activityId: string,
    childIds: string[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(ActivityChildEntity) : this.activityChildRepo;
    await repo.save(childIds.map((childId) => repo.create({ activityId, childId })));
  }
}
