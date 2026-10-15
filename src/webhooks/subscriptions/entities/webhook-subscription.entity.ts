import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BondEntity } from '../../../bonds/entities/bond.entity';
import { UserEntity } from '../../../users/entities/user.entity';

/** Estados de la suscripción (D2): varchar(20) + CHECK, no enum nativo. */
export enum WebhookSubscriptionStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  AUTO_DISABLED = 'AUTO_DISABLED',
}

/**
 * Suscripción de webhooks de un bond (REQ-DATA-1, D2).
 *
 * `secretEncrypted` guarda el secreto del firmante cifrado AES-256-GCM
 * (`v1:iv:tag:ct`, REQ-SEC-2); durante la ventana de rotación
 * (`secretPrevEncrypted` + `secretPrevExpiresAt`) se firma con AMBOS.
 */
@Entity('webhook_subscription')
export class WebhookSubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @Column({ type: 'text', name: 'url' })
  url!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'description' })
  description!: string | null;

  @Column({ type: 'text', array: true, default: '{*}', name: 'event_types' })
  eventTypes!: string[];

  @Column({ type: 'text', name: 'secret_encrypted' })
  secretEncrypted!: string;

  @Column({ type: 'text', nullable: true, name: 'secret_prev_encrypted' })
  secretPrevEncrypted!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'secret_prev_expires_at' })
  secretPrevExpiresAt!: Date | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: WebhookSubscriptionStatus.ACTIVE,
    name: 'status',
  })
  status!: WebhookSubscriptionStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'consecutive_failure_since' })
  consecutiveFailureSince!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
