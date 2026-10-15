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
