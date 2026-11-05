import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DatabaseProbe } from './database-probe';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let probe: { ping: jest.Mock };

  beforeEach(async () => {
    probe = { ping: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DatabaseProbe, useValue: probe }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns 200 with ok status when the database is reachable', async () => {
    probe.ping.mockResolvedValueOnce(undefined);

    const result = await controller.check();

    expect(probe.ping).toHaveBeenCalled();
    expect(result).toEqual({ status: 'ok', db: 'ok' });
  });

  it('throws 503 when the database query fails', async () => {
    probe.ping.mockRejectedValue(new Error('connection refused'));

    await expect(controller.check()).rejects.toThrow(HttpException);
    await expect(controller.check()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(probe.ping).toHaveBeenCalled();
  });

  it('returns the expected error body with 503 status', async () => {
    probe.ping.mockRejectedValue(new Error('connection refused'));

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
    expect(probe.ping).toHaveBeenCalled();
  });
});
