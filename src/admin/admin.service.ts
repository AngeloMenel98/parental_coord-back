import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { UserEntity, SystemRole } from '../users/entities/user.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { BondEntity, AgreementType } from '../bonds/entities/bond.entity';
import { BondMemberEntity, BondMemberRole } from '../bonds/entities/bond-member.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateBondDto } from './dto/create-bond.dto';
import { CreateChildDto } from './dto/create-child.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PersonalDataEntity)
    private readonly personalDataRepo: Repository<PersonalDataEntity>,
    @InjectRepository(BondEntity)
    private readonly bondRepo: Repository<BondEntity>,
    @InjectRepository(BondMemberEntity)
    private readonly bondMemberRepo: Repository<BondMemberEntity>,
    @InjectRepository(ChildEntity)
    private readonly childRepo: Repository<ChildEntity>,
  ) {}

  // ── Users ────────────────────────────────────────────────────────

  async createUser(dto: CreateUserDto) {
    const existing = await this.userRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException(`Email "${dto.email}" is already registered`);
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      passwordHash: hashed,
      systemRole: SystemRole.USER,
      isActive: true,
    });
    const saved = await this.userRepo.save(user);

    const personalData = this.personalDataRepo.create({
      userId: saved.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    await this.personalDataRepo.save(personalData);

    return {
      id: saved.id,
      email: saved.email,
      systemRole: saved.systemRole,
      firstName: dto.firstName,
      lastName: dto.lastName,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
    };
  }

  async listUsers() {
    const users = await this.userRepo.find({
      order: { createdAt: 'DESC' },
    });

    const result = await Promise.all(
      users.map(async (u) => {
        const pd = await this.personalDataRepo.findOneBy({ userId: u.id });
        return {
          id: u.id,
          email: u.email,
          systemRole: u.systemRole,
          firstName: pd?.firstName ?? null,
          lastName: pd?.lastName ?? null,
          isActive: u.isActive,
          createdAt: u.createdAt,
        };
      }),
    );

    return result;
  }

  // ── Bonds ────────────────────────────────────────────────────────

  async createBond(dto: CreateBondDto) {
    if (dto.userIds.length !== 2) {
      throw new BadRequestException('A bond must have exactly 2 members');
    }

    // Validate all users exist
    const users = await this.userRepo.findByIds(dto.userIds);
    if (users.length !== dto.userIds.length) {
      throw new BadRequestException('One or more user IDs are invalid');
    }

    const bond = this.bondRepo.create({
      title: dto.title,
      agreementType: dto.agreementType,
      isActive: true,
    });
    const savedBond = await this.bondRepo.save(bond);

    // Add both users as progenitors
    const members = dto.userIds.map((userId) =>
      this.bondMemberRepo.create({
        bondId: savedBond.id,
        userId,
        role: BondMemberRole.PROGENITOR,
        joinedAt: new Date(),
      }),
    );
    await this.bondMemberRepo.save(members);

    return {
      id: savedBond.id,
      title: savedBond.title,
      agreementType: savedBond.agreementType,
      isActive: savedBond.isActive,
      members: dto.userIds,
      createdAt: savedBond.createdAt,
    };
  }

  async listBonds() {
    const bonds = await this.bondRepo.find({
      order: { createdAt: 'DESC' },
    });

    const result = await Promise.all(
      bonds.map(async (b) => {
        const members = await this.bondMemberRepo.find({
          where: { bondId: b.id },
          relations: ['user'],
        });
        const children = await this.childRepo.find({
          where: { bondId: b.id },
        });
        return {
          id: b.id,
          title: b.title,
          agreementType: b.agreementType,
          isActive: b.isActive,
          members: members.map((m) => ({
            id: m.userId,
            email: m.user?.email,
            role: m.role,
          })),
          childrenCount: children.length,
          createdAt: b.createdAt,
        };
      }),
    );

    return result;
  }

  // ── Bond Members ─────────────────────────────────────────────────

  async addBondMember(bondId: string, userId: string) {
    const bond = await this.bondRepo.findOneBy({ id: bondId });
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const existing = await this.bondMemberRepo.findOneBy({ bondId, userId });
    if (existing) {
      throw new ConflictException(`User ${userId} is already a member of this bond`);
    }

    const member = this.bondMemberRepo.create({
      bondId,
      userId,
      role: BondMemberRole.PROGENITOR,
      joinedAt: new Date(),
    });
    const saved = await this.bondMemberRepo.save(member);

    return { id: saved.id, bondId: saved.bondId, userId: saved.userId, role: saved.role };
  }

  // ── Children ─────────────────────────────────────────────────────

  async listBondChildren(bondId: string) {
    const bond = await this.bondRepo.findOneBy({ id: bondId });
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    return this.childRepo.find({
      where: { bondId },
      order: { createdAt: 'DESC' },
    });
  }

  async addChildToBond(bondId: string, dto: CreateChildDto) {
    const bond = await this.bondRepo.findOneBy({ id: bondId });
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const child = this.childRepo.create({
      bondId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth ?? null,
    });
    const saved = await this.childRepo.save(child);

    return {
      id: saved.id,
      bondId: saved.bondId,
      firstName: saved.firstName,
      lastName: saved.lastName,
      dateOfBirth: saved.dateOfBirth,
      createdAt: saved.createdAt,
    };
  }
}
