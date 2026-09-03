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

@Entity('notification')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'bond_id' })
  bondId!: string | null;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity | null;

  @Column({ type: 'varchar', length: 50, name: 'type' })
  type!: string;

  @Column({ type: 'varchar', length: 255, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'body' })
  body!: string;

  @Column({ type: 'varchar', length: 50, name: 'ref_entity_type' })
  refEntityType!: string;

  @Column({ type: 'uuid', name: 'ref_entity_id', nullable: true })
  @Index('IDX_notification_ref_entity')
  refEntityId!: string | null;

  @Column({ type: 'boolean', default: false, name: 'is_read' })
  isRead!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
