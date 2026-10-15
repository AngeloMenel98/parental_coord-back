import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivitiesRepository } from '../repositories/activities.repository';
import { ActsAuditRepository } from '../repositories/activities-audit.repository';
import { ActivityEntity, ActivityStatus } from '../entities/activity.entity';
import { NotificationRepository } from '../../notifications/repositories/notification.repository';
import { OutboxEventRepository } from '../../outbox/repositories/outbox-event.repository';

describe('ActivitiesRepository', () => {
  let repo: ActivitiesRepository;
  let activityRepo: jest.Mocked<Repository<ActivityEntity>>;
  let outboxRepo: { insert: jest.Mock };
  let notiRepo: { createForActivity: jest.Mock };

  let qb: any;
  let lockQb: any;
  let emRepo: any;
  let em: any;
  let manager: any;

  beforeEach(async () => {
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    lockQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    emRepo = {
      create: jest.fn((data: any) => data),
      save: jest.fn((e: any) => Promise.resolve(e)),
    };

    em = {
      createQueryBuilder: jest.fn().mockReturnValue(lockQb),
      getRepository: jest.fn().mockReturnValue(emRepo),
    };

    manager = { transaction: jest.fn((cb: any) => cb(em)) };

    activityRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn().mockResolvedValue(null),
      target: ActivityEntity,
      manager,
    } as any;

    outboxRepo = { insert: jest.fn().mockResolvedValue({}) };
    notiRepo = { createForActivity: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesRepository,
        { provide: getRepositoryToken(ActivityEntity), useValue: activityRepo },
        { provide: ActsAuditRepository, useValue: { record: jest.fn() } },
        { provide: NotificationRepository, useValue: notiRepo },
        { provide: OutboxEventRepository, useValue: outboxRepo },
      ],
    }).compile();

    repo = module.get<ActivitiesRepository>(ActivitiesRepository);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // A4 · Filtro de borrado lógico en las consultas vivas
  //
  // R9 pide que una actividad eliminada desaparezca de la aplicación. Se
  // comprueba stmt a stmt porque un `WHERE` olvidado en UNA sola consulta es
  // invisible en la UI de lista pero visible en el resumen de cumplimiento o en
  // el paso del scheduler.
  // ══════════════════════════════════════════════════════════════════════════
  describe('soft-delete filter (deleted_at IS NULL)', () => {
    const softDeleteClause = 'a.deleted_at IS NULL';

    it('findByBondIdOrdered excludes deleted', async () => {
      await repo.findByBondIdOrdered('b1');
      expect(qb.andWhere).toHaveBeenCalledWith(softDeleteClause);
    });

    it('countActivitiesByAssignee excludes deleted — compliance counts live work only', async () => {
      await repo.countActivitiesByAssignee('b1', new Date(), new Date());
      expect(qb.andWhere).toHaveBeenCalledWith(softDeleteClause);
    });

    it('findById (user path) filters on deletedAt', async () => {
      await repo.findById('a1');
      expect(activityRepo.findOne).toHaveBeenCalled();
      const where = activityRepo.findOne.mock.calls[0][0].where as Record<string, any>;
      // Se comprueba que es el operador SQL NULL (`IsNull()`), no `undefined`:
      // `undefined` en un `where` de TypeORM se ignora y devolvería la fila
      // eliminada, que es justo el fallo que este filtro existe para evitar.
      expect(where.deletedAt).not.toBeUndefined();
      expect(where.deletedAt.type).toBe('isNull');
    });

    it('findByIdIncludingDeleted does NOT filter — restore needs the hidden row', async () => {
      await repo.findByIdIncludingDeleted('a1');
      const where = activityRepo.findOne.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.deletedAt).toBeUndefined();
      expect(where.id).toBe('a1');
    });

    it('exposes NO purge/GC method — ruling A4 deleted the 30-day retention entirely', () => {
      expect((repo as any).purgeDeleted).toBeUndefined();
      expect((repo as any).purgeDeletedActivities).toBeUndefined();
      expect((repo as any).hardDelete).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E4 · Primitive atómico de transición (REQ-TX-1/2/3)
  // ══════════════════════════════════════════════════════════════════════════
  describe('applyTransition', () => {
    const baseRow = (): ActivityEntity =>
      ({
        id: 'a1',
        bondId: 'b1',
        status: ActivityStatus.CREATED,
        version: 0,
        deletedAt: null,
      }) as ActivityEntity;

    const baseInput = () => ({
      id: 'a1',
      expectedFrom: ActivityStatus.CREATED,
      expectedVersion: 0,
      nextStatus: ActivityStatus.ASSIGNED,
      fields: { deadline: new Date('2030-01-01T00:00:00Z') },
      outbox: { bondId: 'b1', eventType: 'activity.assigned', payload: { k: 'v' } },
    });

    it('locks FOR UPDATE, bumps version and saves with the same manager', async () => {
      const row = baseRow();
      lockQb.getOne.mockResolvedValue(row);

      const result = await repo.applyTransition(baseInput());

      expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(lockQb.where).toHaveBeenCalledWith('a.id = :id', { id: 'a1' });
      expect(result).toBe(row);
      expect(row.status).toBe(ActivityStatus.ASSIGNED);
      expect(row.version).toBe(1);
      expect(row.deadline).toEqual(new Date('2030-01-01T00:00:00Z'));
      expect(emRepo.save).toHaveBeenCalledWith(row);
    });

    it('inserts exactly one outbox row in the same tx with the new version', async () => {
      lockQb.getOne.mockResolvedValue(baseRow());

      await repo.applyTransition(baseInput());

      expect(outboxRepo.insert).toHaveBeenCalledTimes(1);
      expect(outboxRepo.insert).toHaveBeenCalledWith(
        {
          activityId: 'a1',
          bondId: 'b1',
          eventType: 'activity.assigned',
          aggregateVersion: 1,
          payload: { k: 'v' },
        },
        em,
      );
    });

    it('CAS miss (version mismatch) → null, no save, no outbox', async () => {
      lockQb.getOne.mockResolvedValue({ ...baseRow(), version: 5 });

      const result = await repo.applyTransition(baseInput());

      expect(result).toBeNull();
      expect(emRepo.save).not.toHaveBeenCalled();
      expect(outboxRepo.insert).not.toHaveBeenCalled();
    });

    it('writes the optional notification with the SAME tx manager (T7 coordinator)', async () => {
      lockQb.getOne.mockResolvedValue(baseRow());

      await repo.applyTransition({
        ...baseInput(),
        notification: {
          userId: 'coord-1',
          type: 'activity_overdue',
          title: 'T',
          body: 'Activity overdue: T',
        },
      });

      expect(notiRepo.createForActivity).toHaveBeenCalledTimes(1);
      expect(notiRepo.createForActivity).toHaveBeenCalledWith(
        {
          userId: 'coord-1',
          bondId: 'b1',
          type: 'activity_overdue',
          title: 'T',
          body: 'Activity overdue: T',
          refEntityId: 'a1',
        },
        em,
      );
    });

    it('writes NO notification when the input omits one', async () => {
      lockQb.getOne.mockResolvedValue(baseRow());

      await repo.applyTransition(baseInput());

      expect(notiRepo.createForActivity).not.toHaveBeenCalled();
    });

    it('CAS miss → notification is NOT written (all-or-nothing tx)', async () => {
      lockQb.getOne.mockResolvedValue({ ...baseRow(), version: 5 });

      const result = await repo.applyTransition({
        ...baseInput(),
        notification: { userId: 'coord-1', type: 'activity_overdue', title: 'T', body: 'B' },
      });

      expect(result).toBeNull();
      expect(notiRepo.createForActivity).not.toHaveBeenCalled();
    });

    it('row missing → null, no save, no outbox', async () => {
      lockQb.getOne.mockResolvedValue(null);

      const result = await repo.applyTransition(baseInput());

      expect(result).toBeNull();
      expect(emRepo.save).not.toHaveBeenCalled();
      expect(outboxRepo.insert).not.toHaveBeenCalled();
    });

    it('source status mismatch → null (guard miss)', async () => {
      lockQb.getOne.mockResolvedValue({ ...baseRow(), status: ActivityStatus.ASSIGNED });

      const result = await repo.applyTransition(baseInput());

      expect(result).toBeNull();
      expect(outboxRepo.insert).not.toHaveBeenCalled();
    });

    it('soft-deleted row → null (deleted_at guard)', async () => {
      lockQb.getOne.mockResolvedValue({ ...baseRow(), deletedAt: new Date() });

      const result = await repo.applyTransition(baseInput());

      expect(result).toBeNull();
      expect(outboxRepo.insert).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // E9 · Fuente de verdad del sweep (REQ-TIMER-4)
  // ══════════════════════════════════════════════════════════════════════════
  describe('findDueForTransition', () => {
    it('excludes soft-deleted rows', async () => {
      await repo.findDueForTransition(new Date(), 50);
      expect(qb.where).toHaveBeenCalledWith('a.deleted_at IS NULL');
    });

    it('selects due rows by status + anchor and bounds the query', async () => {
      qb.getMany.mockResolvedValueOnce([{ id: 'a1' }]);

      const now = new Date('2026-10-01T12:00:00Z');
      const res = await repo.findDueForTransition(now, 50);

      expect(res).toEqual([{ id: 'a1' }]);
      // The due predicate covers assigned/assisting/in_progress and is parameterized by `now`.
      const [clause, params] = qb.andWhere.mock.calls[0];
      expect(clause).toContain('a.status = :assigned');
      expect(clause).toContain('a.status = :assisting');
      expect(clause).toContain('COALESCE(a.scheduled_end, a.scheduled_start)');
      expect(params.now).toBe(now);
      expect(params.assigned).toBe(ActivityStatus.ASSIGNED);
      expect(qb.limit).toHaveBeenCalledWith(50);
    });

    it('defaults the limit to 100', async () => {
      await repo.findDueForTransition(new Date());
      expect(qb.limit).toHaveBeenCalledWith(100);
    });
  });

  describe('insertWithInitialTransition', () => {
    it('inserts the row at the initial status with version 1 + one outbox row', async () => {
      emRepo.save.mockImplementationOnce((e: any) => Promise.resolve({ ...e, id: 'new-id' }));

      const created = await repo.insertWithInitialTransition({
        row: { bondId: 'b1', title: 't', status: ActivityStatus.CANCELLED } as any,
        initial: { status: ActivityStatus.ASSIGNED, event: 'activity.assigned' },
        payload: { k: 'v' },
      });

      const savedArg = emRepo.save.mock.calls[0][0];
      expect(savedArg.status).toBe(ActivityStatus.ASSIGNED);
      expect(savedArg.version).toBe(1);
      expect(created.id).toBe('new-id');
      expect(outboxRepo.insert).toHaveBeenCalledTimes(1);
      expect(outboxRepo.insert).toHaveBeenCalledWith(
        {
          activityId: 'new-id',
          bondId: 'b1',
          eventType: 'activity.assigned',
          aggregateVersion: 1,
          payload: { k: 'v' },
        },
        em,
      );
    });

    it('uses the created status (T1) when there is no assignee — version 1', async () => {
      emRepo.save.mockImplementationOnce((e: any) => Promise.resolve({ ...e, id: 'n2' }));

      await repo.insertWithInitialTransition({
        row: { bondId: 'b1', title: 't' } as any,
        initial: { status: ActivityStatus.CREATED, event: 'activity.created' },
        payload: {},
      });

      const savedArg = emRepo.save.mock.calls[0][0];
      expect(savedArg.status).toBe(ActivityStatus.CREATED);
      expect(savedArg.version).toBe(1);
    });
  });
});
