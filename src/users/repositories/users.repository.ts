import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { UserEntity } from '../entities/user.entity';

/**
 * Acceso a `user` — la tabla raíz de este módulo.
 *
 * T1 (aditivo): `auth.service` y `admin.service` aún inyectan
 * `Repository<UserEntity>`; los swaps son de T5a/T5b.
 */
@Injectable()
export class UsersRepository extends BaseRepository<UserEntity> {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {
    super(userRepo);
  }

  /** Usuario por email o `null` (login y chequeo de registro duplicado). */
  async findOneByEmail(email: string): Promise<UserEntity | null> {
    return this.userRepo.findOneBy({ email });
  }

  /** Usuarios por ids — el `findByIds` de TypeORM, envuelto (admin.service). */
  async findByIds(ids: string[]): Promise<UserEntity[]> {
    return this.userRepo.findByIds(ids);
  }

  /**
   * Todos los usuarios con su `personal_data` en una sola query
   * (admin.service `listUsers`: QB + `leftJoinAndSelect` + createdAt DESC).
   *
   * Devuelve la entidad completa; el mapeo al DTO vive en el servicio.
   */
  async findAllWithPersonalData(): Promise<UserEntity[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.personalData', 'pd')
      .orderBy('user.createdAt', 'DESC')
      .getMany();
  }
}
