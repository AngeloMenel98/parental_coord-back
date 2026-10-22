import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { CategoryEntity } from './entities/category.entity';
import { CategoriesRepository } from './repositories/categories.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepo: CategoriesRepository) {}

  async create(dto: CreateCategoryDto): Promise<CategoryEntity> {
    const existing = await this.categoriesRepo.findOneByWhere({ name: dto.name });
    if (existing) {
      throw new ConflictException(`Category "${dto.name}" already exists`);
    }

    return this.categoriesRepo.createAndSave(dto);
  }

  async findAll(): Promise<CategoryEntity[]> {
    return this.categoriesRepo.findMany({ order: { name: 'ASC' } });
  }

  async findActive(): Promise<CategoryEntity[]> {
    return this.categoriesRepo.findMany({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<CategoryEntity> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryEntity> {
    const category = await this.findOne(id);

    if (dto.name && dto.name !== category.name) {
      const duplicate = await this.categoriesRepo.findOneByWhere({ name: dto.name });
      if (duplicate) {
        throw new ConflictException(`Category "${dto.name}" already exists`);
      }
    }

    Object.assign(category, dto);
    return this.categoriesRepo.save(category);
  }

  async remove(id: string): Promise<void> {
    const category = await this.findOne(id);
    await this.categoriesRepo.remove(category);
  }
}
