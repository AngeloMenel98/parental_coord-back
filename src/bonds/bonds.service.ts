import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { BondAccessService } from './bond-access.service';
import { BondsRepository } from './repositories/bonds.repository';
import { BondResponseDto } from './dto/bond-response.dto';

@Injectable()
export class BondsService {
  constructor(
    private readonly bondRepo: BondsRepository,
    private readonly bondAccess: BondAccessService,
  ) {}

  async findByUserId(userId: string): Promise<BondResponseDto[]> {
    const bonds = await this.bondRepo.findBondsByUserId(userId);
    return plainToInstance(BondResponseDto, bonds, { excludeExtraneousValues: true });

    /*  

    const flattened = bonds.map((bond) => ({
      ...bond,
      members: bond.members?.map((m) => ({
        ...m,
        user: m.user
          ? {
              id: m.user.id,
              firstName: m.user.personalData?.firstName ?? '',
              lastName: m.user.personalData?.lastName ?? '',
            }
          : undefined,
      })),
    }));

    return plainToInstance(BondResponseDto, flattened, {
      excludeExtraneousValues: true,
    });*/
  }

  /**
   * ¿Es miembro activo del vínculo **con acceso vigente**?
   *
   * T3: delega en `BondAccessService`, el chokepoint. Este método es la puerta que cada
   * dominio usa hoy para resolver tenencia (`activities`, `expenses`, adjuntos,
   * webhooks, notificaciones), así que delegar acá es lo que hace que **revocar o vencer
   * un acceso temporal surta efecto en todo el backend** y no sólo en el módulo de
   * terceros — el defecto que la review nativa marcó como BLOCKER en tres lentes.
   *
   * Un `third_party` sin grant vigente (revocado, suspendido o vencido por fecha) deja de
   * contar como miembro activo sin que ningún servicio tenga que acordarse de preguntar
   * por el grant.
   */
  async isActiveBondForMember(bondId: string, userId: string): Promise<boolean> {
    const access = await this.bondAccess.resolveBondAccess(bondId, userId);
    if (access === null) return false;
    return !access.isThirdParty || access.grant !== undefined;
  }
}
