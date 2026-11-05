import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogEntity } from './entities/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
})
export class AuditModule {}
