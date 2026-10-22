import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Criticality } from '../../common/enums/criticality.enum';
export { Criticality };

@Entity('category')
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description!: string | null;

  @Column({ type: 'varchar', length: 7, nullable: true, name: 'color' })
  color!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'icon' })
  icon!: string | null;

  @Column({ type: 'enum', enum: Criticality, default: Criticality.MEDIUM, name: 'criticality' })
  criticality!: Criticality;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany('ActivityEntity', (activity: any) => activity.category)
  activities!: any[];
}
