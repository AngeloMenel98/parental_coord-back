import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
} from '../../expenses/entities/auth-third-party.entity';

/**
 * Acceso a `auth_third_party`.
 *
 * ⚠ **La entidad vive todavía en `expenses/entities`** (F6: la tabla nació ahí y ningún
 * código la usaba). Moverla obligaría a tocar también
 * `third-activity-participation.entity.ts`, que declara la relación inversa y sigue
 * registrada en `ExpensesModule`, y con `autoLoadEntities` el metadata de esa relación
 * tiene que poder resolverse. Se deja donde está y se documenta como deuda: el módulo
 * dueño del comportamiento es `third-parties`.
 *
 * Cada método de escritura acepta el `EntityManager` de una transacción abierta por el
 * servicio: el grant, el alta del vínculo y el audit tienen que entrar o salir juntos.
 */
@Injectable()
export class AuthThirdPartiesRepository extends BaseRepository<AuthThirdPartyEntity> {
  constructor(
    @InjectRepository(AuthThirdPartyEntity)
    private readonly grantRepo: Repository<AuthThirdPartyEntity>,
  ) {
    super(grantRepo);
  }

  /**
   * El grant `active` de un par (bond, usuario). El índice único parcial de
   * `AddThirdPartyAccessGrant1793664000000` garantiza que sea como mucho uno.
   */
  async findActiveForPair(bondId: string, userId: string): Promise<AuthThirdPartyEntity | null> {
    return this.grantRepo.findOne({
      where: { bondId, userId, status: AuthThirdStatus.ACTIVE },
    });
  }

  /** Los grants que otorgó un progenitor. El otro progenitor no los ve (S7). */
  async findForOwner(bondId: string, ownerId: string): Promise<AuthThirdPartyEntity[]> {
    return this.grantRepo.find({
      where: { bondId, authorizedBy: ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * El grant más reciente del visitante, sea cual sea su estado: `/third-parties/me`
   * necesita poder contar "venció" o "fue revocado" en vez de responder 404 opaco.
   *
   * **Prefiere el `active`** (R2-001): con grants en más de un vínculo, "el más reciente
   * por fecha de creación" podía ser el de OTRO vínculo y `/me` respondía la relación y el
   * vínculo equivocados. Un grant vivo gana siempre; sólo si no hay ninguno se cae al
   * último conocido, que es el que sirve para explicar que el acceso terminó.
   */
  async findLatestForUser(userId: string): Promise<AuthThirdPartyEntity | null> {
    const active = await this.grantRepo.findOne({
      where: { userId, status: AuthThirdStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
    if (active) return active;
    return this.grantRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Escritura transaccional del grant (alta, cambio de fecha o revocación). */
  async saveWith(
    data: DeepPartial<AuthThirdPartyEntity>,
    manager?: EntityManager,
  ): Promise<AuthThirdPartyEntity> {
    const repo = manager ? manager.getRepository(AuthThirdPartyEntity) : this.grantRepo;
    return repo.save(repo.create(data));
  }
}
