import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { ActivityEntity } from '../../activities/entities/activity.entity';
import { BondMemberEntity } from '../../bonds/entities/bond-member.entity';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { CategoryEntity } from '../../categories/entities/category.entity';
import { ChildEntity } from '../../children/entities/child.entity';
import { ExpenseEntity } from '../../expenses/entities/expense.entity';

/**
 * B2 · S6 — lecturas del reporte de vínculo.
 *
 * Todo lo que toca la base vive acá; la agregación es pura
 * (`build-bond-report.ts`). Los nombres de columna se escriben con la propiedad
 * de la entidad (`a.createdAt`), no con el nombre físico, para que un cambio de
 * `name:` en el mapeo no rompa estas consultas en silencio.
 */
@Injectable()
export class BondReportRepository {
  constructor(
    @InjectRepository(BondEntity)
    private readonly bonds: Repository<BondEntity>,
    @InjectRepository(ActivityEntity)
    private readonly activities: Repository<ActivityEntity>,
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
    @InjectRepository(ChildEntity)
    private readonly children: Repository<ChildEntity>,
    @InjectRepository(BondMemberEntity)
    private readonly members: Repository<BondMemberEntity>,
  ) {}

  async findBond(bondId: string): Promise<BondEntity | null> {
    return this.bonds.findOne({ where: { id: bondId } });
  }

  /**
   * S6: la actividad cae en la ventana por su fecha de referencia — la agendada
   * si existe, la de creación si no. Excluye las borradas con la convención de
   * `deleted_at` del resto del repo.
   */
  async findActivities(bondId: string, from: Date, toExclusive: Date): Promise<ActivityEntity[]> {
    return this.activities
      .createQueryBuilder('a')
      .where('a.bondId = :bondId', { bondId })
      .andWhere('a.deletedAt IS NULL')
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) >= :from', { from })
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) < :to', { to: toExclusive })
      .getMany();
  }

  /** S6: los gastos se ubican por `expense_date`, que es una columna `date`. */
  async findExpenses(
    bondId: string,
    fromDate: string,
    toExclusiveDate: string,
  ): Promise<ExpenseEntity[]> {
    return this.expenses
      .createQueryBuilder('e')
      .where('e.bondId = :bondId', { bondId })
      .andWhere('e.expenseDate >= :fromDate', { fromDate })
      .andWhere('e.expenseDate < :toDate', { toDate: toExclusiveDate })
      .getMany();
  }

  async findCategoriesByIds(ids: string[]): Promise<CategoryEntity[]> {
    if (ids.length === 0) return [];
    return this.categories.find({ where: { id: In(ids) } });
  }

  /** S6: los hijos del vínculo no se filtran por período; son del vínculo. */
  async findChildren(bondId: string): Promise<ChildEntity[]> {
    return this.children.find({
      where: { bondId },
      order: { createdAt: 'DESC' },
    });
  }

  /** childId → cantidad de actividades del período asociadas a ese hijo. */
  async findChildActivityCounts(
    bondId: string,
    from: Date,
    toExclusive: Date,
  ): Promise<Record<string, number>> {
    const rows = await this.activities
      .createQueryBuilder('a')
      .innerJoin('a.activityChildren', 'ac')
      .select('ac.childId', 'childId')
      .addSelect('COUNT(DISTINCT a.id)', 'count')
      .where('a.bondId = :bondId', { bondId })
      .andWhere('a.deletedAt IS NULL')
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) >= :from', { from })
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) < :to', { to: toExclusive })
      .groupBy('ac.childId')
      .getRawMany<{ childId: string; count: string }>();

    return Object.fromEntries(rows.map((row) => [row.childId, Number(row.count)]));
  }

  /** S6: miembros vigentes del vínculo; quien se fue no participa del reporte. */
  async findMembers(bondId: string): Promise<BondMemberEntity[]> {
    return this.members.find({
      where: { bondId, leftAt: IsNull() },
      relations: ['user', 'user.personalData'],
    });
  }
}
