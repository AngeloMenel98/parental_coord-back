import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { UserEntity } from '../../users/entities/user.entity';

export enum ReportStatus {
  SOLICITADO = 'solicitado',
  EN_PROCESO = 'en_proceso',
  COMPLETADO = 'completado',
  ENTREGADO = 'entregado',
}

/** Judicial reports — admin-only module. */
@Entity('report')
export class ReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by' })
  requester!: UserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'generated_by' })
  generatedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'generated_by' })
  generator!: UserEntity | null;

  @Column({ type: 'date', name: 'date_from' })
  dateFrom!: string;

  @Column({ type: 'date', name: 'date_to' })
  dateTo!: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.SOLICITADO,
    name: 'status',
  })
  status!: ReportStatus;

  @Column({ type: 'text', nullable: true, name: 'file_url' })
  fileUrl!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'generated_at' })
  generatedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
