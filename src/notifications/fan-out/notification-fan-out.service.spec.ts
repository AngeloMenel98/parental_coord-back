import { NotificationFanOutService } from './notification-fan-out.service';
import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';
import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import { EntityManager } from 'typeorm';

describe('NotificationFanOutService', () => {
  let service: NotificationFanOutService;
  let notificationRepository: any;
  let activitiesRepository: any;
  let bondsRepository: any;
  let bondMembersRepository: any;
  let appConfig: any;
  let manager: EntityManager;

  const makeActivity = (overrides: any = {}) => ({
    id: 'a1',
    bondId: 'b1',
    title: 'Ir al pediatra',
    createdBy: 'u3',
    assignedTo: 'u2',
    deletedAt: null,
    ...overrides,
  });

  const makeEvent = (overrides: any = {}): OutboxEventEntity => {
    const event = new OutboxEventEntity();
    event.id = 'e1';
    event.aggregateId = 'a1';
    event.bondId = 'b1';
    event.eventType = ACTIVITY_EVENT.CREATED;
    event.payload = { actor: { type: 'user', id: 'u1' } };
    Object.assign(event, overrides);
    return event;
  };

  beforeEach(() => {
    notificationRepository = {
      createFromEvent: jest.fn().mockResolvedValue({ id: 'n1' }),
    };
    activitiesRepository = {
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
    };
    bondsRepository = {};
    bondMembersRepository = {
      findCoordinator: jest.fn(),
      findActiveMemberIds: jest.fn(),
    };
    appConfig = { NOTIFICATIONS_FANOUT_ENABLED: 'true' };
    manager = {} as EntityManager;

    service = new NotificationFanOutService(
      notificationRepository,
      activitiesRepository,
      bondsRepository,
      bondMembersRepository,
      appConfig,
    );

    activitiesRepository.findById.mockResolvedValue(makeActivity());
    bondMembersRepository.findCoordinator.mockResolvedValue({ userId: 'u4' });
    bondMembersRepository.findActiveMemberIds.mockResolvedValue(['u1', 'u3', 'u4']);
  });

  it('happy path created: all active members except coordinator and actor', async () => {
    const event = makeEvent({ eventType: ACTIVITY_EVENT.CREATED });
    await service.handleOutboxEvent(event, manager);

    // created rule: members minus coordinator(u4) minus actor(u1) = u3
    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(1);
    expect(notificationRepository.createFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u3',
        bondId: 'b1',
        type: 'activity_created',
        title: 'New activity: Ir al pediatra',
        body: 'New activity: Ir al pediatra',
        refEntityType: 'activity',
        refEntityId: 'a1',
        sourceEventId: 'e1',
      }),
      manager,
    );
  });

  it('happy path assigned', async () => {
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });
    bondMembersRepository.findCoordinator.mockResolvedValue({ userId: 'u4' });
    await service.handleOutboxEvent(event, manager);

    // assignee u2, creator u3, coordinator excluded, actor? payload.actor u1 - not in recipients
    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(2);
    const calls = notificationRepository.createFromEvent.mock.calls;
    const userIds = calls.map((c: any) => c[0].userId).sort();
    expect(userIds).toEqual(['u2', 'u3']);
    expect(calls[0][0].type).toBe('activity_assigned');
  });

  it('happy path assisting', async () => {
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSISTING });
    await service.handleOutboxEvent(event, manager);

    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(2);
    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u3', 'u4']);
    expect(notificationRepository.createFromEvent.mock.calls[0][0].type).toBe('activity_assisting');
  });

  it('happy path in_progress (system actor)', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.IN_PROGRESS,
      payload: { actor: { type: 'system' } },
    });
    await service.handleOutboxEvent(event, manager);

    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u2', 'u3']);
    expect(notificationRepository.createFromEvent.mock.calls[0][0].type).toBe(
      'activity_in_progress',
    );
  });

  it('happy path overdue (R-10 template)', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.OVERDUE,
      payload: { actor: { type: 'system' } },
    });
    await service.handleOutboxEvent(event, manager);

    expect(notificationRepository.createFromEvent.mock.calls[0][0].title).toBe(
      'Activity overdue: Ir al pediatra',
    );
    expect(notificationRepository.createFromEvent.mock.calls[0][0].type).toBe('activity_overdue');
    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u2', 'u3', 'u4']);
  });

  it('happy path done', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.DONE,
      payload: { actor: { type: 'system' } },
    });
    await service.handleOutboxEvent(event, manager);

    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u2', 'u3', 'u4']);
    expect(notificationRepository.createFromEvent.mock.calls[0][0].type).toBe('activity_done');
  });

  it('happy path cancelled', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.CANCELLED,
      payload: { actor: { type: 'system' } },
    });
    await service.handleOutboxEvent(event, manager);

    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u2', 'u3']);
    expect(notificationRepository.createFromEvent.mock.calls[0][0].type).toBe('activity_cancelled');
  });

  it('actor excluded always', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.IN_PROGRESS,
      payload: { actor: { type: 'user', id: 'u2' } },
    });
    await service.handleOutboxEvent(event, manager);

    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    // in_progress goes to assignee u2 and creator u3; actor u2 excluded
    expect(userIds).toEqual(['u3']);
  });

  it('coordinator missing -> no throws, just skips coordinator', async () => {
    bondMembersRepository.findCoordinator.mockResolvedValue(null);
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.OVERDUE,
      payload: { actor: { type: 'system' } },
    });
    await service.handleOutboxEvent(event, manager);

    const userIds = notificationRepository.createFromEvent.mock.calls
      .map((c: any) => c[0].userId)
      .sort();
    expect(userIds).toEqual(['u2', 'u3']);
  });

  it('assignee == actor -> zero notifications possible', async () => {
    const event = makeEvent({
      eventType: ACTIVITY_EVENT.IN_PROGRESS,
      payload: { actor: { type: 'user', id: 'u2' } },
    });
    // only assignee is u2 and creator different? u2==actor, creator is u3
    await service.handleOutboxEvent(event, manager);
    const userIds = notificationRepository.createFromEvent.mock.calls.map((c: any) => c[0].userId);
    expect(userIds).toEqual(['u3']); // actor excluded
  });

  it('activity.unassigned skip -> no inserts', async () => {
    const event = makeEvent({ eventType: ACTIVITY_EVENT.UNASSIGNED });
    await service.handleOutboxEvent(event, manager);
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
  });

  it('unknown event no-op', async () => {
    const event = makeEvent({ eventType: 'activity.teleported' });
    await service.handleOutboxEvent(event, manager);
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
  });

  it('missing activity -> no inserts (no throw)', async () => {
    activitiesRepository.findById.mockResolvedValue(null);
    activitiesRepository.findByIdIncludingDeleted.mockResolvedValue(null);
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });
    await service.handleOutboxEvent(event, manager);
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
  });

  it('soft-deleted activity -> no inserts (no throw)', async () => {
    activitiesRepository.findById.mockResolvedValue(makeActivity({ deletedAt: new Date() }));
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });
    await service.handleOutboxEvent(event, manager);
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
  });

  it('flag false -> log once and return (webhooks still delivered)', async () => {
    appConfig.NOTIFICATIONS_FANOUT_ENABLED = 'false';
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });
    await expect(service.handleOutboxEvent(event, manager)).resolves.toBeUndefined();
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toMatch(/NOTIFICATIONS_FANOUT_ENABLED=false/);

    // Should log only once across subsequent calls
    logSpy.mockClear();
    await service.handleOutboxEvent(event, manager);
    expect(notificationRepository.createFromEvent).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('conflict (createFromEvent null) -> no throw and dispatch unaffected', async () => {
    notificationRepository.createFromEvent.mockResolvedValue(null);
    const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });
    await expect(service.handleOutboxEvent(event, manager)).resolves.toBeUndefined();
    // should have attempted for both recipients
    expect(notificationRepository.createFromEvent).toHaveBeenCalledTimes(2);
  });

  describe('unexpected failures propagate so the outbox event is retried', () => {
    it('insert failure -> rejects instead of silently losing the notification', async () => {
      notificationRepository.createFromEvent.mockRejectedValue(new Error('insert failed'));
      const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });

      await expect(service.handleOutboxEvent(event, manager)).rejects.toThrow('insert failed');
    });

    it('activity load failure -> rejects instead of reading as "no notifications"', async () => {
      activitiesRepository.findById.mockRejectedValue(new Error('select failed'));
      const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });

      await expect(service.handleOutboxEvent(event, manager)).rejects.toThrow('select failed');
    });

    it('recipient resolution failure -> rejects instead of an empty recipient list', async () => {
      bondMembersRepository.findActiveMemberIds.mockRejectedValue(new Error('members failed'));
      const event = makeEvent({ eventType: ACTIVITY_EVENT.ASSIGNED });

      await expect(service.handleOutboxEvent(event, manager)).rejects.toThrow('members failed');
    });
  });
});
