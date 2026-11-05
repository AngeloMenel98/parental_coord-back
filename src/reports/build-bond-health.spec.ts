import {
  buildBondHealthRow,
  buildBondTrend,
  clampPaidPercentage,
  monthKey,
} from './build-bond-health';

/** B4 · S13 — los agregados que alimentan la lista y la tendencia del detalle. */
describe('buildBondHealthRow (B4)', () => {
  const bond = { id: 'bond-1', title: 'Paz–Gómez', agreementType: 'formal', isActive: true };

  it('S13 returns zeroed rates and counts for a bond with no data', () => {
    expect(buildBondHealthRow(bond)).toEqual({
      bondId: 'bond-1',
      title: 'Paz–Gómez',
      agreementType: 'formal',
      isActive: true,
      membersCount: 0,
      childrenCount: 0,
      activitiesTotal: 0,
      completionRate: 0,
      paidAmountPercentage: 0,
    });
  });

  it('S13 rounds both percentages to two decimals', () => {
    const row = buildBondHealthRow(bond, {
      activitiesTotal: 3,
      activitiesCompleted: 2,
      expensesEligibleAmount: 300,
      expensesPaidAmount: 100,
      childrenCount: 2,
      membersCount: 2,
    });

    expect(row.completionRate).toBe(66.67);
    expect(row.paidAmountPercentage).toBe(33.33);
    expect(row.childrenCount).toBe(2);
    expect(row.membersCount).toBe(2);
    expect(row.activitiesTotal).toBe(3);
  });

  it('S13 never reports a paid percentage above 100', () => {
    expect(clampPaidPercentage(123.456)).toBe(100);
    expect(clampPaidPercentage(62.004)).toBe(62);
  });
});

describe('buildBondTrend (B4)', () => {
  const reference = new Date('2026-06-30T12:00:00.000Z');

  it('S13 emits every month of the window, oldest first, ending on the reference month', () => {
    const series = buildBondTrend([], 3, reference);

    expect(series.map((point) => point.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(series.every((point) => point.completionRate === 0)).toBe(true);
    expect(series.every((point) => point.activitiesTotal === 0)).toBe(true);
  });

  it('S13 maps the aggregated rows onto their month and computes the rate', () => {
    const series = buildBondTrend(
      [
        { month: '2026-05', activitiesTotal: 10, activitiesCompleted: 6 },
        { month: '2026-06', activitiesTotal: 3, activitiesCompleted: 2 },
      ],
      3,
      reference,
    );

    expect(series).toEqual([
      { month: '2026-04', activitiesTotal: 0, completionRate: 0 },
      { month: '2026-05', activitiesTotal: 10, completionRate: 60 },
      { month: '2026-06', activitiesTotal: 3, completionRate: 66.67 },
    ]);
  });

  it('S13 crosses the year boundary correctly', () => {
    const series = buildBondTrend([], 3, new Date('2026-01-15T00:00:00.000Z'));

    expect(series.map((point) => point.month)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('S13 keys months in UTC', () => {
    expect(monthKey(new Date('2026-06-30T23:59:00.000Z'))).toBe('2026-06');
    expect(monthKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
  });
});
