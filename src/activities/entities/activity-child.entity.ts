import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ActivityEntity } from './activity.entity';
import { ChildEntity } from '../../children/entities/child.entity';

/** N:N join Activity↔Child — an activity involves one or more children. */
@Entity('activity_child')
export class ActivityChildEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'activity_id' })
  activityId!: string;

  @Column({ type: 'uuid', name: 'child_id' })
  childId!: string;

  @ManyToOne(() => ActivityEntity, (a) => a.activityChildren, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'activity_id' })
  activity!: ActivityEntity;

  @ManyToOne(() => ChildEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'child_id' })
  child!: ChildEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
