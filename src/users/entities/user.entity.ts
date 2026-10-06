import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PersonalDataEntity } from './personal-data.entity';

export enum SystemRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('user')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_user_email', { unique: true })
  @Column({ type: 'varchar', length: 255, name: 'email' })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({
    type: 'enum',
    enum: SystemRole,
    default: SystemRole.USER,
    name: 'system_role',
  })
  systemRole!: SystemRole;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => PersonalDataEntity, (pd) => pd.user)
  personalData?: PersonalDataEntity;
}
