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

export enum ActivityType {
  EVENT = 'event',
  OBLIGATION = 'obligation',
}

export enum ActivityStatus {
  CREATED = 'created',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  VERIFY = 'verify',
  DONE = 'done',
  OVERDUE = 'overdue',
}

export enum Criticality {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
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
