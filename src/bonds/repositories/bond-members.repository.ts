import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { BondMemberEntity } from '../entities/bond-member.entity';

export interface ComplianceMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  total: number;
  completed: number;
}

@Injectable()
export class BondMembersRepository extends BaseRepository<BondMemberEntity> {
  constructor(
    @InjectRepository(BondMemberEntity)
    private readonly bondMemberRepo: Repository<BondMemberEntity>,
  ) {
    super(bondMemberRepo);
  }

  /** Miembro de un bond por usuario o `null` (chequeo de duplicado en admin). */
  async findOneByBondAndUser(bondId: string, userId: string): Promise<BondMemberEntity | null> {
    return this.bondMemberRepo.findOneBy({ bondId, userId });
  }

  /** Alta en lote de miembros (admin.service `createBond`: create[] + save[]). */
  async createAndSaveMany(items: DeepPartial<BondMemberEntity>[]): Promise<BondMemberEntity[]> {
    const members = items.map((item) => this.bondMemberRepo.create(item));
    return this.bondMemberRepo.save(members);
  }

  async findActiveMembersWithActStats(
    bondId: string,
    from: Date,
    to: Date,
  ): Promise<ComplianceMemberRow[]> {
    return this.bondMemberRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('pd.first_name', 'firstName')
      .addSelect('pd.last_name', 'lastName')
      .addSelect('COUNT(a.id)::int', 'total')
      .addSelect("COUNT(a.id) FILTER (WHERE a.status = 'done')::int", 'completed')
      .from('bond_member', 'bm')
      .innerJoin('personal_data', 'pd', 'pd.user_id = bm.user_id')
      .leftJoin(
        'activity',
        'a',
        'a.assigned_to = bm.user_id AND a.bond_id = bm.bond_id AND a.scheduled_start >= :from AND a.scheduled_start < :to',
        { from, to },
      )
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.left_at IS NULL')
      .groupBy('bm.user_id')
      .addGroupBy('pd.first_name')
      .addGroupBy('pd.last_name')
      .getRawMany<ComplianceMemberRow>();
  }
}
