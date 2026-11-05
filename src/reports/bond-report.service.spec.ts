import { BadRequestException, NotFoundException } from '@nestjs/common';

import { BondReportService } from './bond-report.service';

/**
 * B2 · S6 — la ventana del reporte.
 *
 * El builder puro ya está probado aparte; acá se fija la traducción de fechas
 * (inclusivas para el usuario, exclusivas para la consulta), el 404 y que
 * `generatedAt` salga del reloj inyectado.
 */
describe('BondReportService (B2)', () => {
  const BOND = 'bond-1';
  const FROM = '2026-06-01';
  const TO = '2026-06-30';
  const NOW = new Date('2026-06-30T12:00:00.000Z');

  let service: BondReportService;
  let repo: {
    findBond: jest.Mock;
    findActivities: jest.Mock;
    findExpenses: jest.Mock;
    findCategoriesByIds: jest.Mock;
    findChildren: jest.Mock;
    findChildActivityCounts: jest.Mock;
    findMembers: jest.Mock;
  };
  const clock = { now: () => NOW };

  beforeEach(() => {
    repo = {
      findBond: jest.fn().mockResolvedValue({ id: BOND, title: 'Acuerdo Paz' }),
      findActivities: jest.fn().mockResolvedValue([]),
      findExpenses: jest.fn().mockResolvedValue([]),
      findCategoriesByIds: jest.fn().mockResolvedValue([]),
      findChildren: jest.fn().mockResolvedValue([]),
      findChildActivityCounts: jest.fn().mockResolvedValue({}),
      findMembers: jest.fn().mockResolvedValue([]),
    };
    service = new BondReportService(repo as never, clock as never);
  });

  it('S6 translates inclusive user dates into an exclusive query window', async () => {
    await service.build(BOND, { dateFrom: FROM, dateTo: TO });

    expect(repo.findActivities).toHaveBeenCalledWith(
      BOND,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );
    expect(repo.findExpenses).toHaveBeenCalledWith(BOND, '2026-06-01', '2026-07-01');
    expect(repo.findChildActivityCounts).toHaveBeenCalledWith(
      BOND,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );
  });

  it('S6 stamps generatedAt from the injected clock and echoes the period', async () => {
    const report = await service.build(BOND, { dateFrom: FROM, dateTo: TO });

    expect(report.generatedAt).toBe('2026-06-30T12:00:00.000Z');
    expect(report.dateFrom).toBe(FROM);
    expect(report.dateTo).toBe(TO);
    expect(report.bondTitle).toBe('Acuerdo Paz');
  });

  it('S6 answers 404 with the documented message for an unknown bond', async () => {
    repo.findBond.mockResolvedValue(null);

    await expect(service.build('missing', { dateFrom: FROM, dateTo: TO })).rejects.toThrow(
      new NotFoundException('Bond missing not found'),
    );
    expect(repo.findActivities).not.toHaveBeenCalled();
  });

  it('S6 rejects a period that ends before it starts', async () => {
    await expect(service.build(BOND, { dateFrom: TO, dateTo: FROM })).rejects.toThrow(
      new BadRequestException('dateTo must be on or after dateFrom'),
    );
  });
});
