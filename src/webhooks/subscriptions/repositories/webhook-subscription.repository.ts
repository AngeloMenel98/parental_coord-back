import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BaseRepository } from '../../../common/repositories/base.repository';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../entities/webhook-subscription.entity';

/** Tipo virtual que el productor NUNCA emite: lo sintetiza el dispatcher (REQ-EVT-1). */
export const WEBHOOK_STATE_CHANGED_EVENT = 'activity.state_changed';

/** Comodín: matchea cualquier tipo de evento. */
export const WEBHOOK_WILDCARD = '*';

/**
 * Matcheo puro (REQ-DISP-2): una suscripción matchea un evento producido si su
 * `event_types` contiene el tipo específico, el catch-all sintetizado
 * `activity.state_changed`, o `*`. Es la base del dedup del fan-out: aunque
 * matcheen varias condiciones, se emite a lo sumo UNA entrega.
 */
export function subscriptionMatchesEventType(
  eventTypes: readonly string[],
  eventType: string,
): boolean {
  return (
    eventTypes.includes(eventType) ||
    eventTypes.includes(WEBHOOK_STATE_CHANGED_EVENT) ||
    eventTypes.includes(WEBHOOK_WILDCARD)
  );
}

/**
 * Acceso a `webhook_subscription` (REQ-DATA-1, AC-6/AC-9).
 *
 * Extiende `BaseRepository` para heredar el CRUD estándar (`findById`,
 * `countEntities`, ...); los métodos propios son las lecturas del fan-out.
 */
@Injectable()
export class WebhookSubscriptionRepository extends BaseRepository<WebhookSubscriptionEntity> {
  constructor(
    @InjectRepository(WebhookSubscriptionEntity)
    private readonly subRepo: Repository<WebhookSubscriptionEntity>,
  ) {
    super(subRepo);
  }

  /** Suscripciones ACTIVE de un bond, ordenadas por antigüedad. */
  async findActiveByBond(bondId: string): Promise<WebhookSubscriptionEntity[]> {
    return this.subRepo.find({
      where: { bondId, status: WebhookSubscriptionStatus.ACTIVE },
      order: { createdAt: 'ASC' },
    });
  }

  /** Total de suscripciones de un bond (chequeo del tope max-10, REQ-SUB-6). */
  async countByBond(bondId: string): Promise<number> {
    return this.subRepo.count({ where: { bondId } });
  }

  /**
   * Total de suscripciones en un estado (métrica `auto-disabled count`,
   * REQ-NFR-3/AC-20). Sólo lectura.
   */
  async countByStatus(status: WebhookSubscriptionStatus): Promise<number> {
    return this.subRepo.count({ where: { status } });
  }

  /**
   * Suscripciones ACTIVE de un bond que matchean `eventType` en SQL
   * (`= ANY(event_types)` para el tipo específico, el catch-all sintetizado o `*`).
   */
  async findActiveMatchingByBond(
    bondId: string,
    eventType: string,
  ): Promise<WebhookSubscriptionEntity[]> {
    return this.subRepo
      .createQueryBuilder('s')
      .where('s.bond_id = :bondId', { bondId })
      .andWhere('s.status = :active', { active: WebhookSubscriptionStatus.ACTIVE })
      .andWhere(
        '(:eventType = ANY(s.event_types) OR :stateChanged = ANY(s.event_types) OR :wildcard = ANY(s.event_types))',
        {
          eventType,
          stateChanged: WEBHOOK_STATE_CHANGED_EVENT,
          wildcard: WEBHOOK_WILDCARD,
        },
      )
      .getMany();
  }
}
