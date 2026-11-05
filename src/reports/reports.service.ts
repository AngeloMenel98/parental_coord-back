import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Clock } from '../common/clock/clock';
import { StorageService } from '../storage/storage.service';
import { BondReport, BondReportInput } from './build-bond-report';
import { BondReportService, BondReportPeriod } from './bond-report.service';
import { ReportEntity, ReportStatus } from './entities/report.entity';
import { REPORT_PDF_RENDERER, BondReportRenderer } from './pdf/report-pdf.constants';
import { ReportPdfProducer } from './pdf/report-pdf.producer';
import { ReportsRepository } from './repositories/reports.repository';

export interface ReportView {
  id: string;
  bondId: string;
  status: ReportStatus;
  dateFrom: string;
  dateTo: string;
  fileUrl: string | null;
  generatedAt: Date | null;
  createdAt: Date;
}

/**
 * B3 · S9-S11 — ciclo de vida del reporte PDF.
 *
 * `requestPdf` crea la fila en `requested` y encola; `generatePdf` corre en el
 * worker (render → upload → `completed`). `getReport`/`listReports` traducen el
 * path guardado en `file_url` a una URL firmada, igual que los adjuntos.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly bondReportService: BondReportService,
    private readonly producer: ReportPdfProducer,
    private readonly storage: StorageService,
    private readonly clock: Clock,
    @Inject(REPORT_PDF_RENDERER)
    private readonly renderBondReportPdf: BondReportRenderer,
  ) {}

  async requestPdf(bondId: string, period: BondReportPeriod, requestedBy: string) {
    if (period.dateTo < period.dateFrom) {
      throw new BadRequestException('dateTo must be on or after dateFrom');
    }

    const bond = await this.repo.findBond(bondId);
    if (!bond) throw new NotFoundException(`Bond ${bondId} not found`);

    const report = await this.repo.create({
      bondId,
      requestedBy,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      status: ReportStatus.REQUESTED,
    });

    await this.producer.enqueue(report.id);

    return {
      id: report.id,
      status: report.status,
      bondId: report.bondId,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
    };
  }

  async getReport(id: string): Promise<ReportView> {
    return this.toView(await this.mustFind(id));
  }

  async listReports(bondId?: string): Promise<ReportView[]> {
    const rows = await this.repo.list(bondId);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  /**
   * S11 — render, upload y cierre. Idempotente: un job reintentado sobre un
   * reporte ya completado no vuelve a renderizar. Cualquier falla se propaga sin
   * tocar el estado, así BullMQ puede reintentar y la fila nunca queda
   * `completed` con un `file_url` que no existe.
   */
  async generatePdf(reportId: string): Promise<void> {
    const report = await this.mustFind(reportId);
    if (this.isFinished(report.status)) return;

    const data = await this.bondReportService.build(report.bondId, {
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
    });

    const pdf = await this.renderBondReportPdf(data);
    const path = `reports/${report.bondId}/${report.id}.pdf`;
    const stored = await this.storage.uploadObject(path, pdf, 'application/pdf');
    if (!stored) {
      throw new Error(`Report PDF not stored: storage is not configured (report ${report.id})`);
    }

    await this.repo.markCompleted(report.id, {
      fileUrl: stored,
      generatedAt: this.clock.now(),
      generatedBy: report.requestedBy,
    });
  }

  private isFinished(status: ReportStatus): boolean {
    return status === ReportStatus.COMPLETED || status === ReportStatus.DELIVERED;
  }

  private async mustFind(id: string): Promise<ReportEntity> {
    const report = await this.repo.findById(id);
    if (!report) throw new NotFoundException(`Report ${id} not found`);
    return report;
  }

  private async toView(report: ReportEntity): Promise<ReportView> {
    const fileUrl =
      this.isFinished(report.status) && report.fileUrl
        ? await this.storage.createSignedReportDownloadUrl(report.fileUrl)
        : null;

    return {
      id: report.id,
      bondId: report.bondId,
      status: report.status,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
      fileUrl,
      generatedAt: report.generatedAt,
      createdAt: report.createdAt,
    };
  }
}

/** Re-export para que los tests puedan tipar el renderer sin otro import. */
export type { BondReport, BondReportInput };
