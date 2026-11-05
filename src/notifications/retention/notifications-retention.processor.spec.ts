import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { NotificationRetentionJobName } from './notifications-retention.constants';
import { NotificationsRetentionProcessor } from './notifications-retention.processor';
import { NotificationsRetentionService } from './notifications-retention.service';

function makeJob(name: string): Job {
  return { id: 'j1', name, data: {} } as unknown as Job;
}

describe('NotificationsRetentionProcessor (notifications-hygiene, slice 1 — task 4.2, R5)', () => {
  let service: { run: jest.Mock };
  let processor: NotificationsRetentionProcessor;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    service = { run: jest.fn().mockResolvedValue(undefined) };
    processor = new NotificationsRetentionProcessor(
      service as unknown as NotificationsRetentionService,
    );
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('runs the retention purge EXACTLY once for the retention job', async () => {
    await processor.process(makeJob(NotificationRetentionJobName.RETENTION));

    expect(service.run).toHaveBeenCalledTimes(1);
  });

  it('warns about an unknown job name and throws NOTHING (D7 rollback safety net)', async () => {
    await expect(processor.process(makeJob('something-else'))).resolves.toBeUndefined();

    expect(service.run).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(String(message)).toContain('something-else');
  });

  it('catches and logs a failing purge WITHOUT rejecting the job', async () => {
    service.run.mockRejectedValue(new Error('db down'));

    await expect(
      processor.process(makeJob(NotificationRetentionJobName.RETENTION)),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(String(message)).toContain('db down');
  });

  it('resolves with undefined on the happy path', async () => {
    await expect(
      processor.process(makeJob(NotificationRetentionJobName.RETENTION)),
    ).resolves.toBeUndefined();
  });
});
