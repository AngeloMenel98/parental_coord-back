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
import { ChildEntity } from '../../children/entities/child.entity';

export enum ExpenseStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

@Entity('expense')
export class ExpenseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bond_id' })
  bondId!: string;

  @ManyToOne(() => BondEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bond_id' })
  bond!: BondEntity;

  @Column({ type: 'uuid', nullable: true, name: 'child_id' })
  childId!: string | null;

  @ManyToOne(() => ChildEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'child_id' })
  child!: ChildEntity | null;

  @Column({ type: 'varchar', length: 255, name: 'concept' })
  concept!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'amount' })
  amount!: number;

  @Column({ type: 'date', name: 'expense_date' })
  expenseDate!: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'split_ratio_payer' })
  splitRatioPayer!: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, name: 'split_ratio_other' })
  splitRatioOther!: number;

  @Column({
    type: 'enum',
    enum: ExpenseStatus,
    default: ExpenseStatus.PENDING,
    name: 'status',
  })
  status!: ExpenseStatus;

  @Column({ type: 'uuid', name: 'requested_by' })
  requestedBy!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requested_by' })
  requester!: UserEntity;

  @Column({ type: 'uuid', nullable: true, name: 'approved_by' })
  approvedBy!: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver!: UserEntity | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'approved_at' })
  approvedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'paid_at' })
  paidAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
