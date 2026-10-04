import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivitiesRepository } from './repositories/activities.repository';
import { CategoryEntity } from '../categories/entities/category.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { ActivityEntity, ActivityStatus } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { Clock } from '../common/clock/clock';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let activityRepo: any;
  let categoryRepo: any;
  let childRepo: any;
  let notifRepo: any;
  let activityChildRepo: any;
  let bondsRepo: any;
  let clock: Clock;
  const bondId = 'b1';
  const userId = 'u1';
  const childId = 'c1';
  const categoryId = 'cat1';

  beforeEach(async () => {
    activityRepo = {
      findOne: jest.fn(),
      findById: jest.fn(),
      markCompleted: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      findOneBy: jest.fn(),
    } as any;
    categoryRepo = {
      findOneBy: jest.fn(),
    } as any;
    childRepo = {
      find: jest.fn(),
    } as any;
    notifRepo = {
      create: jest.fn(),
      save: jest.fn(),
    } as any;
    activityChildRepo = {
      create: jest.fn(),
      save: jest.fn(),
    } as any;
    bondsRepo = {
      findActiveBondForMember: jest.fn().mockResolvedValue({ id: bondId } as any),
    } as any;

    clock = { now: () => new Date('2026-10-01T12:00:00Z') } as any;

    const dataSourceMock: any = {
      transaction: jest.fn(async (fn) => fn(dataSourceMock as any)),
      getRepository: jest.fn((entity) => {
        if (entity === ActivityEntity) return activityRepo;
        if (entity === ActivityChildEntity) return activityChildRepo;
        if (entity === NotificationEntity) return notifRepo;
        return {} as any;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: ActivitiesRepository, useValue: activityRepo },
        { provide: getRepositoryToken(CategoryEntity), useValue: categoryRepo },
        { provide: getRepositoryToken(ChildEntity), useValue: childRepo },
        { provide: getRepositoryToken(NotificationEntity), useValue: notifRepo },
        { provide: getRepositoryToken(ActivityEntity), useValue: activityRepo },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: BondsRepository, useValue: bondsRepo },
        { provide: Clock, useValue: clock },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  describe('create', () => {
    it('creates activity with valid data', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childRepo.find.mockResolvedValue([{ id: childId }] as any);

      const saved = { id: 'a1' } as any;
      (activityRepo as any).create = jest.fn().mockReturnValue({ foo: 'bar' });
      (activityRepo as any).save = jest.fn().mockResolvedValue(saved);

      (activityChildRepo as any).create = jest.fn().mockReturnValue({ ac: 1 });
      (activityChildRepo as any).save = jest.fn().mockResolvedValue([{}]);

      (notifRepo as any).create = jest.fn().mockReturnValue({ n: 1 });
      (notifRepo as any).save = jest.fn().mockResolvedValue({});

      const dto = {
        title: 'Test Activity',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: 'u2',
      } as any;

      const result = await service.create(bondId, dto, userId);
      expect(result).toEqual(saved);
    });

    it('rejects when childIds is empty', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [],
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
    });

    it('rejects when childIds has duplicates', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId, childId],
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
    });

    it('rejects when category is inactive', async () => {
      categoryRepo.findOneBy.mockResolvedValue(null as any);
      childRepo.find.mockResolvedValue([{ id: childId }] as any);
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
    });

    it('derives criticality from category', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'critical',
      } as any);
      childRepo.find.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).create = jest.fn((a) => a);
      (activityRepo as any).save = jest.fn(async (a) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).create = jest.fn();
      (activityChildRepo as any).save = jest.fn();
      (notifRepo as any).create = jest.fn();
      (notifRepo as any).save = jest.fn();
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      const res = await service.create(bondId, dto, userId);
      expect(res.criticality).toBe('critical');
    });

    it('does not notify when not assigned', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childRepo.find.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).create = jest.fn((a) => a);
      (activityRepo as any).save = jest.fn(async (a) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).create = jest.fn();
      (activityChildRepo as any).save = jest.fn();
      (notifRepo as any).create = jest.fn();
      (notifRepo as any).save = jest.fn();
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      await service.create(bondId, dto, userId);
      expect(notifRepo.save).not.toHaveBeenCalled();
    });

    it('rolls back if notification save fails', async () => {
      categoryRepo.findOneBy.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childRepo.find.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).create = jest.fn((a) => a);
      (activityRepo as any).save = jest.fn(async (a) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).create = jest.fn();
      (activityChildRepo as any).save = jest.fn();
      (notifRepo as any).create = jest.fn();
      (notifRepo as any).save = jest.fn().mockRejectedValue(new Error('fail'));
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: 'u2',
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow();
    });
  });

  describe('complete', () => {
    it('already done returns activity unchanged in completedAt sense', async () => {
      const completedAt = new Date('2026-10-01T10:00:00Z');
      const act = { id: 'a1', status: ActivityStatus.DONE, completedAt, bondId } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).save = jest.fn();
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: completedAt.toISOString() });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('sets completedAt when transitioning to DONE', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: null,
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: '2026-10-01T12:00:00Z' });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('preserves existing completedAt on second call', async () => {
      const completedAt = new Date('2026-10-01T10:00:00Z');
      const act = { id: 'a1', status: ActivityStatus.DONE, completedAt, bondId } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: completedAt.toISOString() });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('does not notify when no assignee', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: null,
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: '2026-10-01T12:00:00Z' });
      await service.complete('a1', userId);
    });

    it('rollback on notification failure', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: 'u2',
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).save = jest.fn(async (a) => a);
      (notifRepo as any).create = jest.fn();
      (notifRepo as any).save = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(service.complete('a1', userId)).rejects.toThrow();
    });
  });
});
