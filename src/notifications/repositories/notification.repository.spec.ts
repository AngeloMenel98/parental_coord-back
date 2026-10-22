import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationEntity } from '../entities/notification.entity';
import { NotificationRepository } from './notification.repository';

describe('NotificationRepository (T-W1.33, REQ-SUB-5, D11)', () => {
  let repo: NotificationRepository;
  let notifRepo: jest.Mocked<Repository<NotificationEntity>>;

  beforeEach(async () => {
    notifRepo = {
      create: jest.fn((data: object) => data),
      save: jest.fn(async (data: object) => data),
      target: NotificationEntity,
      manager: {},
    } as unknown as jest.Mocked<Repository<NotificationEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationRepository,
        { provide: getRepositoryToken(NotificationEntity), useValue: notifRepo },
      ],
    }).compile();

    repo = module.get(NotificationRepository);
  });

  it('creates a generic notification with a free refEntityType', async () => {
    await repo.createNotification({
      userId: 'u1',
      bondId: 'b1',
      type: 'webhook_disabled',
      title: 'Webhook disabled',
      body: 'Your endpoint kept failing.',
      refEntityType: 'webhook_subscription',
      refEntityId: 's1',
    });

    expect(notifRepo.create).toHaveBeenCalledWith({
      userId: 'u1',
      bondId: 'b1',
      type: 'webhook_disabled',
      title: 'Webhook disabled',
      body: 'Your endpoint kept failing.',
      refEntityType: 'webhook_subscription',
      refEntityId: 's1',
      isRead: false,
    });
  });

  it('keeps createForActivity as a thin wrapper (refEntityType=activity)', async () => {
    await repo.createForActivity({
      userId: 'u1',
      bondId: 'b1',
      type: 'activity',
      title: 't',
      body: 'b',
      refEntityId: 'a1',
    });

    expect(notifRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ refEntityType: 'activity', refEntityId: 'a1' }),
    );
  });

  it('uses an explicit EntityManager when provided', async () => {
    const managerRepo = {
      create: jest.fn((d: object) => d),
      save: jest.fn(async (d: object) => d),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await repo.createNotification(
      {
        userId: 'u1',
        bondId: 'b1',
        type: 'x',
        title: 't',
        body: 'b',
        refEntityType: 'activity',
      },
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(NotificationEntity);
    expect(notifRepo.save).not.toHaveBeenCalled();
  });
});

/**
 * Doble del `QueryBuilder` de TypeORM: encadena y REGISTRA las condiciones
 * (`where`/`andWhere`) para poder afirmar sobre el SQL que se genera.
 */
interface QbStub {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
  execute: jest.Mock;
  conditions: string[];
}

function createQbStub(executeResult: () => { affected?: number }): QbStub {
  const conditions: string[] = [];
  const stub = {} as QbStub;

  stub.conditions = conditions;
  stub.where = jest.fn((sql: string) => {
    conditions.push(sql);
    return stub;
  });
  stub.andWhere = jest.fn((sql: string) => {
    conditions.push(sql);
    return stub;
  });
  stub.orderBy = jest.fn(() => stub);
  stub.addOrderBy = jest.fn(() => stub);
  stub.limit = jest.fn(() => stub);
  stub.offset = jest.fn(() => stub);
  stub.getMany = jest.fn(async () => []);
  stub.getCount = jest.fn(async () => 0);
  stub.update = jest.fn(() => stub);
  stub.set = jest.fn(() => stub);
  stub.execute = jest.fn(async () => executeResult());

  return stub;
}

