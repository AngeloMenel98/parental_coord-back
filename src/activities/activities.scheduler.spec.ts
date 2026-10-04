import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesScheduler } from './activities.scheduler';
import { ActivitiesRepository } from './repositories/activities.repository';
import { Logger } from '@nestjs/common';

describe('ActivitiesScheduler', () => {
  let scheduler: ActivitiesScheduler;
  let repo: jest.Mocked<ActivitiesRepository>;
  let logger: jest.Mocked<Logger>;

  beforeEach(async () => {
    repo = { markOverdue: jest.fn() } as any;
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesScheduler,
        { provide: ActivitiesRepository, useValue: repo },
        { provide: Logger, useValue: logger },
      ],
    }).compile();

    scheduler = module.get<ActivitiesScheduler>(ActivitiesScheduler);
    (scheduler as any).logger = logger;
  });

  it('does not log when affected is 0', async () => {
    repo.markOverdue.mockResolvedValue(0 as any);
    await scheduler.markOverdueActivities();
    expect(repo.markOverdue).toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('logs summary when affected > 0', async () => {
    repo.markOverdue.mockResolvedValue(3 as any);
    await scheduler.markOverdueActivities();
    expect(logger.log).toHaveBeenCalled();
  });
});
