import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ActivityEntity } from '../activities/entities/activity.entity';
import { BondMemberEntity } from '../bonds/entities/bond-member.entity';
import { BondEntity } from '../bonds/entities/bond.entity';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { ExpenseEntity } from '../expenses/entities/expense.entity';
import { StorageService } from '../storage/storage.service';
import { AdminReportsController } from './admin-reports.controller';
import { BondReportService } from './bond-report.service';
import { ReportEntity } from './entities/report.entity';
import { REPORT_PDF_QUEUE } from './pdf/report-pdf.constants';
import { ReportsModule } from './reports.module';
import { ReportsService } from './reports.service';

/**
 * B3 · el grafo de DI del módulo de reportes.
 *
 * Los specs de servicio mockean sus dependencias a mano, así que un token mal
 * registrado en `ReportsModule` no lo ve nadie hasta el boot. Este test compila el
 * módulo real: si falta un provider o un `forFeature`, falla acá y no en producción.
 */
describe('ReportsModule wiring (B3)', () => {
  const repoStub = () => ({ find: jest.fn(), findOne: jest.fn(), update: jest.fn() });

  it('resolves the reports services and controller', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ReportsModule] })
      .overrideProvider(getRepositoryToken(ReportEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(BondEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(BondMemberEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(ActivityEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(ExpenseEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(CategoryEntity))
      .useValue(repoStub())
      .overrideProvider(getRepositoryToken(ChildEntity))
      .useValue(repoStub())
      .overrideProvider(getQueueToken(REPORT_PDF_QUEUE))
      .useValue({ add: jest.fn() })
      .overrideProvider(StorageService)
      .useValue({ uploadObject: jest.fn(), createSignedReportDownloadUrl: jest.fn() })
      .compile();

    expect(moduleRef.get(ReportsService)).toBeInstanceOf(ReportsService);
    expect(moduleRef.get(BondReportService)).toBeInstanceOf(BondReportService);
    expect(moduleRef.get(AdminReportsController)).toBeInstanceOf(AdminReportsController);
  });
});
