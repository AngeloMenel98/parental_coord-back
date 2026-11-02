import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { buildExpenseChangedMessage } from './expense-changed-message';

function outboxEvent(overrides: Partial<OutboxEventEntity>): OutboxEventEntity {
  return {
    id: 'evt-1',
    aggregateType: 'expense',
    aggregateId: 'exp-1',
    bondId: 'bond-1',
    eventType: 'expense.approved',
    aggregateVersion: 2,
    payload: {},
    createdAt: new Date('2026-10-16T14:22:31.412Z'),
    dispatchedAt: null,
    ...overrides,
  } as OutboxEventEntity;
}

/**
 * `expense.changed` mapping (S8, T26): maps an expense outbox row to the
 * fixed frame contract the front codes against.
 */
describe('buildExpenseChangedMessage (S8, T26)', () => {
  it('maps a canonical expense transition', () => {
    const message = buildExpenseChangedMessage(
      outboxEvent({
        eventType: 'expense.approved',
        payload: {
          actor: { type: 'user', id: 'u-1' },
          status: 'approved',
        },
      }),
    );

    expect(message).toEqual({
      v: 1,
      type: 'expense.changed',
      eventId: 'evt-1',
      expenseId: 'exp-1',
      bondId: 'bond-1',
      status: 'approved',
      actor: { type: 'user', id: 'u-1' },
      occurredAt: '2026-10-16T14:22:31.412Z',
    });
  });

  it('derives occurredAt from the outbox row createdAt, not the payload', () => {
    const message = buildExpenseChangedMessage(
      outboxEvent({
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
        payload: {
          actor: { type: 'user', id: 'u-1' },
          status: 'paid',
        },
      }),
    );

    expect(message.occurredAt).toBe('2026-11-02T10:00:00.000Z');
  });

  it('passes payload extras through top-level', () => {
    const message = buildExpenseChangedMessage(
      outboxEvent({
        eventType: 'expense.rejected',
        payload: {
          actor: { type: 'user', id: 'u-1' },
          status: 'rejected',
          reason: 'No aplica',
        },
      }),
    );

    expect(message.reason).toBe('No aplica');
  });

  it('never lets payload extras clobber reserved contract keys', () => {
    const message = buildExpenseChangedMessage(
      outboxEvent({
        payload: {
          actor: { type: 'user', id: 'u-1' },
          status: 'approved',
          // Forged envelope keys that would otherwise ride the extras spread.
          v: 99,
          type: 'evil.changed',
          eventId: 'evt-forged',
          bondId: 'bond-forged',
          expenseId: 'exp-forged',
          occurredAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    expect(message.v).toBe(1);
    expect(message.type).toBe('expense.changed');
    expect(message.eventId).toBe('evt-1');
    expect(message.bondId).toBe('bond-1');
    expect(message.expenseId).toBe('exp-1');
    expect(message.status).toBe('approved');
    expect(message.occurredAt).toBe('2026-10-16T14:22:31.412Z');
  });
});
