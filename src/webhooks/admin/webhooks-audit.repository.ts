import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';

/**
 * Acciones estables del audit de suscripciones (REQ-SUB-6). Son CONTRATO, no
 * texto libre: se fijan aquí para que el filtro/observabilidad no dependa de
 * strings dispersos.
 */
export const WEBHOOK_AUDIT_ACTIONS = {
  CREATE: 'webhook_create',
  UPDATE: 'webhook_update',
  ROTATE: 'webhook_rotate',
  DELETE: 'webhook_delete',
  DISABLE: 'webhook_disable',
  ENABLE: 'webhook_enable',
  REPLAY: 'webhook_replay',
} as const;

export type WebhookAuditAction = (typeof WEBHOOK_AUDIT_ACTIONS)[keyof typeof WEBHOOK_AUDIT_ACTIONS];

export interface WebhookAuditEntryInput {
  bondId: string;
  userId: string;
  /** `webhook_subscription.id` (o el id de la entrega en un replay). */
  entityId: string;
  action: WebhookAuditAction;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  detail?: string | null;
}

/**
 * Acceso a `audit_log` para el dominio de webhooks (REQ-SUB-6, D8).
 *
 * Espeja `ActsAuditRepository.record`: reutiliza la tabla polimórfica existente
 * con `entity_type='webhook_subscription'`. El `manager?` opcional permite
 * escribir el audit en la MISMA transacción que la mutación de la suscripción.
 * NUNCA registra material de secreto: los `oldValue`/`newValue` los arma el
 * servicio sin secretos.
 */
@Injectable()
export class WebhooksAuditRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  async record(entry: WebhookAuditEntryInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLogEntity) : this.auditRepo;
    await repo.save(
      repo.create({
        bondId: entry.bondId,
        userId: entry.userId,
        entityType: 'webhook_subscription',
        entityId: entry.entityId,
        action: entry.action,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        detail: entry.detail ?? null,
        ipAddress: null,
        userAgent: null,
      }),
    );
  }
}
