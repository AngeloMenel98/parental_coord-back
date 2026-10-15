import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActivitiesService } from '../activities.service';
import { ActivitiesRepository } from '../repositories/activities.repository';
import { ActivityChildRepository } from '../repositories/activity-child.repository';
import { ActivityPolicyService } from '../activity-policy.service';
import { ChildrenRepository } from '../../children/repositories/children.repository';
import { CategoriesRepository } from '../../categories/repositories/categories.repository';
import { ActivityStatus } from '../entities/activity.entity';
import { BondsService } from '../../bonds/bonds.service';
import { BondMembersRepository } from '../../bonds/repositories/bond-members.repository';
import { NotificationRepository } from '../../notifications/repositories/notification.repository';
import { Clock } from '../../common/clock/clock';
import { CodedException } from '../../common/errors/coded.exception';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { ActivityTimersProducer } from '../../queues/activity-timers/activity-timers.producer';
import { TimerKind } from '../../queues/activity-timers/activity-timers.constants';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let activityRepo: any;
  let categoriesRepo: any;
  let childrenRepo: any;
  let activityChildRepo: any;
  let bondService: any;
  let bondMembersRepo: any;
  let notificationRepo: any;
  let config: any;
  let clock: any;
  let producer: any;
  let fakeManager: any;

  const bondId = 'b1';
  const userId = 'u1';
  const childId = 'c1';
  const categoryId = 'cat1';

  const creator = 'u-creator';
  const assignee = 'u-assignee';
  const stranger = 'u-stranger';

  const NOW = new Date('2026-10-01T12:00:00Z');
  const NOW_ISO = '2026-10-01T12:00:00.000Z';

  beforeEach(async () => {
    activityRepo = {
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
      findByBondIdOrdered: jest.fn().mockResolvedValue([]),
      createInTx: jest.fn(),
      insertWithInitialTransition: jest.fn(),
      updateFields: jest.fn(),
      save: jest.fn(),
      softDeleteWithAudit: jest.fn(),
      cancelWithAudit: jest.fn(),
      declineWithAudit: jest.fn(),
      markCompleted: jest.fn(),
      applyTransition: jest.fn(),
    } as any;
    categoriesRepo = { findActiveById: jest.fn() } as any;
    childrenRepo = { findByIdsAndBond: jest.fn() } as any;
    // El repo dedicado recibe el input YA compuesto: la aserción mide el payload
    // que el servicio decide enviar.
    notificationRepo = { createForActivity: jest.fn() } as any;
    activityChildRepo = { saveChildrenFor: jest.fn() } as any;
    bondService = { isActiveBondForMember: jest.fn().mockResolvedValue(true) } as any;
    // `resolveActorRole` vive en BondMembersRepository.
    bondMembersRepo = {
      findActiveMembersWithActStats: jest.fn().mockResolvedValue([]),
      findOneByBondAndUser: jest.fn().mockResolvedValue({ role: 'progenitor' }),
      findCoordinator: jest.fn().mockResolvedValue(null),
    } as any;

    // `jest.fn` y no una flecha suelta: el test del reloj inyectado necesita poder
    // AVISAR de que se usó `clock.now()` en lugar de `new Date()`.
    clock = { now: jest.fn(() => NOW) } as any;

    // El chokepoint lee `RESPONSE_TIMEOUT_HOURS` (default 36) para `deadline:set`.
    config = { get: jest.fn(() => 36) } as any;

    // Post-commit producer (E6): mocked, always resolves, never throws.
    producer = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      cancel: jest.fn().mockResolvedValue(undefined),
      cancelById: jest.fn().mockResolvedValue(undefined),
      reschedule: jest.fn().mockResolvedValue(undefined),
    } as any;

    fakeManager = {} as any;
    activityRepo.transaction = jest.fn(async (fn: any) => fn(fakeManager));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: ActivitiesRepository, useValue: activityRepo },
        { provide: ActivityChildRepository, useValue: activityChildRepo },
        { provide: NotificationRepository, useValue: notificationRepo },
        { provide: BondsService, useValue: bondService },
        { provide: BondMembersRepository, useValue: bondMembersRepo },
        { provide: ChildrenRepository, useValue: childrenRepo },
        { provide: CategoriesRepository, useValue: categoriesRepo },
        { provide: Clock, useValue: clock },
        { provide: ConfigService, useValue: config },
        { provide: ActivityTimersProducer, useValue: producer },
        ActivityPolicyService,
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  /** Actividad futura y en curso (10:00–14:00, ahora 12:00). */
  function futureActivity(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      bondId,
      createdBy: creator,
      assignedTo: assignee,
      status: ActivityStatus.ASSIGNED,
      version: 1,
      title: 'Test Activity',
      scheduledStart: new Date('2026-10-01T10:00:00Z'),
      scheduledEnd: new Date('2026-10-01T14:00:00Z'),
      confirmedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      declinedAt: null,
      declinedReason: null,
      deletedAt: null,
      ...overrides,
    } as any;
  }

  /** Actividad ya terminada (11:00–12:00, ahora 12:00 ⇒ end alcanzada). */
  function pastActivity(overrides: Record<string, unknown> = {}) {
    return futureActivity({
      scheduledStart: new Date('2026-10-01T11:00:00Z'),
      scheduledEnd: new Date('2026-10-01T12:00:00Z'),
      ...overrides,
    });
  }

  /**
   * `applyTransition` echo: devuelve la entidad resultante a partir del input
   * (status + side-effects), como el repo real tras el `save`.
   */
  function transitionEcho(extra: Record<string, unknown> = {}) {
    activityRepo.applyTransition.mockImplementation(async (input: any) => ({
      id: input.id,
      bondId,
      status: input.nextStatus,
      version: input.expectedVersion + 1,
      ...input.fields,
      // Los `extra` ganan sobre `fields` a propósito (p.ej. confirmedAt exacto).
      ...extra,
    }));
  }

  const expectCode = async (p: Promise<unknown>, code: string, status: number) => {
    // Una sola captura: encadenar dos `await` re-lanzaría la excepción.
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CodedException);
    const coded = err as CodedException;
    expect(coded.code).toBe(code);
    expect(coded.getStatus()).toBe(status);
  };

  describe('create', () => {
    const validDto = () => ({
      title: 'Test Activity',
      categoryId,
      scheduledStart: '2026-10-05T10:00:00Z',
      childrenIds: [childId],
    });

    beforeEach(() => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      // E6: create routes through `insertWithInitialTransition` (v1 + outbox).
      activityRepo.insertWithInitialTransition.mockImplementation(async (input: any) => ({
        id: 'a1',
        ...input.row,
        scheduledStart: input.row.scheduledStart ? new Date(input.row.scheduledStart) : null,
        scheduledEnd: input.row.scheduledEnd ? new Date(input.row.scheduledEnd) : null,
        status: input.initial.status,
        version: 1,
      }));
    });

    it('creates activity with valid data', async () => {
      const saved = { id: 'a1', status: ActivityStatus.CREATED, version: 1 } as any;
      activityRepo.insertWithInitialTransition.mockResolvedValue(saved);
      const result = await service.create(bondId, validDto() as any, userId);
      expect(result).toEqual(saved);
    });

    it('normalizes scheduledStart/scheduledEnd to Date before insert (T2 wireTimers regression)', async () => {
      await service.create(
        bondId,
        { ...validDto(), assignedTo: assignee, scheduledEnd: '2026-10-05T11:00:00Z' } as any,
        userId,
      );
      const input = activityRepo.insertWithInitialTransition.mock.calls[0][0];
      expect(input.row.scheduledStart).toBeInstanceOf(Date);
      expect(input.row.scheduledEnd).toBeInstanceOf(Date);
    });

    it('rejects when childIds is empty (DTO)', async () => {
      const dto = plainToInstance(CreateActivityDto, {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [],
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('childrenIds');
    });

    it('rejects when childIds has duplicates (DTO)', async () => {
      const dto = plainToInstance(CreateActivityDto, {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId, childId],
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('childrenIds');
    });

    it('rejects when category is inactive', async () => {
      categoriesRepo.findActiveById.mockResolvedValue(null as any);
      await expect(service.create(bondId, validDto() as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('derives criticality from category', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'critical',
      } as any);
      const res = await service.create(bondId, validDto() as any, userId);
      expect(res.criticality).toBe('critical');
    });

    it('does not notify when not assigned', async () => {
      await service.create(bondId, validDto() as any, userId);
      expect(notificationRepo.createForActivity).not.toHaveBeenCalled();
    });

    it('rolls back if notification save fails', async () => {
      notificationRepo.createForActivity.mockRejectedValue(new Error('fail'));
      await expect(
        service.create(bondId, { ...validDto(), assignedTo: assignee } as any, userId),
      ).rejects.toThrow();
    });

    it('opens EXACTLY ONE transaction and shares the SAME manager across the 3 writes (R3)', async () => {
      const dto = { ...validDto(), assignedTo: assignee };
      await service.create(bondId, dto as any, userId);

      expect(activityRepo.transaction).toHaveBeenCalledTimes(1);
      expect(activityRepo.insertWithInitialTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          initial: { status: ActivityStatus.ASSIGNED, event: 'activity.assigned' },
          row: expect.objectContaining({ bondId, assignedTo: assignee }),
        }),
        fakeManager,
      );
      expect(activityChildRepo.saveChildrenFor).toHaveBeenCalledWith('a1', [childId], fakeManager);
      expect(notificationRepo.createForActivity).toHaveBeenCalledWith(
        expect.objectContaining({ userId: assignee, refEntityId: 'a1' }),
        fakeManager,
      );
    });

    it('404 when the acting user is not an active bond member', async () => {
      bondService.isActiveBondForMember.mockResolvedValue(false);
      await expect(service.create(bondId, validDto() as any, userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('400 when assignedTo is not an active bond member (OQ-1)', async () => {
      const nonMember = 'u-out';
      bondService.isActiveBondForMember.mockImplementation((_b: string, id: string) =>
        Promise.resolve(id !== nonMember),
      );
      await expect(
        service.create(bondId, { ...validDto(), assignedTo: nonMember } as any, userId),
      ).rejects.toThrow(BadRequestException);
      expect(bondService.isActiveBondForMember).toHaveBeenCalledWith(bondId, nonMember);
    });

    it('T2: with assignee → assigned row with deadline=now+36h and 3 timers enqueued post-commit', async () => {
      const started = await service.create(
        bondId,
        { ...validDto(), assignedTo: assignee } as any,
        userId,
      );

      const input = activityRepo.insertWithInitialTransition.mock.calls[0][0];
      expect(input.initial).toEqual({
        status: ActivityStatus.ASSIGNED,
        event: 'activity.assigned',
      });
      expect(input.payload).toMatchObject({
        from: 'new',
        to: ActivityStatus.ASSIGNED,
        actor: { type: 'user', id: userId },
      });
      expect(input.row.deadline).toEqual(new Date(NOW.getTime() + 36 * 3600_000));
      expect(started.status).toBe(ActivityStatus.ASSIGNED);
      expect(started.version).toBe(1);

      expect(producer.enqueue).toHaveBeenCalledTimes(3);
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.RESPONSE_TIMEOUT,
        'a1',
        1,
        new Date(NOW.getTime() + 36 * 3600_000),
        NOW,
      );
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.START,
        'a1',
        1,
        new Date('2026-10-05T10:00:00Z'),
        NOW,
      );
      // end anchor = scheduled_end ?? scheduled_start (no end here → start).
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.END,
        'a1',
        1,
        new Date('2026-10-05T10:00:00Z'),
        NOW,
      );
      expect(producer.cancel).not.toHaveBeenCalled();
    });

    it('T1: without assignee → created row, deadline null, NO timers', async () => {
      await service.create(bondId, validDto() as any, userId);

      const input = activityRepo.insertWithInitialTransition.mock.calls[0][0];
      expect(input.initial).toEqual({ status: ActivityStatus.CREATED, event: 'activity.created' });
      expect(input.row.deadline).toBeNull();
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(producer.cancel).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Chokepoint `transition()` (E5.1) — REQ-TX-1/4, AC-1/2
  // ══════════════════════════════════════════════════════════════════════════
  describe('transition() chokepoint', () => {
    it('user invalid transition → 409 and NO repo write', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSISTING }));
      await expectCode(
        service.transition({
          activityId: 'a1',
          to: ActivityStatus.DONE,
          actor: { kind: 'user', userId: creator },
        }),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('system invalid transition → current entity, no repo write (timers never throw)', async () => {
      const activity = futureActivity({ status: ActivityStatus.ASSISTING });
      activityRepo.findById.mockResolvedValue(activity);
      const res = await service.transition({
        activityId: 'a1',
        to: ActivityStatus.DONE,
        actor: { kind: 'system' },
      });
      expect(res).toBe(activity);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('system CAS miss → null (stale no-op)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      activityRepo.applyTransition.mockResolvedValue(null);
      const res = await service.transition({
        activityId: 'a1',
        to: ActivityStatus.OVERDUE,
        actor: { kind: 'system' },
      });
      expect(res).toBeNull();
    });

    it('user CAS miss → 409 (racing writer lost)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      activityRepo.applyTransition.mockResolvedValue(null);
      await expectCode(
        service.transition({
          activityId: 'a1',
          to: ActivityStatus.ASSISTING,
          actor: { kind: 'user', userId: assignee },
        }),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );
    });

    it('system-only rule requested by a user → 403', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      await expectCode(
        service.transition({
          activityId: 'a1',
          to: ActivityStatus.OVERDUE, // T7: actors=['system']
          actor: { kind: 'user', userId: creator },
        }),
        'ACTIVITY_FORBIDDEN',
        403,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('records from/to/actor(role)/occurredAt in the outbox payload', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      transitionEcho();
      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.ASSISTING,
        actor: { kind: 'user', userId: assignee },
      });

      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'a1',
          expectedFrom: ActivityStatus.ASSIGNED,
          expectedVersion: 1,
          nextStatus: ActivityStatus.ASSISTING,
        }),
      );
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.outbox.payload).toMatchObject({
        activityId: 'a1',
        from: ActivityStatus.ASSIGNED,
        to: ActivityStatus.ASSISTING,
        actor: { type: 'user', id: assignee, role: 'progenitor' },
      });
      expect(typeof input.outbox.payload.occurredAt).toBe('string');
      // T5 clears the deadline as a side-effect.
      expect(input.fields.deadline).toBeNull();
    });

    it('missing activity → null for system, coded 404 for a user', async () => {
      activityRepo.findById.mockResolvedValue(null);
      await expect(
        service.transition({
          activityId: 'x',
          to: ActivityStatus.OVERDUE,
          actor: { kind: 'system' },
        }),
      ).resolves.toBeNull();
      await expectCode(
        service.transition({
          activityId: 'x',
          to: ActivityStatus.CANCELLED,
          actor: { kind: 'user', userId: creator },
        }),
        'ACTIVITY_NOT_FOUND',
        404,
      );
    });

    it('computes deadline = now + RESPONSE_TIMEOUT_HOURS on deadline:set', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      transitionEcho();
      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.ASSIGNED, // T9: deadline 'set'
        actor: { kind: 'user', userId: creator },
      });
      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toEqual(new Date(NOW.getTime() + 36 * 3600_000));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E8 · markOverdue (T7) + coordinator notify (REQ-ACTOR-3, AC-6)
  // ══════════════════════════════════════════════════════════════════════════
  describe('markOverdue (T7)', () => {
    const futureStart = new Date('2026-10-02T10:00:00Z');
    const futureEnd = new Date('2026-10-02T14:00:00Z');

    it('assigned → overdue: coordinator notified in-tx, start+end timers enqueued', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ scheduledStart: futureStart, scheduledEnd: futureEnd }),
      );
      bondMembersRepo.findCoordinator.mockResolvedValue({ userId: 'coord-1' });
      transitionEcho({ scheduledStart: futureStart, scheduledEnd: futureEnd });

      const res = await service.markOverdue('a1');

      expect(res?.status).toBe(ActivityStatus.OVERDUE);
      expect(bondMembersRepo.findCoordinator).toHaveBeenCalledWith(bondId);

      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.nextStatus).toBe(ActivityStatus.OVERDUE);
      expect(input.outbox.payload.actor).toEqual({ type: 'system' });
      // The notification is resolved pre-tx and written by the repo inside it.
      expect(input.notification).toEqual({
        userId: 'coord-1',
        type: 'activity_overdue',
        title: 'Test Activity',
        body: 'Activity overdue: Test Activity',
      });

      // T7 re-enqueues start+end at the NEW version (design D8).
      expect(producer.enqueue).toHaveBeenCalledTimes(2);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.START, 'a1', 2, futureStart, NOW);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.END, 'a1', 2, futureEnd, NOW);
    });

    it('no coordinator → NO notification, still transitions (no throw)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      bondMembersRepo.findCoordinator.mockResolvedValue(null);
      transitionEcho();

      const res = await service.markOverdue('a1');

      expect(res?.status).toBe(ActivityStatus.OVERDUE);
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.notification).toBeUndefined();
    });

    it('from non-assigned (done) → silent no-op, NO notification, NO timers', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.DONE }));

      const res = await service.markOverdue('a1');

      expect(res?.status).toBe(ActivityStatus.DONE);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
      expect(bondMembersRepo.findCoordinator).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(producer.cancel).not.toHaveBeenCalled();
    });

    it('missing activity → 404', async () => {
      activityRepo.findById.mockResolvedValue(null);
      await expect(service.markOverdue('gone')).rejects.toThrow(NotFoundException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E9 · Shared SYSTEM dispatch used by the timer processor + sweep (design D9)
  // ══════════════════════════════════════════════════════════════════════════
  describe('applySystemTransition', () => {
    it('applies the system transition (assigned → overdue via T7)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      transitionEcho();

      await service.applySystemTransition('a1', ActivityStatus.OVERDUE);

      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.nextStatus).toBe(ActivityStatus.OVERDUE);
      expect(input.outbox.payload.actor).toEqual({ type: 'system' });
    });

    it('swallows errors — never throws into BullMQ', async () => {
      jest.spyOn(service, 'transition').mockRejectedValue(new Error('db down'));

      await expect(
        service.applySystemTransition('a1', ActivityStatus.DONE),
      ).resolves.toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E6 · Post-commit BullMQ wiring (design D7/D8, REQ-TIMER-8)
  // ══════════════════════════════════════════════════════════════════════════
  describe('E6: post-commit timer wiring', () => {
    const futureStart = new Date('2026-10-02T10:00:00Z');
    const futureEnd = new Date('2026-10-02T14:00:00Z');
    const deadline = new Date(NOW.getTime() + 36 * 3600_000);

    it('→assigned (T9): deadline=now+36h and 3 timers enqueued at the NEW version', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.NOT_ASSISTING,
          scheduledStart: futureStart,
          scheduledEnd: futureEnd,
        }),
      );
      transitionEcho({ scheduledStart: futureStart, scheduledEnd: futureEnd });

      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.ASSIGNED,
        actor: { kind: 'user', userId: creator },
      });

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toEqual(deadline);

      expect(producer.enqueue).toHaveBeenCalledTimes(3);
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.RESPONSE_TIMEOUT,
        'a1',
        2,
        deadline,
        NOW,
      );
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.START, 'a1', 2, futureStart, NOW);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.END, 'a1', 2, futureEnd, NOW);
      expect(producer.cancel).not.toHaveBeenCalled();
    });

    it('→assisting (T5): clears deadline, cancels rt at the PREVIOUS version, enqueues start+end', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.ASSIGNED,
          scheduledStart: futureStart,
          scheduledEnd: futureEnd,
        }),
      );
      transitionEcho({ scheduledStart: futureStart, scheduledEnd: futureEnd });

      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.ASSISTING,
        actor: { kind: 'user', userId: assignee },
      });

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toBeNull();

      expect(producer.cancel).toHaveBeenCalledTimes(1);
      expect(producer.cancel).toHaveBeenCalledWith(TimerKind.RESPONSE_TIMEOUT, 'a1', 1);
      expect(producer.enqueue).toHaveBeenCalledTimes(2);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.START, 'a1', 2, futureStart, NOW);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.END, 'a1', 2, futureEnd, NOW);
    });

    it('→assisting skips START when scheduledStart is already past (sweep recovers)', async () => {
      // futureActivity(): scheduledStart 10:00 < NOW 12:00; scheduledEnd 14:00 future.
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      transitionEcho({
        scheduledStart: new Date('2026-10-01T10:00:00Z'),
        scheduledEnd: new Date('2026-10-01T14:00:00Z'),
      });

      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.ASSISTING,
        actor: { kind: 'user', userId: assignee },
      });

      expect(producer.cancel).toHaveBeenCalledTimes(1);
      expect(producer.enqueue).toHaveBeenCalledTimes(1);
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.END,
        'a1',
        2,
        new Date('2026-10-01T14:00:00Z'),
        NOW,
      );
    });

    it('→done (T11): cancels ALL timers at the previous version; deadline column untouched (REQ-MODEL-2)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.IN_PROGRESS }),
      );
      transitionEcho();

      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.DONE,
        actor: { kind: 'user', userId: creator },
      });

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toBeUndefined();
      expect(producer.cancel).toHaveBeenCalledTimes(3);
      for (const kind of [TimerKind.RESPONSE_TIMEOUT, TimerKind.START, TimerKind.END]) {
        expect(producer.cancel).toHaveBeenCalledWith(kind, 'a1', 1);
      }
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('CAS-miss system no-op → null and NO producer calls', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      activityRepo.applyTransition.mockResolvedValue(null);

      const res = await service.transition({
        activityId: 'a1',
        to: ActivityStatus.OVERDUE,
        actor: { kind: 'system' },
      });

      expect(res).toBeNull();
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(producer.cancel).not.toHaveBeenCalled();
    });

    it('user 409 (invalid transition) → NO producer calls', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSISTING }));
      await expectCode(
        service.transition({
          activityId: 'a1',
          to: ActivityStatus.DONE,
          actor: { kind: 'user', userId: creator },
        }),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );
      expect(producer.enqueue).not.toHaveBeenCalled();
      expect(producer.cancel).not.toHaveBeenCalled();
    });

    it('producer failure is swallowed post-commit (never throws)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.NOT_ASSISTING,
          scheduledStart: futureStart,
          scheduledEnd: futureEnd,
        }),
      );
      transitionEcho({ scheduledStart: futureStart, scheduledEnd: futureEnd });
      producer.enqueue.mockRejectedValue(new Error('redis down'));

      await expect(
        service.transition({
          activityId: 'a1',
          to: ActivityStatus.ASSIGNED,
          actor: { kind: 'user', userId: creator },
        }),
      ).resolves.toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Retargeted write sites (E5.2–E5.4)
  // ══════════════════════════════════════════════════════════════════════════
  describe('complete → T11 (in_progress → done)', () => {
    it('routes through transition() and returns done + completedAt', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.IN_PROGRESS }),
      );
      transitionEcho();
      const res = await service.complete('a1', creator);

      expect(res.status).toBe(ActivityStatus.DONE);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.IN_PROGRESS,
          nextStatus: ActivityStatus.DONE,
        }),
      );
    });

    it('409 from assigned (was a raw UPDATE from any status)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      await expectCode(service.complete('a1', creator), 'ACTIVITY_INVALID_TRANSITION', 409);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('409 from a terminal state (done)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.DONE }));
      await expectCode(service.complete('a1', creator), 'ACTIVITY_INVALID_TRANSITION', 409);
    });

    it('409 from cancelled', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.CANCELLED }));
      await expectCode(service.complete('a1', creator), 'ACTIVITY_INVALID_TRANSITION', 409);
    });

    it('404 for a non-member before the transition', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.IN_PROGRESS }),
      );
      bondService.isActiveBondForMember.mockResolvedValue(false);
      await expectCode(service.complete('a1', stranger), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });
  });

  describe('confirmAssignment → T5 (assigned → assisting)', () => {
    it('routes through transition() with a derived assignedConfirmed=true', async () => {
      const confirmedAt = new Date('2026-10-01T11:30:00Z');
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.ASSIGNED, confirmedAt: null }),
      );
      transitionEcho({ confirmedAt });
      const res = await service.confirmAssignment('a1', assignee);

      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.ASSIGNED,
          nextStatus: ActivityStatus.ASSISTING,
        }),
      );
      expect(res.assignedConfirmed).toBe(true);
      expect(res.confirmedAt).toBe(confirmedAt.toISOString());
    });

    it('idempotent when already assisting — no new version/event', async () => {
      const confirmedAt = new Date('2026-10-01T11:30:00Z');
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.ASSISTING, confirmedAt }),
      );
      const res = await service.confirmAssignment('a1', assignee);

      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
      expect(res).toEqual({
        id: 'a1',
        assignedConfirmed: true,
        confirmedAt: confirmedAt.toISOString(),
      });
    });

    it('never writes the removed assignedConfirmed boolean', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.ASSIGNED, confirmedAt: null }),
      );
      transitionEcho();
      await service.confirmAssignment('a1', assignee);
      expect(activityRepo.updateFields).not.toHaveBeenCalled();
    });

    it('403 for a non-assignee', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expect(service.confirmAssignment('a1', creator)).rejects.toThrow(ForbiddenException);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('409 from created (map miss)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.CREATED }));
      await expectCode(
        service.confirmAssignment('a1', assignee),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );
    });
  });

  describe('delete (Eliminar) — REQ-TRANS-4/AC-9: T15 + softDelete same tx', () => {
    it('routes T15 through transition() with deleted=payload', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      const res = await service.delete('a1', creator);

      expect(res.deletedAt).toBe(NOW_ISO);
      expect(activityRepo.applyTransition).toHaveBeenCalledTimes(1);
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.nextStatus).toBe(ActivityStatus.CANCELLED);
      expect(input.fields.deletedAt).toEqual(NOW);
      expect(input.outbox.payload).toMatchObject({
        to: ActivityStatus.CANCELLED,
        deleted: true,
      });
      expect(activityRepo.softDeleteWithAudit).not.toHaveBeenCalled();
    });

    it('touches NOTHING else — no cancel/decline, no child-table cascade', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      await service.delete('a1', creator);
      expect(activityRepo.cancelWithAudit).not.toHaveBeenCalled();
      expect(activityRepo.declineWithAudit).not.toHaveBeenCalled();
      expect(activityChildRepo.saveChildrenFor).not.toHaveBeenCalled();
    });

    it('403 for a bond member who is not the creator', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(service.delete('a1', assignee), 'ACTIVITY_FORBIDDEN', 403);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('403 once the activity has ended — being past strips the creator flag', async () => {
      activityRepo.findById.mockResolvedValue(pastActivity());
      await expectCode(service.delete('a1', creator), 'ACTIVITY_FORBIDDEN', 403);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('404 when the activity does not exist at all', async () => {
      activityRepo.findById.mockResolvedValue(null);
      await expectCode(service.delete('a1', creator), 'ACTIVITY_NOT_FOUND', 404);
    });
  });

  describe('cancel (Cancelar) — A1: reason REQUIRED, 3–200', () => {
    it('routes T15 via transition() with the reason in the payload', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      const res = await service.cancel('a1', creator, 'no podemos ese día');

      expect(res.status).toBe(ActivityStatus.CANCELLED);
      expect(res.cancelledAt).toBe(NOW_ISO);
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.nextStatus).toBe(ActivityStatus.CANCELLED);
      expect(input.outbox.payload.reason).toBe('no podemos ese día');
      expect(activityRepo.cancelWithAudit).not.toHaveBeenCalled();
    });

    it('emits `cancelled` LOWERCASE so the client uppercase() match fires', () => {
      expect(ActivityStatus.CANCELLED).toBe('cancelled');
    });

    it('422 VALIDATION_FAILED when the reason is missing', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(service.cancel('a1', creator, undefined), 'VALIDATION_FAILED', 422);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('422 for a 2-char reason and for a 201-char reason', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(service.cancel('a1', creator, 'ab'), 'VALIDATION_FAILED', 422);
      await expectCode(service.cancel('a1', creator, 'a'.repeat(201)), 'VALIDATION_FAILED', 422);
    });

    it('accepts the 3 and 200 bounds', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      await expect(service.cancel('a1', creator, 'abc')).resolves.toBeDefined();
      await expect(service.cancel('a1', creator, 'a'.repeat(200))).resolves.toBeDefined();
    });

    it('403 for a non-creator', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(
        service.cancel('a1', assignee, 'un motivo válido'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
    });

    it('403 when already past — being past strips the creator flag', async () => {
      activityRepo.findById.mockResolvedValue(pastActivity());
      await expectCode(
        service.cancel('a1', creator, 'un motivo válido'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
    });
  });

  describe('decline (No asistir) — T6/T8, reason required and PERSISTED', () => {
    it('assigned → not_assisting (T6) with the reason persisted', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      const res = await service.declineAssignment('a1', assignee, 'estoy de guardia');

      expect(res.status).toBe(ActivityStatus.NOT_ASSISTING);
      expect(res.declinedAt).toBe(NOW_ISO);
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.expectedFrom).toBe(ActivityStatus.ASSIGNED);
      expect(input.nextStatus).toBe(ActivityStatus.NOT_ASSISTING);
      expect(input.fields.declinedAt).toEqual(NOW);
      expect(input.fields.declinedReason).toBe('estoy de guardia');
      expect(activityRepo.declineWithAudit).not.toHaveBeenCalled();
    });

    it('overdue → not_assisting (T8)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.OVERDUE }));
      transitionEcho();
      await service.declineAssignment('a1', assignee, 'no puedo');
      expect(activityRepo.applyTransition.mock.calls[0][0].expectedFrom).toBe(
        ActivityStatus.OVERDUE,
      );
    });

    it('422 when the reason is missing — previously it was optional', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(
        service.declineAssignment('a1', assignee, undefined),
        'VALIDATION_FAILED',
        422,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('422 for a whitespace-only reason', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(
        service.declineAssignment('a1', assignee, '        '),
        'VALIDATION_FAILED',
        422,
      );
    });

    it('403 for the creator when they are not the assignee', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      await expectCode(
        service.declineAssignment('a1', creator, 'no puedo'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
    });

    it('403 when already past — being past strips the assignee flag', async () => {
      activityRepo.findById.mockResolvedValue(pastActivity());
      await expectCode(
        service.declineAssignment('a1', assignee, 'no puedo'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
    });

    it('uses the injected Clock, never `new Date()`', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();
      await service.declineAssignment('a1', assignee, 'no puedo');
      expect(clock.now).toHaveBeenCalled();
    });
  });

  describe('viewer-aware DTOs (R1)', () => {
    it('listByBond injects can_* for the viewer, not for the creator', async () => {
      activityRepo.findByBondIdOrdered.mockResolvedValue([futureActivity({ id: 'a1' })]);

      const asCreator = await service.listByBond(bondId, creator);
      expect(asCreator[0]).toMatchObject({
        canDelete: true,
        canCancel: true,
        canDecline: false,
      });

      const asAssignee = await service.listByBond(bondId, assignee);
      expect(asAssignee[0]).toMatchObject({
        canDelete: false,
        canCancel: false,
        canDecline: true,
      });
    });

    it('getDetail adds isPast and the three flags', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      const detail = await service.getDetail('a1', creator);
      expect(detail).toMatchObject({
        canDelete: true,
        canCancel: true,
        canDecline: false,
        isPast: false,
      });
    });

    it('A3: declinedReason is exposed to ANY bond member, not only the creator', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ declinedReason: 'cita médica' }));
      const detail = await service.getDetail('a1', stranger);
      expect(detail.declinedReason).toBe('cita médica');
    });

    it('declinedReason is null (present, not omitted) when nobody declined', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      const detail = await service.getDetail('a1', creator);
      expect(detail.declinedReason).toBeNull();
      expect('declinedReason' in detail).toBe(true);
    });
  });

  describe('derived assignedConfirmed (AC-12)', () => {
    it('listByBond: true only when status=assisting AND confirmedAt present', async () => {
      activityRepo.findByBondIdOrdered.mockResolvedValue([
        futureActivity({
          id: 'a1',
          status: ActivityStatus.ASSISTING,
          confirmedAt: new Date('2026-10-01T11:00:00Z'),
        }),
        futureActivity({ id: 'a2', status: ActivityStatus.ASSIGNED, confirmedAt: null }),
      ]);
      const rows = await service.listByBond(bondId, creator);
      expect(rows[0].assignedConfirmed).toBe(true);
      expect(rows[1].assignedConfirmed).toBe(false);
    });

    it('getDetail: derived value survives JSON serialization', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.ASSISTING,
          confirmedAt: new Date('2026-10-01T11:00:00Z'),
        }),
      );
      const detail = await service.getDetail('a1', creator);
      expect(detail.assignedConfirmed).toBe(true);
      expect(JSON.parse(JSON.stringify(detail)).assignedConfirmed).toBe(true);
    });

    it('getDetail: false for an assigned (unconfirmed) activity', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.ASSIGNED, confirmedAt: null }),
      );
      const detail = await service.getDetail('a1', creator);
      expect(detail.assignedConfirmed).toBe(false);
    });

    it('getDetail: false when status=assisting but confirmedAt is null (invariant guard)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.ASSISTING, confirmedAt: null }),
      );
      const detail = await service.getDetail('a1', creator);
      expect(detail.assignedConfirmed).toBe(false);
    });
  });

  describe('membership enforcement (BOLA closure)', () => {
    const nonMember = 'u-out';
    const notMember = () => bondService.isActiveBondForMember.mockResolvedValue(false);

    const expectPlain404 = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as Error).message).toBe('Bond not found or you are not a member');
    };

    it('delete: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      notMember();
      await expectCode(service.delete('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('cancel: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      notMember();
      await expectCode(service.cancel('a1', nonMember, 'motivo válido'), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('declineAssignment: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      notMember();
      await expectCode(
        service.declineAssignment('a1', nonMember, 'no puedo'),
        'ACTIVITY_NOT_FOUND',
        404,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('getDetail: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      notMember();
      await expectCode(service.getDetail('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
    });

    it('complete: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.IN_PROGRESS }),
      );
      notMember();
      await expectCode(service.complete('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('confirmAssignment: non-member → coded 404 before the assignee check', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      notMember();
      await expectCode(service.confirmAssignment('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
    });

    it('listByBond: non-member → plain 404 before any row query', async () => {
      notMember();
      await expectPlain404(service.listByBond(bondId, nonMember));
      expect(activityRepo.findByBondIdOrdered).not.toHaveBeenCalled();
    });

    it('getComplianceForBond: non-member → plain 404 before any row query', async () => {
      notMember();
      await expectPlain404(service.getComplianceForBond(bondId, nonMember));
      expect(bondMembersRepo.findActiveMembersWithActStats).not.toHaveBeenCalled();
    });

    it('member happy path is unchanged (viewer flags still resolved)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      const detail = await service.getDetail('a1', creator);
      expect(detail).toMatchObject({ canDelete: true, canCancel: true, canDecline: false });
    });
  });
});
