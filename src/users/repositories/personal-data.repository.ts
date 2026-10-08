import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { PersonalDataEntity } from '../entities/personal-data.entity';

/**
 * Acceso a `personal_data` — datos 1:1 del usuario.
 *
 * T1 (aditivo): `auth.service` y `admin.service` aún inyectan
 * `Repository<PersonalDataEntity>`; los swaps son de T5a/T5b.
 */
@Injectable()
export class PersonalDataRepository extends BaseRepository<PersonalDataEntity> {
  constructor(
    @InjectRepository(PersonalDataEntity)
    private readonly personalDataRepo: Repository<PersonalDataEntity>,
  ) {
    super(personalDataRepo);
  }

  /** Perfil del usuario o `null` (buildAuthResponse de auth.service). */
  async findOneByUserId(userId: string): Promise<PersonalDataEntity | null> {
    return this.personalDataRepo.findOneBy({ userId });
  }
}
