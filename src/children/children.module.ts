import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChildEntity } from './entities/child.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChildEntity])],
  exports: [TypeOrmModule],
})
export class ChildrenModule {}
