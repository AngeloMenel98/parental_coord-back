import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { EntityManager } from 'typeorm';

import { BondAccessCache, BondAccessService } from '../bonds/bond-access.service';
import { BondMemberEntity, BondMemberRole } from '../bonds/entities/bond-member.entity';
import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { Clock } from '../common/clock/clock';
import {
  AuthThirdPartyEntity,
  AuthThirdStatus,
} from '../expenses/entities/auth-third-party.entity';
import { thirdPartyInviteMail, thirdPartyNoticeMail } from '../mail/mail-templates';
import { MailerService } from '../mail/mailer.service';
import { SystemRole, UserEntity } from '../users/entities/user.entity';
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
 * se apoyará en él; hoy delega en `BondAccessService.assertBondAccess`, que resuelve
 * membresía y grant en una sola consulta.
 * información que ya está en la DB.
 */
@Injectable()
export class ThirdPartiesService {
  private readonly logger = new Logger(ThirdPartiesService.name);

  constructor(
    private readonly grants: AuthThirdPartiesRepository,
    private readonly audit: ThirdPartiesAuditRepository,
    private readonly access: BondAccessService,
    private readonly members: BondMembersRepository,
    private readonly users: UsersRepository,
    private readonly mailer: MailerService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Los accesos que otorgó ESTE progenitor. */
  async listForOwner(bondId: string, ownerId: string): Promise<ThirdPartyResponseDto[]> {
    const cache = new BondAccessCache();
    await this.assertProgenitor(bondId, ownerId, cache);

    const grants = await this.grants.findForOwner(bondId, ownerId);
    if (grants.length === 0) return [];

    // Una sola consulta de nombres para toda la lista: preguntar por grant sería un N+1.
    const names = await this.members.findMemberNames(bondId);

    // Barrido perezoso también acá: si el dueño abre la consola, un grant vencido que
    // todavía figura `active` tiene que leerse como vencido, no como vigente (F1 de la
    // verificación independiente). Sin vencidos no se abre transacción.
    const today = this.today();
    const lapsed = grants.some(
      (grant) => grant.status === AuthThirdStatus.ACTIVE && grant.endDate < today,
    );
    if (!lapsed) return grants.map((grant) => this.toResponse(grant, names));

    const fresh = await this.grants.transaction(async (manager) => {
      const rows: AuthThirdPartyEntity[] = [];
      for (const grant of grants) {
        rows.push(await this.expireIfLapsed(grant, today, ownerId, manager));
      }
      return rows;
    });
    return fresh.map((grant) => this.toResponse(grant, names));
  }

  /**
   * Alta del acceso (S2/S3/S7) y de las credenciales del tercero (S1, D2).
   *
   * La cuenta, la fila de `bond_member` con rol `third_party`, el grant y el audit entran
   * en UNA transacción: un grant sin membresía no se podría autorizar después, y una
   * membresía sin grant quedaría con acceso indefinido a nivel de vínculo.
   *
   * Email **sin** cuenta (D2): la cuenta se crea en esa misma transacción con una
   * contraseña generada y el correo con usuario + contraseña se envía ANTES del commit.
   * Si el envío falla, el callback tira y TypeORM revierte todo: nadie queda con una
   * cuenta cuyas credenciales nunca llegaron.
   *
   * Email **con** cuenta: no se toca su contraseña; el aviso sale después del commit y si
   * falla sólo se loguea, porque el acceso ya es real.
   */
  async createForOwner(
    bondId: string,
    ownerId: string,
    dto: CreateThirdPartyDto,
  ): Promise<ThirdPartyResponseDto> {
    const cache = new BondAccessCache();
    await this.assertProgenitor(bondId, ownerId, cache);
    const today = this.today();
    this.assertAccessEnd(dto.accessEnd, today);

    const target = await this.users.findOneByEmail(dto.email);

    let existingMember: BondMemberEntity | null = null;
    if (target) {
      existingMember = await this.members.findOneByBondAndUser(bondId, target.id);
      // Un progenitor o coordinador NO se degrada a tercero por un POST: cambiaría sus
      // permisos en todo el vínculo sin que nadie lo haya pedido.
      if (existingMember && existingMember.role !== BondMemberRole.THIRD_PARTY) {
        throw new ConflictException('Ese usuario ya es miembro del vínculo con otro rol');
      }
      const activeGrant = await this.grants.findActiveForPair(bondId, target.id);
      if (activeGrant && activeGrant.endDate >= today) {
        // Mismo mensaje lo haya otorgado quien lo haya otorgado: si dijera "vigente" o
        // nombrara al dueño, el otro progenitor aprendería que existe un grant ajeno en
        // este vínculo (F2 de la verificación independiente, misma regla que el
        // 404-antes-que-403 del resto del módulo).
        throw new ConflictException('Ese usuario ya tiene un acceso temporal en este vínculo');
      }
    }
    // Una membresía cerrada por revocación o vencimiento se REABRE: es el mismo tercero
    // del mismo vínculo, y bloquearlo dejaría el acceso imposible de re-otorgar.

    // La contraseña se genera y se hashea FUERA de la transacción: bcrypt tarda, y no hay
    // razón para tener una conexión abierta esperándolo.
    const provisional = target ? null : await this.provisionalCredentials();

    const { grant, invitedUserId } = await this.grants.transaction(async (manager) => {
      // `provisional` existe exactamente cuando `target` no: la cuenta se crea con el
      // manager de la transacción, no por el repositorio de usuarios, para que una falla
      // del correo la revierta junto con el grant.
      const userId = target
        ? target.id
        : await this.createAccount(manager, dto.email, provisional!.passwordHash);

      if (existingMember && existingMember.leftAt !== null) {
        await manager.getRepository(BondMemberEntity).update(
          { bondId, userId },
          { leftAt: null },
        );
      } else if (!existingMember) {
        // La membresía se escribe con el manager de la transacción, no por el
        // repositorio de bonds: ese repositorio no acepta `EntityManager` y abriría
        // otra conexión, dejando el alta partida en dos si algo falla después.
        const memberRepo = manager.getRepository(BondMemberEntity);
        await memberRepo.save(
          memberRepo.create({
            bondId,
            userId,
            role: BondMemberRole.THIRD_PARTY,
          }),
        );
      }

      // Vencido sin barrer = todavía `active` y todavía chocando con el índice único
      // parcial, que sólo mira el estado. Se vence acá, antes de insertar, para que
      // volver a otorgar un acceso vencido funcione (F1).
      const pairRows = await manager.getRepository(AuthThirdPartyEntity).find({
        where: { bondId, userId, status: AuthThirdStatus.ACTIVE },
      });
      for (const row of pairRows) {
        await this.expireIfLapsed(row, today, ownerId, manager);
      }

      const createGrant = () =>
        this.grants.saveWith(
          {
            bondId,
            userId,
            authorizedBy: ownerId,
            startDate: today,
            endDate: dto.accessEnd,
            relationship: dto.relationship,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone?.trim() || null,
            document: dto.document?.trim() || null,
            status: AuthThirdStatus.ACTIVE,
            scopeNote: dto.note ?? null,
          },
          manager,
        );

      let created: AuthThirdPartyEntity;
      try {
        created = await createGrant();
      } catch (error) {
        // La comprobación de arriba y el INSERT no son atómicos: dos altas simultáneas
        // del mismo par pasan las dos y una choca con `UQ_auth_third_party_active_grant`.
        // Eso es el mismo 409 que el chequeo, no un 500 (R3-004).
        if (isUniqueViolation(error)) {
          throw new ConflictException('Ese usuario ya tiene un acceso temporal en este vínculo');
        }
        throw error;
      }

      await this.audit.record(
        {
          bondId,
          userId: ownerId,
          grantId: created.id,
          action: THIRD_PARTY_AUDIT_ACTIONS.GRANT,
          newValue: {
            userId,
            endDate: created.endDate,
            relationship: created.relationship,
          },
          detail: dto.note ?? null,
        },
        manager,
      );

      return { grant: created, invitedUserId: provisional ? userId : null };
    });

    if (invitedUserId) {
      try {
        await this.mailer.sendMail(
          thirdPartyInviteMail({
            email: dto.email,
            password: provisional!.password,
            accessEnd: dto.accessEnd,
          }),
        );
      } catch (error) {
        // R3-001/R4-001: el correo sale DESPUÉS del commit. Nada de I/O externo con la
        // transacción abierta, y si el commit falla no se enviaron credenciales. Si el
        // envío falla, la cuenta recién creada no sirve sin credenciales: se compensa
        // borrándola (el DELETE del user cascadea membresía y grant). El audit queda
        // como registro del intento.
        const reverted = await this.revertInvitedAccount(invitedUserId);
        this.logger.error(
          `No se pudo enviar la invitación a ${dto.email}; cuenta ${reverted ? 'revertida' : 'NO revertida'}: ${describeError(error)}`,
        );
        if (!reverted) {
          // REG-001: la compensación falló, así que la cuenta SÍ existe. El mensaje no
          // puede decir "no quedó creado" ni invitar a reintentar el alta (chocaría con
          // el 409 del grant): el estado real necesita intervención.
          throw new BadGatewayException(
            'La cuenta quedó creada pero el mail con las credenciales no salió. No reintentes el alta: pedile a un administrador que elimine la cuenta o reintente el envío.',
          );
        }
        throw new BadGatewayException(
          'No se pudo enviar el mail con las credenciales; el acceso no quedó creado. Reintentá.',
        );
      }
    } else {
      // Después del commit y best-effort: el acceso ya es real, así que un aviso que no
      // sale no puede deshacerlo. Se loguea y se sigue.
      try {
        await this.mailer.sendMail(
          thirdPartyNoticeMail({ email: dto.email, accessEnd: grant.endDate }),
        );
      } catch (error) {
        this.logger.warn(
          `Acceso temporal otorgado a ${dto.email} pero el aviso no salió: ${describeError(error)}`,
        );
      }
    }

    const names = await this.members.findMemberNames(bondId);
    return this.toResponse(grant, names);
  }

  /**
   * S2/D2 · revierte la cuenta recién invitada cuando el correo no sale.
   *
   * El `DELETE` del `user` cascadea `bond_member` y `auth_third_party`, así que no hay
   * que borrar tres tablas a mano ni arriesgar una compensación a medias. El registro de
   * audit del intento se conserva: documenta que se intentó, no que el acceso existió.
   * Devuelve `false` si la compensación también falló, para que el error lo diga.
   */
  private async revertInvitedAccount(userId: string): Promise<boolean> {
    try {
      await this.grants.transaction(async (manager) => {
        await manager.getRepository(UserEntity).delete({ id: userId });
      });
      return true;
    } catch (error) {
      this.logger.error(`No se pudo revertir la cuenta ${userId}: ${describeError(error)}`);
      return false;
    }
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
   * Revocación anticipada (D3). El grant deja de autorizar en cuanto exista el
   * chokepoint de T3, que es lo que mira `status`. **Hoy la fila de `bond_member` sigue
   * autorizando por sí sola** (`isActiveBondForMember` repartido en cada servicio), así
   * que la revocación surte efecto pleno cuando T3 entre, no antes; el registro de
   * membresía se deja como historia del vínculo, no como permiso.
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

      // Sin esto la revocación es cosmética: la autorización vigente de todo el resto
      // del backend es `isActiveBondForMember`, así que el tercero conserva el vínculo
      // aunque el `DELETE` responda 200 (R1-001, R3-001, R4-001 — tres lentes de la
      // review nativa coincidieron). Cerrar la membresía es lo que hace efectiva la baja;
      // volver a otorgar el acceso la reabre (ver createForOwner).
      await manager.getRepository(BondMemberEntity).update(
        { bondId: saved.bondId, userId: saved.userId },
        { leftAt: now },
      );

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
    const current =
      grant.status === AuthThirdStatus.ACTIVE && grant.endDate < today
        ? await this.grants.transaction(async (manager) =>
            this.expireIfLapsed(grant, today, viewerId, manager),
          )
        : grant;

    const names = await this.members.findMemberNames(current.bondId);
    return this.toResponse(current, names);
  }

  // ── Reglas compartidas ────────────────────────────────────────────────

  /**
   * Contraseña provisional + su hash, con las MISMAS 10 rondas que el resto del repo
   * (`auth.service`, `admin.service`): bajar el costo acá sería un hash más débil que el
   * del resto de las cuentas.
   */
  private async provisionalCredentials(): Promise<{
    password: string;
    passwordHash: string;
  }> {
    const password = generateTemporaryPassword();
    return { password, passwordHash: await bcrypt.hash(password, 10) };
  }

  /**
   * Crea la cuenta del tercero con el manager de la transacción (S1, D2).
   *
   * `mustChangePassword: true` porque la contraseña la eligió el sistema: al entrar, el
   * guard la manda a cambiarla (S2).
   */
  private async createAccount(
    manager: EntityManager,
    email: string,
    passwordHash: string,
  ): Promise<string> {
    const repo = manager.getRepository(UserEntity);
    const created = await repo.save(
      repo.create({
        email,
        passwordHash,
        systemRole: SystemRole.USER,
        isActive: true,
        mustChangePassword: true,
      }),
    );
    return created.id;
  }

  /** Sólo un progenitor ACTIVO del vínculo administra accesos (S3/S7). */
  private async assertProgenitor(
    bondId: string,
    callerId: string,
    cache?: BondAccessCache,
  ): Promise<void> {
    const access = await this.access.assertBondAccess(bondId, callerId, cache);
    if (access.role !== BondMemberRole.PROGENITOR) {
      throw new ForbiddenException(
        'Sólo un progenitor del vínculo puede administrar accesos temporales',
      );
    }
  }

  private async requireOwnedGrant(
    grantId: string,
    ownerId: string,
  ): Promise<AuthThirdPartyEntity> {
    const grant = await this.grants.findById(grantId);
    if (!grant || grant.authorizedBy !== ownerId) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    // Cambiar o revocar exige seguir siendo progenitor ACTIVO del vínculo: ser el dueño
    // del grant no alcanza si esa persona ya dejó el vínculo o cambió de rol (F3 de la
    // verificación independiente). Es la única guarda el día que exista un flujo de
    // salida o degradación de miembro. Pasa por el chokepoint de T3, que además sabe de
    // grants vencidos.
    await this.assertProgenitor(grant.bondId, ownerId, new BondAccessCache());
    return grant;
  }

  /**
   * Vencimiento perezoso de UNA fila, con el manager que recibe.
   *
   * No hace nada si la fila no está `active` o si todavía no venció, así que llamarlo
   * dos veces es seguro: la segunda no toca la DB ni escribe audit.
   */
  private async expireIfLapsed(
    row: AuthThirdPartyEntity,
    today: string,
    actorId: string,
    manager: EntityManager,
  ): Promise<AuthThirdPartyEntity> {
    if (row.status !== AuthThirdStatus.ACTIVE || row.endDate >= today) return row;

    const repo = manager.getRepository(AuthThirdPartyEntity);
    // UPDATE condicional, no `save` de una fila leída antes: si una revocación commiteó
    // en el medio, pisar `revoked` con `expired` borraría `revokedAt`/`revokedBy` y
    // cambiaría el resultado de la revocación (R4-004).
    const updated = await repo.update(
      { id: row.id, status: AuthThirdStatus.ACTIVE },
      { status: AuthThirdStatus.EXPIRED },
    );
    if (!updated.affected) return row;

    const saved = { ...row, status: AuthThirdStatus.EXPIRED } as AuthThirdPartyEntity;

    // Vencer también cierra el vínculo: si no, el acceso seguiría abierto por
    // `isActiveBondForMember` (mismo defecto que la revocación).
    await manager.getRepository(BondMemberEntity).update(
      { bondId: saved.bondId, userId: saved.userId },
      { leftAt: this.clock.now() },
    );

    await this.audit.record(
      {
        bondId: saved.bondId,
        userId: actorId,
        grantId: saved.id,
        action: THIRD_PARTY_AUDIT_ACTIONS.EXPIRE,
        oldValue: { status: AuthThirdStatus.ACTIVE },
        newValue: { status: AuthThirdStatus.EXPIRED },
        detail: `endDate ${saved.endDate}`,
      },
      manager,
    );
    return saved;
  }

  /** D3: la fecha de vencimiento es obligatoria y no puede estar en el pasado. */
  private assertAccessEnd(accessEnd: string, today: string): void {
    if (!isCalendarDate(accessEnd)) {
      // `2026-02-30` pasa la regex del DTO y compara bien como string, pero Postgres la
      // rechaza y el error salía como 500 en vez de 400 (R3-003).
      throw new BadRequestException('accessEnd must be a real calendar date');
    }
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
      firstName: grant.firstName,
      lastName: grant.lastName,
      phone: grant.phone,
      document: grant.document,
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

/**
 * Alfabeto de la contraseña provisional: sin `I`, `l`, `O`, `0` ni `1`, que se confunden
 * al tipear un código que llegó por mail. Quedan mayúsculas, minúsculas y dígitos.
 */
const PROVISIONAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Largo de la provisional: dentro del rango 12–16 que pide D2. */
const PROVISIONAL_PASSWORD_LENGTH = 14;

/**
 * Contraseña provisional desde `crypto.randomBytes`.
 *
 * Los bytes que caen por encima del mayor múltiplo del alfabeto se descartan: con un `%`
 * directo las primeras entradas del alfabeto saldrían más seguido, porque 256 no es
 * múltiplo de su largo.
 */
function generateTemporaryPassword(): string {
  const limit = 256 - (256 % PROVISIONAL_ALPHABET.length);
  let password = '';
  while (password.length < PROVISIONAL_PASSWORD_LENGTH) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) continue;
      password += PROVISIONAL_ALPHABET[byte % PROVISIONAL_ALPHABET.length];
      if (password.length === PROVISIONAL_PASSWORD_LENGTH) break;
    }
  }
  return password;
}

/** Mensaje de un error para un log, sin arrastrar el objeto entero (ni credenciales). */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** ¿`YYYY-MM-DD` es una fecha que existe? `2026-02-30` no. */
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Violación del índice único parcial: dos grants `active` para el mismo par. */
function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { driverError?: { code?: string } })?.driverError?.code;
  return code === '23505';
}
