import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';

/** Nombres de acción del audit de actividades. Estables: son contrato, no texto. */
export const ACTIVITY_AUDIT_ACTIONS = {
  DELETE: 'activity_delete',
  RESTORE: 'activity_restore',
  CANCEL: 'activity_cancel',
  DECLINE: 'activity_decline',
  UNDO_DECLINE: 'activity_undo_decline',
} as const;

export type ActivityAuditAction =
  (typeof ACTIVITY_AUDIT_ACTIONS)[keyof typeof ACTIVITY_AUDIT_ACTIONS];

export interface AuditEntryInput {
  bondId: string;
  userId: string;
  entityId: string;
  action: ActivityAuditAction;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  detail?: string | null;
}

/**
 * Acceso a `audit_log` (la tabla ya existía; las actividades nunca escribían en
 * ella — R11 cierra ese hueco).
 *
 * No hay DDL: se reutiliza la tabla y sus columnas `old_value` / `new_value` /
 * `detail`. El motivo va en `detail` (texto legible) y en `new_value` (para
 * consultas), no en una columna propia.
 */
@Injectable()
export class ActivitiesAuditRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  /**
   * Escribe una entrada de audit.
   *
   * `manager` es opcional y tiene una razón: las mutaciones de swipe escriben la
   * fila de `activity`, su audit y su notificación en UNA transacción, así que la
   * llamada pasa el `EntityManager` de la transacción. Sin él, la escritura del
   * audit saldría por otra conexión y un rollback de la actividad dejaría el audit
   * mintiendo sobre algo que no ocurrió.
   */
  async record(entry: AuditEntryInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLogEntity) : this.auditRepo;
    await repo.save(
      repo.create({
        bondId: entry.bondId,
        userId: entry.userId,
        entityType: 'activity',
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

  /**
   * Último `old_value` de una acción sobre la actividad.
   *
   * Es lo que permite que `undo-decline` devuelva el estado anterior sin una
   * columna extra en `activity`: el estado previo viaja en el propio audit.
   */
  async findLatestOldValue(
    entityId: string,
    action: ActivityAuditAction,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.auditRepo.findOne({
      where: { entityType: 'activity', entityId, action },
      order: { createdAt: 'DESC' },
    });
    return row?.oldValue ?? null;
  }
}
