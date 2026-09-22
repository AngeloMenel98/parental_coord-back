import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';

export interface BondMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
}

export interface ComplianceRow {
  assignedTo: string;
  total: string;
  completed: string;
}

@Injectable()
export class ActivitiesRepository extends BaseRepository<ActivityEntity> {
  constructor(
    @InjectRepository(ActivityEntity)
    private readonly activityRepo: Repository<ActivityEntity>,
  ) {
    super(activityRepo);
  }

  /**
   * Returns active bond members with their personal data.
   * Raw query joins bond_member → user → personal_data.
   */
  async findActiveBondMembers(bondId: string): Promise<BondMemberRow[]> {
    return this.activityRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('pd.first_name', 'firstName')
      .addSelect('pd.last_name', 'lastName')
      .from('bond_member', 'bm')
      .innerJoin('user', 'u', 'u.id = bm.user_id')
      .innerJoin('personal_data', 'pd', 'pd.user_id = u.id')
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.left_at IS NULL')
      .getRawMany<BondMemberRow>();
  }

  /**
   * Aggregates activity counts per assignee for a given bond and date range.
   * Uses PostgreSQL FILTER clause for completed count.
   */
  async countActivitiesByAssignee(
    bondId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<ComplianceRow[]> {
    return this.activityRepo
      .createQueryBuilder('a')
      .select('a.assigned_to', 'assignedTo')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE a.status IN (:...doneStatuses))`, 'completed')
      .where('a.bond_id = :bondId', { bondId })
      .andWhere('a.scheduled_start >= :startOfMonth', { startOfMonth })
      .andWhere('a.scheduled_start <= :endOfMonth', { endOfMonth })
      .andWhere('a.assigned_to IS NOT NULL')
      .setParameters({
        doneStatuses: [ActivityStatus.DONE],
      })
      .groupBy('a.assigned_to')
      .getRawMany<ComplianceRow>();
  }
}
