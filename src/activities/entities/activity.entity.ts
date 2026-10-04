import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { ActivityChildEntity } from './activity-child.entity';
import { CategoryEntity } from '../../categories/entities/category.entity';
import { Criticality } from '../../common/enums/criticality.enum';

export enum ActivityType {
  EVENT = 'event',
  OBLIGATION = 'obligation',
}

export enum ActivityStatus {
  CREATED = 'created',
  ASSIGNED = 'assigned',
  ASSISTING = 'assisting',
  IN_PROGRESS = 'in_progress',
  VERIFY = 'verify',
  DONE = 'done',
  OVERDUE = 'overdue',
  NOT_ASSISTING = 'not_assisting',
  /**
   * A5 · minúscula a propósito: el cliente normaliza con `status.uppercase()` y
   * el/match `"CANCELLED" -> "Cancelada"` (`TimelineFormatters.kt:156`) sólo
   * dispara con minúsculas en el backend.
   *
   * 🔴 `objection` y `dispute` se ELIMINAN del enum (ruling A5). Nunca estuvieron
   * en este enum de TypeScript — sólo en el enum nativo de Postgres, donde eran
   * remanentes de `initial-schema:25`. Ver la migración
   * `DropActivityStatusLegacyValues`, que aborta si alguna fila los aún sostiene.
   */
  CANCELLED = 'cancelled',
}

@Entity('activity')
export class ActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'uuid', name: 'category_id' })
  categoryId!: string;

  @ManyToOne(() => CategoryEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity;

  @Column({
    type: 'enum',
    enum: ActivityType,
    name: 'type',
  })
  type!: ActivityType;

  @Column({
    type: 'enum',
    enum: ActivityStatus,
    default: ActivityStatus.CREATED,
    name: 'status',
  })
  status!: ActivityStatus;

  @Column({
    type: 'enum',
    enum: Criticality,
    default: Criticality.MEDIUM,
    name: 'criticality',
  })
  criticality!: Criticality;

  @Column({ type: 'varchar', length: 255, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'description' })
  description!: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  creator!: UserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'assigned_to' })
  assignedTo!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignee!: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'scheduled_start' })
  scheduledStart!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'scheduled_end' })
  scheduledEnd!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'deadline' })
  deadline!: Date | null;

  @Column({ type: 'interval', nullable: true, name: 'notif_before' })
  notifBefore!: string | null;

  @Column({ type: 'interval', nullable: true, name: 'notif_after' })
  notifAfter!: string | null;

  @Column({ type: 'boolean', default: false, name: 'assigned_confirmed' })
  assignedConfirmed!: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'confirmed_at' })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt!: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'cancelled_by' })
  cancelledBy!: string | null;

  /**
   * R4/A4 · "Eliminar" NO borra la fila: sólo marca `deleted_at`. No hay ventana
   * de retención ni purga (el ruling A4 eliminó el cron diario y los 30 días), así
   * que una fila eliminada persiste indefinidamente con la bandera puesta. La
   * única forma de volver es `POST /activities/:id/restore` dentro de los 5000 ms.
   *
   * Índice parcial en la migración, no aquí: TypeORM no modela índices parciales.
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'deleted_at' })
  deletedAt!: Date | null;

  /** "No asistir" — se persiste para que `undo-decline` pueda cerrar la ventana. */
  @Column({ type: 'timestamptz', nullable: true, name: 'declined_at' })
  declinedAt!: Date | null;

  /**
   * A3 · Visible para TODOS los miembros del vínculo, no sólo para el creador.
   * Que no cruce de vínculos lo garantiza el chequeo de membresía previo a la
   * lectura (`getDetail` devuelve 404 al que no es miembro), nunca este campo.
   */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'declined_reason' })
  declinedReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt!: Date | null;

  @Column({ type: 'enum', enum: ActivityStatus, nullable: true, name: 'resolved_status' })
  resolvedStatus!: ActivityStatus | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ActivityChildEntity, (ac) => ac.activity)
  activityChildren!: ActivityChildEntity[];
}
export { Criticality };
