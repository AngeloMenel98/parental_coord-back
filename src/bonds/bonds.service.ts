import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { BondAccessService } from './bond-access.service';
import { BondsRepository } from './repositories/bonds.repository';
import { BondMembersRepository } from './repositories/bond-members.repository';
import { BondMemberRole } from './entities/bond-member.entity';
import { BondResponseDto } from './dto/bond-response.dto';

@Injectable()
export class BondsService {
  constructor(
    private readonly bondRepo: BondsRepository,
    private readonly bondAccess: BondAccessService,
    private readonly bondMembers: BondMembersRepository,
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
    const dtos = plainToInstance(BondResponseDto, visible, { excludeExtraneousValues: true });

    // T12: a un progenitor no se le muestra el nombre del tercero, sino quién lo autorizó.
    // Los vínculos redactados del tercero llegan con `members: []`, así que quedan afuera
    // sin necesidad de repetir el chequeo de rol. S8: el chequeo es VIEWER-AWARE — el
    // enmascaramiento lo decide el que pregunta, y el viewer es quien pide sus vínculos.
    await Promise.all(dtos.map((dto) => this.hideThirdPartyIdentity(dto, userId)));

    return dtos;

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
   * S12/T12 — el otro progenitor ve "Autorizado por <progenitor>", no el tercero.
   *
   * S8 (T7/T8 de `odd/tasks/thirdparty-identity.md`): el enmascaramiento es VIEWER-AWARE.
   * El único viewer que recibe el nombre REAL del tercero es su AUTORIZANTE (el grant es
   * suyo, él declaró ese nombre en el alta): para él los datos quedan intactos — el resto
   * de los miembros (y el propio tercero, que ya sabe quién lo autorizó) siguen viendo
   * la máscara. Es una regla de DATOS, no de pintado.
   *
   * Se reemplaza **el nombre y el perfil** del miembro `third_party`, no su `user.id`:
   * el id sigue siendo la llave con la que la app resuelve `bondRole`, la asignación y
   * la revocación del grant. `avatarUrl` se vacía porque una foto también identifica.
   * El nombre real sale del GRANT (`first_name`/`last_name` de `auth_third_party`, el
   * declarado en el alta), con el nombre de `personal_data` como respaldo.
   *
   * Cuando no hay grant vivo (revocado o vencido) o el autorizador no tiene nombre, el
   * nombre queda en `null` en vez de caer al del tercero: la regla es *no mostrarlo*, y
   * un hueco honesto es preferible a una identidad filtrada.
   *
   * Sin miembros `third_party` no se consulta nada: el caso común no paga el costo.
   */
  private async hideThirdPartyIdentity(bond: BondResponseDto, viewerId: string): Promise<void> {
    const thirdParties = bond.members.filter(
      (member) => member.role === BondMemberRole.THIRD_PARTY,
    );
    if (thirdParties.length === 0) return;

    const [authorizers, names, displayNames] = await Promise.all([
      this.bondMembers.findThirdPartyAuthorizers(bond.id),
      this.bondMembers.findMemberNames(bond.id),
      // T7: los dobles de specs previos (t12-verifier) no lo traen; preferir el nombre
      // declarado del grant cuando existe, sin romper esas pruebas ya vigentes.
      this.bondMembers.findThirdPartyDisplayNames
        ? this.bondMembers.findThirdPartyDisplayNames(bond.id)
        : Promise.resolve(new Map<string, string>()),
    ]);

    for (const member of thirdParties) {
      if (!member.user) continue;
      const authorizerId = authorizers.get(member.user.id);
      const authorizerName = authorizerId ? names.get(authorizerId) : undefined;

      // S8: el autorizante del grant ve los datos reales del tercero.
      if (authorizerId !== undefined && authorizerId === viewerId) {
        member.user.firstName =
          displayNames.get(member.user.id) ?? names.get(member.user.id) ?? member.user.firstName;
        continue;
      }

      member.user.firstName = authorizerName ? `Autorizado por ${authorizerName}` : null;
      member.user.lastName = null;
      member.user.avatarUrl = null;
    }
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
