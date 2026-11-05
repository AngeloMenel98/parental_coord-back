import { ModuleRef } from '@nestjs/core';

import { ActivityTimersSweep, dueTargetFor, SWEEP_LIMIT } from './activity-timers.sweep';
import { ActivitiesService } from '../../activities/activities.service';
import { ActivityEntity, ActivityStatus } from '../../activities/entities/activity.entity';

describe('ActivityTimersSweep', () => {
  let sweep: ActivityTimersSweep;
  let activities: { applySystemTransition: jest.Mock };
  let activitiesRepo: { findDueForTransition: jest.Mock };
  let queue: { upsertJobScheduler: jest.Mock };

  const NOW = new Date('2026-10-01T12:00:00Z');
  const past = new Date('2026-10-01T10:00:00Z');
  const future = new Date('2026-10-01T14:00:00Z');

  const row = (over: Partial<ActivityEntity> = {}): ActivityEntity =>
    ({ id: 'a1', bondId: 'b1', version: 1, ...over }) as ActivityEntity;

  beforeEach(() => {
    activities = { applySystemTransition: jest.fn().mockResolvedValue(undefined) };
    activitiesRepo = { findDueForTransition: jest.fn().mockResolvedValue([]) };
    queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = {
      get: jest.fn((token: unknown) => (token === ActivitiesService ? activities : activitiesRepo)),
    } as unknown as ModuleRef;

    sweep = new ActivityTimersSweep(queue as any, moduleRef);
  });

  beforeEach(async () => {
    await sweep.onModuleInit();
  });

  describe('dueTargetFor (pure)', () => {
    it('created past deadline → overdue', () => {
      expect(dueTargetFor(row({ status: ActivityStatus.CREATED, deadline: past }), NOW)).toBe(
        ActivityStatus.OVERDUE,
      );
    });

    it('assigned past deadline → overdue', () => {
      expect(dueTargetFor(row({ status: ActivityStatus.ASSIGNED, deadline: past }), NOW)).toBe(
        ActivityStatus.OVERDUE,
      );
    });

    it('created with a future deadline is not due', () => {
      expect(
        dueTargetFor(row({ status: ActivityStatus.CREATED, deadline: future }), NOW),
      ).toBeNull();
    });

    it('assigned with a future deadline is not due', () => {
      expect(
        dueTargetFor(row({ status: ActivityStatus.ASSIGNED, deadline: future }), NOW),
      ).toBeNull();
    });

    it('assisting past scheduled_start → in_progress', () => {
      expect(
        dueTargetFor(row({ status: ActivityStatus.ASSISTING, scheduledStart: past }), NOW),
      ).toBe(ActivityStatus.IN_PROGRESS);
    });

    it('in_progress past scheduled_end → verify', () => {
      expect(
        dueTargetFor(
          row({ status: ActivityStatus.IN_PROGRESS, scheduledStart: past, scheduledEnd: past }),
          NOW,
        ),
      ).toBe(ActivityStatus.VERIFY);
    });

    it('in_progress without scheduled_end falls back to scheduled_start → verify', () => {
      expect(
        dueTargetFor(row({ status: ActivityStatus.IN_PROGRESS, scheduledStart: past }), NOW),
      ).toBe(ActivityStatus.VERIFY);
    });

    it('verify past deadline → overdue', () => {
      expect(dueTargetFor(row({ status: ActivityStatus.VERIFY, deadline: past }), NOW)).toBe(
        ActivityStatus.OVERDUE,
      );
    });
  });

  it('onModuleInit upserts the repeatable sweep scheduler', async () => {
    await sweep.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'activity-timers-sweep',
      { every: expect.any(Number) },
      { name: 'sweep', data: {} },
    );
  });

  it('processes every due activity with its mapped system transition', async () => {
    activitiesRepo.findDueForTransition.mockResolvedValue([
      row({ id: 'created-overdue', status: ActivityStatus.CREATED, deadline: past }),
      row({ id: 'assigned-overdue', status: ActivityStatus.ASSIGNED, deadline: past }),
      row({ id: 'start', status: ActivityStatus.ASSISTING, scheduledStart: past }),
      row({ id: 'verify', status: ActivityStatus.IN_PROGRESS, scheduledStart: past }),
      row({ id: 'verify-overdue', status: ActivityStatus.VERIFY, deadline: past }),
    ]);

    await sweep.runSweep(NOW);

    expect(activitiesRepo.findDueForTransition).toHaveBeenCalledWith(NOW, SWEEP_LIMIT);
    expect(activities.applySystemTransition).toHaveBeenCalledTimes(5);
    expect(activities.applySystemTransition).toHaveBeenCalledWith(
      'created-overdue',
      ActivityStatus.OVERDUE,
    );
    expect(activities.applySystemTransition).toHaveBeenCalledWith(
      'assigned-overdue',
      ActivityStatus.OVERDUE,
    );
    expect(activities.applySystemTransition).toHaveBeenCalledWith(
      'start',
      ActivityStatus.IN_PROGRESS,
    );
    expect(activities.applySystemTransition).toHaveBeenCalledWith('verify', ActivityStatus.VERIFY);
    expect(activities.applySystemTransition).toHaveBeenCalledWith(
      'verify-overdue',
      ActivityStatus.OVERDUE,
    );
  });

  it('empty result → no transitions', async () => {
    activitiesRepo.findDueForTransition.mockResolvedValue([]);

    await sweep.runSweep(NOW);

    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });

  it('skips a defensively-returned row that is not actually due', async () => {
    activitiesRepo.findDueForTransition.mockResolvedValue([
      row({ id: 'x', status: ActivityStatus.ASSIGNED, deadline: future }),
    ]);

    await sweep.runSweep(NOW);

    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });
});
