import { EntityManager } from 'typeorm';

import { NotificationFanOutService } from './notification-fan-out.service';
import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { EXPENSE_EVENT } from '../../expenses/expense-events';

/**
 * T23 · rama de GASTOS del fan-out (PRD_expense §7, R8).
 *
 * El contrato que se prueba es el mismo que ya cumple la rama de actividades:
 * resolver destinatarios ANTES de escribir, deduplicar por `(user_id,
 * source_event_id)`, devolver sólo lo creado, y dejar que los errores reales
 * suban para que el relay reintente en vez de perder la notificación.
 *
 * Lo propio de esta rama: el gasto se busca con `findAliveById` (un gasto
 * cancelado no avisa nada), la contraparte sale del vínculo, y `amount` llega
 * del driver como STRING.
 */
describe('NotificationFanOutService — expense branch (T23)', () => {
  let service: NotificationFanOutService;
  let notificationRepository: any;
  let activitiesRepository: any;
  let bondMembersRepository: any;
  let appConfig: any;
  let expensesRepository: any;
  let manager: EntityManager;

  const makeExpense = (overrides: any = {}) => ({
    id: 'x1',
    bondId: 'b1',
    concept: 'Consulta pediatra',
    // `numeric` vuelve del driver como string: el doble lo imita a propósito.
    amount: '15000.50',
    expenseDate: '2026-10-30',
    status: 'pending',
    requestedBy: 'u1',
    counterpartId: null,
    approvedBy: null,
    paidAt: null,
    deletedAt: null,
    ...overrides,
  });

  const makeEvent = (overrides: any = {}): OutboxEventEntity => {
    const event = new OutboxEventEntity();
    event.id = 'e9';
    event.aggregateType = 'expense';
    event.aggregateId = 'x1';
    event.bondId = 'b1';
    event.eventType = EXPENSE_EVENT.CREATED;
    event.payload = { actor: { type: 'user', id: 'u1' } };
    Object.assign(event, overrides);
    return event;
  };

  beforeEach(() => {
    notificationRepository = {
      createFromEvent: jest.fn().mockImplementation(async (input: any) => ({ ...input, id: 'n1' })),
    };
    activitiesRepository = { findById: jest.fn(), findByIdIncludingDeleted: jest.fn() };
    bondMembersRepository = {
      findCoordinator: jest.fn(),
      findActiveMemberIds: jest.fn().mockResolvedValue(['u1', 'u2']),
    };
    appConfig = { NOTIFICATIONS_FANOUT_ENABLED: 'true' };
    expensesRepository = { findAliveById: jest.fn().mockResolvedValue(makeExpense()) };
    manager = {} as EntityManager;

    service = new NotificationFanOutService(
      notificationRepository,
      activitiesRepository,
      {} as any, // BondsRepository no lo usa esta rama
      bondMembersRepository,
      appConfig,
      expensesRepository,
    );
  });

  it('expense.created notifies the counterpart, never the activity pipeline', async () => {
    const created = await service.handleOutboxEvent(makeEvent(), manager);

    expect(activitiesRepository.findById).not.toHaveBeenCalled();
    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(1);
    expect(notificationRepository.createFromEvent).toHaveBeenCalledWith(
      {
        userId: 'u2',
        bondId: 'b1',
        type: 'expense_created',
        title: 'Nuevo gasto',
        body: '"Consulta pediatra" por $15.000,50 espera tu aprobación.',
        refEntityType: 'expense',
        refEntityId: 'x1',
        sourceEventId: 'e9',
      },
      manager,
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: 'n1', userId: 'u2', refEntityType: 'expense' });
  });

  it('formats the numeric string the driver returns, instead of concatenating it', async () => {
    expensesRepository.findAliveById.mockResolvedValue(makeExpense({ amount: '9999999999.99' }));

    await service.handleOutboxEvent(makeEvent(), manager);

    const body = notificationRepository.createFromEvent.mock.calls[0][0].body;
    expect(body).toContain('$9.999.999.999,99');
  });

  it('expense.approved notifies the requester and skips the approver who acted', async () => {
    expensesRepository.findAliveById.mockResolvedValue(makeExpense({ status: 'approved' }));

    await service.handleOutboxEvent(
      makeEvent({
        eventType: EXPENSE_EVENT.APPROVED,
        payload: { actor: { type: 'user', id: 'u2' } },
      }),
      manager,
    );

    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(1);
    expect(notificationRepository.createFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'expense_approved' }),
      manager,
    );
  });

  it('expense.paid marked by the requester creates nothing (R2, §7 literal)', async () => {
    expensesRepository.findAliveById.mockResolvedValue(makeExpense({ status: 'paid' }));

    const created = await service.handleOutboxEvent(
      makeEvent({ eventType: EXPENSE_EVENT.PAID }),
      manager,
    );

    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('expense.stale with a system actor notifies the counterpart', async () => {
    await service.handleOutboxEvent(
      makeEvent({ eventType: EXPENSE_EVENT.STALE, payload: { actor: { type: 'system' } } }),
      manager,
    );

    expect(notificationRepository.createFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'expense_stale',
        body: '"Consulta pediatra" lleva más de 7 días pendiente.',
      }),
      manager,
    );
  });

  it('a cancelled expense notifies nobody and does not throw', async () => {
    expensesRepository.findAliveById.mockResolvedValue(null);

    const created = await service.handleOutboxEvent(makeEvent(), manager);

    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('a bond with one member has no counterpart, so nothing is notified', async () => {
    bondMembersRepository.findActiveMemberIds.mockResolvedValue(['u1']);

    const created = await service.handleOutboxEvent(makeEvent(), manager);

    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('an unknown expense event type is a no-op and does not even load the expense', async () => {
    const created = await service.handleOutboxEvent(
      makeEvent({ eventType: 'expense.nope' }),
      manager,
    );

    expect(expensesRepository.findAliveById).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('an unknown aggregate_type is ignored, not read as an activity', async () => {
    const created = await service.handleOutboxEvent(
      makeEvent({ aggregateType: 'invoice' as never }),
      manager,
    );

    expect(activitiesRepository.findById).not.toHaveBeenCalled();
    expect(expensesRepository.findAliveById).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('a deduplicated insert (null) contributes no frame', async () => {
    notificationRepository.createFromEvent.mockResolvedValue(null);

    const created = await service.handleOutboxEvent(makeEvent(), manager);

    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(1);
    expect(created).toEqual([]);
  });

  it('the kill switch still wins over the expense branch', async () => {
    appConfig.NOTIFICATIONS_FANOUT_ENABLED = 'false';

    const created = await service.handleOutboxEvent(makeEvent(), manager);

    expect(expensesRepository.findAliveById).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it('a real insert failure propagates so the relay retries', async () => {
    notificationRepository.createFromEvent.mockRejectedValue(new Error('db down'));

    await expect(service.handleOutboxEvent(makeEvent(), manager)).rejects.toThrow('db down');
  });
});
