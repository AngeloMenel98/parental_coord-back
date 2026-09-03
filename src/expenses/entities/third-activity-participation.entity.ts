import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuthThirdPartyEntity } from './auth-third-party.entity';
import { ActivityEntity } from '../../activities/entities/activity.entity';

export enum ParticipationStatus {
  ASSIGNED = 'asignado',
  CONFIRMED = 'confirmado',
  REJECTED = 'rechazado',
  COMPLETED = 'completado',
}

/** Join table: which activities a third-party can see + confirm/complete them. */
@Entity('third_activity_participation')
export class ThirdActivityParticipationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'auth_third_id' })
  authThirdId!: string;

  @ManyToOne(() => AuthThirdPartyEntity, (a) => a.participations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'auth_third_id' })
  authThird!: AuthThirdPartyEntity;

  @Column({ type: 'uuid', name: 'activity_id' })
  activityId!: string;

  @ManyToOne(() => ActivityEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activity_id' })
  activity!: ActivityEntity;

  @Column({
    type: 'enum',
    enum: ParticipationStatus,
    default: ParticipationStatus.ASSIGNED,
    name: 'participation_status',
  })
  participationStatus!: ParticipationStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'confirmed_at' })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'completed_at' })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
