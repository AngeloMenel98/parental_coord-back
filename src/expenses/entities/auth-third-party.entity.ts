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
  /**
   * Venció por fecha, no por decisión de nadie (D3). Se escribe de forma perezosa
   * cuando alguien consulta el grant después de `end_date`, o por el barrido del
   * worker; nunca convive con `revoked`, que sí es una decisión humana.
   */
  EXPIRED = 'expired',
}

/**
 * Relación declarada por el progenitor al otorgar el acceso.
 *
 * Los valores son minúsculas como el resto de los enums persistidos de este repo
 * (`progenitor`, `coordinador`, `active`), y la etiqueta en palabras la arma el
 * cliente.
 */
export enum ThirdPartyRelationship {
  FAMILY = 'family',
  CAREGIVER = 'caregiver',
  MEDICAL = 'medical',
  EDUCATIONAL = 'educational',
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

  /**
   * Obligatoria (D3): un acceso sin vencimiento no es temporal. La columna es NOT NULL
   * desde `AddThirdPartyAccessGrant1793664000000`, que se niega a inventar una fecha
   * para filas preexistentes.
   */
  @Column({ type: 'date', name: 'end_date' })
  endDate!: string;

  @Column({
    type: 'enum',
    enum: ThirdPartyRelationship,
    name: 'relationship',
  })
  relationship!: ThirdPartyRelationship;

  @Column({
    type: 'enum',
    enum: AuthThirdStatus,
    default: AuthThirdStatus.ACTIVE,
    name: 'status',
  })
  status!: AuthThirdStatus;

  @Column({ type: 'text', nullable: true, name: 'scope_note' })
  scopeNote!: string | null;

  /** Revocación anticipada (D3): cuándo, quién y —cuando se sepa— por qué. */
  @Column({ type: 'timestamptz', nullable: true, name: 'revoked_at' })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'revoked_by' })
  revokedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'revoked_by' })
  revoker!: UserEntity | null;

  @Column({ type: 'text', nullable: true, name: 'revoked_reason' })
  revokedReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => ThirdActivityParticipationEntity, (p) => p.authThird)
  participations!: ThirdActivityParticipationEntity[];
}
