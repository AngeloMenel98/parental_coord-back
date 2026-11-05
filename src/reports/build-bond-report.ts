import { Criticality } from '../common/enums/criticality.enum';
import { ActivityStatus } from '../activities/entities/activity.entity';
import { ExpenseStatus } from '../expenses/entities/expense.entity';

/**
 * B2 · S6-S8 — armado del reporte de vínculo.
 *
 * Función pura a propósito: el repositorio trae filas, esto las agrega. Sin eso,
 * cada regla de reporte (porcentaje de gastos pagados, tasa de cumplimiento,
 * agrupación por categoría) quedaría enterrada en SQL y sólo se podría probar
 * levantando Postgres.
 */

export interface ReportActivityRow {
  status: ActivityStatus;
  criticality: Criticality;
  deadline: Date | null;
  assignedTo: string | null;
}

export interface ReportExpenseRow {
  status: ExpenseStatus;
  amount: number | string;
  categoryId: string | null;
  deletedAt: Date | null;
}

export interface ReportCategoryRow {
  id: string;
  name: string;
}

export interface ReportChildRow {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
}

export interface ReportMemberRow {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface BondReportInput {
  bondId: string;
  bondTitle: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: Date;
  activities: ReportActivityRow[];
  expenses: ReportExpenseRow[];
  categories: ReportCategoryRow[];
  children: ReportChildRow[];
  /** childId → actividades del período a las que está asociado. */
  childActivityCounts: Record<string, number>;
  members: ReportMemberRow[];
}

export interface BondReportActivitySection {
  total: number;
  completed: number;
  overdue: number;
  completionRate: number;
  byStatus: Record<string, number>;
  byCriticality: Record<string, number>;
}

export interface BondExpenseStatusBucket {
  count: number;
  amount: number;
}

export interface BondExpenseCategoryBucket {
  categoryId: string | null;
  categoryName: string | null;
  count: number;
  amount: number;
}

export interface BondReportExpenseSection {
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  paidAmountPercentage: number;
  paidCountPercentage: number;
  byStatus: Record<string, BondExpenseStatusBucket>;
  byCategory: BondExpenseCategoryBucket[];
}

export interface BondReportChild {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  ageInYears: number | null;
  activityCount: number;
}

export interface BondReportMember {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  assigned: number;
  completed: number;
  completionPercentage: number;
}

export interface BondReport {
  bondId: string;
  bondTitle: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  activities: BondReportActivitySection;
  expenses: BondReportExpenseSection;
  children: BondReportChild[];
  members: BondReportMember[];
}

/** Los estados cerrados no pueden vencer: `done` cumplió y `cancelled` no corre. */
const TERMINAL_ACTIVITY_STATUSES: ReadonlySet<ActivityStatus> = new Set([
  ActivityStatus.DONE,
  ActivityStatus.CANCELLED,
]);

/**
 * Gastos que cuentan para los totales: los borrados y los rechazados quedan
 * afuera del denominador de S7. `byStatus` sí conserva los rechazados (S8).
 */
const isEligibleExpense = (row: ReportExpenseRow): boolean =>
  !row.deletedAt && row.status !== ExpenseStatus.REJECTED;

const toAmount = (value: number | string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Dos decimales, sin `-0` ni arrastre binario visible. */
export const round2 = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const percentage = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round2((numerator / denominator) * 100);

const ageInYears = (dateOfBirth: string | null, at: Date): number | null => {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(born.getTime())) return null;

  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age < 0 ? null : age;
};

const increment = (bucket: Record<string, number>, key: string): void => {
  bucket[key] = (bucket[key] ?? 0) + 1;
};

export function buildBondReport(input: BondReportInput): BondReport {
  const activities = input.activities;

  const byStatus: Record<string, number> = {};
  const byCriticality: Record<string, number> = {};
  for (const activity of activities) {
    increment(byStatus, activity.status);
    increment(byCriticality, activity.criticality);
  }

  const completed = activities.filter((a) => a.status === ActivityStatus.DONE).length;
  const overdue = activities.filter(
    (a) =>
      !TERMINAL_ACTIVITY_STATUSES.has(a.status) &&
      a.deadline !== null &&
      a.deadline.getTime() < input.generatedAt.getTime(),
  ).length;

  const expenseStatus: Record<string, BondExpenseStatusBucket> = {};
  for (const expense of input.expenses) {
    if (expense.deletedAt) continue;
    const bucket = expenseStatus[expense.status] ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += toAmount(expense.amount);
    expenseStatus[expense.status] = bucket;
  }

  const eligible = input.expenses.filter(isEligibleExpense);
  const totalAmount = round2(eligible.reduce((sum, e) => sum + toAmount(e.amount), 0));
  const paidRows = eligible.filter((e) => e.status === ExpenseStatus.PAID);
  const paidAmount = round2(paidRows.reduce((sum, e) => sum + toAmount(e.amount), 0));
  const pendingAmount = round2(
    eligible
      .filter((e) => e.status === ExpenseStatus.PENDING || e.status === ExpenseStatus.APPROVED)
      .reduce((sum, e) => sum + toAmount(e.amount), 0),
  );

  const categoryNames = new Map(input.categories.map((c) => [c.id, c.name]));
  const categoryBuckets = new Map<string | null, BondExpenseCategoryBucket>();
  for (const expense of eligible) {
    const bucket = categoryBuckets.get(expense.categoryId) ?? {
      categoryId: expense.categoryId,
      categoryName: expense.categoryId ? (categoryNames.get(expense.categoryId) ?? null) : null,
      count: 0,
      amount: 0,
    };
    bucket.count += 1;
    bucket.amount += toAmount(expense.amount);
    categoryBuckets.set(expense.categoryId, bucket);
  }
  const byCategory = [...categoryBuckets.values()]
    .map((bucket) => ({ ...bucket, amount: round2(bucket.amount) }))
    .sort((a, b) => b.amount - a.amount || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''));

  const children: BondReportChild[] = input.children.map((child) => ({
    id: child.id,
    firstName: child.firstName,
    lastName: child.lastName,
    dateOfBirth: child.dateOfBirth,
    ageInYears: ageInYears(child.dateOfBirth, input.generatedAt),
    activityCount: input.childActivityCounts[child.id] ?? 0,
  }));

  const members: BondReportMember[] = input.members.map((member) => {
    const assignedRows = activities.filter((a) => a.assignedTo === member.userId);
    const completedRows = assignedRows.filter((a) => a.status === ActivityStatus.DONE);
    return {
      userId: member.userId,
      firstName: member.firstName,
      lastName: member.lastName,
      role: member.role,
      assigned: assignedRows.length,
      completed: completedRows.length,
      completionPercentage: percentage(completedRows.length, assignedRows.length),
    };
  });

  return {
    bondId: input.bondId,
    bondTitle: input.bondTitle,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    generatedAt: input.generatedAt.toISOString(),
    activities: {
      total: activities.length,
      completed,
      overdue,
      completionRate: percentage(completed, activities.length),
      byStatus,
      byCriticality,
    },
    expenses: {
      totalAmount,
      paidAmount,
      pendingAmount,
      paidAmountPercentage: percentage(paidAmount, totalAmount),
      paidCountPercentage: percentage(paidRows.length, eligible.length),
      byStatus: Object.fromEntries(
        Object.entries(expenseStatus).map(([status, bucket]) => [
          status,
          { count: bucket.count, amount: round2(bucket.amount) },
        ]),
      ),
      byCategory,
    },
    children,
    members,
  };
}
