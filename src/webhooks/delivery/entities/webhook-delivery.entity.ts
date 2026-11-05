import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OutboxEventEntity } from '../../../outbox/entities/outbox-event.entity';
import { WebhookSubscriptionEntity } from '../../subscriptions/entities/webhook-subscription.entity';

/** Estados de una entrega (D2/REQ-DATA-1): varchar(20) + CHECK, no enum nativo. */
export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  RETRYING = 'RETRYING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  DEAD = 'DEAD',
}

/**
 * Una entrega por (evento de outbox, suscripción) — REQ-DATA-1/2.
 *
 * El `UNIQUE(event_id, subscription_id)` (creado en la migración, TypeORM no lo
 * modela) hace idempotente el fan-out: un re-dispatch no crea una segunda fila.
 */
@Entity('webhook_delivery')
export class WebhookDeliveryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @ManyToOne(() => OutboxEventEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event!: OutboxEventEntity;

  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId!: string;

  @ManyToOne(() => WebhookSubscriptionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription!: WebhookSubscriptionEntity;

  @Column({
    type: 'varchar',
    length: 20,
    default: WebhookDeliveryStatus.PENDING,
    name: 'status',
  })
  status!: WebhookDeliveryStatus;

  @Column({ type: 'int', default: 0, name: 'attempt_count' })
  attemptCount!: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'next_attempt_at' })
  nextAttemptAt!: Date | null;

  @Column({ type: 'int', nullable: true, name: 'last_status_code' })
  lastStatusCode!: number | null;

  @Column({ type: 'text', nullable: true, name: 'last_error' })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt!: Date | null;
}
