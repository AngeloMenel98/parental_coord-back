import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { ChildEntity } from '../../children/entities/child.entity';
import { CategoryEntity } from '../../categories/entities/category.entity';
import { ActivityEntity } from '../../activities/entities/activity.entity';

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

  /**
   * R2 · Una sola taxonomía: la MISMA tabla `category` que ya usa una actividad.
   * Nullable porque los gastos históricos no tienen categoría y elegir una por
   * ellos sería inventar un dato contable; que sea obligatoria al crear es regla
   * del DTO (`CreateExpenseDto`, T22), no del esquema.
   */
  @Column({ type: 'uuid', nullable: true, name: 'category_id' })
  categoryId!: string | null;

  @ManyToOne(() => CategoryEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryEntity | null;

  /**
   * R6/D-17 · Actividad de la que nació el gasto (adjunto convertido). Nullable:
   * no todo gasto viene de una actividad. `SET NULL` para que borrar la actividad
   * nunca se lleve puesta la fila de plata.
   */
  @Column({ type: 'uuid', nullable: true, name: 'activity_id' })
  activityId!: string | null;

  @ManyToOne(() => ActivityEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'activity_id' })
  activity!: ActivityEntity | null;

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

  /**
   * "Eliminar" de un gasto, con la convención de `activity.deleted_at`: la fila
   * se queda con la marca y las lecturas filtran `deleted_at IS NULL`. No hay
   * purga ni cascada.
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'deleted_at' })
  deletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
