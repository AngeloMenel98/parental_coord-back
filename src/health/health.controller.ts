import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseProbe } from './database-probe';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseProbe: DatabaseProbe) {}

  @Get()
  async check() {
    try {
      await this.databaseProbe.ping();
      return { status: 'ok', db: 'ok' };
    } catch {
      throw new HttpException(
        { status: 'error', db: 'unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
