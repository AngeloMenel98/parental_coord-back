import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BondMemberEntity } from './bond-member.entity';
import { ChildEntity } from '../../children/entities/child.entity';

export enum AgreementType {
  FORMAL = 'formal',
  INFORMAL = 'informal',
}

@Entity('bond')
export class BondEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'title' })
  title!: string;

  @Column({
    type: 'enum',
    enum: AgreementType,
    name: 'agreement_type',
  })
  agreementType!: AgreementType;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'court_case_ref' })
  courtCaseRef!: string | null;

  @Column({ type: 'date', nullable: true, name: 'start_date' })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true, name: 'end_date' })
  endDate!: string | null;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => BondMemberEntity, (member) => member.bond)
  members!: BondMemberEntity[];

  @OneToMany(() => ChildEntity, (child) => child.bond)
  children!: ChildEntity[];
}
