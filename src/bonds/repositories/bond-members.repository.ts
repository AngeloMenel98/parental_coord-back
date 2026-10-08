import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { BondMemberEntity } from '../entities/bond-member.entity';

/**
 * Acceso a `bond_member` — la tabla raíz de este módulo.
 *
 * T6 (R5): `findActiveMemberNames(bondId)` recibió la porción de joins del
 * join de compliance migrada desde ActivitiesRepository.
 */
export interface BondMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
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

  /**
   * Returns active bond members with their personal data.
   * Raw query joins bond_member → user → personal_data.
   */
  async findActiveMemberNames(bondId: string): Promise<BondMemberRow[]> {
    return this.bondMemberRepo.manager
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
}
