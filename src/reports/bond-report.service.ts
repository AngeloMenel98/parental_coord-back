import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Clock } from '../common/clock/clock';
import { BondReportRepository } from './repositories/bond-report.repository';
import { BondReport, buildBondReport } from './build-bond-report';

export interface BondReportPeriod {
  dateFrom: string;
  dateTo: string;
}

/** 'YYYY-MM-DD' + n días, en UTC: un día tiene 24h también cuando cambia la hora. */
export function addDaysToIsoDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * B2 · S6-S8 — reporte de vínculo en JSON.
 *
 * Traduce la ventana inclusiva que elige el usuario (`dateFrom`..`dateTo`) a la
 * consulta exclusiva (`>= from`, `< to + 1 día`) y delega la agregación al
 * builder puro.
 */
@Injectable()
export class BondReportService {
  constructor(
    private readonly repo: BondReportRepository,
    private readonly clock: Clock,
  ) {}

  async build(bondId: string, period: BondReportPeriod): Promise<BondReport> {
    if (period.dateTo < period.dateFrom) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }

    const bond = await this.repo.findBond(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const toExclusiveDate = addDaysToIsoDate(period.dateTo, 1);
    const fromInstant = new Date(`${period.dateFrom}T00:00:00.000Z`);
    const toInstant = new Date(`${toExclusiveDate}T00:00:00.000Z`);
    const generatedAt = this.clock.now();

    const [activities, expenses, children, childActivityCounts, members] = await Promise.all([
      this.repo.findActivities(bondId, fromInstant, toInstant),
      this.repo.findExpenses(bondId, period.dateFrom, toExclusiveDate),
      this.repo.findChildren(bondId),
      this.repo.findChildActivityCounts(bondId, fromInstant, toInstant),
      this.repo.findMembers(bondId),
    ]);

    const categories = await this.repo.findCategoriesByIds([
      ...new Set(expenses.map((expense) => expense.categoryId).filter((id): id is string => !!id)),
    ]);

    return buildBondReport({
      bondId: bond.id,
      bondTitle: bond.title,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      generatedAt,
      activities: activities.map((activity) => ({
        status: activity.status,
        criticality: activity.criticality,
        deadline: activity.deadline,
        assignedTo: activity.assignedTo,
      })),
      expenses: expenses.map((expense) => ({
        status: expense.status,
        amount: expense.amount,
        categoryId: expense.categoryId,
        deletedAt: expense.deletedAt,
      })),
      categories: categories.map((category) => ({ id: category.id, name: category.name })),
      children: children.map((child) => ({
        id: child.id,
        firstName: child.firstName,
        lastName: child.lastName,
        dateOfBirth: child.dateOfBirth,
      })),
      childActivityCounts,
      members: members.map((member) => ({
        userId: member.userId,
        firstName: member.user?.personalData?.firstName ?? '',
        lastName: member.user?.personalData?.lastName ?? '',
        role: member.role,
      })),
    });
  }
}
