import { Injectable, Logger } from '@nestjs/common';

import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { NotificationRepository } from '../repositories/notification.repository';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { BondsRepository } from '../../bonds/repositories/bonds.repository';
import { BondMembersRepository } from '../../bonds/repositories/bond-members.repository';
import { AppConfig } from '../../config/app-config';
import { ActivityEntity } from '../../activities/entities/activity.entity';
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

  async handleOutboxEvent(event: OutboxEventEntity, manager: any): Promise<void> {
    const enabled = this.isFanOutEnabled();
    if (!enabled) {
      if (!this.flagLogged) {
        this.logger.log('Notifications fan-out disabled via NOTIFICATIONS_FANOUT_ENABLED=false');
        this.flagLogged = true;
      }
      return;
    }

    const rule = resolveNotificationRule(event.eventType);
    if (!rule) {
      this.logger.debug(`No notification rule for event_type=${event.eventType}; skipping`);
      return;
    }

    const activity = await this.loadActivity(event.aggregateId);
    if (!activity || activity.deletedAt) {
      this.logger.debug(
        `Activity not found or deleted for aggregateId=${event.aggregateId}; skipping notifications`,
      );
      return;
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
      return;
    }

    const { title, body } = renderNotificationText(rule, activity.title);

    for (const userId of recipientIds) {
      try {
        await this.notificationRepository.createFromEvent(
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
      } catch (error) {
        // Never throw - conflicts are expected and handled by createFromEvent returning null
        // Any other unexpected error should not abort the dispatch transaction
        this.logger.debug(`Failed to create notification for user ${userId}: ${error}`);
      }
    }
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

  private async loadActivity(activityId: string): Promise<ActivityEntity | null> {
    try {
      // Try to find with relations if possible
      const activity = await this.activitiesRepository.findById(activityId);
      if (activity) {
        return activity;
      }
      // Also check including deleted? The spec says missing activity/soft-deleted -> no inserts
      return await this.activitiesRepository.findByIdIncludingDeleted(activityId);
    } catch (error) {
      this.logger.debug(`Error loading activity ${activityId}: ${error}`);
      return null;
    }
  }

  private async buildRecipientContext(
    bondId: string,
    activity: ActivityEntity,
    actorId: string | null,
  ): Promise<RecipientContext> {
    const context: RecipientContext = {
      assignedTo: activity.assignedTo ?? null,
      createdBy: activity.createdBy ?? null,
      actorId,
    };

    try {
      const coordinator = await this.bondMembersRepository.findCoordinator(bondId);
      if (coordinator) {
        context.coordinatorId = coordinator.userId;
      } else {
        context.coordinatorId = null;
      }
    } catch (error) {
      this.logger.debug(`Error loading coordinator for bond ${bondId}: ${error}`);
      context.coordinatorId = null;
    }

    try {
      const memberIds = await this.bondMembersRepository.findActiveMemberIds(bondId);
      context.memberIds = memberIds ?? [];
    } catch (error) {
      this.logger.debug(`Error loading active members for bond ${bondId}: ${error}`);
      context.memberIds = [];
    }

    return context;
  }
}
