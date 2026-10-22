import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { NotificationEntity } from '../entities/notification.entity';

/** Entrada genérica de `create` (REQ-SUB-5, D11). */
export interface CreateNotificationInput {
  userId: string;
  bondId: string;
  type: string;
  title: string;
  body: string;
  refEntityType: string;
  refEntityId?: string | null;
}

/** Filtros del listado de notificaciones del usuario (read path). */
export interface ListNotificationsOptions {
  /** Tamaño de página (1..100, validado en el DTO). */
  limit: number;
  /** Desplazamiento (>= 0, validado en el DTO). */
  offset: number;
  /** Sólo no leídas. */
  unreadOnly?: boolean;
  /** Acota a un bond; las notificaciones sin bond quedan fuera. */
  bondId?: string;
}

/** Página de notificaciones + total del mismo conjunto filtrado. */
export interface ListNotificationsResult {
  items: NotificationEntity[];
  total: number;
}

/**
 * Acceso a `notification` — la tabla raíz de este módulo.
 *
 * Espeja el patrón probado de `ActivitiesAuditRepository.record(entry, manager?)`:
 * el `manager` opcional es lo que permite escribir la notificación dentro de
 * la MISMA transacción que la fila de `activity` (T2+ lo usa en create/cancel/
 * decline); sin él, escribe por la conexión normal.
 */
@Injectable()
export class NotificationRepository extends BaseRepository<NotificationEntity> {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifRepo: Repository<NotificationEntity>,
  ) {
    super(notifRepo);
  }

  /**
   * Crea una notificación GENÉRICA (REQ-SUB-5, D11).
   *
   * El `refEntityType` es libre (antes estaba hardcodeado a `'activity'`), lo que
   * habilita avisos de otros dominios (p. ej. `webhook_disabled`) sin filas
   * `coordinador`. Mismo patrón `manager?` que el resto de repos.
   *
   * ⚠ Nota: se llama `createNotification` (no `create`) porque `BaseRepository`
   * extiende `Repository`, cuyo `create()` ya existe con otra firma; sobrecargarlo
   * rompería el tipado estricto (TS2416). El contrato funcional de D11 se mantiene.
   */
  async createNotification(
    input: CreateNotificationInput,
    manager?: EntityManager,
  ): Promise<NotificationEntity> {
    const repo = manager ? manager.getRepository(NotificationEntity) : this.notifRepo;
    return repo.save(
      repo.create({
        userId: input.userId,
        bondId: input.bondId,
        type: input.type,
        title: input.title,
        body: input.body,
        refEntityType: input.refEntityType,
        refEntityId: input.refEntityId ?? null,
        isRead: false,
      }),
    );
  }

  /**
   * Notificación ligada a una `activity` (wrapper delgado sobre
   * {@link createNotification} con `refEntityType='activity'`): mantiene intactos
   * los call-sites existentes.
   */
  async createForActivity(
    input: {
      userId: string;
      bondId: string;
      type: string;
      title: string;
      body: string;
      refEntityId: string;
    },
    manager?: EntityManager,
  ): Promise<NotificationEntity> {
    return this.createNotification({ ...input, refEntityType: 'activity' }, manager);
  }

  // ── Read path (notifications-read-path) ───────────────────────────────────

  /**
   * Lista las notificaciones del USUARIO, más recientes primero.
   *
   * El scoping por `user_id` va SIEMPRE primero y es la única garantía de
   * aislamiento: ninguna fila ajena puede entrar en `items` ni en `total`.
   *
   * Orden determinista: `created_at DESC, id DESC` — el `id` desempata las
   * filas que comparten `created_at` para que la paginación sea estable (la
   * fila repetida o saltada no puede ocurrir al paginar).
   *
   * `bond_id` es NULLABLE ⇒ con `bondId` las notificaciones SIN bond quedan
   * fuera (igualdad simple). NUNCA `COALESCE`: `COALESCE(bond_id, :bondId)`
   * reintroduciría las notificaciones sin bond y rompería el filtro.
   */
  async listForUser(
    userId: string,
    options: ListNotificationsOptions,
  ): Promise<ListNotificationsResult> {
    const [items, total] = await Promise.all([
      this.scopedQuery(userId, options)
        .orderBy('n.created_at', 'DESC')
        .addOrderBy('n.id', 'DESC')
        .limit(options.limit)
        .offset(options.offset)
        .getMany(),
      this.scopedQuery(userId, options).getCount(),
    ]);

    return { items, total };
  }

  /**
   * Cuenta las no leídas del usuario (`COUNT(*)` equivalente vía `getCount()`).
   *
   * Con `bondId` sólo cuenta las de ese bond; las notificaciones sin bond
   * (`bond_id IS NULL`) quedan fuera (misma semántica que el listado).
   */
  async countUnread(userId: string, bondId?: string): Promise<number> {
    const qb = this.notifRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.is_read = false');

    if (bondId) {
      qb.andWhere('n.bond_id = :bondId', { bondId });
    }

    return qb.getCount();
  }

  /**
   * Marca UNA notificación como leída.
   *
   * `UPDATE … SET is_read = true WHERE user_id = :userId AND id = :id` es
   * ATÓMICO (no hay read-modify-write) y su alcance es doble: el `user_id`
   * impide tocar filas ajenas y el `affected` distingue "no existe" de
   * "existe pero es de otro" — indistinguibles a propósito (404, sin oráculo
   * de existencia).
   *
   * @returns nº de filas afectadas (0 = no existe o es ajena).
   */
  async markRead(id: string, userId: string): Promise<number> {
    const result = await this.notifRepo
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ isRead: true })
      .where('user_id = :userId', { userId })
      .andWhere('id = :id', { id })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Marca TODAS las no leídas del usuario como leídas.
   *
   * El `AND is_read = false` hace que `affected` sea el nº de filas NUEVAMENTE
   * leídas (re-marcar lo ya leído no cuenta) y que la operación sea idempotente.
   * Con `bondId` sólo se tocan las de ese bond.
   */
  async markAllRead(userId: string, bondId?: string): Promise<number> {
    const qb = this.notifRepo
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ isRead: true })
      .where('user_id = :userId', { userId })
      .andWhere('is_read = false');

    if (bondId) {
      qb.andWhere('bond_id = :bondId', { bondId });
    }

    const result = await qb.execute();
    return result.affected ?? 0;
  }

  /**
   * QueryBuilder con el scoping por `user_id` + los filtros opcionales.
   *
   * Se construye uno por consulta (filas y `total`) para que el `COUNT` no
   * arrastre el `ORDER BY` de la página.
   */
  private scopedQuery(userId: string, options: { unreadOnly?: boolean; bondId?: string }) {
    const qb = this.notifRepo.createQueryBuilder('n').where('n.user_id = :userId', { userId });

    if (options.unreadOnly) {
      qb.andWhere('n.is_read = false');
    }

    if (options.bondId) {
      qb.andWhere('n.bond_id = :bondId', { bondId: options.bondId });
    }

    return qb;
  }
}
