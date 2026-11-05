import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { BondsModule } from '../bonds/bonds.module';
import { CategoriesModule } from '../categories/categories.module';
import { Clock } from '../common/clock/clock';
import { SystemClock } from '../common/clock/system-clock';
import { OutboxModule } from '../outbox/outbox.module';
import { ExpenseEntity } from './entities/expense.entity';
import { ExpenseAttachmentEntity } from './entities/expense-attachment.entity';
import { AuthThirdPartyEntity } from './entities/auth-third-party.entity';
import { ThirdActivityParticipationEntity } from './entities/third-activity-participation.entity';
import { ActAttachmentEntity } from '../activities/entities/act-attachment.entity';
import { ExpensePolicyService } from './expense-policy.service';
import { ExpensesRepository } from './repositories/expenses.repository';
import { ExpensesAuditRepository } from './repositories/expenses-audit.repository';
import { ExpenseAttachmentsRepository } from './repositories/expense-attachments.repository';
import { ExpensesService } from './expenses.service';
import { ExpenseAttachmentsService } from './attachments/expense-attachments.service';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpenseEntity,
      ExpenseAttachmentEntity,
      AuthThirdPartyEntity,
      ThirdActivityParticipationEntity,
      AuditLogEntity,
      ActAttachmentEntity,
    ]),
    BondsModule,
    CategoriesModule,
    OutboxModule,
  ],
  controllers: [ExpensesController],
  providers: [
    ExpensesRepository,
    ExpensesAuditRepository,
    ExpenseAttachmentsRepository,
    ExpensePolicyService,
    ExpensesService,
    ExpenseAttachmentsService,
    SystemClock,
    { provide: Clock, useExisting: SystemClock },
  ],
  exports: [ExpensesService, ExpensesRepository, ExpensePolicyService, ExpensesAuditRepository],
})
export class ExpensesModule {}
