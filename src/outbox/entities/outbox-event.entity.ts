import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityEntity } from '../../activities/entities/activity.entity';
import { BondEntity } from '../../bonds/entities/bond.entity';

/**
 * Transactional outbox (write-only) — REQ-TX-3.
 *
 * Cada transición válida inserta UNA fila en la MISMA tx que la `activity`.
 * El relay/fan-out queda fuera de alcance: por eso `dispatchedAt` nace NULL y
 * el índice parcial `IDX_outbox_pending` (`WHERE dispatched_at IS NULL`) se crea
 * en la migración E1 (TypeORM no modela índices parciales, no se declara aquí).
 *
 * `aggregateId` referencia `activity` (el nombre del aggregate se conserva para
 * que el futuro relay no dependa del dominio concreto).
 */
@Entity('outbox_event')
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'aggregate_id' })
  aggregateId!: string;

  @ManyToOne(() => ActivityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'aggregate_id' })
  activity!: ActivityEntity;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType!: string;

  @Column({ type: 'int', name: 'aggregate_version' })
  aggregateVersion!: number;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'dispatched_at' })
  dispatchedAt!: Date | null;
}
