import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from '../audit/entities/audit-log.entity';
import { ExpenseEntity } from './entities/expense.entity';
import { ExpenseAttachmentEntity } from './entities/expense-attachment.entity';
import { AuthThirdPartyEntity } from './entities/auth-third-party.entity';
import { ThirdActivityParticipationEntity } from './entities/third-activity-participation.entity';
import { ExpensePolicyService } from './expense-policy.service';
import { ExpensesAuditRepository } from './repositories/expenses-audit.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpenseEntity,
      ExpenseAttachmentEntity,
      AuthThirdPartyEntity,
      ThirdActivityParticipationEntity,
      AuditLogEntity,
    ]),
  ],
  providers: [ExpensePolicyService, ExpensesAuditRepository],
  exports: [ExpensePolicyService, ExpensesAuditRepository],
})
export class ExpensesModule {}
