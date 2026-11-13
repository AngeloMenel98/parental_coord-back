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

  /**
   * Los vínculos del usuario.
   *
   * **S5: al tercero temporal se le redacta el vínculo.** El resto de los miembros y los
   * hijos del vínculo no son datos suyos —los ve el progenitor—, así que para él la
   * respuesta queda con los metadatos del Bond y nada más. La redacción se decide por el
   * rol del chokepoint, no por lo que la app pida.
   */
  async findByUserId(userId: string): Promise<BondResponseDto[]> {
    const bonds = await this.bondRepo.findBondsByUserId(userId);
    const visible = await Promise.all(
      bonds.map(async (bond) => {
        const access = await this.bondAccess.resolveBondAccess(bond.id, userId);
        if (access?.isThirdParty !== true) return bond;
        // Se vacían las dos colecciones en vez de omitir el Bond: el tercero necesita
        // saber a qué vínculo pertenece, no quiénes son los otros.
        return { ...bond, members: [], children: [] };
      }),
    );
    return plainToInstance(BondResponseDto, visible, { excludeExtraneousValues: true });

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
  /** ¿El usuario es un tercero temporal en este vínculo? (S5: gastos y compliance le dan 403.) */
  async isThirdPartyIn(bondId: string, userId: string): Promise<boolean> {
    const access = await this.bondAccess.resolveBondAccess(bondId, userId);
    return access?.isThirdParty === true;
  }

  async isActiveBondForMember(bondId: string, userId: string): Promise<boolean> {
    const access = await this.bondAccess.resolveBondAccess(bondId, userId);
    if (access === null) return false;
    return !access.isThirdParty || access.grant !== undefined;
  }
}
