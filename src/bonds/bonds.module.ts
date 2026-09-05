import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BondEntity } from './entities/bond.entity';
import { BondMemberEntity } from './entities/bond-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BondEntity, BondMemberEntity])],
  exports: [TypeOrmModule],
})
export class BondsModule {}
