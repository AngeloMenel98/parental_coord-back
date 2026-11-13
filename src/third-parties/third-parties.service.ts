import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { BondsService } from '../bonds/bonds.service';
import { BondMemberEntity, BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
} from '../expenses/entities/auth-third-party.entity';
import { UsersRepository } from '../users/repositories/users.repository';
import { CreateThirdPartyDto } from './dto/create-third-party.dto';
import { ThirdPartyResponseDto } from './dto/third-party-response.dto';
import { UpdateThirdPartyDto } from './dto/update-third-party.dto';
import { AuthThirdPartiesRepository } from './repositories/auth-third-parties.repository';
import {
  THIRD_PARTY_AUDIT_ACTIONS,
  ThirdPartiesAuditRepository,
} from './repositories/third-parties-audit.repository';

/**
 * Mensaje único para "el grant no existe" y "el grant no es tuyo".
 *
 * Un 403 distinguiría los dos casos y con eso confirmaría que el id existe: el mismo
 * criterio que ya usa `ExpensesService.loadForViewer` (404 antes que revelar).
 */
const NOT_FOUND_MESSAGE = 'Third-party access not found';

/**
 * El módulo del acceso temporal (T2 de `odd/tasks/terciarios-temporales.md`).
 *
 * Dos superficies y una sola regla de tenencia:
 * - **Dueño**: sólo el progenitor que otorgó un grant lo lista, lo edita y lo revoca.
 *   El otro progenitor del vínculo no lo ve (S7) — y no lo ve porque las consultas
 *   filtran por `authorizedBy`, no porque la UI lo esconda.
 * - **Visitante**: `getMyGrant` devuelve SU grant, con el nombre de quien lo autorizó y
 *   la vigencia (S12). Es lo único que necesita para entrar.
 *
 * Esta tarea NO implementa el chokepoint de autorización del vínculo (T3) ni la política
 * de actividades (T4): acá sólo se administra el grant. El día que T3 exista, `assertOwner`
 * se apoyará en él; hoy usa `isActiveBondForMember` + el rol del miembro, que es la
 * información que ya está en la DB.
 */
