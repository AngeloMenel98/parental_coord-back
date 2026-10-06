import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChildEntity } from './entities/child.entity';
import { ChildrenController } from './children.controller';
import { ChildController } from './child.controller';
import { ChildrenService } from './children.service';
import { BondsModule } from '../bonds/bonds.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChildEntity]),
    forwardRef(() => BondsModule),
  ],
  controllers: [ChildrenController, ChildController],
  providers: [ChildrenService],
  exports: [ChildrenService],
})
export class ChildrenModule {}
