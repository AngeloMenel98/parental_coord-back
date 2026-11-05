import { BadRequestException, NotFoundException } from '@nestjs/common';

import { BondHealthService } from './bond-health.service';

/** B4 · S13 — la ventana y el 404 de la salud por vínculo y la tendencia. */
describe('BondHealthService (B4)', () => {
  const BOND = 'bond-1';
  const NOW = new Date('2026-06-30T12:00:00.000Z');

  let service: BondHealthService;
  let repo: {
    findBonds: jest.Mock;
    aggregatesByBond: jest.Mock;
    bondExists: jest.Mock;
    trendByMonth: jest.Mock;
  };
  const clock = { now: () => NOW };

  beforeEach(() => {
    repo = {
      findBonds: jest
        .fn()
        .mockResolvedValue([
          { id: BOND, title: 'Paz–Gómez', agreementType: 'formal', isActive: true },
        ]),
      aggregatesByBond: jest.fn().mockResolvedValue(
        new Map([
          [
            BOND,
            {
              activitiesTotal: 42,
              activitiesCompleted: 31,
              expensesEligibleAmount: 248500,
              expensesPaidAmount: 154070,
              childrenCount: 2,
              membersCount: 2,
            },
          ],
        ]),
      ),
      bondExists: jest.fn().mockResolvedValue({ id: BOND }),
      trendByMonth: jest.fn().mockResolvedValue([]),
    };
    service = new BondHealthService(repo as never, clock as never);
  });

  it('S13 translates the inclusive period into the exclusive aggregate window', async () => {
    await service.health({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });

    expect(repo.aggregatesByBond).toHaveBeenCalledWith(
      [BOND],
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );
  });

  it('S13 joins the aggregates onto the bonds and computes both percentages', async () => {
    const rows = await service.health({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });

    expect(rows).toEqual([
      {
        bondId: BOND,
        title: 'Paz–Gómez',
        agreementType: 'formal',
        isActive: true,
        membersCount: 2,
        childrenCount: 2,
        activitiesTotal: 42,
        completionRate: 73.81,
        paidAmountPercentage: 62,
      },
    ]);
  });

  it('S13 rejects a period that ends before it starts', async () => {
    await expect(service.health({ dateFrom: '2026-06-30', dateTo: '2026-06-01' })).rejects.toThrow(
      new BadRequestException('dateTo must be on or after dateFrom'),
    );
    expect(repo.findBonds).not.toHaveBeenCalled();
  });

  it('S13 queries the trend over the window ending with the current month', async () => {
    await service.trend(BOND, 3);

    expect(repo.trendByMonth).toHaveBeenCalledWith(
      BOND,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );
  });

  it('S13 answers 404 with the documented message for an unknown bond', async () => {
    repo.bondExists.mockResolvedValue(null);

    await expect(service.trend('missing')).rejects.toThrow(
      new NotFoundException('Bond missing not found'),
    );
    expect(repo.trendByMonth).not.toHaveBeenCalled();
  });

  it('S13 rejects a month count outside 1..12', async () => {
    await expect(service.trend(BOND, 0)).rejects.toThrow(
      new BadRequestException('months must be between 1 and 12'),
    );
    await expect(service.trend(BOND, 13)).rejects.toThrow(BadRequestException);
  });
});