@Injectable()
export class ThirdPartiesService {
  constructor(
    private readonly grants: AuthThirdPartiesRepository,
    private readonly audit: ThirdPartiesAuditRepository,
    private readonly bonds: BondsService,
    private readonly members: BondMembersRepository,
    private readonly users: UsersRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Los accesos que otorgó ESTE progenitor. */
  async listForOwner(bondId: string, ownerId: string): Promise<ThirdPartyResponseDto[]> {
    await this.assertProgenitor(bondId, ownerId);

    const grants = await this.grants.findForOwner(bondId, ownerId);
    if (grants.length === 0) return [];

    // Una sola consulta de nombres para toda la lista: preguntar por grant sería un N+1.
    const names = await this.members.findMemberNames(bondId);
    return grants.map((grant) => this.toResponse(grant, names));
  }

  /**
   * Alta del acceso (S2/S3/S7).
   *
   * La fila de `bond_member` con rol `third_party`, el grant y el audit entran en UNA
   * transacción: un grant sin membresía no se podría autorizar después, y una membresía
   * sin grant quedaría con acceso indefinido a nivel de vínculo.
   *
   * Credenciales (D4): no se crean acá. Si el email no tiene cuenta, se responde 422.
   */
  async createForOwner(
    bondId: string,
    ownerId: string,
    dto: CreateThirdPartyDto,
  ): Promise<ThirdPartyResponseDto> {
    await this.assertProgenitor(bondId, ownerId);
    const today = this.today();
    this.assertAccessEnd(dto.accessEnd, today);

    const target = await this.users.findOneByEmail(dto.email);
    if (!target) {
      throw new UnprocessableEntityException(
        'Ese email todavía no tiene una cuenta en la app. El alta con credenciales está diferida (D4): el progenitor tiene que crear el usuario antes de otorgarle acceso.',
      );
    }

    const existingMember = await this.members.findOneByBondAndUser(bondId, target.id);
    // Un progenitor o coordinador NO se degrada a tercero por un POST: cambiaría sus
    // permisos en todo el vínculo sin que nadie lo haya pedido.
    if (existingMember && existingMember.role !== BondMemberRole.THIRD_PARTY) {
      throw new ConflictException('Ese usuario ya es miembro del vínculo con otro rol');
    }
    if (existingMember && existingMember.leftAt !== null) {
      throw new ConflictException('Ese usuario dejó el vínculo; no se le puede otorgar acceso');
    }

    const activeGrant = await this.grants.findActiveForPair(bondId, target.id);
    if (activeGrant) {
      throw new ConflictException('Ese usuario ya tiene un acceso temporal vigente en este vínculo');
    }

    const grant = await this.grants.transaction(async (manager) => {
      if (!existingMember) {
        // La membresía se escribe con el manager de la transacción, no por el
        // repositorio de bonds: ese repositorio no acepta `EntityManager` y abriría
        // otra conexión, dejando el alta partida en dos si algo falla después.
        const memberRepo = manager.getRepository(BondMemberEntity);
        await memberRepo.save(
          memberRepo.create({
            bondId,
            userId: target.id,
            role: BondMemberRole.THIRD_PARTY,
          }),
        );
      }

      const created = await this.grants.saveWith(
        {
          bondId,
          userId: target.id,
          authorizedBy: ownerId,
          startDate: today,
          endDate: dto.accessEnd,
          relationship: dto.relationship,
          status: AuthThirdStatus.ACTIVE,
          scopeNote: dto.note ?? null,
        },
        manager,
      );

      await this.audit.record(
        {
          bondId,
          userId: ownerId,
          grantId: created.id,
          action: THIRD_PARTY_AUDIT_ACTIONS.GRANT,
          newValue: {
            userId: target.id,
            endDate: created.endDate,
            relationship: created.relationship,
          },
          detail: dto.note ?? null,
        },
        manager,
      );

      return created;
    });

    const names = await this.members.findMemberNames(bondId);
    return this.toResponse(grant, names);
  }

  /** Cambios sobre un acceso vigente: fecha, relación y nota. */
  async updateForOwner(
    grantId: string,
    ownerId: string,
    dto: UpdateThirdPartyDto,
  ): Promise<ThirdPartyResponseDto> {
    const grant = await this.requireOwnedGrant(grantId, ownerId);
    if (grant.status !== AuthThirdStatus.ACTIVE) {
      throw new ConflictException('Sólo se puede editar un acceso vigente');
    }

    const today = this.today();
    if (dto.accessEnd !== undefined) {
      this.assertAccessEnd(dto.accessEnd, today);
      if (grant.startDate !== null && dto.accessEnd < grant.startDate) {
        throw new BadRequestException('accessEnd cannot be earlier than startDate');
      }
    }

    const updated = await this.grants.transaction(async (manager) => {
      const repo = manager.getRepository(AuthThirdPartyEntity);
      const row = await repo.findOneByOrFail({ id: grant.id });
      const before = {
        endDate: row.endDate,
        relationship: row.relationship,
        note: row.scopeNote,
      };

      if (dto.accessEnd !== undefined) row.endDate = dto.accessEnd;
      if (dto.relationship !== undefined) row.relationship = dto.relationship;
      if (dto.note !== undefined) row.scopeNote = dto.note;

      const saved = await repo.save(row);
      await this.audit.record(
        {
          bondId: saved.bondId,
          userId: ownerId,
          grantId: saved.id,
          action: THIRD_PARTY_AUDIT_ACTIONS.UPDATE,
          oldValue: before,
          newValue: {
            endDate: saved.endDate,
            relationship: saved.relationship,
            note: saved.scopeNote,
          },
        },
        manager,
      );
      return saved;
    });

    const names = await this.members.findMemberNames(updated.bondId);
    return this.toResponse(updated, names);
  }

  /**
   * Revocación anticipada (D3). Surte efecto de inmediato porque `status` es lo que mira
   * la autorización; la fila de `bond_member` se deja como está (sigue siendo historia
   * del vínculo, no permiso).
   *
   * Idempotente: revocar dos veces no duplica el audit ni mueve `revokedAt`.
   */
  async revokeForOwner(grantId: string, ownerId: string): Promise<ThirdPartyResponseDto> {
    const grant = await this.requireOwnedGrant(grantId, ownerId);

    if (grant.status === AuthThirdStatus.EXPIRED) {
      throw new ConflictException('El acceso ya venció: no hay nada que revocar');
    }
    if (grant.status === AuthThirdStatus.REVOKED) {
      const names = await this.members.findMemberNames(grant.bondId);
      return this.toResponse(grant, names);
    }

    const now = this.clock.now();
    const revoked = await this.grants.transaction(async (manager) => {
      const repo = manager.getRepository(AuthThirdPartyEntity);
      const row = await repo.findOneByOrFail({ id: grant.id });
      const from = row.status;

      row.status = AuthThirdStatus.REVOKED;
      row.revokedAt = now;
      row.revokedBy = ownerId;
      row.revokedReason = 'Revocado por el progenitor';

      const saved = await repo.save(row);
      await this.audit.record(
        {
          bondId: saved.bondId,
          userId: ownerId,
          grantId: saved.id,
          action: THIRD_PARTY_AUDIT_ACTIONS.REVOKE,
          oldValue: { status: from },
          newValue: { status: saved.status },
          detail: saved.revokedReason,
        },
        manager,
      );
      return saved;
    });

    const names = await this.members.findMemberNames(revoked.bondId);
    return this.toResponse(revoked, names);
  }

  /**
   * El grant del visitante (`GET /third-parties/me`).
   *
   * Vencimiento perezoso: si el grant sigue `active` y ya pasó `endDate`, se marca
   * `expired` y se audita antes de responder. No se responde 404: la persona necesita
   * poder leer que su acceso terminó (y por qué), no un "no existe".
   *
   * Un grant revocado o suspendido sí es 403: la respuesta no tiene nada que la persona
   * pueda usar y el front tiene que cerrar la sesión (T10).
   */
  async getMyGrant(viewerId: string): Promise<ThirdPartyResponseDto> {
    const grant = await this.grants.findLatestForUser(viewerId);
    if (!grant) {
      throw new NotFoundException('No tenés un acceso temporal en este vínculo');
    }
    if (
      grant.status === AuthThirdStatus.REVOKED ||
      grant.status === AuthThirdStatus.SUSPENDED
    ) {
      throw new ForbiddenException('Tu acceso temporal terminó');
    }

    const today = this.today();
    let current = grant;
    if (grant.status === AuthThirdStatus.ACTIVE && grant.endDate < today) {
      current = await this.grants.transaction(async (manager) => {
        const repo = manager.getRepository(AuthThirdPartyEntity);
        const row = await repo.findOneByOrFail({ id: grant.id });
        row.status = AuthThirdStatus.EXPIRED;
        const saved = await repo.save(row);
        await this.audit.record(
          {
            bondId: saved.bondId,
            userId: viewerId,
            grantId: saved.id,
            action: THIRD_PARTY_AUDIT_ACTIONS.EXPIRE,
            oldValue: { status: AuthThirdStatus.ACTIVE },
            newValue: { status: AuthThirdStatus.EXPIRED },
            detail: `endDate ${saved.endDate}`,
          },
          manager,
        );
        return saved;
      });
    }

    const names = await this.members.findMemberNames(current.bondId);
    return this.toResponse(current, names);
  }

  // ── Reglas compartidas ────────────────────────────────────────────────

  /** Sólo un progenitor ACTIVO del vínculo administra accesos (S3/S7). */
  private async assertProgenitor(bondId: string, callerId: string): Promise<BondMemberEntity> {
    const isMember = await this.bonds.isActiveBondForMember(bondId, callerId);
    const member = isMember ? await this.members.findOneByBondAndUser(bondId, callerId) : null;
    if (!member || member.leftAt !== null || member.role !== BondMemberRole.PROGENITOR) {
      throw new ForbiddenException(
        'Sólo un progenitor del vínculo puede administrar accesos temporales',
      );
    }
    return member;
  }

  private async requireOwnedGrant(
    grantId: string,
    ownerId: string,
  ): Promise<AuthThirdPartyEntity> {
    const grant = await this.grants.findById(grantId);
    if (!grant || grant.authorizedBy !== ownerId) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return grant;
  }

  /** D3: la fecha de vencimiento es obligatoria y no puede estar en el pasado. */
  private assertAccessEnd(accessEnd: string, today: string): void {
    if (accessEnd < today) {
      throw new BadRequestException('accessEnd cannot be in the past');
    }
  }

  /** `YYYY-MM-DD` en UTC: la columna es `date`, sin hora ni zona que la corran. */
  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  private toResponse(
    grant: AuthThirdPartyEntity,
    names: Map<string, string>,
  ): ThirdPartyResponseDto {
    return {
      id: grant.id,
      bondId: grant.bondId,
      userId: grant.userId,
      displayName: names.get(grant.userId) ?? null,
      relationship: grant.relationship,
      startDate: grant.startDate,
      endDate: grant.endDate,
      status: grant.status,
      authorizedBy: grant.authorizedBy,
      authorizedByName: names.get(grant.authorizedBy) ?? null,
      note: grant.scopeNote,
      revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
    };
  }
}
