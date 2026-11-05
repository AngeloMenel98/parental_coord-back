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
    // getDetail now uses the children-enriched path; default to the same fixture
    // so existing getDetail specs keep working without per-test rewrites.
    activityRepo.findByIdWithChildren = jest.fn((id: string) => activityRepo.findById(id));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: ActivitiesRepository, useValue: activityRepo },
        { provide: ActivityChildRepository, useValue: activityChildRepo },
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
      verifyAt: null,
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

    it('rejects create when scheduledStart is less than 48 h ahead', async () => {
      const dto = {
        ...validDto(),
        scheduledStart: '2026-10-02T11:00:00Z', // 23 h after NOW
      };
      await expect(service.create(bondId, dto as any, userId)).rejects.toThrow(BadRequestException);
      await expect(service.create(bondId, dto as any, userId)).rejects.toThrow(
        'La actividad debe programarse con al menos 48 horas de anticipación',
      );
      expect(activityRepo.insertWithInitialTransition).not.toHaveBeenCalled();
    });

    it('accepts create exactly at the 48 h boundary', async () => {
      const dto = {
        ...validDto(),
        scheduledStart: '2026-10-03T12:00:00Z', // exactly 48 h after NOW
      };
      await expect(service.create(bondId, dto as any, userId)).resolves.toBeDefined();
    });

    it('honours MIN_LEAD_TIME_HOURS when overridden', async () => {
      config.get.mockImplementation((key: string) => (key === 'MIN_LEAD_TIME_HOURS' ? 72 : 36));
      const dto = {
        ...validDto(),
        scheduledStart: '2026-10-04T11:00:00Z', // 47 h after NOW, < 72 h
      };
      await expect(service.create(bondId, dto as any, userId)).rejects.toThrow(
        'La actividad debe programarse con al menos 48 horas de anticipación',
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

    it('does NOT write a notification on create — the worker fan-out owns it (P5)', async () => {
      await service.create(bondId, { ...validDto(), assignedTo: assignee } as any, userId);

      // REQ-FAN-006: `activity_assigned` is produced by the worker-only fan-out
      // after dispatch. Create only writes activity + children + outbox.
      expect(activityChildRepo.saveChildrenFor).toHaveBeenCalledTimes(1);
      expect((service as any).notificationRepo).toBeUndefined();
    });

    it('opens EXACTLY ONE transaction and shares the SAME manager across the remaining writes (R3)', async () => {
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

    it('T1: without assignee → created row, deadline=now+36h, response-timeout enqueued', async () => {
      await service.create(bondId, validDto() as any, userId);

      const input = activityRepo.insertWithInitialTransition.mock.calls[0][0];
      expect(input.initial).toEqual({ status: ActivityStatus.CREATED, event: 'activity.created' });
      expect(input.row.deadline).toEqual(new Date(NOW.getTime() + 36 * 3600_000));
      expect(producer.enqueue).toHaveBeenCalledTimes(1);
      expect(producer.enqueue).toHaveBeenCalledWith(
        TimerKind.RESPONSE_TIMEOUT,
        'a1',
        1,
        new Date(NOW.getTime() + 36 * 3600_000),
        NOW,
      );
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

    it('assigned → overdue: NO in-tx notification (worker fan-out owns it), start+end timers enqueued', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ scheduledStart: futureStart, scheduledEnd: futureEnd }),
      );
      transitionEcho({ scheduledStart: futureStart, scheduledEnd: futureEnd });

      const res = await service.markOverdue('a1');

      expect(res?.status).toBe(ActivityStatus.OVERDUE);

      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.nextStatus).toBe(ActivityStatus.OVERDUE);
      expect(input.outbox.payload.actor).toEqual({ type: 'system' });
      // REQ-FAN-006: the coordinator notice now comes from the worker fan-out,
      // not from the transition tx.
      expect(input.notification).toBeUndefined();
      expect(bondMembersRepo.findCoordinator).not.toHaveBeenCalled();

      // T7 re-enqueues start+end at the NEW version (design D8).
      expect(producer.enqueue).toHaveBeenCalledTimes(2);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.START, 'a1', 2, futureStart, NOW);
      expect(producer.enqueue).toHaveBeenCalledWith(TimerKind.END, 'a1', 2, futureEnd, NOW);
    });

    it('no in-tx notification regardless of coordinator lookup (P5 regression)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      transitionEcho();

      const res = await service.markOverdue('a1');

      expect(res?.status).toBe(ActivityStatus.OVERDUE);
      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.notification).toBeUndefined();
      expect(bondMembersRepo.findCoordinator).not.toHaveBeenCalled();
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

    it('→done: cancels ALL timers at the previous version; deadline column untouched (REQ-MODEL-2)', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.VERIFY }));
      transitionEcho();

      await service.transition({
        activityId: 'a1',
        to: ActivityStatus.DONE,
        actor: { kind: 'user', userId: creator },
      });

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toBeNull();
      expect(producer.cancel).toHaveBeenCalledTimes(4);
      for (const kind of [
        TimerKind.RESPONSE_TIMEOUT,
        TimerKind.START,
        TimerKind.END,
        TimerKind.VERIFY_TIMEOUT,
      ]) {
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
  describe('complete → T11 (in_progress → done) / T13 (verify → done)', () => {
    it('routes through transition() and returns done + completedAt', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.VERIFY }));
      transitionEcho();
      const res = await service.complete('a1', creator);

      expect(res.status).toBe(ActivityStatus.DONE);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.VERIFY,
          nextStatus: ActivityStatus.DONE,
        }),
      );
    });

    it('completes from in_progress — the member may close it before its end time', async () => {
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

    it('409 from assigned', async () => {
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
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.VERIFY }));
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

    /**
     * La aceptación TARDÍA ya no existe (decisión del usuario, 2026-11-03).
     *
     * No es sólo que el botón desaparezca: la regla `overdue → assisting` se quitó
     * del catálogo, así que el endpoint responde 409 como cualquier transición
     * inexistente. Ocultar el botón y dejar la puerta abierta sería el flag
     * mintiendo.
     */
    it('overdue → assisting is a 409: la aceptación tardía se quitó del catálogo', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.OVERDUE, assignedTo: assignee, verifyAt: null }),
      );
      transitionEcho();

      await expectCode(
        service.confirmAssignment('a1', assignee),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );

      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('403 when overdue originated from created (no assignee; not the assignee)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.OVERDUE, assignedTo: null, verifyAt: null }),
      );
      await expect(service.confirmAssignment('a1', userId)).rejects.toThrow(ForbiddenException);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('409 when overdue originated from verify', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.OVERDUE, assignedTo: assignee, verifyAt: NOW }),
      );
      await expectCode(
        service.confirmAssignment('a1', assignee),
        'ACTIVITY_INVALID_TRANSITION',
        409,
      );
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

    it('overdue → not_assisting (T8) when origin is assigned', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.OVERDUE, assignedTo: assignee, verifyAt: null }),
      );
      transitionEcho();
      await service.declineAssignment('a1', assignee, 'no puedo');
      expect(activityRepo.applyTransition.mock.calls[0][0].expectedFrom).toBe(
        ActivityStatus.OVERDUE,
      );
    });

    it('403 when overdue originated from created (no assignee; not the assignee)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.OVERDUE,
          assignedTo: null,
          verifyAt: null,
        }),
      );
      await expectCode(
        service.declineAssignment('a1', userId, 'no puedo'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('403 when overdue originated from verify — policy.canDecline is false', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.OVERDUE,
          assignedTo: assignee,
          verifyAt: NOW,
        }),
      );
      await expectCode(
        service.declineAssignment('a1', assignee, 'no puedo'),
        'ACTIVITY_FORBIDDEN',
        403,
      );
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
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
        canConfirm: false,
        canDecline: false,
        canComplete: false,
      });

      const asAssignee = await service.listByBond(bondId, assignee);
      expect(asAssignee[0]).toMatchObject({
        canDelete: false,
        canCancel: false,
        canConfirm: true,
        canDecline: true,
        canComplete: false,
      });
    });

    it('getDetail adds isPast and the server flags', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      const detail = await service.getDetail('a1', creator);
      expect(detail).toMatchObject({
        canDelete: true,
        canCancel: true,
        canConfirm: false,
        canDecline: false,
        canComplete: false,
        isPast: false,
      });
    });

    it('listByBond exposes canComplete in `in_progress` for any member', async () => {
      activityRepo.findByBondIdOrdered.mockResolvedValue([
        futureActivity({ id: 'a1', status: ActivityStatus.IN_PROGRESS }),
      ]);
      const rows = await service.listByBond(bondId, stranger);
      expect(rows[0].canComplete).toBe(true);
      expect(rows[0].canConfirm).toBe(false);
    });

    it('listByBond exposes canDecline but NOT canConfirm for overdue-from-assigned', async () => {
      // La aceptación tardía se quitó (decisión del usuario, 2026-11-03): en
      // `overdue` el botón "Confirmar" no se pinta. El "No asiste" sigue, que es
      // la salida que evita el callejón sin salida.
      activityRepo.findByBondIdOrdered.mockResolvedValue([
        futureActivity({
          id: 'a1',
          status: ActivityStatus.OVERDUE,
          assignedTo: assignee,
          verifyAt: null,
        }),
      ]);
      const rows = await service.listByBond(bondId, assignee);
      expect(rows[0].canConfirm).toBe(false);
      expect(rows[0].canDecline).toBe(true);
    });

    it('getDetail exposes canComplete in `verify`', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.VERIFY, verifyAt: NOW }),
      );
      const detail = await service.getDetail('a1', stranger);
      expect(detail.canComplete).toBe(true);
    });

    it('T4 removed: canUnassign is never present in DTOs', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity());
      const detail = await service.getDetail('a1', creator);
      expect('canUnassign' in detail).toBe(false);
      activityRepo.findByBondIdOrdered.mockResolvedValue([futureActivity({ id: 'a1' })]);
      const rows = await service.listByBond(bondId, creator);
      expect('canUnassign' in rows[0]).toBe(false);
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

    it('getDetail exposes childrenIds linked to the activity (D-5)', async () => {
      activityRepo.findByIdWithChildren.mockResolvedValue(
        futureActivity({ childrenIds: [childId, 'c2'] }),
      );
      const detail = await service.getDetail('a1', creator);
      expect(detail.childrenIds).toEqual([childId, 'c2']);
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
      expect(detail).toMatchObject({
        canDelete: true,
        canCancel: true,
        canConfirm: false,
        canDecline: false,
        canComplete: false,
      });
    });
  });

  describe('assign → T3 (created → assigned)', () => {
    it('assigns to the actor when assignedTo is omitted', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      const res = await service.assign('a1', userId);

      expect(res.status).toBe(ActivityStatus.ASSIGNED);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.CREATED,
          nextStatus: ActivityStatus.ASSIGNED,
          fields: expect.objectContaining({ assignedTo: userId }),
        }),
      );
    });

    it('assigns to another bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      const res = await service.assign('a1', userId, assignee);

      expect(res.status).toBe(ActivityStatus.ASSIGNED);
      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.assignedTo).toBe(assignee);
    });

    it('sets the response deadline to now + 36 h (T3 side-effect)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      await service.assign('a1', userId);

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toEqual(new Date(NOW.getTime() + 36 * 3600_000));
    });

    it('409 when the activity is not in `created`', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      await expectCode(service.assign('a1', userId), 'ACTIVITY_INVALID_TRANSITION', 409);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    /**
     * La RUTA no acota el estado: lo acota el CATÁLOGO de transiciones.
     *
     * `POST /:id/assign` sobre una actividad en `not_assisting` aplica T9 (la misma
     * transición que la ruta de reasignar). Lo que impide robar una asignación viva
     * NO es la ruta: es que el catálogo no tiene regla hacia `assigned` desde
     * `assigned`/`assisting`/`in_progress`/`verify`, y eso es un 409.
     *
     * Pinned porque es la diferencia entre "la ruta protege" y "el catálogo protege":
     * si algún día se duplica el estado en la ruta, este test lo delata.
     */
    it('applies T9 when the activity is in `not_assisting` (the catalog guards, not the route)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.NOT_ASSISTING,
          declinedAt: new Date(),
          declinedReason: 'no puedo',
        }),
      );
      transitionEcho();

      const res = await service.assign('a1', userId);

      expect(res.status).toBe(ActivityStatus.ASSIGNED);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.NOT_ASSISTING,
          nextStatus: ActivityStatus.ASSIGNED,
          fields: expect.objectContaining({ assignedTo: userId }),
        }),
      );
    });

    it('404 when the caller is not a bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      bondService.isActiveBondForMember.mockResolvedValue(false);
      await expectCode(service.assign('a1', 'u-out'), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('404 when the target is not an active bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      bondService.isActiveBondForMember.mockImplementation((_b: string, id: string) =>
        Promise.resolve(id !== assignee),
      );
      await expectCode(service.assign('a1', userId, assignee), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });
  });

  describe('reassign → T9 (not_assisting → assigned)', () => {
    it('reassigns to the actor when assignedTo is omitted', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      transitionEcho();

      const res = await service.reassign('a1', userId);

      expect(res.status).toBe(ActivityStatus.ASSIGNED);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.NOT_ASSISTING,
          nextStatus: ActivityStatus.ASSIGNED,
          fields: expect.objectContaining({ assignedTo: userId }),
        }),
      );
    });

    it('reassigns to another bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      transitionEcho();

      await service.reassign('a1', userId, assignee);

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.assignedTo).toBe(assignee);
    });

    it('clears declined_at and confirmed_at for the new assignee (T9 side-effect)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({
          status: ActivityStatus.NOT_ASSISTING,
          declinedAt: new Date('2026-09-30T10:00:00Z'),
          declinedReason: 'estoy de guardia',
          confirmedAt: new Date('2026-09-30T09:00:00Z'),
        }),
      );
      transitionEcho();

      await service.reassign('a1', userId);

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.declinedAt).toBeNull();
      expect(fields.declinedReason).toBeNull();
      expect(fields.confirmedAt).toBeNull();
    });

    it('sets the response deadline to now + 36 h (T9 side-effect)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      transitionEcho();

      await service.reassign('a1', userId);

      const fields = activityRepo.applyTransition.mock.calls[0][0].fields;
      expect(fields.deadline).toEqual(new Date(NOW.getTime() + 36 * 3600_000));
    });

    it('409 when the activity is not in `not_assisting`', async () => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status: ActivityStatus.ASSIGNED }));
      await expectCode(service.reassign('a1', userId), 'ACTIVITY_INVALID_TRANSITION', 409);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    /**
     * La ruta de reasignar sobre una actividad en `created` aplica T3 — la misma
     * transición que la ruta de asignar. Ver la nota del `describe` de `assign`: lo
     * que acota los estados alcanzables es el catálogo, no la ruta.
     */
    it('applies T3 when the activity is in `created` (the catalog guards, not the route)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      const res = await service.reassign('a1', userId);

      expect(res.status).toBe(ActivityStatus.ASSIGNED);
      expect(activityRepo.applyTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ActivityStatus.CREATED,
          nextStatus: ActivityStatus.ASSIGNED,
        }),
      );
    });

    it('404 when the caller is not a bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      bondService.isActiveBondForMember.mockResolvedValue(false);
      await expectCode(service.reassign('a1', 'u-out'), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('404 when the target is not an active bond member', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING }),
      );
      bondService.isActiveBondForMember.mockImplementation((_b: string, id: string) =>
        Promise.resolve(id !== assignee),
      );
      await expectCode(service.reassign('a1', userId, assignee), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });
  });
  /**
   * RECEIPTS de la verificación de autorización (T21).
   *
   * El pase adversarial no encontró ningún defecto —las doce vías de entrada quedaron
   * bloqueadas— pero dejó cinco huecos SIN FIJAR. Estos tests los cierran, para que la
   * próxima revisión no tenga que volver a sondear lo mismo:
   *
   *  1. La respuesta es ESTRECHA: ni `version`, ni `bondId`, ni `deletedAt`.
   *  2. El outbox lleva el ACTOR: una reasignación es atribuible.
   *  3. Una asignación VIVA (o terminal, o vencida) es 409 y NO escribe — en las dos rutas.
   *  4. La fila se lee SIN las borradas: el guard del soft delete está en el `WHERE` del
   *     repositorio (`deletedAt IS NULL`), y esta aserción deja fijado que la ruta de
   *     asignación usa esa lectura y no la que trae las borradas.
   *  5. Un objetivo de OTRO vínculo es 404, con la consulta acotada por el vínculo.
   */
  describe('assign/reassign — receipts de la verificación de autorización', () => {
    it('la respuesta es ESTRECHA: nada de version, bondId ni deletedAt', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      const res = await service.assign('a1', userId);

      expect(Object.keys(res).sort()).toEqual(['assignedTo', 'id', 'status']);
    });

    it('el outbox lleva el actor: la reasignación es atribuible', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.NOT_ASSISTING, declinedAt: new Date() }),
      );
      transitionEcho();

      await service.reassign('a1', userId, assignee);

      const input = activityRepo.applyTransition.mock.calls[0][0];
      expect(input.outbox.payload).toMatchObject({
        activityId: 'a1',
        from: ActivityStatus.NOT_ASSISTING,
        to: ActivityStatus.ASSIGNED,
        actor: { type: 'user', id: userId, role: 'progenitor' },
      });
    });

    it.each([
      ActivityStatus.ASSIGNED,
      ActivityStatus.ASSISTING,
      ActivityStatus.IN_PROGRESS,
      ActivityStatus.VERIFY,
      ActivityStatus.OVERDUE,
      ActivityStatus.DONE,
      ActivityStatus.CANCELLED,
    ])('una asignación viva, vencida o terminal (%s) es 409 y no escribe', async (status) => {
      activityRepo.findById.mockResolvedValue(futureActivity({ status }));

      await expectCode(service.assign('a1', userId), 'ACTIVITY_INVALID_TRANSITION', 409);
      await expectCode(service.reassign('a1', userId), 'ACTIVITY_INVALID_TRANSITION', 409);

      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });

    it('la fila se lee SIN las borradas (el guard del soft delete vive en el WHERE)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      transitionEcho();

      await service.assign('a1', userId);

      expect(activityRepo.findById).toHaveBeenCalledWith('a1');
      expect(activityRepo.findByIdIncludingDeleted).not.toHaveBeenCalled();
    });

    it('un objetivo de OTRO vínculo es 404 (la consulta está acotada por el vínculo)', async () => {
      activityRepo.findById.mockResolvedValue(
        futureActivity({ status: ActivityStatus.CREATED, assignedTo: null }),
      );
      // El mock por defecto ignora el vínculo; acá se acota a propósito, como el SQL.
      bondService.isActiveBondForMember.mockImplementation(
        async (b: string, u: string) => b === bondId && u !== 'u-otro-vinculo',
      );

      await expectCode(service.assign('a1', userId, 'u-otro-vinculo'), 'ACTIVITY_NOT_FOUND', 404);
      expect(activityRepo.applyTransition).not.toHaveBeenCalled();
    });
  });
});
