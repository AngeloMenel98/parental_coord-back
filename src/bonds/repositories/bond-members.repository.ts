import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, IsNull, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { BondMemberEntity, BondMemberRole } from '../entities/bond-member.entity';

export interface ComplianceMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  total: number;
  completed: number;
}

/**
 * Una fila de tenencia: el miembro y, si es tercero, su grant `active` vigente o nulo.
 *
 * Es la materia prima de `BondAccessService.resolveBondAccess` (T3): una sola consulta
 * resuelve membresía y permiso, en vez de un `exists` por servicio.
 */
export interface BondAccessRow {
  userId: string;
  role: BondMemberRole;
  leftAt: Date | string | null;
  grantId: string | null;
  grantStatus: string | null;
  grantStart: string | null;
  grantEnd: string | null;
  grantedBy: string | null;
}

@Injectable()
export class BondMembersRepository extends BaseRepository<BondMemberEntity> {
  constructor(
    @InjectRepository(BondMemberEntity)
    private readonly bondMemberRepo: Repository<BondMemberEntity>,
  ) {
    super(bondMemberRepo);
  }

  /** Miembro de un bond por usuario o `null` (chequeo de duplicado en admin). */
  async findOneByBondAndUser(bondId: string, userId: string): Promise<BondMemberEntity | null> {
    return this.bondMemberRepo.findOneBy({ bondId, userId });
  }

  /**
   * Miembro + su grant vivo, en UNA consulta (T3).
   *
   * El `LEFT JOIN` con `auth_third_party` filtra por `status = 'active'` en la condición,
   * no en el `WHERE`: así un tercero sin grant sigue devolviendo su fila (con `grantId`
   * nulo) en vez de desaparecer y confundirse con "no es miembro". El vencimiento por
   * fecha lo decide el servicio, que es quien tiene el reloj.
   */
  async findAccessRow(bondId: string, userId: string): Promise<BondAccessRow | null> {
    const row = await this.bondMemberRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('bm.role', 'role')
      .addSelect('bm.left_at', 'leftAt')
      .addSelect('g.id', 'grantId')
      .addSelect('g.status', 'grantStatus')
      .addSelect('g.start_date', 'grantStart')
      .addSelect('g.end_date', 'grantEnd')
      .addSelect('g.authorized_by', 'grantedBy')
      .from('bond_member', 'bm')
      .leftJoin(
        'auth_third_party',
        'g',
        "g.bond_id = bm.bond_id AND g.user_id = bm.user_id AND g.status = 'active'",
      )
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.user_id = :userId', { userId })
      .getRawOne<BondAccessRow>();
    return row ?? null;
  }

  /**
   * Coordinador parental ACTIVO del bond o `null` (design D2, REQ-ACTOR-1/3).
   * "Activo" = `left_at IS NULL`. Se usa para notificar el paso a `overdue` (T7);
   * `null` es un caso normal (skip de notificación, no un error).
   */
  async findCoordinator(bondId: string): Promise<BondMemberEntity | null> {
    return this.bondMemberRepo.findOne({
      where: { bondId, role: BondMemberRole.COORDINATOR, leftAt: IsNull() },
    });
  }

  /** Alta en lote de miembros (admin.service `createBond`: create[] + save[]). */
  async createAndSaveMany(items: DeepPartial<BondMemberEntity>[]): Promise<BondMemberEntity[]> {
    const members = items.map((item) => this.bondMemberRepo.create(item));
    return this.bondMemberRepo.save(members);
  }

  /**
   * IDs de los miembros ACTIVOS del bond (REQ-3: recipients del gateway realtime).
   *
   * Lean a propósito: sólo `bond_id` + `left_at IS NULL` — sin JOINs ni métricas
   * de compliance. NO reutiliza `findActiveMembersWithActStats`: ese método exige
   * un rango de fechas, INNER JOINa `personal_data` (descartaría miembros sin
   * perfil) y calcula estadísticas innecesarias para resolver destinatarios.
   */
  async findActiveMemberIds(bondId: string): Promise<string[]> {
    const rows = await this.bondMemberRepo
      .createQueryBuilder('bm')
      .select('bm.user_id', 'userId')
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.left_at IS NULL')
      .getRawMany<{ userId: string }>();
    return rows.map((row) => row.userId);
  }

  /**
   * El nombre para mostrar de cada miembro del vínculo (id → nombre).
   *
   * UNA consulta por página: los nombres de "solicitado por", "contraparte" y
   * "aprobado por" salen de acá. Preguntarlo por gasto sería un N+1.
   *
   * ⚠ NO filtra por `left_at`: el nombre es un dato de la persona, no del vínculo.
   * Un ex-miembro que aprobó un gasto sigue siendo quien lo aprobó. Lo que deja
   * de ser contraparte es otra cosa (`selectCounterpartId` usa la lista de
   * ACTIVOS), no deja de tener nombre.
   *
   * El `LEFT JOIN` con `personal_data` es a propósito: un usuario sin perfil
   * queda sin nombre (y el front lo muestra por id), pero NO desaparece de la
   * lista — un `INNER JOIN` lo haría, y con él se iría el nombre de un
   * miembro que sí lo tiene.
   */
  async findMemberNames(bondId: string): Promise<Map<string, string>> {
    const rows = await this.bondMemberRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('pd.first_name', 'firstName')
      .addSelect('pd.last_name', 'lastName')
      .from('bond_member', 'bm')
      .leftJoin('personal_data', 'pd', 'pd.user_id = bm.user_id')
      .where('bm.bond_id = :bondId', { bondId })
      .getRawMany<{ userId: string; firstName: string | null; lastName: string | null }>();

    const names = new Map<string, string>();
    for (const row of rows) {
      const name = [row.firstName, row.lastName]
        .filter((part) => !!part && part.trim())
        .join(' ')
        .trim();
      if (name) names.set(row.userId, name);
    }
    return names;
  }

  async findActiveMembersWithActStats(
    bondId: string,
    from: Date,
    to: Date,
  ): Promise<ComplianceMemberRow[]> {
    return this.bondMemberRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('pd.first_name', 'firstName')
      .addSelect('pd.last_name', 'lastName')
      .addSelect('COUNT(a.id)::int', 'total')
      .addSelect("COUNT(a.id) FILTER (WHERE a.status = 'done')::int", 'completed')
      .from('bond_member', 'bm')
      .innerJoin('personal_data', 'pd', 'pd.user_id = bm.user_id')
      .leftJoin(
        'activity',
        'a',
        'a.assigned_to = bm.user_id AND a.bond_id = bm.bond_id AND a.scheduled_start >= :from AND a.scheduled_start < :to',
        { from, to },
      )
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.left_at IS NULL')
      .groupBy('bm.user_id')
      .addGroupBy('pd.first_name')
      .addGroupBy('pd.last_name')
      .getRawMany<ComplianceMemberRow>();
  }
}
