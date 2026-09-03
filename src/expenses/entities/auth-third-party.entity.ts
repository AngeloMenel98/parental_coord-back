import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { ThirdActivityParticipationEntity } from './third-activity-participation.entity';

export enum AuthThirdStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

/** Third-party authorization: temporal access for non-core users. */
@Entity('auth_third_party')
export class AuthThirdPartyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ type: 'uuid', name: 'authorized_by' })
  authorizedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'authorized_by' })
  authorizer!: UserEntity;

  @Column({ type: 'date', nullable: true, name: 'start_date' })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true, name: 'end_date' })
  endDate!: string | null;

  @Column({
    type: 'enum',
    enum: AuthThirdStatus,
    default: AuthThirdStatus.ACTIVE,
    name: 'status',
  })
  status!: AuthThirdStatus;

  @Column({ type: 'text', nullable: true, name: 'scope_note' })
  scopeNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => ThirdActivityParticipationEntity, (p) => p.authThird)
  participations!: ThirdActivityParticipationEntity[];
}
