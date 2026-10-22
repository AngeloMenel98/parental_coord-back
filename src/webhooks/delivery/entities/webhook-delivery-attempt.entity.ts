import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { WebhookDeliveryEntity } from './webhook-delivery.entity';

/**
 * Un intento de entrega (REQ-DATA-1, REQ-LOG-1).
 *
 * `responseSnippet` se guarda truncado a 1 KB (varchar(1024)) y debe tratarse
 * como no confiable (REQ-SEC-5). `startedAt` nace `now()` pero el servicio lo
 * escribe explícitamente para medir latencia con precisión.
 */
@Entity('webhook_delivery_attempt')
export class WebhookDeliveryAttemptEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'delivery_id' })
  deliveryId!: string;

  @ManyToOne(() => WebhookDeliveryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'delivery_id' })
  delivery!: WebhookDeliveryEntity;

  @Column({ type: 'int', name: 'attempt_no' })
  attemptNo!: number;

  @Column({ type: 'timestamptz', default: () => 'now()', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'int', nullable: true, name: 'duration_ms' })
  durationMs!: number | null;

  @Column({ type: 'int', nullable: true, name: 'status_code' })
  statusCode!: number | null;

  @Column({ type: 'varchar', length: 1024, nullable: true, name: 'response_snippet' })
  responseSnippet!: string | null;

  @Column({ type: 'text', nullable: true, name: 'error' })
  error!: string | null;
}
