import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ReportsService } from '../reports.service';
import { REPORT_PDF_QUEUE, ReportPdfJobData } from './report-pdf.constants';

/**
 * B3 · S11 — worker del PDF.
 *
 * Deliberadamente delgado: el ciclo de vida (render → upload → `completed`) vive
 * en `ReportsService.generatePdf`, que sí tiene spec. Acá sólo se rethrow-ea para
 * que BullMQ aplique el `attempts: 2` del producer.
 */
@Processor(REPORT_PDF_QUEUE)
export class ReportPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportPdfProcessor.name);

  constructor(private readonly reportsService: ReportsService) {
    super();
  }

  async process(job: Job<ReportPdfJobData>): Promise<void> {
    const { reportId } = job.data;
    try {
      await this.reportsService.generatePdf(reportId);
    } catch (error) {
      this.logger.error(
        `Report PDF generation failed for ${reportId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
