import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { BondEntity } from '../entities/bond.entity';

@Injectable()
export class BondsRepository extends BaseRepository<BondEntity> {
  constructor(
    @InjectRepository(BondEntity)
    private readonly bondRepo: Repository<BondEntity>,
  ) {
    super(bondRepo);
  }

  async findBondsByUserId(userId: string): Promise<BondEntity[]> {
    return this.createQueryBuilder('bond')
      .select(['bond.id', 'bond.courtCaseRef', 'bond.isActive'])
      .innerJoin(
        'bond.members',
        'activeMember',
        'activeMember.userId = :userId AND activeMember.leftAt IS NULL',
        { userId },
      )
      .leftJoin('bond.members', 'allMembers', 'allMembers.leftAt IS NULL')
      .addSelect(['allMembers.id', 'allMembers.role', 'allMembers.joinedAt'])
      .leftJoin('allMembers.user', 'memberUser')
      .addSelect(['memberUser.id', 'memberUser.systemRole'])
      .leftJoin('memberUser.personalData', 'memberPD')
      .addSelect(['memberPD.firstName', 'memberPD.lastName', 'memberPD.avatarUrl'])
      .innerJoin('bond.children', 'child')
      .addSelect(['child.id', 'child.firstName', 'child.lastName', 'child.dateOfBirth'])
      .where('bond.isActive = :isActive', { isActive: true })
      .orderBy('bond.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Find all bonds with members and children (admin list view).
   * Single query replaces N+1: 1 + 2M → 1 query.
   */
  async findAllBondsEnriched(): Promise<BondEntity[]> {
    return this.createQueryBuilder('bond')
      .leftJoinAndSelect('bond.members', 'allMembers')
      .leftJoinAndSelect('allMembers.user', 'memberUser')
      .leftJoinAndSelect('memberUser.personalData', 'memberPD')
      .leftJoinAndSelect('bond.children', 'child')
      .orderBy('bond.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Find a single bond with full member details (user + personalData).
   * Returns null if bond not found.
   */
  async findBondWithMembers(bondId: string): Promise<BondEntity | null> {
    return this.createQueryBuilder('bond')
      .leftJoinAndSelect('bond.members', 'allMembers')
      .leftJoinAndSelect('allMembers.user', 'memberUser')
      .leftJoinAndSelect('memberUser.personalData', 'memberPD')
      .where('bond.id = :bondId', { bondId })
      .getOne();
  }

  /**
   * Find a single bond with all children.
   * Returns null if bond not found.
   */
  async findBondWithChildren(bondId: string): Promise<BondEntity | null> {
    return this.createQueryBuilder('bond')
      .leftJoinAndSelect('bond.children', 'children')
      .where('bond.id = :bondId', { bondId })
      .getOne();
  }

  /**
   * Verify user is an active member of a specific bond.
   * Returns the bond if authorized, null otherwise.
   */
  async findActiveBondForMember(bondId: string, userId: string): Promise<BondEntity | null> {
    return this.createQueryBuilder('bond')
      .innerJoin(
        'bond.members',
        'member',
        'member.bondId = :bondId AND member.userId = :userId AND member.leftAt IS NULL',
        { bondId, userId },
      )
      .where('bond.id = :bondId', { bondId })
      .getOne();
  }

  async existsActiveBondForMember(bondId: string) {
    return this.bondRepo.exists({ where: { id: bondId, isActive: true } });
  }

  /**
   * Count children for a bond (lightweight, no entity hydration).
   */
  async countChildrenByBond(bondId: string): Promise<number> {
    const result = await this.createQueryBuilder('bond')
      .leftJoin('bond.children', 'children')
      .select('COUNT(children.id)', 'count')
      .where('bond.id = :bondId', { bondId })
      .getRawOne();

    return Number(result?.count ?? 0);
  }
}
