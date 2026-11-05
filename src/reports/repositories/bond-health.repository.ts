import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivityEntity } from '../../activities/entities/activity.entity';
import { BondMemberEntity } from '../../bonds/entities/bond-member.entity';
import { BondEntity } from '../../bonds/entities/bond.entity';
import { ChildEntity } from '../../children/entities/child.entity';
import { ExpenseEntity } from '../../expenses/entities/expense.entity';
import { BondHealthAggregates } from '../build-bond-health';

/**
 * B4 · los cuatro agregados que alimentan la lista de vínculos.
 *
 * Se agrupan en SQL por `bond_id` para que la lista cueste cuatro consultas y no
 * cuatro por vínculo, que es lo que saldría de reusar el reporte completo.
 */
@Injectable()
export class BondHealthRepository {
  constructor(
    @InjectRepository(BondEntity)
    private readonly bonds: Repository<BondEntity>,
    @InjectRepository(ActivityEntity)
    private readonly activities: Repository<ActivityEntity>,
    @InjectRepository(ExpenseEntity)
    private readonly expenses: Repository<ExpenseEntity>,
    @InjectRepository(ChildEntity)
    private readonly children: Repository<ChildEntity>,
    @InjectRepository(BondMemberEntity)
    private readonly members: Repository<BondMemberEntity>,
  ) {}

  async findBonds(): Promise<BondEntity[]> {
    return this.bonds.find({ order: { createdAt: 'DESC' } });
  }

  async aggregatesByBond(
    bondIds: string[],
    fromInstant: Date,
    toExclusiveInstant: Date,
  ): Promise<Map<string, BondHealthAggregates>> {
    const result = new Map<string, BondHealthAggregates>();
    if (bondIds.length === 0) return result;

    const base = (bondId: string): BondHealthAggregates =>
      result.get(bondId) ?? {
        activitiesTotal: 0,
        activitiesCompleted: 0,
        expensesEligibleAmount: 0,
        expensesPaidAmount: 0,
        childrenCount: 0,
        membersCount: 0,
      };

    const activityRows = await this.activities
      .createQueryBuilder('a')
      .select('a.bondId', 'bondId')
      .addSelect('COUNT(*)', 'total')
      .addSelect("COUNT(*) FILTER (WHERE a.status = 'done')", 'completed')
      .where('a.bondId IN (:...bondIds)', { bondIds })
      .andWhere('a.deletedAt IS NULL')
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) >= :from', { from: fromInstant })
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) < :to', { to: toExclusiveInstant })
      .groupBy('a.bondId')
      .getRawMany<{ bondId: string; total: string; completed: string }>();

    for (const row of activityRows) {
      const current = base(row.bondId);
      result.set(row.bondId, {
        ...current,
        activitiesTotal: Number(row.total),
        activitiesCompleted: Number(row.completed),
      });
    }

    // B4 · el elegible replica S7: fuera los borrados y los rechazados.
    const expenseRows = await this.expenses
      .createQueryBuilder('e')
      .select('e.bondId', 'bondId')
      .addSelect("COALESCE(SUM(e.amount) FILTER (WHERE e.status <> 'rejected'), 0)", 'eligible')
      .addSelect("COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'paid'), 0)", 'paid')
      .where('e.bondId IN (:...bondIds)', { bondIds })
      .andWhere('e.deletedAt IS NULL')
      .andWhere('e.expenseDate >= :fromDate', { fromDate: isoDay(fromInstant) })
      .andWhere('e.expenseDate < :toDate', { toDate: isoDay(toExclusiveInstant) })
      .groupBy('e.bondId')
      .getRawMany<{ bondId: string; eligible: string; paid: string }>();

    for (const row of expenseRows) {
      const current = base(row.bondId);
      result.set(row.bondId, {
        ...current,
        expensesEligibleAmount: Number(row.eligible),
        expensesPaidAmount: Number(row.paid),
      });
    }

    const childRows = await this.children
      .createQueryBuilder('c')
      .select('c.bondId', 'bondId')
      .addSelect('COUNT(*)', 'count')
      .where('c.bondId IN (:...bondIds)', { bondIds })
      .groupBy('c.bondId')
      .getRawMany<{ bondId: string; count: string }>();

    for (const row of childRows) {
      const current = base(row.bondId);
      result.set(row.bondId, { ...current, childrenCount: Number(row.count) });
    }

    const memberRows = await this.members
      .createQueryBuilder('bm')
      .select('bm.bondId', 'bondId')
      .addSelect('COUNT(*)', 'count')
      .where('bm.bondId IN (:...bondIds)', { bondIds })
      .andWhere('bm.leftAt IS NULL')
      .groupBy('bm.bondId')
      .getRawMany<{ bondId: string; count: string }>();

    for (const row of memberRows) {
      const current = base(row.bondId);
      result.set(row.bondId, { ...current, membersCount: Number(row.count) });
    }

    return result;
  }

  /** Serie agrupada por mes de la fecha de referencia de la actividad. */
  async trendByMonth(
    bondId: string,
    fromInstant: Date,
    toExclusiveInstant: Date,
  ): Promise<{ month: string; activitiesTotal: number; activitiesCompleted: number }[]> {
    const rows = await this.activities
      .createQueryBuilder('a')
      .select(
        "to_char(date_trunc('month', COALESCE(a.scheduledStart, a.createdAt)), 'YYYY-MM')",
        'month',
      )
      .addSelect('COUNT(*)', 'total')
      .addSelect("COUNT(*) FILTER (WHERE a.status = 'done')", 'completed')
      .where('a.bondId = :bondId', { bondId })
      .andWhere('a.deletedAt IS NULL')
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) >= :from', { from: fromInstant })
      .andWhere('COALESCE(a.scheduledStart, a.createdAt) < :to', { to: toExclusiveInstant })
      .groupBy('month')
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; total: string; completed: string }>();

    return rows.map((row) => ({
      month: row.month,
      activitiesTotal: Number(row.total),
      activitiesCompleted: Number(row.completed),
    }));
  }

  async bondExists(bondId: string): Promise<{ id: string } | null> {
    return this.bonds.findOne({ where: { id: bondId }, select: ['id'] });
  }
}

/** `Date` → `YYYY-MM-DD` en UTC; las columnas de fecha del esquema son `date`. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
