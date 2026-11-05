import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivityEntity } from '../activities/entities/activity.entity';
import { BondMemberEntity } from '../bonds/entities/bond-member.entity';
import { BondEntity } from '../bonds/entities/bond.entity';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { Clock } from '../common/clock/clock';
import { SystemClock } from '../common/clock/system-clock';
import { ExpenseEntity } from '../expenses/entities/expense.entity';
import { StorageModule } from '../storage/storage.module';
import { AdminReportsController } from './admin-reports.controller';
import { BondReportService } from './bond-report.service';
import { ReportEntity } from './entities/report.entity';
import { REPORT_PDF_RENDERER } from './pdf/report-pdf.constants';
import { ReportPdfModule } from './pdf/report-pdf.module';
import { renderBondReportPdf } from './pdf/render-bond-report-pdf';
import { BondReportRepository } from './repositories/bond-report.repository';
import { ReportsRepository } from './repositories/reports.repository';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportEntity,
      BondEntity,
      BondMemberEntity,
      ActivityEntity,
      ExpenseEntity,
      CategoryEntity,
      ChildEntity,
    ]),
    ReportPdfModule,
    StorageModule,
  ],
  controllers: [AdminReportsController],
  providers: [
    BondReportService,
    BondReportRepository,
    ReportsService,
    ReportsRepository,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
    { provide: REPORT_PDF_RENDERER, useValue: renderBondReportPdf },
  ],
  exports: [BondReportService, ReportsService, ReportsRepository],
})
export class ReportsModule {}
