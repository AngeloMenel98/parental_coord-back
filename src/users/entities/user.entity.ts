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

  /**
   * S2 · la contraseña la generó el sistema (alta de tercero o del admin) y la persona
   * tiene que cambiarla en su primer ingreso. `JwtAuthGuard` bloquea el resto de las
   * rutas mientras esté en `true`. Las cuentas viejas quedan en `false` por el DEFAULT
   * de la migración: nadie se despierta un día bloqueado.
   */
  @Column({ type: 'boolean', default: false, name: 'must_change_password' })
  mustChangePassword!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => PersonalDataEntity, (pd) => pd.user)
  personalData?: PersonalDataEntity;
}
