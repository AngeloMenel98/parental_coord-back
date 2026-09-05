import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from '../users/entities/user.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { BondEntity } from '../bonds/entities/bond.entity';
import { BondMemberEntity } from '../bonds/entities/bond-member.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      PersonalDataEntity,
      BondEntity,
      BondMemberEntity,
      ChildEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
