import { Injectable, Logger } from '@nestjs/common';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { BondsRepository } from '../../bonds/repositories/bonds.repository';
import { BondMembersRepository } from '../../bonds/repositories/bond-members.repository';
import { AppConfig } from '../../config/app-config';
import { ActivityEntity } from '../../activities/entities/activity.entity';
import { CreatedNotificationRef } from '../../realtime/dto/notification-created-message';
import {
  buildRecipientIds,
  RecipientContext,
  renderNotificationText,
  resolveNotificationRule,
} from './activity-notification.map';

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
  ) {}

  async handleOutboxEvent(
    event: OutboxEventEntity,
    manager: any,
  ): Promise<CreatedNotificationRef[]> {
    const enabled = this.isFanOutEnabled();
    if (!enabled) {
      if (!this.flagLogged) {
        this.logger.log('Notifications fan-out disabled via NOTIFICATIONS_FANOUT_ENABLED=false');
        this.flagLogged = true;
      }
      return [];
    }

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

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const actor = payload.actor as Record<string, unknown> | undefined;
    const actorId =
      actor && actor.type === 'user' && typeof actor.id === 'string' ? actor.id : null;

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

    // Los duplicados no lanzan: `createFromEvent` devuelve `null` por el
    // ON CONFLICT DO NOTHING. Cualquier error real debe propagarse para que
    // `Relay.run` no marque el evento como despachado y lo reintente: tragarse
    // el fallo aquí perdería la notificación de forma permanente.
    //
    // Sólo las filas REALMENTE creadas vuelven al llamador: es la lista que
    // `FanOutService` convierte en frames `notification.created` tras el commit,
    // así que un re-dispatch deduplicado no emite ningún frame.
    const created: CreatedNotificationRef[] = [];
    for (const userId of recipientIds) {
      const row = await this.notificationRepository.createFromEvent(
        {
          userId,
          bondId: event.bondId,
          type: rule.type,
          title,
          body,
          refEntityType: 'activity',
          refEntityId: activity.id,
          sourceEventId: event.id,
        },
        manager,
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
