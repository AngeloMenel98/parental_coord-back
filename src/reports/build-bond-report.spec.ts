import { Criticality } from '../common/enums/criticality.enum';
import { ActivityStatus } from '../activities/entities/activity.entity';
import { ExpenseStatus } from '../expenses/entities/expense.entity';

import { BondReportInput, buildBondReport } from './build-bond-report';

/**
 * B2 · S6-S8 — la agregación del reporte de vínculo.
 *
 * Es una función pura: entra lo que las consultas ya trajeron, sale el JSON. Se
 * prueba sin base de datos ni mocks, que es justamente el punto de separarla del
 * repositorio.
 */
describe('buildBondReport (B2)', () => {
  const GENERATED_AT = new Date('2026-06-30T12:00:00.000Z');

  const baseInput = (over: Partial<BondReportInput> = {}): BondReportInput => ({
    bondId: 'bond-1',
    bondTitle: 'Acuerdo Paz',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    generatedAt: GENERATED_AT,
    activities: [],
    expenses: [],
    categories: [],
    children: [],
    childActivityCounts: {},
    members: [],
    ...over,
  });

  // ── S6 · Actividades ────────────────────────────────────────────

  it('S6 returns zeroed rates and empty maps for a bond with no data', () => {
    const report = buildBondReport(baseInput());

    expect(report.activities).toEqual({
      total: 0,
      completed: 0,
      overdue: 0,
      completionRate: 0,
      byStatus: {},
      byCriticality: {},
    });
    expect(report.expenses.totalAmount).toBe(0);
    expect(report.expenses.paidAmountPercentage).toBe(0);
    expect(report.expenses.paidCountPercentage).toBe(0);
    expect(report.expenses.byCategory).toEqual([]);
    expect(report.children).toEqual([]);
    expect(report.members).toEqual([]);
    expect(report.generatedAt).toBe('2026-06-30T12:00:00.000Z');
  });

  it('S6 counts activities by status and criticality and rounds the completion rate', () => {
    const report = buildBondReport(
      baseInput({
        activities: [
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.HIGH,
            deadline: null,
            assignedTo: null,
          },
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.HIGH,
            deadline: null,
            assignedTo: null,
          },
          {
            status: ActivityStatus.ASSIGNED,
            criticality: Criticality.LOW,
            deadline: null,
            assignedTo: null,
          },
        ],
      }),
    );

    expect(report.activities.total).toBe(3);
    expect(report.activities.completed).toBe(2);
    expect(report.activities.completionRate).toBe(66.67);
    expect(report.activities.byStatus).toEqual({ done: 2, assigned: 1 });
    expect(report.activities.byCriticality).toEqual({ high: 2, low: 1 });
  });

  it('S6 counts as overdue only open activities whose deadline already passed', () => {
    const past = new Date('2026-06-10T00:00:00.000Z');
    const future = new Date('2026-07-10T00:00:00.000Z');

    const report = buildBondReport(
      baseInput({
        activities: [
          {
            status: ActivityStatus.ASSIGNED,
            criticality: Criticality.HIGH,
            deadline: past,
            assignedTo: null,
          },
          {
            status: ActivityStatus.IN_PROGRESS,
            criticality: Criticality.HIGH,
            deadline: past,
            assignedTo: null,
          },
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.HIGH,
            deadline: past,
            assignedTo: null,
          },
          {
            status: ActivityStatus.CANCELLED,
            criticality: Criticality.HIGH,
            deadline: past,
            assignedTo: null,
          },
          {
            status: ActivityStatus.ASSIGNED,
            criticality: Criticality.HIGH,
            deadline: future,
            assignedTo: null,
          },
          {
            status: ActivityStatus.ASSIGNED,
            criticality: Criticality.HIGH,
            deadline: null,
            assignedTo: null,
          },
        ],
      }),
    );

    expect(report.activities.overdue).toBe(2);
    expect(report.activities.byStatus).toEqual({
      assigned: 3,
      in_progress: 1,
      done: 1,
      cancelled: 1,
    });
  });

  // ── S7/S8 · Gastos ──────────────────────────────────────────────

  it('S7 computes the paid percentage by amount and by count over the eligible base', () => {
    const report = buildBondReport(
      baseInput({
        expenses: [
          { status: ExpenseStatus.PAID, amount: 100, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.PAID, amount: 50, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.PENDING, amount: 50, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.APPROVED, amount: 100, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.REJECTED, amount: 200, categoryId: null, deletedAt: null },
        ],
      }),
    );

    // elegible = 100 + 50 + 50 + 100 = 300 (el rechazado queda afuera)
    expect(report.expenses.totalAmount).toBe(300);
    expect(report.expenses.paidAmount).toBe(150);
    expect(report.expenses.pendingAmount).toBe(150);
    expect(report.expenses.paidAmountPercentage).toBe(50);
    // 2 pagados sobre 4 elegibles
    expect(report.expenses.paidCountPercentage).toBe(50);
  });

  it('S8 keeps rejected and deleted rows out of the totals but shows the rejected one in byStatus', () => {
    const report = buildBondReport(
      baseInput({
        expenses: [
          { status: ExpenseStatus.PAID, amount: 120.5, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.REJECTED, amount: 80, categoryId: null, deletedAt: null },
          { status: ExpenseStatus.PAID, amount: 999, categoryId: null, deletedAt: new Date() },
        ],
      }),
    );

    expect(report.expenses.totalAmount).toBe(120.5);
    expect(report.expenses.paidAmountPercentage).toBe(100);
    expect(report.expenses.paidCountPercentage).toBe(100);
    expect(report.expenses.byStatus).toEqual({
      paid: { count: 1, amount: 120.5 },
      rejected: { count: 1, amount: 80 },
    });
  });

  it('S8 rounds every amount to two decimals and groups the eligible expenses by category', () => {
    const report = buildBondReport(
      baseInput({
        categories: [
          { id: 'cat-food', name: 'Alimentación' },
          { id: 'cat-school', name: 'Educación' },
        ],
        expenses: [
          {
            status: ExpenseStatus.APPROVED,
            amount: 33.335,
            categoryId: 'cat-food',
            deletedAt: null,
          },
          { status: ExpenseStatus.PAID, amount: 10.115, categoryId: 'cat-food', deletedAt: null },
          { status: ExpenseStatus.PENDING, amount: 20, categoryId: 'cat-school', deletedAt: null },
          { status: ExpenseStatus.PENDING, amount: 5, categoryId: null, deletedAt: null },
        ],
      }),
    );

    expect(report.expenses.byCategory).toEqual([
      { categoryId: 'cat-food', categoryName: 'Alimentación', count: 2, amount: 43.45 },
      { categoryId: 'cat-school', categoryName: 'Educación', count: 1, amount: 20 },
      { categoryId: null, categoryName: null, count: 1, amount: 5 },
    ]);
  });

  // ── S6 · Hijos ──────────────────────────────────────────────────

  it('S6 lists every child with its age in years and its activity count', () => {
    const report = buildBondReport(
      baseInput({
        children: [
          { id: 'c1', firstName: 'Mateo', lastName: 'Paz', dateOfBirth: '2020-05-15' },
          { id: 'c2', firstName: 'Lucía', lastName: 'Paz', dateOfBirth: null },
        ],
        childActivityCounts: { c1: 4 },
      }),
    );

    expect(report.children).toEqual([
      {
        id: 'c1',
        firstName: 'Mateo',
        lastName: 'Paz',
        dateOfBirth: '2020-05-15',
        ageInYears: 6,
        activityCount: 4,
      },
      {
        id: 'c2',
        firstName: 'Lucía',
        lastName: 'Paz',
        dateOfBirth: null,
        ageInYears: null,
        activityCount: 0,
      },
    ]);
  });

  // ── S6 · Progenitores ───────────────────────────────────────────

  it('S6 reports each member participation over the activities of the window', () => {
    const report = buildBondReport(
      baseInput({
        members: [
          { userId: 'u1', firstName: 'Ana', lastName: 'Paz', role: 'progenitor' },
          { userId: 'u2', firstName: 'Bruno', lastName: 'Paz', role: 'progenitor' },
          { userId: 'u3', firstName: 'Caro', lastName: 'Ruiz', role: 'coordinador' },
        ],
        activities: [
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.HIGH,
            deadline: null,
            assignedTo: 'u1',
          },
          {
            status: ActivityStatus.ASSIGNED,
            criticality: Criticality.HIGH,
            deadline: null,
            assignedTo: 'u1',
          },
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.LOW,
            deadline: null,
            assignedTo: 'u1',
          },
          {
            status: ActivityStatus.DONE,
            criticality: Criticality.LOW,
            deadline: null,
            assignedTo: 'u2',
          },
        ],
      }),
    );

    expect(report.members).toEqual([
      {
        userId: 'u1',
        firstName: 'Ana',
        lastName: 'Paz',
        role: 'progenitor',
        assigned: 3,
        completed: 2,
        completionPercentage: 66.67,
      },
      {
        userId: 'u2',
        firstName: 'Bruno',
        lastName: 'Paz',
        role: 'progenitor',
        assigned: 1,
        completed: 1,
        completionPercentage: 100,
      },
      {
        userId: 'u3',
        firstName: 'Caro',
        lastName: 'Ruiz',
        role: 'coordinador',
        assigned: 0,
        completed: 0,
        completionPercentage: 0,
      },
    ]);
  });
});
