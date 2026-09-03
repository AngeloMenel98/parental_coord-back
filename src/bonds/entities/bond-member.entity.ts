import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BondEntity } from './bond.entity';
import { UserEntity } from '../../users/entities/user.entity';

export enum BondMemberRole {
  PROGENITOR = 'progenitor',
  COORDINADOR = 'coordinador',
}

/** Join table User↔Bond with a per-bond role (progenitor | coordinador). */
@Entity('bond_member')
export class BondMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({
    type: 'enum',
    enum: BondMemberRole,
    name: 'role',
  })
  role!: BondMemberRole;

  @Column({ type: 'timestamptz', nullable: true, name: 'joined_at' })
  joinedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'left_at' })
  leftAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
