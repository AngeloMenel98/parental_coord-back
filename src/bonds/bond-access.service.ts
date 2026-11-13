import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMembersRepository, BondAccessRow } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';

/**
 * El resultado de resolver la tenencia de un vínculo, tal como lo consumen los servicios.
 *
 * `grant` sólo existe para un `third_party`, y **sólo si el grant está vigente**: el
 * chokepoint no devuelve un permiso vencido para que el llamante tenga que acordarse de
 * mirar la fecha. Un permiso que no autoriza no se representa.
 */
export interface BondAccess {
  role: BondMemberRole;
  isThirdParty: boolean;
  grant?: {
    id: string;
    authorizedBy: string;
    startDate: string | null;
    endDate: string;
  };
}

/**
 * Memo por request. **No es una caché de datos**: vive lo que vive el request y se tira.
 *
 * Existe porque el chokepoint se llama desde varios servicios del mismo request
 * (actividades, gastos, hijos) y un `SELECT` por servicio vuelve a introducir el costo
 * que T3 viene a ordenar. La revocación sigue siendo inmediata porque no hay estado
 * compartido entre requests.
 */
export class BondAccessCache {
  private readonly entries = new Map<string, Promise<BondAccess | null>>();

  get(key: string): Promise<BondAccess | null> | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: Promise<BondAccess | null>): void {
    this.entries.set(key, value);
  }
}

/**
 * T3 · el único chokepoint de autorización de vínculo.
 *
 * Antes de esto, la tenencia se resolvía con `isActiveBondForMember(bondId, userId)`
 * repetido en cada servicio (F8), y ese chequeo **no mira al tercero temporal**: un
 * `third_party` con el grant revocado o vencido seguía siendo "miembro activo". Las dos
 * primitivas de acá son fail-closed y saben de grants:
 *
 * - [assertBondAccess] — membresía activa **y**, si es tercero, grant `active` y hoy
 *   dentro de `[start_date, end_date]`. Es lo que hay que llamar en vez de
 *   `isActiveBondForMember`.
 * - [assertCanAssignTo] — además, si se le asigna algo a un tercero, el llamante tiene
 *   que ser el progenitor que lo autorizó (S7). Es el punto exacto donde `assign` y
 *   `reassign` dejan de ser "cualquier miembro del vínculo".
 *
 * ⚠ **Una sola consulta por request**: `resolveBondAccess` acepta el [BondAccessCache]
 * que el entrypoint crea una vez y pasa a todo lo que llame durante ese request.
 */
@Injectable()
export class BondAccessService {
  constructor(
    private readonly members: BondMembersRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Resuelve la tenencia o `null` si el usuario no es miembro activo del vínculo.
   *
   * Un `third_party` sin grant vigente devuelve la membresía **sin** `grant`: el rol se
   * conserva (sirve para explicar el 403) pero no hay permiso que consumir.
   */
  async resolveBondAccess(
    bondId: string,
    userId: string,
    cache?: BondAccessCache,
  ): Promise<BondAccess | null> {
    const key = `${bondId}:${userId}`;
    const cached = cache?.get(key);
    if (cached) return cached;

    const pending = this.resolveUncached(bondId, userId);
    cache?.set(key, pending);
    return pending;
  }

  /** Fail-closed: sin membresía o sin grant vigente no hay acceso, y se dice por qué. */
  async assertBondAccess(
    bondId: string,
    userId: string,
    cache?: BondAccessCache,
  ): Promise<BondAccess> {
    const access = await this.resolveBondAccess(bondId, userId, cache);
    if (!access) {
      // Mismo mensaje que la tenencia repartida de antes: no distinguir "no existe" de
      // "no sos miembro" evita confirmar la existencia de un vínculo ajeno.
      throw new NotFoundException('Bond not found or you are not a member');
    }
    if (access.isThirdParty && !access.grant) {
      throw new ForbiddenException('Tu acceso temporal terminó');
    }
    return access;
  }

  /**
   * S7: a un tercero sólo le asigna el progenitor que lo autorizó.
   *
   * El llamante ya tiene que haber pasado por [assertBondAccess]; acá sólo se agrega la
   * regla de propiedad del grant. Devuelve `true` cuando el destino **es** un tercero
   * autorizado por el llamante, que es lo que el alta necesita para auto-confirmar.
   */
  async assertCanAssignTo(
    bondId: string,
    callerId: string,
    targetUserId: string,
    cache?: BondAccessCache,
  ): Promise<boolean> {
    const target = await this.resolveBondAccess(bondId, targetUserId, cache);
    if (!target || !target.isThirdParty) return false;
    if (!target.grant || target.grant.authorizedBy !== callerId) {
      throw new ForbiddenException(
        'Sólo el progenitor que autorizó a esta persona puede asignarle actividades',
      );
    }
    // Devuelve el dato en vez de `void`: el llamante necesita saber que el destino es un
    // tercero para auto-confirmar la asignación (S8), y preguntarlo otra vez sería una
    // segunda resolución para la misma respuesta.
    return true;
  }

  private async resolveUncached(bondId: string, userId: string): Promise<BondAccess | null> {
    const row = await this.members.findAccessRow(bondId, userId);
    if (!row) return null;
    // `left_at` es la baja del vínculo: ni el rol ni el grant sobreviven a ella.
    if (row.leftAt !== null) return null;

    const isThirdParty = row.role === BondMemberRole.THIRD_PARTY;
    if (!isThirdParty) {
      return { role: row.role, isThirdParty: false };
    }

    // El vencimiento se evalúa por fecha, no sólo por estado: un grant que nadie barrió
    // todavía (`active` con `end_date` pasado) NO autoriza.
    const today = this.clock.now().toISOString().slice(0, 10);
    const vigente =
      row.grantId !== null &&
      row.grantStatus === 'active' &&
      row.grantEnd !== null &&
      row.grantEnd >= today;

    return {
      role: row.role,
      isThirdParty: true,
      grant: vigente
        ? {
            id: row.grantId as string,
            authorizedBy: row.grantedBy as string,
            startDate: row.grantStart,
            endDate: row.grantEnd as string,
          }
        : undefined,
    };
  }
}

/** El vínculo no existe o el usuario no es miembro activo. */
export type { BondAccessRow };
