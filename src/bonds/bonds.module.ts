import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BondEntity } from './entities/bond.entity';
import { BondMemberEntity } from './entities/bond-member.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { PersonalDataEntity } from '../users/entities/personal-data.entity';
import { BondsRepository } from './repositories/bonds.repository';
import { BondsService } from './bonds.service';
import { BondsController } from './bonds.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BondEntity, BondMemberEntity, ChildEntity, PersonalDataEntity]),
  ],
  controllers: [BondsController],
  providers: [BondsRepository, BondsService],
  exports: [TypeOrmModule, BondsRepository],
})
export class BondsModule {}
