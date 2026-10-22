import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { WebhookDeliveryAttemptRepository } from './webhook-delivery-attempt.repository';
import { WebhookDeliveryAttemptEntity } from '../entities/webhook-delivery-attempt.entity';

describe('WebhookDeliveryAttemptRepository', () => {
  let repo: WebhookDeliveryAttemptRepository;
  let attemptRepo: jest.Mocked<Repository<WebhookDeliveryAttemptEntity>>;

  beforeEach(async () => {
    attemptRepo = {
      create: jest.fn((data: any) => data),
      save: jest.fn((e: any) => Promise.resolve(e)),
      find: jest.fn().mockResolvedValue([]),
      target: WebhookDeliveryAttemptEntity,
      manager: {},
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryAttemptRepository,
        { provide: getRepositoryToken(WebhookDeliveryAttemptEntity), useValue: attemptRepo },
      ],
    }).compile();

    repo = module.get(WebhookDeliveryAttemptRepository);
  });

  it('insertAttempt persists a row with the given fields', async () => {
    const startedAt = new Date('2026-10-01T00:00:00Z');
    await repo.insertAttempt({
      deliveryId: 'd1',
      attemptNo: 1,
      startedAt,
      durationMs: 42,
      statusCode: 500,
      responseSnippet: 'boom',
      error: 'Server Error',
    });

    expect(attemptRepo.save).toHaveBeenCalledWith({
      deliveryId: 'd1',
      attemptNo: 1,
      startedAt,
      durationMs: 42,
      statusCode: 500,
      responseSnippet: 'boom',
      error: 'Server Error',
    });
  });

  it('insertAttempt defaults missing optionals to null', async () => {
    await repo.insertAttempt({
      deliveryId: 'd1',
      attemptNo: 2,
      startedAt: new Date('2026-10-01T00:00:00Z'),
    });

    const saved = attemptRepo.save.mock.calls[0][0] as any;
    expect(saved.durationMs).toBeNull();
    expect(saved.statusCode).toBeNull();
    expect(saved.responseSnippet).toBeNull();
    expect(saved.error).toBeNull();
  });

  it('findByDelivery orders by attempt number', async () => {
    await repo.findByDelivery('d1');
    expect(attemptRepo.find).toHaveBeenCalledWith({
      where: { deliveryId: 'd1' },
      order: { attemptNo: 'ASC' },
    });
  });

  it('findByDeliveryIds batches the query (no N+1)', async () => {
    await repo.findByDeliveryIds(['d1', 'd2']);
    expect(attemptRepo.find).toHaveBeenCalledWith({
      where: { deliveryId: In(['d1', 'd2']) },
      order: { attemptNo: 'ASC' },
    });
  });

  it('findByDeliveryIds short-circuits an empty list', async () => {
    expect(await repo.findByDeliveryIds([])).toEqual([]);
    expect(attemptRepo.find).not.toHaveBeenCalled();
  });
});
