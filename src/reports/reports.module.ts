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
import { AdminReportsController } from './admin-reports.controller';
import { BondReportService } from './bond-report.service';
import { ReportEntity } from './entities/report.entity';
import { BondReportRepository } from './repositories/bond-report.repository';

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
  ],
  controllers: [AdminReportsController],
  providers: [
    BondReportService,
    BondReportRepository,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [BondReportService],
})
export class ReportsModule {}
