import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Repository,
  FindOptionsWhere,
  FindOneOptions,
  FindManyOptions,
  DeepPartial,
} from 'typeorm';

@Injectable()
export abstract class BaseRepository<T extends { id: string }> extends Repository<T> {
  constructor(private readonly repo: Repository<T>) {
    super(repo.target, repo.manager);
  }

  // --- Standard CRUD ---

  async findById(id: string, options?: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({ where: { id } as FindOptionsWhere<T>, ...options });
  }

  async findByIdOrThrow(id: string, options?: FindOneOptions<T>): Promise<T> {
    const entity = await this.findById(id, options);
    if (!entity)
      throw new NotFoundException(
        `${this.repo.metadata.name} with id "${id}" not found`,
      );
    return entity;
  }

  async findByWhere(where: FindOptionsWhere<T>, options?: FindManyOptions<T>): Promise<T[]> {
    return this.repo.find({ where, ...options });
  }

  async findMany(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repo.find(options);
  }

  async findOneByWhere(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repo.findOneBy(where);
  }

  async createAndSave(data: DeepPartial<T>): Promise<T> {
    const entity = this.repo.create(data as any);
    const saved = await this.repo.save(entity as any);
    return saved as T;
  }

  async updateEntity(id: string, data: DeepPartial<T>): Promise<T> {
    const entity = await this.findByIdOrThrow(id);
    Object.assign(entity, data);
    return this.repo.save(entity);
  }

  async removeEntity(id: string): Promise<void> {
    const entity = await this.findByIdOrThrow(id);
    await this.repo.remove(entity);
  }

  async existsByWhere(where: FindOptionsWhere<T>): Promise<boolean> {
    const count = await this.repo.count({ where, take: 1 });
    return count > 0;
  }

  async countEntities(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repo.count({ where });
  }

  // --- QueryBuilder helpers ---

  protected get queryBuilder() {
    return this.repo.createQueryBuilder();
  }

  protected get alias() {
    return this.repo.metadata.name;
  }
}
