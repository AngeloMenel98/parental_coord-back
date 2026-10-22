import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityChildEntity } from '../entities/activity-child.entity';

@Injectable()
export class ActivityChildRepository extends BaseRepository<ActivityChildEntity> {
  constructor(
    @InjectRepository(ActivityChildEntity)
    private readonly activityChildRepo: Repository<ActivityChildEntity>,
  ) {
    super(activityChildRepo);
  }

  async saveChildrenFor(
    activityId: string,
    childIds: string[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(ActivityChildEntity) : this.activityChildRepo;
    await repo.save(childIds.map((childId) => repo.create({ activityId, childId })));
  }
}