describe('NotificationRepository — read path (notifications-read-path)', () => {
  let repo: NotificationRepository;
  let qbs: QbStub[];
  /** Resultado que devuelve `execute()` (UPDATE … RETURNING affected). */
  let executeResult: { affected?: number };

  beforeEach(async () => {
    qbs = [];
    executeResult = { affected: 0 };

    const notifRepo = {
      target: NotificationEntity,
      manager: {},
      createQueryBuilder: jest.fn(() => {
        const qb = createQbStub(() => executeResult);
        qbs.push(qb);
        return qb;
      }),
    } as unknown as jest.Mocked<Repository<NotificationEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationRepository,
        { provide: getRepositoryToken(NotificationEntity), useValue: notifRepo },
      ],
    }).compile();

    repo = module.get(NotificationRepository);
  });

  it('filters by user_id FIRST and orders by created_at DESC, id DESC', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0 });

    const rows = qbs[0];
    expect(rows.where).toHaveBeenNthCalledWith(1, 'n.user_id = :userId', { userId: 'u1' });
    expect(rows.orderBy).toHaveBeenCalledWith('n.created_at', 'DESC');
    expect(rows.addOrderBy).toHaveBeenCalledWith('n.id', 'DESC');
    expect(rows.limit).toHaveBeenCalledWith(20);
    expect(rows.offset).toHaveBeenCalledWith(0);
    expect(rows.getMany).toHaveBeenCalled();
  });

  it('counts the same filtered set in a separate query without the ORDER BY', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0 });

    const count = qbs[1];
    expect(count.getCount).toHaveBeenCalled();
    expect(count.orderBy).not.toHaveBeenCalled();
    expect(count.where).toHaveBeenNthCalledWith(1, 'n.user_id = :userId', { userId: 'u1' });
  });

  it('applies the unreadOnly filter', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0, unreadOnly: true });

    expect(qbs[0].andWhere).toHaveBeenCalledWith('n.is_read = false');
  });

  it('filters by bond_id with plain equality and NEVER with COALESCE', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0, bondId: 'b1' });

    expect(qbs[0].andWhere).toHaveBeenCalledWith('n.bond_id = :bondId', { bondId: 'b1' });
    expect(qbs[0].conditions.join(' ')).not.toMatch(/coalesce/i);
  });

  it('excludes bond-less rows when bondId is given (no IS NULL / COALESCE escape hatch)', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0, bondId: 'b1' });

    expect(qbs[0].conditions).toContain('n.bond_id = :bondId');
    expect(qbs[0].conditions.some((c) => /is null/i.test(c))).toBe(false);
    expect(qbs[0].conditions.some((c) => /coalesce/i.test(c))).toBe(false);
  });

  it('keeps bond-less rows when no bondId is given', async () => {
    await repo.listForUser('u1', { limit: 20, offset: 0 });

    expect(qbs[0].andWhere).not.toHaveBeenCalled();
    expect(qbs[0].conditions).toEqual(['n.user_id = :userId']);
  });

  it('counts the caller unread rows and scopes them by bond when asked', async () => {
    await repo.countUnread('u1');
    expect(qbs[0].where).toHaveBeenCalledWith('n.user_id = :userId', { userId: 'u1' });
    expect(qbs[0].andWhere).toHaveBeenCalledWith('n.is_read = false');
    expect(qbs[0].getCount).toHaveBeenCalled();

    await repo.countUnread('u1', 'b1');
    expect(qbs[1].andWhere).toHaveBeenCalledWith('n.bond_id = :bondId', { bondId: 'b1' });
    expect(qbs[1].conditions.join(' ')).not.toMatch(/coalesce/i);
  });

  it('marks one notification read with an atomic UPDATE scoped to the owner', async () => {
    executeResult = { affected: 1 };

    await expect(repo.markRead('n1', 'u1')).resolves.toBe(1);

    const qb = qbs[0];
    expect(qb.update).toHaveBeenCalledWith(NotificationEntity);
    expect(qb.set).toHaveBeenCalledWith({ isRead: true });
    expect(qb.where).toHaveBeenCalledWith('user_id = :userId', { userId: 'u1' });
    expect(qb.andWhere).toHaveBeenCalledWith('id = :id', { id: 'n1' });
  });

  it('returns 0 when the notification is missing or belongs to another user', async () => {
    executeResult = { affected: 0 };
    await expect(repo.markRead('n1', 'u1')).resolves.toBe(0);

    executeResult = {};
    await expect(repo.markRead('n1', 'u1')).resolves.toBe(0);
  });

  it('marks all the caller unread rows read and returns the newly-read count', async () => {
    executeResult = { affected: 3 };

    await expect(repo.markAllRead('u1')).resolves.toBe(3);

    const qb = qbs[0];
    expect(qb.set).toHaveBeenCalledWith({ isRead: true });
    expect(qb.where).toHaveBeenCalledWith('user_id = :userId', { userId: 'u1' });
    expect(qb.andWhere).toHaveBeenCalledWith('is_read = false');
  });

  it('scopes mark-all-read by bond when bondId is given', async () => {
    executeResult = { affected: 1 };

    await expect(repo.markAllRead('u1', 'b1')).resolves.toBe(1);

    expect(qbs[0].andWhere).toHaveBeenCalledWith('bond_id = :bondId', { bondId: 'b1' });
    expect(qbs[0].conditions.join(' ')).not.toMatch(/coalesce/i);
  });
});
