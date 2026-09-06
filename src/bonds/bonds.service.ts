import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { BondEntity } from './entities/bond.entity';
import { BondMemberEntity } from './entities/bond-member.entity';
import { ChildEntity } from '../children/entities/child.entity';

@Injectable()
export class BondsService {
  constructor(
    @InjectRepository(BondEntity)
    private readonly bondRepo: Repository<BondEntity>,
    @InjectRepository(BondMemberEntity)
    private readonly bondMemberRepo: Repository<BondMemberEntity>,
    @InjectRepository(ChildEntity)
    private readonly childRepo: Repository<ChildEntity>,
  ) {}

  async findByUserId(userId: string) {
    // Step 1: Find all bonds where user is an active member
    const memberships = await this.bondMemberRepo.find({
      where: { userId, leftAt: IsNull() },
      relations: ['bond'],
    });

    // Filter to only active bonds (belt-and-suspenders with leftAt)
    const activeMemberships = memberships.filter(m => m.bond?.isActive);

    // Step 2: Enrich each bond with members and children count
    const result = await Promise.all(
      activeMemberships.map(async (membership) => {
        const bond = membership.bond;

        const members = await this.bondMemberRepo.find({
          where: { bondId: bond.id },
          relations: ['user', 'user.personalData'],
        });

        const children = await this.childRepo.find({
          where: { bondId: bond.id },
        });

        return {
          id: bond.id,
          title: bond.title,
          agreement_type: bond.agreementType,
          status: bond.isActive ? 'ACTIVE' : 'INACTIVE',
          members: members.map((m) => ({
            user_id: m.userId,
            email: m.user?.email,
            first_name: m.user?.personalData?.firstName ?? null,
            last_name: m.user?.personalData?.lastName ?? null,
            role: m.role,
          })),
          children_count: children.length,
          created_at: bond.createdAt,
          updated_at: bond.updatedAt,
        };
      }),
    );

    return result;
  }
}