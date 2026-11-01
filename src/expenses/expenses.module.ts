import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { CategoriesModule } from '../categories/categories.module';
import { Clock } from '../common/clock/clock';
import { SystemClock } from '../common/clock/system-clock';
import { ExpenseEntity } from './entities/expense.entity';
import { ExpenseAttachmentEntity } from './entities/expense-attachment.entity';
import { AuthThirdPartyEntity } from './entities/auth-third-party.entity';
import { ThirdActivityParticipationEntity } from './entities/third-activity-participation.entity';
import { ExpensePolicyService } from './expense-policy.service';
import { ExpensesRepository } from './repositories/expenses.repository';
import { ExpensesAuditRepository } from './repositories/expenses-audit.repository';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpenseEntity,
      ExpenseAttachmentEntity,
      AuthThirdPartyEntity,
      ThirdActivityParticipationEntity,
      AuditLogEntity,
    ]),
    BondsModule,
    CategoriesModule,
  ],
  controllers: [ExpensesController],
  providers: [
    ExpensesRepository,
    ExpensesAuditRepository,
    ExpensePolicyService,
    ExpensesService,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ExpensesService, ExpensesRepository, ExpensePolicyService, ExpensesAuditRepository],
})
export class ExpensesModule {}
