import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch {
      throw new HttpException(
        { status: 'error', db: 'unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
