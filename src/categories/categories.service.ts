import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CategoryEntity } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryEntity> {
    const existing = await this.categoryRepo.findOneBy({ name: dto.name });
    if (existing) {
      throw new ConflictException(`Category "${dto.name}" already exists`);
    }

    const category = this.categoryRepo.create(dto);
    return this.categoryRepo.save(category);
  }

  async findAll(): Promise<CategoryEntity[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  async findActive(): Promise<CategoryEntity[]> {
    return this.categoryRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<CategoryEntity> {
    const category = await this.categoryRepo.findOneBy({ id });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryEntity> {
    const category = await this.findOne(id);

    if (dto.name && dto.name !== category.name) {
      const duplicate = await this.categoryRepo.findOneBy({ name: dto.name });
      if (duplicate) {
        throw new ConflictException(`Category "${dto.name}" already exists`);
      }
    }

    Object.assign(category, dto);
    return this.categoryRepo.save(category);
  }

  async remove(id: string): Promise<void> {
    const category = await this.findOne(id);
    await this.categoryRepo.remove(category);
  }
}
