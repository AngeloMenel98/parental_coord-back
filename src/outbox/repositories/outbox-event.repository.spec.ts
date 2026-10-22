import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OutboxEventRepository } from './outbox-event.repository';
import { OutboxEventEntity } from '../entities/outbox-event.entity';

/**
 * Read-side del outbox (T-W1.11, REQ-DISP-1/4, REQ-DATA-3): `findPending` lee
 * únicamente filas no despachadas y `markDispatched` escribe SÓLO `dispatched_at`.
 * La invariante write-only se protege comprobando que el payload no se toca.
 */
describe('OutboxEventRepository — read side', () => {
  let repo: OutboxEventRepository;
  let outboxRepo: jest.Mocked<Repository<OutboxEventEntity>>;
  let qb: any;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    outboxRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn(),
      target: OutboxEventEntity,
      manager: {},
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxEventRepository,
        { provide: getRepositoryToken(OutboxEventEntity), useValue: outboxRepo },
      ],
    }).compile();

    repo = module.get(OutboxEventRepository);
  });

  describe('findPending (REQ-DISP-1)', () => {
    it('reads only undispatched rows, oldest first, bounded by limit', async () => {
      await repo.findPending(50);

      expect(outboxRepo.createQueryBuilder).toHaveBeenCalledWith('o');
      expect(qb.where).toHaveBeenCalledWith('o.dispatched_at IS NULL');
      expect(qb.orderBy).toHaveBeenCalledWith('o.created_at', 'ASC');
      expect(qb.limit).toHaveBeenCalledWith(50);
    });

    it('returns the rows the query builder yields', async () => {
      const rows = [{ id: 'e1' } as OutboxEventEntity];
      qb.getMany.mockResolvedValueOnce(rows);
      expect(await repo.findPending(10)).toBe(rows);
    });
  });

  describe('findById (REQ-DISP-3)', () => {
    it('loads a single outbox row by id', async () => {
      const row = { id: 'e1' } as OutboxEventEntity;
      outboxRepo.findOne.mockResolvedValueOnce(row);

      expect(await repo.findById('e1')).toBe(row);
      expect(outboxRepo.findOne).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });
  });

  describe('markDispatched (REQ-DISP-4, REQ-DATA-3)', () => {
    it('updates ONLY dispatched_at (no payload/event_type rewrite)', async () => {
      await repo.markDispatched('e1');

      expect(outboxRepo.update).toHaveBeenCalledTimes(1);
      const [id, patch] = outboxRepo.update.mock.calls[0];
      expect(id).toBe('e1');
      expect(Object.keys(patch as object)).toEqual(['dispatchedAt']);
      expect((patch as { dispatchedAt: unknown }).dispatchedAt).toBeInstanceOf(Date);
    });

    it('uses the transaction manager repository when provided', async () => {
      const txUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const manager = {
        getRepository: jest.fn().mockReturnValue({ update: txUpdate }),
      } as any;

      await repo.markDispatched('e2', manager);

      expect(manager.getRepository).toHaveBeenCalledWith(OutboxEventEntity);
      expect(txUpdate).toHaveBeenCalledWith(
        'e2',
        expect.objectContaining({ dispatchedAt: expect.any(Date) }),
      );
      expect(outboxRepo.update).not.toHaveBeenCalled();
    });
  });
});
