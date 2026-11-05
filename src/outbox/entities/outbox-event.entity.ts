import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BondEntity } from '../../bonds/entities/bond.entity';

/**
 * Tipo de aggregate del outbox (T23, wave 2).
 *
 * Nació con un solo valor porque sólo `activity` emitía eventos. Desde que los
 * gastos usan el mismo pipeline (R8: "no se construye un segundo transporte")
 * el aggregate es polimórfico, y por eso `aggregate_id` ya NO tiene FK a
 * `activity`: una columna no puede apuntar a dos tablas. El discriminador es lo
 * que le dice al relay cómo interpretar el `aggregate_id`.
 */
export type OutboxAggregateType = 'activity' | 'expense';

/**
 * Transactional outbox (write-only) — REQ-TX-3.
 *
 * Cada transición válida inserta UNA fila en la MISMA tx que el aggregate
 * (`activity` en E4+, `expense` en T23).
 * El relay/fan-out queda fuera de alcance: por eso `dispatchedAt` nace NULL y
 * el índice parcial `IDX_outbox_pending` (`WHERE dispatched_at IS NULL`) se crea
 * en la migración E1 (TypeORM no modela índices parciales, no se declara aquí).
 *
 * `aggregateId` es una referencia FLOJA al id del aggregate que indica
 * `aggregateType`: sin FK e indexado por `(aggregate_type, aggregate_id)`
 * (migración `AddOutboxAggregateType`). El único vínculo fuerte que queda es
 * `bond_id`, que sí tiene FK: ningún evento puede apuntar a un vínculo
 * inexistente.
 */
@Entity('outbox_event')
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'aggregate_type', default: 'activity' })
  aggregateType!: OutboxAggregateType;

  @Column({ type: 'uuid', name: 'aggregate_id' })
  aggregateId!: string;

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
