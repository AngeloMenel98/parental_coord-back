import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CategoriesService } from './categories.service';
import { CategoryEntity } from './entities/category.entity';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoryRepo: jest.Mocked<Repository<CategoryEntity>>;

  beforeEach(async () => {
    categoryRepo = {
      findOneBy: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getRepositoryToken(CategoryEntity), useValue: categoryRepo },
      ],
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

      categoryRepo.findOneBy.mockResolvedValue(null);
      categoryRepo.create.mockReturnValue(mockCategory);
      categoryRepo.save.mockResolvedValue(mockCategory);

      const result = await service.create(dto);

      expect(result).toEqual(mockCategory);
      expect(categoryRepo.create).toHaveBeenCalledWith(dto);
      expect(categoryRepo.save).toHaveBeenCalledWith(mockCategory);
    });

    it('should throw ConflictException for duplicate name', async () => {
      const dto = { name: 'Salud' };
      categoryRepo.findOneBy.mockResolvedValue({
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

      categoryRepo.find.mockResolvedValue(mockCategories);

      const result = await service.findAll();

      expect(result).toEqual(mockCategories);
      expect(categoryRepo.find).toHaveBeenCalledWith({
        order: { name: 'ASC' },
      });
    });
  });
});
