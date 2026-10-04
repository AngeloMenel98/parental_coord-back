import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivitiesRepository } from './activities.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';

describe('ActivitiesRepository', () => {
  let repo: ActivitiesRepository;
  let activityRepo: jest.Mocked<Repository<ActivityEntity>>;

  let qb: any;

  beforeEach(async () => {
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    activityRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesRepository,
        { provide: getRepositoryToken(ActivityEntity), useValue: activityRepo },
      ],
    }).compile();

    repo = module.get<ActivitiesRepository>(ActivitiesRepository);
  });

  describe('markOverdue', () => {
    it('builds correct query conditions', async () => {
      await repo.markOverdue();
      expect(qb.update).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith('assigned_to IS NOT NULL');
    });

    it('returns affected count', async () => {
      const qb: any = activityRepo.createQueryBuilder();
      qb.execute.mockResolvedValueOnce({ affected: 3 });
      const res = await repo.markOverdue();
      expect(res).toBe(3);

      qb.execute.mockResolvedValueOnce({ affected: null });
      const res2 = await repo.markOverdue();
      expect(res2).toBe(0);
    });
  });
});
