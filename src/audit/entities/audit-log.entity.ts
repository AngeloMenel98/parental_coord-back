import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { BondEntity } from '../../bonds/entities/bond.entity';

/** Append-only / immutable audit trail with polymorphic FKs. */
@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid', nullable: true, name: 'bond_id' })
  @Index('IDX_audit_bond')
  bondId!: string | null;

  @ManyToOne(() => BondEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity | null;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'varchar', length: 50, name: 'entity_type' })
  @Index('IDX_audit_entity')
  entityType!: string;

  @Column({ type: 'uuid', nullable: true, name: 'entity_id' })
  entityId!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'action' })
  action!: string;

  @Column({ type: 'jsonb', nullable: true, name: 'old_value' })
  oldValue!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true, name: 'new_value' })
  newValue!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true, name: 'detail' })
  detail!: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' })
  ipAddress!: string | null;

  @Column({ type: 'text', nullable: true, name: 'user_agent' })
  userAgent!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
