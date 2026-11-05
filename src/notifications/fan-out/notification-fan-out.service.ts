import { Injectable, Logger } from '@nestjs/common';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { BondsRepository } from '../../bonds/repositories/bonds.repository';
import { BondMembersRepository } from '../../bonds/repositories/bond-members.repository';
import { AppConfig } from '../../config/app-config';
import { ActivityEntity } from '../../activities/entities/activity.entity';
import { CreatedNotificationRef } from '../../realtime/dto/notification-created-message';
import { ExpensesRepository } from '../../expenses/repositories/expenses.repository';
import { selectCounterpartId } from '../../expenses/expense-counterpart';
import {
  buildRecipientIds,
  RecipientContext,
  renderNotificationText,
  resolveNotificationRule,
} from './activity-notification.map';
import {
  buildExpenseRecipientIds,
  renderExpenseNotificationText,
  resolveExpenseNotificationRule,
} from './expense-notification.map';

/**
 * Fan-out `outbox_event` → `notification` (REQ-FAN-004, y T23 para gastos).
 *
 * Es el ÚNICO consumidor de eventos que crea notificaciones. R8 prohíbe un
 * segundo transporte para gastos, así que el servicio despacha por
 * `aggregate_type` en vez de tener dos pipelines:
 *
 *   activity → `activity-notification.map`  (9 eventos, bond + miembros)
 *   expense  → `expense-notification.map`   (5 eventos, solicitante + contraparte)
 *
 * Cada rama resuelve sus datos, sus destinatarios y sus textos. Lo que se
 * comparte es el despacho: el flag de fan-out, la deduplicación por
 * `(user_id, source_event_id)` y la devolución de las filas REALMENTE creadas,
 * que es lo que después se convierte en frames `notification.created`.
 */
