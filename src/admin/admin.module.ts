import { Module } from '@nestjs/common';
import { BondsModule } from '../bonds/bonds.module';
import { UsersModule } from '../users/users.module';
import { ChildrenModule } from '../children/children.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [UsersModule, BondsModule, ChildrenModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
