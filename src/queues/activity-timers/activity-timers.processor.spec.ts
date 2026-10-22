import { ModuleRef } from '@nestjs/core';

import {
  ActivityTimersProcessor,
  expectedSourceFor,
  targetStatusFor,
} from './activity-timers.processor';
import { ActivityTimersSweep } from './activity-timers.sweep';
import { ActivitiesService } from '../../activities/activities.service';
import { ActivityEntity, ActivityStatus } from '../../activities/entities/activity.entity';
import { TimerKind, ActivityTimerJobData } from './activity-timers.constants';

describe('ActivityTimersProcessor', () => {
  let processor: ActivityTimersProcessor;
  let activities: { applySystemTransition: jest.Mock };
  let activitiesRepo: { findById: jest.Mock };
  let sweep: { runSweep: jest.Mock };

  const row = (over: Partial<ActivityEntity> = {}): ActivityEntity =>
    ({
      id: 'a1',
      bondId: 'b1',
      status: ActivityStatus.ASSIGNED,
      version: 3,
      deadline: new Date('2026-10-01T00:00:00Z'),
      ...over,
    }) as ActivityEntity;

  const job = (data: ActivityTimerJobData, name = data.kind) => ({ id: 'j1', name, data }) as any;

  beforeEach(() => {
    activities = { applySystemTransition: jest.fn().mockResolvedValue(undefined) };
    activitiesRepo = { findById: jest.fn() };
    sweep = { runSweep: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = {
      get: jest.fn((token: unknown) => (token === ActivitiesService ? activities : activitiesRepo)),
    } as unknown as ModuleRef;

    processor = new ActivityTimersProcessor(moduleRef, sweep as unknown as ActivityTimersSweep);
    processor.onModuleInit();
  });

  describe('pure helpers', () => {
    it('maps each timer kind to its required source state', () => {
      expect(expectedSourceFor(TimerKind.RESPONSE_TIMEOUT)).toBe(ActivityStatus.ASSIGNED);
      expect(expectedSourceFor(TimerKind.START)).toBe(ActivityStatus.ASSISTING);
      expect(expectedSourceFor(TimerKind.END)).toBe(ActivityStatus.IN_PROGRESS);
      expect(expectedSourceFor(TimerKind.SWEEP)).toBeNull();
    });

    it('maps each timer kind to its system target', () => {
      expect(targetStatusFor(TimerKind.RESPONSE_TIMEOUT)).toBe(ActivityStatus.OVERDUE);
      expect(targetStatusFor(TimerKind.START)).toBe(ActivityStatus.IN_PROGRESS);
      expect(targetStatusFor(TimerKind.END)).toBe(ActivityStatus.DONE);
      expect(targetStatusFor(TimerKind.SWEEP)).toBeNull();
    });
  });

  it('response-timeout on an assigned row → system transition to overdue (T7)', async () => {
    activitiesRepo.findById.mockResolvedValue(row({ status: ActivityStatus.ASSIGNED, version: 3 }));

    await processor.process(
      job({ activityId: 'a1', version: 3, kind: TimerKind.RESPONSE_TIMEOUT }),
    );

    expect(activities.applySystemTransition).toHaveBeenCalledWith('a1', ActivityStatus.OVERDUE);
  });

  it('start on an assisting row → in_progress (T10)', async () => {
    activitiesRepo.findById.mockResolvedValue(
      row({ status: ActivityStatus.ASSISTING, version: 3 }),
    );

    await processor.process(job({ activityId: 'a1', version: 3, kind: TimerKind.START }));

    expect(activities.applySystemTransition).toHaveBeenCalledWith('a1', ActivityStatus.IN_PROGRESS);
  });

  it('end on an in_progress row → done (T11)', async () => {
    activitiesRepo.findById.mockResolvedValue(
      row({ status: ActivityStatus.IN_PROGRESS, version: 3 }),
    );

    await processor.process(job({ activityId: 'a1', version: 3, kind: TimerKind.END }));

    expect(activities.applySystemTransition).toHaveBeenCalledWith('a1', ActivityStatus.DONE);
  });

  it('stale version → silent no-op, no transition (REQ-TX-2)', async () => {
    activitiesRepo.findById.mockResolvedValue(row({ version: 5 }));

    await processor.process(
      job({ activityId: 'a1', version: 3, kind: TimerKind.RESPONSE_TIMEOUT }),
    );

    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });

  it('source-state mismatch → no-op (e.g. response-timeout on an assisting row)', async () => {
    activitiesRepo.findById.mockResolvedValue(
      row({ status: ActivityStatus.ASSISTING, version: 3 }),
    );

    await processor.process(
      job({ activityId: 'a1', version: 3, kind: TimerKind.RESPONSE_TIMEOUT }),
    );

    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });

  it('missing activity (404) → no-op, no throw', async () => {
    activitiesRepo.findById.mockResolvedValue(null);

    await expect(
      processor.process(job({ activityId: 'gone', version: 1, kind: TimerKind.END })),
    ).resolves.toBeUndefined();
    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });

  it('sweep job (name=sweep) → delegates to runSweep, no direct transition', async () => {
    await processor.process({ id: 'j2', name: TimerKind.SWEEP, data: {} } as any);

    expect(sweep.runSweep).toHaveBeenCalledTimes(1);
    expect(activities.applySystemTransition).not.toHaveBeenCalled();
  });

  it('never rethrows when the system transition rejects (BullMQ ack)', async () => {
    activitiesRepo.findById.mockResolvedValue(row());
    activities.applySystemTransition.mockRejectedValue(new Error('db down'));

    await expect(
      processor.process(job({ activityId: 'a1', version: 3, kind: TimerKind.RESPONSE_TIMEOUT })),
    ).resolves.toBeUndefined();
  });
});
