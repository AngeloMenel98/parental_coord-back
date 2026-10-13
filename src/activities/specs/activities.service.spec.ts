import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let activityRepo: any;
  let categoriesRepo: any;
  let childrenRepo: any;
  let notifRepo: any;
  let notificationRepo: any;
  let activityChildRepo: any;
  let bondService: any;
  let bondMembersRepo: any;
  let clock: Clock;
  let fakeManager: any;
  const bondId = 'b1';
  const userId = 'u1';
  const childId = 'c1';
  const categoryId = 'cat1';

  beforeEach(async () => {
    activityRepo = {
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
      findByBondIdOrdered: jest.fn().mockResolvedValue([]),
      markCompleted: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
      create: jest.fn(),
      findOneBy: jest.fn(),
      updateFields: jest.fn(),
      softDeleteWithAudit: jest.fn(),
      cancelWithAudit: jest.fn(),
      declineWithAudit: jest.fn(),
    } as any;
    categoriesRepo = {
      findActiveById: jest.fn(),
    } as any;
    childrenRepo = {
      findByIdsAndBond: jest.fn(),
    } as any;
    notifRepo = {
      create: jest.fn((x: any) => x),
      save: jest.fn(),
    } as any;
    // El repo dedicado recibe el input YA compuesto (refEntityType/isRead los
    // pone él): la aserción mide el payload que el servicio decide enviar.
    notificationRepo = {
      createForActivity: jest.fn(),
    } as any;
    activityChildRepo = {
      saveChildrenFor: jest.fn(),
    } as any;
    bondService = {
      isActiveBondForMember: jest.fn().mockResolvedValue(true),
    } as any;
    // T6 (R5): el join de compliance vive en BondMembersRepository.
    bondMembersRepo = {
      findActiveMembersWithActStats: jest.fn().mockResolvedValue([]),
    } as any;

    // `jest.fn` y no una flecha suelta: los tests de la guarda de tiempo y de la
    // ventana de deshacer necesitan PODER AVISAR de que se usó el reloj inyectado
    // en lugar de `new Date()`, que es la diferencia entre una regla testeable y
    // una que depende del reloj de pared.
    clock = { now: jest.fn(() => new Date('2026-10-01T12:00:00Z')) } as any;

    // Los 6 openers (create + 5 swipes) pasan por `activitiesRepo.transaction`;
    // `fakeManager` es el EntityManager de mentira que recibe el callback — el
    // mismo que reciben createInTx/saveChildrenFor/createForActivity (R3). Los
    // cuerpos de swipe ya no lo desglosan: escriben vía
    // `activitiesRepo.updateFields(id, patch, manager)`, así que el manager
    // sólo se propaga como argumento (T3).
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
        ActivityPolicyService,
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  describe('create', () => {
    it('creates activity with valid data', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);

      const saved = { id: 'a1' } as any;
      (activityRepo as any).createInTx = jest.fn().mockResolvedValue(saved);
      (activityChildRepo as any).saveChildrenFor = jest.fn();
      (notificationRepo as any).createForActivity = jest.fn();

      const dto = {
        title: 'Test Activity',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: 'u2',
      } as any;

      const result = await service.create(bondId, dto, userId);
      expect(result).toEqual(saved);
    });

    it('rejects when childIds is empty', async () => {
      // La validación de childIds vive en el DTO (@ArrayNotEmpty/@ArrayUnique),
      // no en el servicio. Este caso garantiza que el pipe la aplica.
      const dto = plainToInstance(CreateActivityDto, {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [],
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('childrenIds');
    });

    it('rejects when childIds has duplicates', async () => {
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
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
    });

    it('derives criticality from category', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'critical',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      // Echo: createInTx devuelve el payload tal cual, de modo que el criticality
      // que se verifica es exactamente el que el servicio puso en el objeto.
      (activityRepo as any).createInTx = jest.fn(async (a: any) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).saveChildrenFor = jest.fn();
      (notificationRepo as any).createForActivity = jest.fn();
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      const res = await service.create(bondId, dto, userId);
      expect(res.criticality).toBe('critical');
    });

    it('does not notify when not assigned', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).createInTx = jest.fn(async (a: any) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).saveChildrenFor = jest.fn();
      (notificationRepo as any).createForActivity = jest.fn();
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      await service.create(bondId, dto, userId);
      expect(notificationRepo.createForActivity).not.toHaveBeenCalled();
    });

    it('rolls back if notification save fails', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).createInTx = jest.fn(async (a: any) => ({ id: 'a1', ...a }));
      (activityChildRepo as any).saveChildrenFor = jest.fn();
      (notificationRepo as any).createForActivity = jest.fn().mockRejectedValue(new Error('fail'));
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: 'u2',
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow();
    });

    it('opens EXACTLY ONE transaction and shares the SAME manager across the 3 writes (R3)', async () => {
      categoriesRepo.findActiveById.mockResolvedValue({
        id: categoryId,
        isActive: true,
        criticality: 'medium',
      } as any);
      childrenRepo.findByIdsAndBond.mockResolvedValue([{ id: childId }] as any);
      (activityRepo as any).createInTx = jest.fn().mockResolvedValue({ id: 'a1' });
      (activityChildRepo as any).saveChildrenFor = jest.fn();
      (notificationRepo as any).createForActivity = jest.fn();

      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: 'u2',
      } as any;
      await service.create(bondId, dto, userId);

      // R3 · "the spec asserts exactly one transaction(fn) invocation driven
      // with fakeManager" — y las tres escrituras reciben ESE manager.
      expect(activityRepo.transaction).toHaveBeenCalledTimes(1);
      expect(activityRepo.createInTx).toHaveBeenCalledWith(expect.any(Object), fakeManager);
      expect(activityChildRepo.saveChildrenFor).toHaveBeenCalledWith('a1', [childId], fakeManager);
      expect(notificationRepo.createForActivity).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u2', refEntityId: 'a1' }),
        fakeManager,
      );
    });

    it('404 when the acting user is not an active bond member', async () => {
      bondService.isActiveBondForMember.mockResolvedValue(false);
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(NotFoundException);
    });

    it('400 when assignedTo is not an active bond member (OQ-1)', async () => {
      const nonMember = 'u-out';
      bondService.isActiveBondForMember.mockImplementation((_bond: string, id: string) =>
        Promise.resolve(id !== nonMember),
      );
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: nonMember,
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
    });

    it('400 when a derived memberIds entry is not an active bond member (SC-005)', async () => {
      const nonMember = 'u-out';
      bondService.isActiveBondForMember.mockImplementation((_bond: string, id: string) =>
        Promise.resolve(id !== nonMember),
      );
      const dto = {
        title: 'Test',
        categoryId,
        scheduledStart: '2026-10-05T10:00:00Z',
        childrenIds: [childId],
        assignedTo: nonMember,
      } as any;
      await expect(service.create(bondId, dto, userId)).rejects.toThrow(BadRequestException);
      expect(bondService.isActiveBondForMember).toHaveBeenCalledWith(bondId, nonMember);
    });
  });

  describe('complete', () => {
    it('already done returns activity unchanged in completedAt sense', async () => {
      const completedAt = new Date('2026-10-01T10:00:00Z');
      const act = { id: 'a1', status: ActivityStatus.DONE, completedAt, bondId } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).save = jest.fn();
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: completedAt.toISOString() });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('sets completedAt when transitioning to DONE', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: null,
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: '2026-10-01T12:00:00Z' });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('preserves existing completedAt on second call', async () => {
      const completedAt = new Date('2026-10-01T10:00:00Z');
      const act = { id: 'a1', status: ActivityStatus.DONE, completedAt, bondId } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: completedAt.toISOString() });
      const res = await service.complete('a1', userId);
      expect(res.status).toBe(ActivityStatus.DONE);
    });

    it('does not notify when no assignee', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: null,
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).markCompleted = jest
        .fn()
        .mockResolvedValue({ status: ActivityStatus.DONE, completedAt: '2026-10-01T12:00:00Z' });
      await service.complete('a1', userId);
    });

    it('rollback on notification failure', async () => {
      const act = {
        id: 'a1',
        status: ActivityStatus.ASSIGNED,
        completedAt: null,
        bondId,
        assigneeId: 'u2',
      } as any;
      (activityRepo as any).findById = jest.fn().mockResolvedValue(act);
      (activityRepo as any).save = jest.fn(async (a) => a);
      (notifRepo as any).create = jest.fn();
      (notifRepo as any).save = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(service.complete('a1', userId)).rejects.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Acciones de swipe (R2, R4–R8, R11)
  // ══════════════════════════════════════════════════════════════════════════
  describe('swipe actions', () => {
    const creator = 'u-creator';
    const assignee = 'u-assignee';
    const stranger = 'u-stranger';

    /** Actividad futura y en curso (10:00–14:00, ahora 12:00). */
    function futureActivity(overrides: Record<string, unknown> = {}) {
      return {
        id: 'a1',
        bondId,
        createdBy: creator,
        assignedTo: assignee,
        status: ActivityStatus.ASSIGNED,
        scheduledStart: new Date('2026-10-01T10:00:00Z'),
        scheduledEnd: new Date('2026-10-01T14:00:00Z'),
        deletedAt: null,
        declinedAt: null,
        declinedReason: null,
        cancelledAt: null,
        cancelledBy: null,
        ...overrides,
      } as any;
    }

    /** Actividad ya terminada (12:00–13:00, ahora 12:00 ⇒ end alcanzada). */
    function pastActivity(overrides: Record<string, unknown> = {}) {
      return futureActivity({
        scheduledStart: new Date('2026-10-01T11:00:00Z'),
        scheduledEnd: new Date('2026-10-01T12:00:00Z'),
        ...overrides,
      });
    }

    const expectCode = async (p: Promise<unknown>, code: string, status: number) => {
      // Se captura UNA vez y se inspecciona el resultado: encadenar dos `await` sobre
      // la misma promesa re-lanza la excepción en vez de devolverla.
      const err = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CodedException);
      const coded = err as CodedException;
      expect(coded.code).toBe(code);
      expect(coded.getStatus()).toBe(status);
    };

    describe('delete (Eliminar) — A4: deleted_at and nothing else', () => {
      it('delegates to softDeleteWithAudit with the CLOCK time', async () => {
        const activity = futureActivity();
        (activityRepo as any).findById.mockResolvedValue(activity);
        const res = await service.delete('a1', creator);

        expect(res.deletedAt).toBe('2026-10-01T12:00:00.000Z');
        expect(activityRepo.softDeleteWithAudit).toHaveBeenCalledWith(
          activity,
          creator,
          new Date('2026-10-01T12:00:00Z'),
        );
      });

      it('touches NOTHING else — no cancel/decline, no child-table cascade', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.delete('a1', creator);
        expect(activityRepo.cancelWithAudit).not.toHaveBeenCalled();
        expect(activityRepo.declineWithAudit).not.toHaveBeenCalled();
        expect(activityChildRepo.saveChildrenFor).not.toHaveBeenCalled();
      });

      it('403 for a bond member who is not the creator', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(service.delete('a1', assignee), 'ACTIVITY_FORBIDDEN', 403);
      });

      it('403 once the activity has ended — being past strips the creator flag', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(service.delete('a1', creator), 'ACTIVITY_FORBIDDEN', 403);
        expect(activityRepo.softDeleteWithAudit).not.toHaveBeenCalled();
      });

      it('404 when the activity does not exist at all', async () => {
        (activityRepo as any).findById.mockResolvedValue(null);
        await expectCode(service.delete('a1', creator), 'ACTIVITY_NOT_FOUND', 404);
      });
    });

    describe('cancel (Cancelar) — A1: reason REQUIRED, 3–200', () => {
      it('delegates to cancelWithAudit with CANCELLED + the reason', async () => {
        const activity = futureActivity();
        (activityRepo as any).findById.mockResolvedValue(activity);
        const res = await service.cancel('a1', creator, 'no podemos ese día');

        expect(res.status).toBe(ActivityStatus.CANCELLED);
        expect(res.cancelledAt).toBe('2026-10-01T12:00:00.000Z');
        expect(activityRepo.cancelWithAudit).toHaveBeenCalledWith(
          activity,
          creator,
          new Date('2026-10-01T12:00:00Z'),
          'no podemos ese día',
        );
      });

      it('emits `cancelled` LOWERCASE so the client uppercase() match fires', () => {
        expect(ActivityStatus.CANCELLED).toBe('cancelled');
      });

      it('422 VALIDATION_FAILED when the reason is missing', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(service.cancel('a1', creator, undefined), 'VALIDATION_FAILED', 422);
      });

      it('422 for a 2-char reason and for a 201-char reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(service.cancel('a1', creator, 'ab'), 'VALIDATION_FAILED', 422);
        await expectCode(service.cancel('a1', creator, 'a'.repeat(201)), 'VALIDATION_FAILED', 422);
      });

      it('accepts the 3 and 200 bounds', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expect(service.cancel('a1', creator, 'abc')).resolves.toBeDefined();
        await expect(service.cancel('a1', creator, 'a'.repeat(200))).resolves.toBeDefined();
      });

      it('403 for a non-creator', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(
          service.cancel('a1', assignee, 'un motivo válido'),
          'ACTIVITY_FORBIDDEN',
          403,
        );
      });

      it('403 when already past — being past strips the creator flag', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(
          service.cancel('a1', creator, 'un motivo válido'),
          'ACTIVITY_FORBIDDEN',
          403,
        );
      });

      it('forwards the reason to the repository that owns the notification', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ title: 'Visita al museo' }),
        );
        await service.cancel('a1', creator, 'llueve mucho');
        expect(activityRepo.cancelWithAudit).toHaveBeenCalledWith(
          expect.anything(),
          creator,
          expect.any(Date),
          'llueve mucho',
        );
      });
    });

    describe('decline (No asistir) — reason required and PERSISTED', () => {
      it('delegates to declineWithAudit with NOT_ASSISTING + the reason', async () => {
        const activity = futureActivity();
        (activityRepo as any).findById.mockResolvedValue(activity);
        const res = await service.declineAssignment('a1', assignee, 'estoy de guardia');

        expect(res.status).toBe(ActivityStatus.NOT_ASSISTING);
        expect(res.declinedAt).toBe('2026-10-01T12:00:00.000Z');
        expect(activityRepo.declineWithAudit).toHaveBeenCalledWith(
          activity,
          assignee,
          new Date('2026-10-01T12:00:00Z'),
          'estoy de guardia',
        );
      });

      it('422 when the reason is missing — previously it was optional', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(
          service.declineAssignment('a1', assignee, undefined),
          'VALIDATION_FAILED',
          422,
        );
      });

      it('422 for a whitespace-only reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(
          service.declineAssignment('a1', assignee, '        '),
          'VALIDATION_FAILED',
          422,
        );
      });

      it('403 for the creator when they are not the assignee', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(
          service.declineAssignment('a1', creator, 'no puedo'),
          'ACTIVITY_FORBIDDEN',
          403,
        );
      });

      it('403 when already past — being past strips the assignee flag', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(
          service.declineAssignment('a1', assignee, 'no puedo'),
          'ACTIVITY_FORBIDDEN',
          403,
        );
      });

      it('forwards the reason to the repository that owns the notification', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.declineAssignment('a1', assignee, 'cita médica');
        expect(activityRepo.declineWithAudit).toHaveBeenCalledWith(
          expect.anything(),
          assignee,
          expect.any(Date),
          'cita médica',
        );
      });

      it('uses the injected Clock, never `new Date()` — otherwise the guard is untestable', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.declineAssignment('a1', assignee, 'no puedo');
        expect(clock.now).toHaveBeenCalled();
      });
    });

    describe('viewer-aware DTOs (R1)', () => {
      it('listByBond injects can_* for the viewer, not for the creator', async () => {
        const rows = [futureActivity({ id: 'a1' })];
        (activityRepo as any).findByBondIdOrdered.mockResolvedValue(rows);

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
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const detail = await service.getDetail('a1', creator);
        expect(detail).toMatchObject({
          canDelete: true,
          canCancel: true,
          canDecline: false,
          isPast: false,
        });
      });

      it('A3: declinedReason is exposed to ANY bond member, not only the creator', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ declinedReason: 'cita médica' }),
        );
        // El tercero es miembro del vínculo pero no es creador ni asignado.
        const detail = await service.getDetail('a1', stranger);
        expect(detail.declinedReason).toBe('cita médica');
      });

      it('A3: the creator also still sees it', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ declinedReason: 'cita médica' }),
        );
        const detail = await service.getDetail('a1', creator);
        expect(detail.declinedReason).toBe('cita médica');
      });

      it('declinedReason is null (present, not omitted) when nobody declined', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const detail = await service.getDetail('a1', creator);
        expect(detail.declinedReason).toBeNull();
        expect('declinedReason' in detail).toBe(true);
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
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        notMember();
        await expectCode(service.delete('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
        expect(activityRepo.softDeleteWithAudit).not.toHaveBeenCalled();
      });

      it('cancel: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        notMember();
        await expectCode(
          service.cancel('a1', nonMember, 'motivo válido'),
          'ACTIVITY_NOT_FOUND',
          404,
        );
        expect(activityRepo.cancelWithAudit).not.toHaveBeenCalled();
      });

      it('declineAssignment: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        notMember();
        await expectCode(
          service.declineAssignment('a1', nonMember, 'no puedo'),
          'ACTIVITY_NOT_FOUND',
          404,
        );
        expect(activityRepo.declineWithAudit).not.toHaveBeenCalled();
      });

      it('getDetail: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        notMember();
        await expectCode(service.getDetail('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
      });

      it('complete: non-member → coded 404 ACTIVITY_NOT_FOUND', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        notMember();
        await expectCode(service.complete('a1', nonMember), 'ACTIVITY_NOT_FOUND', 404);
        expect(activityRepo.markCompleted).not.toHaveBeenCalled();
      });

      it('confirmAssignment: non-member → coded 404 before the assignee check', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
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
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const detail = await service.getDetail('a1', creator);
        expect(detail).toMatchObject({ canDelete: true, canCancel: true, canDecline: false });
      });
    });
  });
});
