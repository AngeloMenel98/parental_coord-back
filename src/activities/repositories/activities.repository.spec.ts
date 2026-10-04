import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ActivitiesRepository } from './activities.repository';
import { ActivityEntity } from '../entities/activity.entity';

describe('ActivitiesRepository', () => {
  let repo: ActivitiesRepository;
  let activityRepo: jest.Mocked<Repository<ActivityEntity>>;

  let qb: any;

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
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    activityRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn().mockResolvedValue(null),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesRepository,
        { provide: getRepositoryToken(ActivityEntity), useValue: activityRepo },
      ],
    }).compile();

    repo = module.get<ActivitiesRepository>(ActivitiesRepository);
  });

  describe('markOverdue', () => {
    it('builds correct query conditions', async () => {
      await repo.markOverdue();
      expect(qb.update).toHaveBeenCalled();
      expect(qb.where).toHaveBeenCalledWith('assigned_to IS NOT NULL');
    });

    it('returns affected count', async () => {
      const qb: any = activityRepo.createQueryBuilder();
      qb.execute.mockResolvedValueOnce({ affected: 3 });
      const res = await repo.markOverdue();
      expect(res).toBe(3);

      qb.execute.mockResolvedValueOnce({ affected: null });
      const res2 = await repo.markOverdue();
      expect(res2).toBe(0);
    });
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

    it('markOverdue excludes deleted — a hidden row must not be flipped to overdue', async () => {
      await repo.markOverdue();
      expect(qb.andWhere).toHaveBeenCalledWith('deleted_at IS NULL');
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
});
