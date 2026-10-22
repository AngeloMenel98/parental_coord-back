import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { SystemRole } from '../users/entities/user.entity';
import { BondMemberRole } from '../bonds/entities/bond-member.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { PersonalDataRepository } from '../users/repositories/personal-data.repository';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { ChildrenRepository } from '../children/repositories/children.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateBondDto } from './dto/create-bond.dto';
import { CreateChildDto } from './dto/create-child.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly usersRepo: UsersRepository,
    private readonly personalDataRepo: PersonalDataRepository,
    private readonly bondsRepo: BondsRepository,
    private readonly bondMembersRepo: BondMembersRepository,
    private readonly childrenRepo: ChildrenRepository,
  ) {}

  // ── Users ────────────────────────────────────────────────────────

  async createUser(dto: CreateUserDto) {
    const existing = await this.usersRepo.findOneByWhere({ email: dto.email });
    if (existing) {
      throw new ConflictException(`Email "${dto.email}" is already registered`);
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const saved = await this.usersRepo.createAndSave({
      email: dto.email,
      passwordHash: hashed,
      systemRole: SystemRole.USER,
      isActive: true,
    });

    await this.personalDataRepo.createAndSave({
      userId: saved.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

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
    const users = await this.usersRepo.findAllWithPersonalData();

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      systemRole: u.systemRole,
      firstName: u.personalData?.firstName ?? null,
      lastName: u.personalData?.lastName ?? null,
      isActive: u.isActive,
      createdAt: u.createdAt,
    }));
  }

  // ── Bonds ────────────────────────────────────────────────────────

  async createBond(dto: CreateBondDto) {
    if (dto.userIds.length !== 2) {
      throw new BadRequestException('A bond must have exactly 2 members');
    }

    // Validate all users exist
    const users = await this.usersRepo.findByIds(dto.userIds);
    if (users.length !== dto.userIds.length) {
      throw new BadRequestException('One or more user IDs are invalid');
    }

    const savedBond = await this.bondsRepo.createAndSave({
      title: dto.title,
      agreementType: dto.agreementType,
      isActive: true,
    });

    // Add both users as progenitors
    const members = dto.userIds.map((userId) => ({
      bondId: savedBond.id,
      userId,
      role: BondMemberRole.PROGENITOR,
      joinedAt: new Date(),
    }));
    await this.bondMembersRepo.createAndSaveMany(members);

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
    const enrichedBonds = await this.bondsRepo.findAllBondsEnriched();

    return enrichedBonds.map((b) => ({
      id: b.id,
      title: b.title,
      agreementType: b.agreementType,
      isActive: b.isActive,
      members: (b.members ?? []).map((m) => ({
        id: m.userId,
        email: m.user?.email,
        role: m.role,
      })),
      childrenCount: b.children?.length ?? 0,
      createdAt: b.createdAt,
    }));
  }

  // ── Bond Members ─────────────────────────────────────────────────

  async addBondMember(bondId: string, userId: string) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const user = await this.usersRepo.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const existing = await this.bondMembersRepo.findOneByBondAndUser(bondId, userId);
    if (existing) {
      throw new ConflictException(`User ${userId} is already a member of this bond`);
    }

    const saved = await this.bondMembersRepo.createAndSave({
      bondId,
      userId,
      role: BondMemberRole.PROGENITOR,
      joinedAt: new Date(),
    });

    return { id: saved.id, bondId: saved.bondId, userId: saved.userId, role: saved.role };
  }

  // ── Children ─────────────────────────────────────────────────────

  async listBondChildren(bondId: string) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    return this.childrenRepo.findByBond(bondId);
  }

  async addChildToBond(bondId: string, dto: CreateChildDto) {
    const bond = await this.bondsRepo.findById(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const saved = await this.childrenRepo.createAndSave({
      bondId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: dto.dateOfBirth ?? null,
    });

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
