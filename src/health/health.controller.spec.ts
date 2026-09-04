import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DataSource, useValue: dataSource }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns 200 with ok status when the database is reachable', async () => {
    dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);

    const result = await controller.check();

    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    expect(result).toEqual({ status: 'ok', db: 'ok' });
  });

  it('throws 503 when the database query fails', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toThrow(HttpException);
    await expect(controller.check()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns the expected error body with 503 status', async () => {
    dataSource.query.mockRejectedValue(new Error('connection refused'));

    try {
      await controller.check();
      fail('Expected check() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const exception = err as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(exception.getResponse()).toEqual({
        status: 'error',
        db: 'unavailable',
      });
    }
  });
});
