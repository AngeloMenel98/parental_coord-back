import { ForbiddenException, Injectable } from '@nestjs/common';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { BondsService } from '../../bonds/bonds.service';
import { SystemRole } from '../../users/entities/user.entity';

/**
 * Seam de autorización de webhooks (REQ-SUB-1, Q1, D8).
 *
 * El diseño lo aísla aquí para que un futuro rol de bond pueda endurecerlo sin
 * tocar los servicios/controladores: hoy NO existe rol `admin` a nivel bond.
 *
 *  - `assertCanManage`: mutaciones (create/update/delete/rotate/test/disable/
 *    enable/replay-dead) exigen un MIEMBRO ACTIVO del bond o un
 *    `systemRole=admin` global.
 *  - `assertCanRead`: lecturas (list/get/event-types/deliveries) abiertas a
 *    TODOS los miembros activos del bond (transparencia, REQ-SEC-4) o admin.
 *
 * No se revela la existencia del recurso: un no-miembro recibe 403.
 */
@Injectable()
export class WebhookAuthzService {
  constructor(private readonly bonds: BondsService) {}

  /** Autoriza una mutación sobre suscripciones de `bondId`. Lanza 403 si no. */
  async assertCanManage(bondId: string, user: AuthUser): Promise<void> {
    await this.assertBondAccess(bondId, user);
  }

  /** Autoriza una lectura de las suscripciones de `bondId`. Lanza 403 si no. */
  async assertCanRead(bondId: string, user: AuthUser): Promise<void> {
    await this.assertBondAccess(bondId, user);
  }

  private async assertBondAccess(bondId: string, user: AuthUser): Promise<void> {
    if (user.systemRole === SystemRole.ADMIN) {
      return;
    }

    const isMember = await this.bonds.isActiveBondForMember(bondId, user.id);
    if (!isMember) {
      throw new ForbiddenException('You are not an active member of this bond');
    }
  }
}
