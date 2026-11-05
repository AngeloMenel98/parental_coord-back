import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { REPORT_PDF_QUEUE } from './report-pdf.constants';
import { ReportPdfProducer } from './report-pdf.producer';

/** B3 · S9 — lado API: sólo encola. El processor vive en `ReportPdfWorkerModule`. */
@Module({
  imports: [BullModule.registerQueue({ name: REPORT_PDF_QUEUE })],
  providers: [ReportPdfProducer],
  exports: [ReportPdfProducer],
})
export class ReportPdfModule {}
