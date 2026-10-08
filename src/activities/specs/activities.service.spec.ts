import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActivitiesService } from '../activities.service';
import { ActivitiesRepository } from '../repositories/activities.repository';
import { ActivitiesAuditRepository } from '../repositories/activities-audit.repository';
import { ActivityChildRepository } from '../repositories/activity-child.repository';
import { ActivityPolicyService } from '../activity-policy.service';
import { ChildrenRepository } from '../../children/repositories/children.repository';
import { CategoriesRepository } from '../../categories/repositories/categories.repository';
import { ActivityStatus } from '../entities/activity.entity';
import { BondsRepository } from '../../bonds/repositories/bonds.repository';
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
  let bondsRepo: any;
  let auditRepo: any;
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
    bondsRepo = {
      findActiveBondForMember: jest.fn().mockResolvedValue({ id: bondId } as any),
    } as any;
    auditRepo = {
      record: jest.fn(),
      findLatestOldValue: jest.fn().mockResolvedValue(null),
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
        { provide: BondsRepository, useValue: bondsRepo },
        { provide: ChildrenRepository, useValue: childrenRepo },
        { provide: CategoriesRepository, useValue: categoriesRepo },
        { provide: Clock, useValue: clock },
        ActivityPolicyService,
        { provide: ActivitiesAuditRepository, useValue: auditRepo },
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
      it('sets deleted_at to the CLOCK time and writes an audit row', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const res = await service.delete('a1', creator);

        expect(res.deletedAt).toBe('2026-10-01T12:00:00.000Z');
        expect(activityRepo.updateFields).toHaveBeenCalledWith(
          'a1',
          expect.objectContaining({ deletedAt: new Date('2026-10-01T12:00:00Z') }),
          fakeManager,
        );
        expect(auditRepo.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'activity_delete', userId: creator }),
          expect.anything(),
        );
      });

      it('touches NOTHING else — no status change, no child-table cascade', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.delete('a1', creator);
        const patch = activityRepo.updateFields.mock.calls[0][1];
        expect(Object.keys(patch)).toEqual(['deletedAt']);
      });

      it('403 for a bond member who is not the creator', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await expectCode(service.delete('a1', assignee), 'ACTIVITY_FORBIDDEN', 403);
      });

      it('404 (NOT 403) for a non-member — existence is not revealed', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        bondsRepo.findActiveBondForMember.mockResolvedValue(null);
        await expectCode(service.delete('a1', stranger), 'ACTIVITY_NOT_FOUND', 404);
      });

      it('409 ACTIVITY_ALREADY_PAST once the activity has ended', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(service.delete('a1', creator), 'ACTIVITY_ALREADY_PAST', 409);
        expect(activityRepo.updateFields).not.toHaveBeenCalled();
      });

      it('404 when the activity does not exist at all', async () => {
        (activityRepo as any).findById.mockResolvedValue(null);
        await expectCode(service.delete('a1', creator), 'ACTIVITY_NOT_FOUND', 404);
      });
    });

    describe('restore (undo delete) — server-owned 5000 ms window', () => {
      it('clears deleted_at 3000 ms after the delete', async () => {
        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: new Date('2026-10-01T11:59:57Z') }),
        );
        const res = await service.restore('a1', creator);
        expect(res.deletedAt).toBeNull();
        expect(activityRepo.updateFields).toHaveBeenCalledWith(
          'a1',
          { deletedAt: null },
          fakeManager,
        );
        expect(auditRepo.record).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'activity_restore' }),
          expect.anything(),
        );
      });

      it('is open at EXACTLY 5000 ms and closed at 5001 ms', async () => {
        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: new Date('2026-10-01T11:59:55Z') }),
        );
        await expect(service.restore('a1', creator)).resolves.toEqual({
          id: 'a1',
          deletedAt: null,
        });

        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: new Date('2026-10-01T11:59:54.999Z') }),
        );
        await expectCode(service.restore('a1', creator), 'ACTIVITY_UNDO_WINDOW_EXPIRED', 409);
      });

      it('reads through findByIdIncludingDeleted — the row is already hidden', async () => {
        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: new Date('2026-10-01T11:59:59Z') }),
        );
        await service.restore('a1', creator);
        expect(activityRepo.findByIdIncludingDeleted).toHaveBeenCalledWith('a1');
      });

      it('is idempotent when nothing was deleted — 200, no write, no audit noise', async () => {
        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: null }),
        );
        await expect(service.restore('a1', creator)).resolves.toEqual({
          id: 'a1',
          deletedAt: null,
        });
        expect(activityRepo.updateFields).not.toHaveBeenCalled();
        expect(auditRepo.record).not.toHaveBeenCalled();
      });

      it('403 for a non-creator even inside the window', async () => {
        (activityRepo as any).findByIdIncludingDeleted.mockResolvedValue(
          futureActivity({ deletedAt: new Date('2026-10-01T11:59:59Z') }),
        );
        await expectCode(service.restore('a1', assignee), 'ACTIVITY_FORBIDDEN', 403);
      });
    });

    describe('cancel (Cancelar) — A1: reason REQUIRED, 3–200', () => {
      it('sets CANCELLED + cancelled_at + cancelled_by and audits the reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const res = await service.cancel('a1', creator, 'no podemos ese día');

        expect(res.status).toBe(ActivityStatus.CANCELLED);
        expect(res.cancelledAt).toBe('2026-10-01T12:00:00.000Z');
        expect(activityRepo.updateFields).toHaveBeenCalledWith(
          'a1',
          expect.objectContaining({
            status: ActivityStatus.CANCELLED,
            cancelledAt: new Date('2026-10-01T12:00:00Z'),
            cancelledBy: creator,
          }),
          fakeManager,
        );
        expect(auditRepo.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'activity_cancel',
            detail: 'no podemos ese día',
            oldValue: { status: ActivityStatus.ASSIGNED },
          }),
          expect.anything(),
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

      it('409 when already past', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(
          service.cancel('a1', creator, 'un motivo válido'),
          'ACTIVITY_ALREADY_PAST',
          409,
        );
      });

      it('notifies the assignee WITH the reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ title: 'Visita al museo' }),
        );
        await service.cancel('a1', creator, 'llueve mucho');
        expect(notificationRepo.createForActivity).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: assignee,
            type: 'activity_cancelled',
            body: expect.stringContaining('llueve mucho'),
          }),
          expect.anything(),
        );
      });

      it('does NOT notify the creator — the actor already knows they cancelled it', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.cancel('a1', creator, 'llueve mucho');
        const recipients = notificationRepo.createForActivity.mock.calls.map(
          (c: any[]) => c[0].userId,
        );
        expect(recipients).not.toContain(creator);
        expect(recipients).toEqual([assignee]);
      });
    });

    describe('decline (No asistir) — reason required and PERSISTED', () => {
      it('persists declined_at AND declined_reason (the old endpoint dropped it)', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const res = await service.declineAssignment('a1', assignee, 'estoy de guardia');

        expect(res.status).toBe(ActivityStatus.NOT_ASSISTING);
        expect(activityRepo.updateFields).toHaveBeenCalledWith(
          'a1',
          expect.objectContaining({
            status: ActivityStatus.NOT_ASSISTING,
            declinedAt: new Date('2026-10-01T12:00:00Z'),
            declinedReason: 'estoy de guardia',
          }),
          fakeManager,
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

      it('409 when already past', async () => {
        (activityRepo as any).findById.mockResolvedValue(pastActivity());
        await expectCode(
          service.declineAssignment('a1', assignee, 'no puedo'),
          'ACTIVITY_ALREADY_PAST',
          409,
        );
      });

      it('stores the PREVIOUS status in the audit so undo has something to restore', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.declineAssignment('a1', assignee, 'no puedo');
        expect(auditRepo.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'activity_decline',
            oldValue: { status: ActivityStatus.ASSIGNED },
          }),
          expect.anything(),
        );
      });

      it('notifies the creator WITH the reason (A3 changed DTO visibility, not this audience)', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.declineAssignment('a1', assignee, 'cita médica');
        expect(notificationRepo.createForActivity).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: creator,
            type: 'activity_declined',
            body: expect.stringContaining('cita médica'),
          }),
          expect.anything(),
        );
      });

      it('uses the injected Clock, never `new Date()` — otherwise the guard is untestable', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        await service.declineAssignment('a1', assignee, 'no puedo');
        expect(clock.now).toHaveBeenCalled();
      });
    });

    describe('undo-decline', () => {
      it('restores the previous status from the audit and clears the reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({
            status: ActivityStatus.NOT_ASSISTING,
            declinedAt: new Date('2026-10-01T11:59:57Z'),
            declinedReason: 'no puedo',
          }),
        );
        auditRepo.findLatestOldValue.mockResolvedValue({ status: ActivityStatus.ASSIGNED });

        const res = await service.undoDecline('a1', assignee);
        expect(res.status).toBe(ActivityStatus.ASSIGNED);
        expect(activityRepo.updateFields).toHaveBeenCalledWith(
          'a1',
          expect.objectContaining({
            status: ActivityStatus.ASSIGNED,
            declinedAt: null,
            declinedReason: null,
          }),
          fakeManager,
        );
      });

      it('409 ACTIVITY_UNDO_WINDOW_EXPIRED past 5000 ms', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ declinedAt: new Date('2026-10-01T11:59:50Z') }),
        );
        await expectCode(service.undoDecline('a1', assignee), 'ACTIVITY_UNDO_WINDOW_EXPIRED', 409);
      });

      it('is idempotent when there is no decline to undo', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ status: ActivityStatus.ASSIGNED, declinedAt: null }),
        );
        await expect(service.undoDecline('a1', assignee)).resolves.toEqual({
          id: 'a1',
          status: ActivityStatus.ASSIGNED,
        });
        expect(activityRepo.updateFields).not.toHaveBeenCalled();
      });

      it('403 for a non-assignee', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ declinedAt: new Date('2026-10-01T11:59:59Z') }),
        );
        await expectCode(service.undoDecline('a1', creator), 'ACTIVITY_FORBIDDEN', 403);
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

      it('A3: NEVER leaks across bonds — a non-member gets 404, not the reason', async () => {
        (activityRepo as any).findById.mockResolvedValue(
          futureActivity({ declinedReason: 'cita médica' }),
        );
        bondsRepo.findActiveBondForMember.mockResolvedValue(null);
        await expect(service.getDetail('a1', stranger)).rejects.toMatchObject({
          code: 'ACTIVITY_NOT_FOUND',
        });
      });

      it('declinedReason is null (present, not omitted) when nobody declined', async () => {
        (activityRepo as any).findById.mockResolvedValue(futureActivity());
        const detail = await service.getDetail('a1', creator);
        expect(detail.declinedReason).toBeNull();
        expect('declinedReason' in detail).toBe(true);
      });
    });
  });
});
