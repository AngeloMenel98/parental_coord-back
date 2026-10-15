import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookDeliveryRepository } from './webhook-delivery.repository';
import { WebhookDeliveryEntity, WebhookDeliveryStatus } from '../entities/webhook-delivery.entity';

describe('WebhookDeliveryRepository', () => {
  let repo: WebhookDeliveryRepository;
  let deliveryRepo: jest.Mocked<Repository<WebhookDeliveryEntity>>;
  let insertQb: any;

  beforeEach(async () => {
    insertQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'd1' }] }),
    };

    deliveryRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(insertQb),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      target: WebhookDeliveryEntity,
      manager: {},
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDeliveryRepository,
        { provide: getRepositoryToken(WebhookDeliveryEntity), useValue: deliveryRepo },
      ],
    }).compile();

    repo = module.get(WebhookDeliveryRepository);
  });

  describe('insertOnConflictDoNothing (REQ-DATA-2/REQ-DISP-3)', () => {
    it('inserts with orIgnore + returning and reports true when a row was created', async () => {
      const inserted = await repo.insertOnConflictDoNothing({
        eventId: 'e1',
        subscriptionId: 's1',
      });

      expect(inserted).toBe(true);
      expect(insertQb.into).toHaveBeenCalledWith(WebhookDeliveryEntity);
      expect(insertQb.values).toHaveBeenCalledWith({
        eventId: 'e1',
        subscriptionId: 's1',
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: null,
      });
      expect(insertQb.orIgnore).toHaveBeenCalled();
      expect(insertQb.returning).toHaveBeenCalledWith('id');
    });

    it('reports false when the unique constraint collapses the insert (no raw rows)', async () => {
      insertQb.execute.mockResolvedValueOnce({ raw: [] });
      const inserted = await repo.insertOnConflictDoNothing({
        eventId: 'e1',
        subscriptionId: 's1',
      });
      expect(inserted).toBe(false);
    });
  });

  it('findByEventSub queries the (event, subscription) pair', async () => {
    await repo.findByEventSub('e1', 's1');
    expect(deliveryRepo.findOne).toHaveBeenCalledWith({
      where: { eventId: 'e1', subscriptionId: 's1' },
    });
  });

  it('findBySubscriptionPaginated orders newest-first with skip/take', async () => {
    await repo.findBySubscriptionPaginated('s1', 20, 10);
    expect(deliveryRepo.find).toHaveBeenCalledWith({
      where: { subscriptionId: 's1' },
      order: { createdAt: 'DESC' },
      skip: 20,
      take: 10,
    });
  });

  it('countBySubscription counts the subscription deliveries', async () => {
    deliveryRepo.count.mockResolvedValueOnce(3);
    expect(await repo.countBySubscription('s1')).toBe(3);
    expect(deliveryRepo.count).toHaveBeenCalledWith({ where: { subscriptionId: 's1' } });
  });

  it('updateStatus patches the row', async () => {
    await repo.updateStatus('d1', {
      status: WebhookDeliveryStatus.DEAD,
      attemptCount: 8,
      completedAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(deliveryRepo.update).toHaveBeenCalledWith('d1', {
      status: WebhookDeliveryStatus.DEAD,
      attemptCount: 8,
      completedAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('findDeadBySubscription filters by DEAD status (replay-dead, REQ-LOG-2)', async () => {
    await repo.findDeadBySubscription('s1');
    expect(deliveryRepo.find).toHaveBeenCalledWith({
      where: { subscriptionId: 's1', status: WebhookDeliveryStatus.DEAD },
      order: { createdAt: 'ASC' },
    });
  });

  it('findReconcilable selects PENDING/RETRYING due deliveries (REQ-NFR-2)', async () => {
    const now = new Date('2026-10-01T00:00:00Z');
    await repo.findReconcilable(now);
    const arg = deliveryRepo.find.mock.calls.at(-1)![0] as { where: unknown[] };
    expect(arg.where).toHaveLength(3);
    expect(arg.where[0]).toEqual(
      expect.objectContaining({ status: WebhookDeliveryStatus.PENDING }),
    );
    expect(arg.where[2]).toEqual(
      expect.objectContaining({ status: WebhookDeliveryStatus.RETRYING }),
    );
  });
});
