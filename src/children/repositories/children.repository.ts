import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ChildEntity } from '../entities/child.entity';

/**
 * Acceso a `children` — la tabla raíz de este módulo.
 *
 * T1 (aditivo): el servicio todavía inyecta `Repository<ChildEntity>`; los
 * call sites migran en T5a. Los métodos copian la semántica de las consultas
 * existentes byte a byte para que el swap sea silencioso.
 */
@Injectable()
export class ChildrenRepository extends BaseRepository<ChildEntity> {
  constructor(
    @InjectRepository(ChildEntity)
    private readonly childRepo: Repository<ChildEntity>,
  ) {
    super(childRepo);
  }

  /**
   * Hijos de un bond dados sus ids.
   *
   * Sirve a `activities.service` (`In(ids)` + bondId). El chequeo de longitud
   * (¿todos los ids pertenecen al bond?) se queda en el servicio: es regla de
   * negocio de creación de actividades, no de lectura.
   */
  async findByIdsAndBond(ids: string[], bondId: string): Promise<ChildEntity[]> {
    return this.childRepo.find({ where: { id: In(ids), bondId } });
  }

  /** Hijos de un bond, más recientes primero (children.service y admin.service). */
  async findByBond(bondId: string): Promise<ChildEntity[]> {
    return this.childRepo.find({
      where: { bondId },
      order: { createdAt: 'DESC' },
    });
  }
}
