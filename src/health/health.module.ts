import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseProbe } from './database-probe';

@Module({
  controllers: [HealthController],
  providers: [DatabaseProbe],
})
export class HealthModule {}
