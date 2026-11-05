import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseProbe {
  constructor(private readonly ds: DataSource) {}

  async ping(): Promise<void> {
    await this.ds.query('SELECT 1');
  }
}
