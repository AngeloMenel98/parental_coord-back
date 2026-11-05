import { Queue } from 'bullmq';

import { ExpenseEntity, ExpenseStatus } from '../entities/expense.entity';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';
import { ExpenseStaleReminderRepository } from './expense-stale-reminder.repository';
import {
  DEFAULT_EXPENSE_STALE_REMINDER_INTERVAL_MS,
  EXPENSE_STALE_REMINDER_JOB_NAME,
  EXPENSE_STALE_REMINDER_QUEUE,
  EXPENSE_STALE_REMINDER_SCHEDULER_ID,
} from './expense-stale-reminder.constants';
import { ExpenseStaleReminderProcessor } from './expense-stale-reminder.processor';
import { ExpenseStaleReminderScheduler } from './expense-stale-reminder.scheduler';
import { ExpenseStaleReminderService } from './expense-stale-reminder.service';

describe('ExpenseStaleReminderRepository', () => {
  it('emits one expense.stale outbox event per locked eligible expense', async () => {
    const rows = [
      { id: 'expense-1', bondId: 'bond-1' },
      { id: 'expense-2', bondId: 'bond-2' },
    ] as ExpenseEntity[];
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    };
    const manager = {
      getRepository: jest.fn(() => ({ createQueryBuilder: () => query })),
    };
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(manager),
    );
    const expensesRepository = { manager: { transaction } };
    const outbox = { insert: jest.fn().mockResolvedValue(undefined) };
    const repository = new ExpenseStaleReminderRepository(
      expensesRepository as never,
      outbox as unknown as OutboxEventRepository,
    );

    await expect(repository.emitStaleEvents()).resolves.toBe(2);

    expect(query.where).toHaveBeenCalledWith('expense.status = :status', {
      status: ExpenseStatus.PENDING,
    });
    expect(query.andWhere).toHaveBeenCalledWith('expense.deletedAt IS NULL');
    expect(query.andWhere).toHaveBeenCalledWith(
      "expense.expenseDate <= CURRENT_DATE - INTERVAL '7 days'",
    );
    expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'), {
      staleType: 'expense.stale',
    });
    expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(query.setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(outbox.insert).toHaveBeenNthCalledWith(
      1,
      {
        aggregateType: 'expense',
        aggregateId: 'expense-1',
        bondId: 'bond-1',
        eventType: 'expense.stale',
        aggregateVersion: 1,
        payload: { actor: { type: 'system' }, status: ExpenseStatus.PENDING },
      },
      manager,
    );
    expect(outbox.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ aggregateId: 'expense-2', eventType: 'expense.stale' }),
      manager,
    );
  });

  it('does not insert an event when the anti-join finds no eligible expenses', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const manager = { getRepository: jest.fn(() => ({ createQueryBuilder: () => query })) };
    const expensesRepository = {
      manager: { transaction: jest.fn((callback) => callback(manager)) },
    };
    const outbox = { insert: jest.fn() };
    const repository = new ExpenseStaleReminderRepository(
      expensesRepository as never,
      outbox as unknown as OutboxEventRepository,
    );

    await expect(repository.emitStaleEvents()).resolves.toBe(0);
    expect(outbox.insert).not.toHaveBeenCalled();
  });
});

describe('ExpenseStaleReminderScheduler', () => {
  it('upserts one daily BullMQ scheduler on worker startup', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new ExpenseStaleReminderScheduler(queue as unknown as Queue);

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      EXPENSE_STALE_REMINDER_SCHEDULER_ID,
      { every: DEFAULT_EXPENSE_STALE_REMINDER_INTERVAL_MS },
      { name: EXPENSE_STALE_REMINDER_JOB_NAME, data: {} },
    );
  });
});

describe('ExpenseStaleReminderProcessor', () => {
  it('runs the reminder service for the scheduled job', async () => {
    const service = { run: jest.fn().mockResolvedValue(3) };
    const processor = new ExpenseStaleReminderProcessor(
      service as unknown as ExpenseStaleReminderService,
    );

    await processor.process({ name: EXPENSE_STALE_REMINDER_JOB_NAME } as never);

    expect(service.run).toHaveBeenCalledTimes(1);
    expect(EXPENSE_STALE_REMINDER_QUEUE).toBe('expense-stale-reminder');
  });
});
