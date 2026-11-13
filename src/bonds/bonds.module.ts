import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BondEntity } from './entities/bond.entity';
import { BondMemberEntity } from './entities/bond-member.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { BondsRepository } from './repositories/bonds.repository';
import { BondMembersRepository } from './repositories/bond-members.repository';
import { BondsService } from './bonds.service';
import { BondAccessService } from './bond-access.service';
import { BondsController } from './bonds.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BondEntity, BondMemberEntity, ChildEntity, PersonalDataEntity]),
  ],
  controllers: [BondsController],
  providers: [BondsRepository, BondMembersRepository, BondsService, BondAccessService],
  exports: [BondsRepository, BondMembersRepository, BondsService, BondAccessService],
})
export class BondsModule {}
