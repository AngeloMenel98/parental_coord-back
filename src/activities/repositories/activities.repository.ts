import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, IsNull, QueryDeepPartialEntity, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';
import { NotificationRepository } from '../../notifications/repositories/notification.repository';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { InitialTransition } from '../activity-transition.map';

export interface ComplianceRow {
  assignedTo: string;
  total: string;
  completed: string;
}

/** Side-effect columns a transition may write (REQ-TX-1). */
export type ApplyTransitionFields = Partial<
  Pick<
    ActivityEntity,
    | 'confirmedAt'
    | 'cancelledAt'
    | 'cancelledBy'
    | 'declinedAt'
    | 'declinedReason'
    | 'completedAt'
    | 'deadline'
    | 'deletedAt'
  >
>;

/** Notification written INSIDE the transition tx (T7 coordinator, REQ-ACTOR-3). */
export interface ApplyTransitionNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
}

/** Plain DTO (no typeorm types leak to the service). `null` return = CAS/guard miss. */
export interface ApplyTransitionInput {
  id: string;
  expectedFrom: ActivityStatus;
  expectedVersion: number;
  nextStatus: ActivityStatus;
  fields?: ApplyTransitionFields;
  outbox: {
    bondId: string;
    eventType: string;
    payload: Record<string, unknown>;
  };
  /** Optional companion write in the SAME tx (e.g. coordinator overdue notice). */
  notification?: ApplyTransitionNotification;
}

/** Create INSERT exception (design D3): v1 + one outbox row. */
export interface InsertWithInitialTransitionInput {
  row: DeepPartial<ActivityEntity>;
  initial: InitialTransition;
  payload: Record<string, unknown>;
}

@Injectable()
export class ActivitiesRepository extends BaseRepository<ActivityEntity> {
  constructor(
    @InjectRepository(ActivityEntity)
    private readonly activityRepo: Repository<ActivityEntity>,

    private readonly notiRepo: NotificationRepository,
    private readonly outboxRepo: OutboxEventRepository,
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

  /**
   * Primitive atómico de transición (REQ-TX-1/2/3, design D3).
   *
   * Una sola tx: `SELECT … FOR UPDATE` → guardas (`deleted_at`, `expectedFrom`,
   * `expectedVersion`) → status/campos + `version++` → `outbox_event` en la MISMA
   * tx. Devuelve `null` en cualquier miss (sin save, sin outbox) — el service
   * interpreta ese `null` como 409 (user) o no-op (system).
   *
   * `manager?` sigue el patrón `createInTx`/`updateFields`: con él, participa en
   * una tx ya abierta por el caller; sin él, el repositorio abre la suya.
   */
  async applyTransition(
    input: ApplyTransitionInput,
    manager?: EntityManager,
  ): Promise<ActivityEntity | null> {
    const run = async (em: EntityManager): Promise<ActivityEntity | null> => {
      const row = await em
        .createQueryBuilder(ActivityEntity, 'a')
        .setLock('pessimistic_write')
        .where('a.id = :id', { id: input.id })
        .getOne();

      if (
        !row ||
        row.deletedAt != null ||
        row.status !== input.expectedFrom ||
        row.version !== input.expectedVersion
      ) {
        return null;
      }

      const nextVersion = row.version + 1;
      row.status = input.nextStatus;
      row.version = nextVersion;
      if (input.fields) {
        Object.assign(row, input.fields);
      }

      const saved = await em.getRepository(ActivityEntity).save(row);

      await this.outboxRepo.insert(
        {
          activityId: input.id,
          bondId: input.outbox.bondId,
          eventType: input.outbox.eventType,
          aggregateVersion: nextVersion,
          payload: input.outbox.payload,
        },
        em,
      );

      if (input.notification) {
        await this.notiRepo.createForActivity(
          {
            userId: input.notification.userId,
            bondId: input.outbox.bondId,
            type: input.notification.type,
            title: input.notification.title,
            body: input.notification.body,
            refEntityId: input.id,
          },
          em,
        );
      }

      return saved;
    };

    return manager ? run(manager) : this.transaction(run);
  }

  /**
   * INSERT inicial de `create` (excepción documentada, design D3): la fila nace
   * en el status inicial del mapa con `version = 1` y, en la MISMA tx, se escribe
   * UNA fila de outbox (`aggregate_version = 1`).
   */
  async insertWithInitialTransition(
    input: InsertWithInitialTransitionInput,
    manager?: EntityManager,
  ): Promise<ActivityEntity> {
    const run = async (em: EntityManager): Promise<ActivityEntity> => {
      const repo = em.getRepository(ActivityEntity);
      const entity = repo.create({
        ...input.row,
        status: input.initial.status,
        version: 1,
      });
      const saved = await repo.save(entity);

      await this.outboxRepo.insert(
        {
          activityId: saved.id,
          bondId: saved.bondId,
          eventType: input.initial.event,
          aggregateVersion: 1,
          payload: input.payload,
        },
        em,
      );

      return saved;
    };

    return manager ? run(manager) : this.transaction(run);
  }

  /**
   * Reconciliation source of truth (REQ-TIMER-4, design D9). Returns the live
   * activities whose timer should already have fired:
   * `assigned` past its response `deadline`, `assisting` past `scheduled_start`,
   * `in_progress` past `COALESCE(scheduled_end, scheduled_start)`. Soft-deleted
   * rows are excluded; results are bounded and ordered by soonest anchor.
   */
  async findDueForTransition(now: Date, limit = 100): Promise<ActivityEntity[]> {
    return this.activityRepo
      .createQueryBuilder('a')
      .where('a.deleted_at IS NULL')
      .andWhere(
        `(
          (a.status = :assigned AND a.deadline IS NOT NULL AND a.deadline <= :now)
          OR (a.status = :assisting AND a.scheduled_start IS NOT NULL AND a.scheduled_start <= :now)
          OR (a.status = :inProgress AND COALESCE(a.scheduled_end, a.scheduled_start) IS NOT NULL
              AND COALESCE(a.scheduled_end, a.scheduled_start) <= :now)
        )`,
        {
          now,
          assigned: ActivityStatus.ASSIGNED,
          assisting: ActivityStatus.ASSISTING,
          inProgress: ActivityStatus.IN_PROGRESS,
        },
      )
      .addOrderBy('a.deadline', 'ASC', 'NULLS LAST')
      .addOrderBy('a.scheduled_start', 'ASC', 'NULLS LAST')
      .addOrderBy('a.scheduled_end', 'ASC', 'NULLS LAST')
      .limit(limit)
      .getMany();
  }
}
