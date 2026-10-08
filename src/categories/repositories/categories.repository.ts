import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { CategoryEntity } from '../entities/category.entity';

/**
 * Acceso a `category` — la tabla raíz de este módulo.
 *
 * T1 (aditivo): `categories.service` aún inyecta `Repository<CategoryEntity>`;
 * el swap es de T5a y ahí se conserva su mensaje de NotFound propio (D3).
 */
@Injectable()
export class CategoriesRepository extends BaseRepository<CategoryEntity> {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
  ) {
    super(categoryRepo);
  }

  /**
   * Categoría activa por id o `null`.
   *
   * Sirve a `activities.service` en la validación de creación: el servicio
   * conserva su propio `BadRequest('Category is unknown or inactive')` — este
   * método sólo lee, no lanza.
   */
  async findActiveById(id: string): Promise<CategoryEntity | null> {
    return this.categoryRepo.findOneBy({ id, isActive: true });
  }
}
