import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ReportsService } from './reports.service';

/**
 * B3 · S9-S11 — ciclo de vida del reporte PDF.
 *
 * La generación del PDF se mockea acá (tiene su propio spec con pdfkit real); lo
 * que se fija es el contrato: qué fila se crea, qué se encola, cuándo se marca
 * completado y qué pasa cuando el storage falla.
 */
describe('ReportsService (B3)', () => {
  const BOND = 'bond-1';
  const REPORT = 'report-1';
  const ADMIN = 'admin-1';
  const NOW = new Date('2026-06-30T12:00:00.000Z');
  const PERIOD = { dateFrom: '2026-06-01', dateTo: '2026-06-30' };

  let service: ReportsService;
  let reportsRepo: {
    findBond: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    list: jest.Mock;
    markCompleted: jest.Mock;
  };
  let reportService: { build: jest.Mock };
  let producer: { enqueue: jest.Mock };
  let storage: {
    isEnabled: jest.Mock;
    uploadObject: jest.Mock;
    createSignedReportDownloadUrl: jest.Mock;
  };
  let renderer: jest.Mock;
  const clock = { now: () => NOW };

  const row = (over: Record<string, unknown> = {}) => ({
    id: REPORT,
    bondId: BOND,
    requestedBy: ADMIN,
    generatedBy: null,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    status: 'requested',
    fileUrl: null,
    generatedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    reportsRepo = {
      findBond: jest.fn().mockResolvedValue({ id: BOND }),
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      markCompleted: jest.fn(),
    };
    reportService = { build: jest.fn().mockResolvedValue({ bondId: BOND }) };
    producer = { enqueue: jest.fn() };
    storage = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadObject: jest.fn().mockResolvedValue('reports/bond-1/report-1.pdf'),
      createSignedReportDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example/report.pdf'),
    };
    renderer = jest.fn().mockResolvedValue(Buffer.from('%PDF-1.3 fake'));

    service = new ReportsService(
      reportsRepo as never,
      reportService as never,
      producer as never,
      storage as never,
      clock as never,
      renderer,
    );
  });

  // ── S9 · Solicitud ──────────────────────────────────────────────

  it('S9 creates a requested row and enqueues exactly one PDF job', async () => {
    reportsRepo.create.mockResolvedValue(row());

    const result = await service.requestPdf(BOND, PERIOD, ADMIN);

    expect(reportsRepo.create).toHaveBeenCalledWith({
      bondId: BOND,
      requestedBy: ADMIN,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      status: 'requested',
    });
    expect(producer.enqueue).toHaveBeenCalledTimes(1);
    expect(producer.enqueue).toHaveBeenCalledWith(REPORT);
    expect(result).toEqual({
      id: REPORT,
      status: 'requested',
      bondId: BOND,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });
  });

  it('S9 answers 404 with the documented message for an unknown bond', async () => {
    reportsRepo.findBond.mockResolvedValue(null);

    await expect(service.requestPdf('missing', PERIOD, ADMIN)).rejects.toThrow(
      new NotFoundException('Bond missing not found'),
    );
    expect(reportsRepo.create).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('S9 answers 400 when the period ends before it starts', async () => {
    await expect(
      service.requestPdf(BOND, { dateFrom: '2026-06-30', dateTo: '2026-06-01' }, ADMIN),
    ).rejects.toThrow(new BadRequestException('dateTo must be on or after dateFrom'));
    expect(reportsRepo.create).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  // ── S10 · Consulta ─────────────────────────────────────────────

  it('S10 answers 404 with the documented message for an unknown report', async () => {
    reportsRepo.findById.mockResolvedValue(null);

    await expect(service.getReport('missing')).rejects.toThrow(
      new NotFoundException('Report missing not found'),
    );
  });

  it('S10 returns a null fileUrl while the report is not completed', async () => {
    reportsRepo.findById.mockResolvedValue(row({ status: 'in_progress' }));

    const result = await service.getReport(REPORT);

    expect(result.fileUrl).toBeNull();
    expect(storage.createSignedReportDownloadUrl).not.toHaveBeenCalled();
  });

  it('S10 returns a signed download URL once the report is completed', async () => {
    reportsRepo.findById.mockResolvedValue(
      row({ status: 'completed', fileUrl: 'reports/bond-1/report-1.pdf', generatedAt: NOW }),
    );

    const result = await service.getReport(REPORT);

    expect(storage.createSignedReportDownloadUrl).toHaveBeenCalledWith(
      'reports/bond-1/report-1.pdf',
    );
    expect(result.fileUrl).toBe('https://signed.example/report.pdf');
    expect(result.status).toBe('completed');
  });

  it('S10 lists reports newest first, optionally filtered by bond', async () => {
    reportsRepo.list.mockResolvedValue([row()]);

    const result = await service.listReports(BOND);

    expect(reportsRepo.list).toHaveBeenCalledWith(BOND);
    expect(result).toEqual([
      {
        id: REPORT,
        bondId: BOND,
        status: 'requested',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        fileUrl: null,
        generatedAt: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
  });

  // ── S11 · Generación ───────────────────────────────────────────

  it('S11 renders, uploads and marks the report completed', async () => {
    reportsRepo.findById.mockResolvedValue(row());
    reportService.build.mockResolvedValue({ bondId: BOND, activities: {} });

    await service.generatePdf(REPORT);

    expect(reportService.build).toHaveBeenCalledWith(BOND, {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });
    expect(renderer).toHaveBeenCalledWith({ bondId: BOND, activities: {} });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      `reports/${BOND}/${REPORT}.pdf`,
      expect.any(Buffer),
      'application/pdf',
    );
    expect(reportsRepo.markCompleted).toHaveBeenCalledWith(REPORT, {
      fileUrl: `reports/${BOND}/${REPORT}.pdf`,
      generatedAt: NOW,
      generatedBy: ADMIN,
    });
  });

  it('S11 never marks the report completed when rendering fails', async () => {
    reportsRepo.findById.mockResolvedValue(row());
    renderer.mockRejectedValue(new Error('pdfkit exploded'));

    await expect(service.generatePdf(REPORT)).rejects.toThrow('pdfkit exploded');

    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(reportsRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('S11 never marks the report completed when the upload returns no path', async () => {
    reportsRepo.findById.mockResolvedValue(row());
    storage.uploadObject.mockResolvedValue(null);

    await expect(service.generatePdf(REPORT)).rejects.toThrow('storage is not configured');

    expect(reportsRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('S11 skips a report that is already completed', async () => {
    reportsRepo.findById.mockResolvedValue(row({ status: 'completed' }));

    await service.generatePdf(REPORT);

    expect(renderer).not.toHaveBeenCalled();
    expect(reportsRepo.markCompleted).not.toHaveBeenCalled();
  });

  it('S11 answers 404 when the queued report no longer exists', async () => {
    reportsRepo.findById.mockResolvedValue(null);

    await expect(service.generatePdf('missing')).rejects.toThrow(
      new NotFoundException('Report missing not found'),
    );
  });
});
