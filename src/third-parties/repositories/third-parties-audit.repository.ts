import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';

/** El tipo de entidad con el que el grant se escribe en `audit_log`. */
export const THIRD_PARTY_AUDIT_ENTITY = 'auth_third_party';

/**
 * Acciones auditadas del grant. Son strings estables (van a la DB y a los reportes),
 * no un enum de TypeScript: `audit_log.action` es `varchar(50)` y el resto de los
 * dominios escriben sus propias constantes.
 */
export const THIRD_PARTY_AUDIT_ACTIONS = {
  GRANT: 'third_party_grant',
  UPDATE: 'third_party_update',
  REVOKE: 'third_party_revoke',
  EXPIRE: 'third_party_expire',
} as const;

export interface ThirdPartyAuditEntryInput {
  bondId: string;
  /** Quién provocó el cambio: el progenitor en grant/update/revoke, el visitante al vencer. */
  userId: string;
  grantId: string;
  action: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  detail?: string | null;
}

/**
 * Audit del dominio de terceros, espejando `ExpensesAuditRepository` y
 * `ActsAuditRepository`: reutiliza la tabla polimórfica existente, sin DDL propia.
 *
 * `manager` es opcional y no es un adorno: el alta del grant, la fila de `bond_member`
 * y este audit van en UNA transacción, así que la llamada pasa el `EntityManager`.
 * Sin él, un rollback del grant dejaría un audit afirmando algo que no pasó.
 */
@Injectable()
export class ThirdPartiesAuditRepository {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  async record(entry: ThirdPartyAuditEntryInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLogEntity) : this.auditRepo;
    await repo.save(
      repo.create({
        bondId: entry.bondId,
        userId: entry.userId,
        entityType: THIRD_PARTY_AUDIT_ENTITY,
        entityId: entry.grantId,
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
