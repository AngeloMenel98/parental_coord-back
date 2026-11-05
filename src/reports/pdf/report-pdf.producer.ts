import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { REPORT_PDF_QUEUE, ReportPdfJobData } from './report-pdf.constants';

/**
 * B3 · S9 — encola la generación del PDF.
 *
 * Igual que `ActivityTimersProducer`: nunca rompe la request. Si Redis no
 * responde, se loguea y el reporte queda en `requested`; un reintento manual del
 * admin (volver a pedirlo) es la recuperación, no una excepción al usuario.
 */
@Injectable()
export class ReportPdfProducer {
  private readonly logger = new Logger(ReportPdfProducer.name);

  constructor(
    @InjectQueue(REPORT_PDF_QUEUE)
    private readonly queue: Queue<ReportPdfJobData>,
  ) {}

  async enqueue(reportId: string): Promise<void> {
    try {
      await this.queue.add(
        'render',
        { reportId },
        {
          jobId: `report-pdf:${reportId}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: { count: 500 },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue the PDF job for report ${reportId}: ${(error as Error).message}`,
      );
    }
  }
}
