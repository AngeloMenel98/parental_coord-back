import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { BondMemberEntity } from '../entities/bond-member.entity';

/**
 * Acceso a `bond_member` — la tabla raíz de este módulo.
 *
 * T1 (aditivo): `admin.service` aún inyecta `Repository<BondMemberEntity>`;
 * el swap es de T5b. En T6 este repositorio recibe también
 * `findActiveMemberNames(bondId)` (la porción de joins del join de compliance
 * se muda desde ActivitiesRepository — R5).
 */
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
}