@Injectable()
export class NotificationFanOutService {
  private readonly logger = new Logger(NotificationFanOutService.name);
  private flagLogged = false;

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly activitiesRepository: ActivitiesRepository,
    private readonly bondsRepository: BondsRepository,
    private readonly bondMembersRepository: BondMembersRepository,
    private readonly appConfig: AppConfig,
    private readonly expensesRepository: ExpensesRepository,
  ) {}

  async handleOutboxEvent(
    event: OutboxEventEntity,
    manager: any,
  ): Promise<CreatedNotificationRef[]> {
    if (!this.isFanOutEnabled()) {
      if (!this.flagLogged) {
        this.logger.log('Notifications fan-out disabled via NOTIFICATIONS_FANOUT_ENABLED=false');
        this.flagLogged = true;
      }
      return [];
    }

    switch (event.aggregateType) {
      case 'activity':
        return this.handleActivityEvent(event, manager);
      case 'expense':
        return this.handleExpenseEvent(event, manager);
      default:
        // Un `aggregate_type` desconocido NO se interpreta como activity: el
        // `aggregate_id` es un uuid sin dueño y adivinar podría hacer que un
        // evento de otro dominio se lea como una actividad. Se ignora y se
        // deja rastro; el relay lo marca despachado igual.
        this.logger.warn(
          `Unknown aggregate_type=${String(event.aggregateType)} for event=${event.id}; skipping`,
        );
        return [];
    }
  }

  // ── Actividades ───────────────────────────────────────────────────────────

  private async handleActivityEvent(
    event: OutboxEventEntity,
    manager: any,
  ): Promise<CreatedNotificationRef[]> {
    const rule = resolveNotificationRule(event.eventType);
    if (!rule) {
      this.logger.debug(`No notification rule for event_type=${event.eventType}; skipping`);
      return [];
    }

    const activity = await this.loadActivity(event.aggregateId);
    if (!activity || activity.deletedAt) {
      this.logger.debug(
        `Activity not found or deleted for aggregateId=${event.aggregateId}; skipping notifications`,
      );
      return [];
    }

    const actorId = this.actorIdOf(event);
    const context = await this.buildRecipientContext(event.bondId, activity, actorId);
    const recipientIds = buildRecipientIds(rule, context);
    if (recipientIds.length === 0) {
      this.logger.debug(
        `No recipients resolved for event=${event.eventType}, activity=${activity.id}`,
      );
      return [];
    }

    const { title, body } = renderNotificationText(rule, {
      activityTitle: activity.title,
      scheduledStart: activity.scheduledStart,
    });

    return this.persist(recipientIds, {
      bondId: event.bondId,
      type: rule.type,
      title,
      body,
      refEntityType: 'activity',
      refEntityId: activity.id,
      sourceEventId: event.id,
      manager,
    });
  }

  // ── Gastos (T23) ──────────────────────────────────────────────────────────

  private async handleExpenseEvent(
    event: OutboxEventEntity,
    manager: any,
  ): Promise<CreatedNotificationRef[]> {
    const rule = resolveExpenseNotificationRule(event.eventType);
    if (!rule) {
      this.logger.debug(`No expense notification rule for event_type=${event.eventType}; skipping`);
      return [];
    }

    // `findAliveById` filtra `deleted_at IS NULL`: un gasto cancelado no avisa
    // nada. El evento igual queda despachado, así que no se reintenta para
    // siempre un aviso que ya no corresponde.
    const expense = await this.expensesRepository.findAliveById(event.aggregateId);
    if (!expense) {
      this.logger.debug(
        `Expense not found or cancelled for aggregateId=${event.aggregateId}; skipping notifications`,
      );
      return [];
    }

    // La contraparte sale del vínculo, no del gasto: la fila guarda quién lo
    // pidió, no quién tiene que aprobarlo. Misma función que usa la política,
    // así no puede pasar que el aprobador no reciba el aviso de lo que aprueba.
    const memberIds = (await this.bondMembersRepository.findActiveMemberIds(event.bondId)) ?? [];
    const counterpartId = selectCounterpartId(memberIds, expense.requestedBy);

    const recipientIds = buildExpenseRecipientIds(rule, {
      requestedBy: expense.requestedBy,
      counterpartId,
      actorId: this.actorIdOf(event),
    });
    if (recipientIds.length === 0) {
      // Normal, no un error: `expense.paid` marcado por el propio solicitante es
      // una auto-notificación y R2 la descarta; y un vínculo de un solo miembro
      // no tiene contraparte a quién avisar.
      this.logger.debug(
        `No recipients resolved for event=${event.eventType}, expense=${expense.id}`,
      );
      return [];
    }

    const { title, body } = renderExpenseNotificationText(rule, {
      concept: expense.concept,
      // `amount` es `numeric`: el driver lo devuelve como STRING aunque la
      // entidad lo declare `number`. Convertir acá evita que el formateo de la
      // notificación haga aritmética con una cadena.
      amount: Number(expense.amount),
    });

    return this.persist(recipientIds, {
      bondId: event.bondId,
      type: rule.type,
      title,
      body,
      refEntityType: 'expense',
      refEntityId: expense.id,
      sourceEventId: event.id,
      manager,
    });
  }

  // ── Compartido ────────────────────────────────────────────────────────────

  private isFanOutEnabled(): boolean {
    const value = this.appConfig.NOTIFICATIONS_FANOUT_ENABLED;
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.toLowerCase() !== 'false';
    }
    return true;
  }

  /** `payload.actor.id` sólo cuando `actor.type === 'user'`; sistema ⇒ `null`. */
  private actorIdOf(event: OutboxEventEntity): string | null {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const actor = payload.actor as Record<string, unknown> | undefined;
    return actor && actor.type === 'user' && typeof actor.id === 'string' ? actor.id : null;
  }

  /**
   * Inserta una fila por destinatario y devuelve SÓLO las creadas.
   *
   * Los duplicados no lanzan: `createFromEvent` devuelve `null` por el
   * ON CONFLICT DO NOTHING. Cualquier error real debe propagarse para que
   * `Relay.run` no marque el evento como despachado y lo reintente: tragarse el
   * fallo aquí perdería la notificación de forma permanente.
   *
   * Sólo las filas REALMENTE creadas vuelven al llamador: es la lista que
   * `FanOutService` convierte en frames `notification.created` tras el commit,
   * así que un re-dispatch deduplicado no emite ningún frame.
   */
  private async persist(
    recipientIds: readonly string[],
    input: {
      bondId: string;
      type: string;
      title: string;
      body: string;
      refEntityType: string;
      refEntityId: string;
      sourceEventId: string;
      manager: any;
    },
  ): Promise<CreatedNotificationRef[]> {
    const created: CreatedNotificationRef[] = [];
    for (const userId of recipientIds) {
      const row = await this.notificationRepository.createFromEvent(
        {
          userId,
          bondId: input.bondId,
          type: input.type,
          title: input.title,
          body: input.body,
          refEntityType: input.refEntityType,
          refEntityId: input.refEntityId,
          sourceEventId: input.sourceEventId,
        },
        input.manager,
      );
      if (!row) continue;
      created.push({
        id: row.id,
        userId: row.userId,
        type: row.type,
        refEntityType: row.refEntityType,
        refEntityId: row.refEntityId,
      });
    }
    return created;
  }

  /** `findById` ya filtra soft-deleted; el fallback sólo distingue "borrada" de "inexistente". */
  private async loadActivity(activityId: string): Promise<ActivityEntity | null> {
    const activity = await this.activitiesRepository.findById(activityId);
    if (activity) {
      return activity;
    }
    return this.activitiesRepository.findByIdIncludingDeleted(activityId);
  }

  private async buildRecipientContext(
    bondId: string,
    activity: ActivityEntity,
    actorId: string | null,
  ): Promise<RecipientContext> {
    const coordinator = await this.bondMembersRepository.findCoordinator(bondId);
    const memberIds = await this.bondMembersRepository.findActiveMemberIds(bondId);

    return {
      assignedTo: activity.assignedTo ?? null,
      createdBy: activity.createdBy ?? null,
      actorId,
      coordinatorId: coordinator ? coordinator.userId : null,
      memberIds: memberIds ?? [],
    };
  }
}
