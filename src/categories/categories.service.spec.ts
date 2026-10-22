import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';

import { CategoriesService } from './categories.service';
import { CategoriesRepository } from './repositories/categories.repository';
import { CategoryEntity } from './entities/category.entity';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoryRepo: jest.Mocked<CategoriesRepository>;

  beforeEach(async () => {
    categoryRepo = {
      findOneByWhere: jest.fn(),
      findById: jest.fn(),
      createAndSave: jest.fn(),
      findMany: jest.fn(),
      remove: jest.fn(),
      save: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriesService, { provide: CategoriesRepository, useValue: categoryRepo }],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('create', () => {
    it('should create and return a category', async () => {
      const dto = { name: 'Salud', description: 'Medical activities' };
      const mockCategory = {
        id: 'cat-1',
        name: 'Salud',
        description: 'Medical activities',
        isActive: true,
      } as CategoryEntity;

      categoryRepo.findOneByWhere.mockResolvedValue(null);
      categoryRepo.createAndSave.mockResolvedValue(mockCategory);

      const result = await service.create(dto);

      expect(result).toEqual(mockCategory);
      expect(categoryRepo.createAndSave).toHaveBeenCalledWith(dto);
    });

    it('should throw ConflictException for duplicate name', async () => {
      const dto = { name: 'Salud' };
      categoryRepo.findOneByWhere.mockResolvedValue({
        id: 'existing',
        name: 'Salud',
      } as CategoryEntity);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return an array of categories', async () => {
      const mockCategories = [
        { id: '1', name: 'Salud' },
        { id: '2', name: 'Educación' },
      ] as CategoryEntity[];

      categoryRepo.findMany.mockResolvedValue(mockCategories);

      const result = await service.findAll();

      expect(result).toEqual(mockCategories);
      expect(categoryRepo.findMany).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
    });
  });
});
