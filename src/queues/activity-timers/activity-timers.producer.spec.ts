import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ACTIVITY_TIMERS_QUEUE, TimerKind } from './activity-timers.constants';
import { buildTimerJobId, computeDelayMs } from './activity-timers.job';
import { ActivityTimersProducer } from './activity-timers.producer';

describe('ActivityTimersProducer', () => {
  let producer: ActivityTimersProducer;
  let queue: { add: jest.Mock; remove: jest.Mock };
  let errorSpy: jest.SpyInstance;

  const NOW = new Date('2026-10-01T12:00:00Z');
  const TARGET = new Date('2026-10-01T13:00:00Z');

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityTimersProducer,
        { provide: getQueueToken(ACTIVITY_TIMERS_QUEUE), useValue: queue },
      ],
    }).compile();

    producer = module.get<ActivityTimersProducer>(ActivityTimersProducer);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('enqueue passes the deterministic jobId, delay and retention options', async () => {
    await producer.enqueue(TimerKind.RESPONSE_TIMEOUT, 'act-1', 3, TARGET, NOW);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      TimerKind.RESPONSE_TIMEOUT,
      { activityId: 'act-1', version: 3, kind: TimerKind.RESPONSE_TIMEOUT },
      {
        jobId: buildTimerJobId(TimerKind.RESPONSE_TIMEOUT, 'act-1', 3),
        delay: computeDelayMs(TARGET, NOW),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      },
    );
  });

  it('enqueue jobId matches the format and has no colon', async () => {
    await producer.enqueue(TimerKind.START, 'abc', 7, TARGET, NOW);

    const options = queue.add.mock.calls[0][2];
    expect(options.jobId).toBe('start--abc--v7');
    expect(options.jobId).not.toContain(':');
  });

  it('cancel removes the deterministic id', async () => {
    await producer.cancel(TimerKind.END, 'act-2', 5);

    expect(queue.remove).toHaveBeenCalledWith(buildTimerJobId(TimerKind.END, 'act-2', 5));
  });

  it('cancelById removes the given id', async () => {
    await producer.cancelById('response-timeout--x--v1');

    expect(queue.remove).toHaveBeenCalledWith('response-timeout--x--v1');
  });

  it('reschedule removes the OLD id then enqueues the NEW one', async () => {
    await producer.reschedule(TimerKind.START, 'act-3', 1, 2, TARGET, NOW);

    expect(queue.remove).toHaveBeenCalledWith(buildTimerJobId(TimerKind.START, 'act-3', 1));
    expect(queue.add).toHaveBeenCalledWith(
      TimerKind.START,
      { activityId: 'act-3', version: 2, kind: TimerKind.START },
      expect.objectContaining({ jobId: buildTimerJobId(TimerKind.START, 'act-3', 2) }),
    );
    expect(queue.remove.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });

  it('does NOT throw when enqueue fails — logs instead', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(
      producer.enqueue(TimerKind.RESPONSE_TIMEOUT, 'act-4', 1, TARGET, NOW),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does NOT throw when remove fails — logs instead', async () => {
    queue.remove.mockRejectedValue(new Error('redis down'));

    await expect(producer.cancel(TimerKind.END, 'act-5', 1)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
