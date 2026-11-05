import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReportEntity } from '../entities/report.entity';
import { ReportsModule } from '../reports.module';
import { REPORT_PDF_QUEUE } from './report-pdf.constants';
import { ReportPdfProcessor } from './report-pdf.processor';

/**
 * B3 · S11 — el worker del PDF, igual que `ActivityTimersWorkerModule`: se
 * registra sólo en `WorkerModule`, no en `AppModule`, para que la API no procese
 * jobs que le corresponden al worker.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: REPORT_PDF_QUEUE }),
    TypeOrmModule.forFeature([ReportEntity]),
    ReportsModule,
  ],
  providers: [ReportPdfProcessor],
})
export class ReportPdfWorkerModule {}
