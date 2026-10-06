import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChildEntity } from './entities/child.entity';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { BondsRepository } from '../bonds/repositories/bonds.repository';

@Injectable()
export class ChildrenService {
  constructor(
    @InjectRepository(ChildEntity)
    private readonly repo: Repository<ChildEntity>,
    private readonly bondsRepo: BondsRepository,
  ) {}

  private async verifyBondMembership(bondId: string, userId: string): Promise<void> {
    const bond = await this.bondsRepo.findActiveBondForMember(bondId, userId);
    if (!bond) {
      throw new ForbiddenException('You are not a member of this bond');
    }
  }

  async create(bondId: string, dto: CreateChildDto, userId: string): Promise<ChildEntity> {
    await this.verifyBondMembership(bondId, userId);
    const child = this.repo.create({ ...dto, bondId });
    return this.repo.save(child);
  }

  async findByBond(bondId: string, userId: string): Promise<ChildEntity[]> {
    await this.verifyBondMembership(bondId, userId);
    return this.repo.find({
      where: { bondId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<ChildEntity> {
    const child = await this.repo.findOne({ where: { id }, relations: ['bond'] });
    if (!child) {
      throw new NotFoundException(`Child with id "${id}" not found`);
    }
    await this.verifyBondMembership(child.bond.id, userId);
    return child;
  }

  async update(id: string, dto: UpdateChildDto, userId: string): Promise<ChildEntity> {
    const child = await this.findOne(id, userId);
    Object.assign(child, dto);
    return this.repo.save(child);
  }

  async remove(id: string, userId: string): Promise<void> {
    const child = await this.findOne(id, userId);
    await this.repo.remove(child);
  }
}
