import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';

export interface BondMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
}

export interface ComplianceRow {
  assignedTo: string;
  total: string;
  completed: string;
}

@Injectable()
export class ActivitiesRepository extends BaseRepository<ActivityEntity> {
  constructor(
    @InjectRepository(ActivityEntity)
    private readonly activityRepo: Repository<ActivityEntity>,
  ) {
    super(activityRepo);
  }

  /**
   * Returns active bond members with their personal data.
   * Raw query joins bond_member → user → personal_data.
   */
  async findActiveBondMembers(bondId: string): Promise<BondMemberRow[]> {
    return this.activityRepo.manager
      .createQueryBuilder()
      .select('bm.user_id', 'userId')
      .addSelect('pd.first_name', 'firstName')
      .addSelect('pd.last_name', 'lastName')
      .from('bond_member', 'bm')
      .innerJoin('user', 'u', 'u.id = bm.user_id')
      .innerJoin('personal_data', 'pd', 'pd.user_id = u.id')
      .where('bm.bond_id = :bondId', { bondId })
      .andWhere('bm.left_at IS NULL')
      .getRawMany<BondMemberRow>();
  }

  /**
   * Aggregates activity counts per assignee for a given bond and date range.
   * Uses PostgreSQL FILTER clause for completed count.
   */
  async countActivitiesByAssignee(
    bondId: string,
    startOfMonth: Date,
    endOfMonth: Date,
  ): Promise<ComplianceRow[]> {
    return (
      this.activityRepo
        .createQueryBuilder('a')
        .select('a.assigned_to', 'assignedTo')
        .addSelect('COUNT(*)', 'total')
        .addSelect(`COUNT(*) FILTER (WHERE a.status IN (:...doneStatuses))`, 'completed')
        .where('a.bond_id = :bondId', { bondId })
        .andWhere('a.scheduled_start >= :startOfMonth', { startOfMonth })
        .andWhere('a.scheduled_start <= :endOfMonth', { endOfMonth })
        .andWhere('a.assigned_to IS NOT NULL')
        // 🔴 Una actividad eliminada (`deleted_at`) no cuenta para el cumplimiento:
        // el porcentaje es de lo que el usuario tiene PENDIENTE, no de lo que règles
        // y luego escondiste.
        .andWhere('a.deleted_at IS NULL')
        .setParameters({
          doneStatuses: [ActivityStatus.DONE],
        })
        .groupBy('a.assigned_to')
        .getRawMany<ComplianceRow>()
    );
  }

  /**
   * Returns all activities of a bond ordered by scheduled_start (nulls last)
   * asc → deadline (nulls last) asc → created_at asc.
   *
   * 🔴 Filtra `deleted_at IS NULL`: es una de las CUATRO consultas que deben
   * excluir las eliminadas por "Eliminar".
   */
  async findByBondIdOrdered(bondId: string): Promise<ActivityEntity[]> {
    return this.activityRepo
      .createQueryBuilder('a')
      .where('a.bond_id = :bondId', { bondId })
      .andWhere('a.deleted_at IS NULL')
      .addOrderBy('a.scheduled_start IS NULL', 'ASC')
      .addOrderBy('a.scheduled_start', 'ASC', 'NULLS LAST')
      .addOrderBy('a.deadline IS NULL', 'ASC')
      .addOrderBy('a.deadline', 'ASC', 'NULLS LAST')
      .addOrderBy('a.created_at', 'ASC')
      .getMany();
  }

  /**
   * Lectura de RUTA DE USUARIO: excluye las eliminadas, así que después de
   * "Eliminar" el detalle responde 404 (cuarta de las cuatro consultas).
   */
  async findById(id: string): Promise<ActivityEntity | null> {
    return this.activityRepo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  /**
   * Lectura de RUTA DE SISTEMA: sí incluye las eliminadas.
   *
   * Existe sólo para `restore` y `undo-decline`, que por definición tienen que
   * encontrar una fila que las rutas de usuario ya no ven. Si `findById` no lo
   * hiciera, deshacer una eliminación sería imposible por construcción.
   */
  async findByIdIncludingDeleted(id: string): Promise<ActivityEntity | null> {
    return this.activityRepo.findOne({ where: { id } });
  }

  async markCompleted(id: string, now: Date): Promise<{ status: string; completedAt: string }> {
    const res = await this.activityRepo
      .createQueryBuilder()
      .update(ActivityEntity)
      .set({
        status: ActivityStatus.DONE,
        completedAt: () => 'COALESCE(completed_at, :now)',
        updatedAt: () => 'now()',
      })
      .where('id = :id', { id })
      .setParameters({ now })
      .returning(['status', 'completedAt'])
      .execute();
    const row = res.raw?.[0] as { status: string; completed_at: Date | string } | undefined;
    if (!row) {
      throw new NotFoundException('Activity not found');
    }
    return { status: row.status, completedAt: new Date(row.completed_at).toISOString() };
  }

  async markOverdue(): Promise<number> {
    const result = await this.activityRepo
      .createQueryBuilder()
      .update(ActivityEntity)
      .set({ status: ActivityStatus.OVERDUE })
      .where('assigned_to IS NOT NULL')
      .andWhere('completed_at IS NULL')
      .andWhere("status NOT IN ('done', 'overdue')")
      // 🔴 Quinta condición y no una más: una actividad eliminada no debe "vencer"
      // ni reaparecer por la vía del scheduler. Sin esto, borrar a las 10:00 una
      // actividad vencida la dejaría marcada `overdue` en la fila oculta.
      .andWhere('deleted_at IS NULL')
      .andWhere('scheduled_start + notif_after <= now()')
      .execute();
    return result.affected ?? 0;
  }
}
