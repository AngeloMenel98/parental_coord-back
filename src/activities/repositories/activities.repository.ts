import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, IsNull, QueryDeepPartialEntity, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';
import { ActsAuditRepository, ACT_AUDIT_ACTIONS } from './activities-audit.repository';
import { NotificationRepository } from '../../notifications/repositories/notification.repository';

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

    private readonly auditRepo: ActsAuditRepository,
    private readonly notiRepo: NotificationRepository,
  ) {
    super(activityRepo);
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
    return this.activityRepo
      .createQueryBuilder('a')
      .select('a.assigned_to', 'assignedTo')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE a.status IN (:...doneStatuses))`, 'completed')
      .where('a.bond_id = :bondId', { bondId })
      .andWhere('a.scheduled_start >= :startOfMonth', { startOfMonth })
      .andWhere('a.scheduled_start <= :endOfMonth', { endOfMonth })
      .andWhere('a.assigned_to IS NOT NULL')
      .andWhere('a.deleted_at IS NULL')
      .setParameters({
        doneStatuses: [ActivityStatus.DONE],
      })
      .groupBy('a.assigned_to')
      .getRawMany<ComplianceRow>();
  }

  /**
   * Returns all activities of a bond ordered by scheduled_start (nulls last)
   * asc → deadline (nulls last) asc → created_at asc.
   */
  async findByBondIdOrdered(bondId: string): Promise<ActivityEntity[]> {
    return this.activityRepo
      .createQueryBuilder('a')
      .where('a.bond_id = :bondId', { bondId })
      .andWhere('a.deleted_at IS NULL')
      .addSelect(
        "(SELECT COALESCE(array_agg(ac.child_id ORDER BY ac.created_at), '{}'::uuid[]) FROM activity_child ac WHERE ac.activity_id = a.id)",
        'childrenIds',
      )
      .addOrderBy('a.scheduled_start IS NULL', 'ASC')
      .addOrderBy('a.scheduled_start', 'ASC', 'NULLS LAST')
      .addOrderBy('a.deadline IS NULL', 'ASC')
      .addOrderBy('a.deadline', 'ASC', 'NULLS LAST')
      .addOrderBy('a.created_at', 'ASC')
      .getMany();
  }

  async findById(id: string): Promise<ActivityEntity | null> {
    return this.activityRepo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  async findByIdIncludingDeleted(id: string): Promise<ActivityEntity | null> {
    return this.activityRepo.findOne({ where: { id } });
  }

  /**
   * Crea una actividad dentro de una transacción abierta por `transaction()`.
   *
   * `manager` es opcional (patrón `manager?` de ActivitiesAuditRepository.record):
   * con él, la fila de `activity` participa en la MISMA transacción que
   * `activity_child` y la notificación; sin él, escribe por la conexión normal.
   */
  async createInTx(
    data: DeepPartial<ActivityEntity>,
    manager?: EntityManager,
  ): Promise<ActivityEntity> {
    const repo = manager ? manager.getRepository(ActivityEntity) : this.activityRepo;
    return repo.save(repo.create(data));
  }

  /**
   * Actualización parcial de columnas sin hidratar la fila.
   *
   * El `patch` se tipea como `QueryDeepPartialEntity<ActivityEntity>` — es el
   * tipo que `Repository.update()` ya acepta — para que los call sites de swipe
   * no necesiten ningún cast (`as any`).
   */
  async updateFields(
    id: string,
    patch: QueryDeepPartialEntity<ActivityEntity>,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(ActivityEntity) : this.activityRepo;
    await repo.update(id, patch);
  }

  async softDeleteWithAudit(activity: ActivityEntity, userId: string, now: Date): Promise<void> {
    await this.transaction(async (manager) => {
      await this.updateFields(activity.id, { deletedAt: now }, manager);
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: activity.id,
          action: ACT_AUDIT_ACTIONS.DELETE,
          oldValue: { deletedAt: null },
          newValue: { deletedAt: now.toISOString() },
          detail: `Deleted by creator; undo available for 5000ms`,
        },
        manager,
      );
    });
  }

  async cancelWithAudit(
    activity: ActivityEntity,
    userId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await this.transaction(async (manager) => {
      await this.updateFields(activity.id, {
        status: ActivityStatus.CANCELLED,
        cancelledAt: now,
        cancelledBy: userId,
      });
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: activity.id,
          action: ACT_AUDIT_ACTIONS.CANCEL,
          oldValue: { status: activity.status },
          newValue: {
            status: ActivityStatus.CANCELLED,
            cancelledAt: now.toISOString(),
            cancelledBy: userId,
          },
          detail: reason,
        },
        manager,
      );

      if (activity.assignedTo && activity.assignedTo !== userId) {
        await this.notiRepo.createForActivity(
          {
            userId: activity.assignedTo,
            bondId: activity.bondId,
            type: 'activity_cancelled',
            title: activity.title,
            body: `La actividad "${activity.title}" fue cancelada. Motivo: ${reason}`,
            refEntityId: activity.id,
          },
          manager,
        );
      }
    });
  }

  async declineWithAudit(activity: ActivityEntity, userId: string, now: Date, reason: string) {
    await this.transaction(async (manager) => {
      await this.updateFields(
        activity.id,
        {
          status: ActivityStatus.NOT_ASSISTING,
          declinedAt: now,
          declinedReason: reason,
          updatedAt: now,
        },
        manager,
      );
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: activity.id,
          action: ACT_AUDIT_ACTIONS.DECLINE,
          oldValue: { status: activity.status },
          newValue: {
            status: ActivityStatus.NOT_ASSISTING,
            declinedAt: now.toISOString(),
            declinedReason: reason,
          },
          detail: reason,
        },
        manager,
      );
      if (activity.createdBy !== userId) {
        await this.notiRepo.createForActivity(
          {
            userId: activity.createdBy,
            bondId: activity.bondId,
            type: 'activity_declined',
            title: activity.title,
            body: `La actividad "${activity.title}" se marcó como "No asisto". Motivo: ${reason}`,
            refEntityId: activity.id,
          },
          manager,
        );
      }
    });
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
      .andWhere('deleted_at IS NULL')
      .andWhere('scheduled_start + notif_after <= now()')
      .execute();
    return result.affected ?? 0;
  }
}
