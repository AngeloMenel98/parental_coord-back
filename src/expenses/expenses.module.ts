import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExpenseEntity } from './entities/expense.entity';
import { ExpenseAttachmentEntity } from './entities/expense-attachment.entity';
import { AuthThirdPartyEntity } from './entities/auth-third-party.entity';
import { ThirdActivityParticipationEntity } from './entities/third-activity-participation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpenseEntity,
      ExpenseAttachmentEntity,
      AuthThirdPartyEntity,
      ThirdActivityParticipationEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class ExpensesModule {}
