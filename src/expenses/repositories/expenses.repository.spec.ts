import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ExpenseAttachmentEntity } from '../entities/expense-attachment.entity';
import { ExpenseEntity, ExpenseStatus } from '../entities/expense.entity';
import { ExpensesRepository } from './expenses.repository';

/**
 * Doble del `QueryBuilder` de TypeORM: encadena y REGISTRA las condiciones
 * (`where`/`andWhere`) para poder afirmar sobre el SQL que se genera.
 */
interface QbStub {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  limit: jest.Mock;
  offset: jest.Mock;
  setParameter: jest.Mock;
  setParameters: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  getRawOne: jest.Mock;
  leftJoinAndSelect: jest.Mock;
  conditions: string[];
  params: Record<string, unknown>[];
}

function createQbStub(): QbStub {
  const conditions: string[] = [];
  const params: Record<string, unknown>[] = [];
  const stub = {} as QbStub;

  stub.conditions = conditions;
  stub.params = params;
  stub.where = jest.fn((sql: string, bound?: Record<string, unknown>) => {
    conditions.push(sql);
    params.push(bound ?? {});
    return stub;
  });
  stub.andWhere = jest.fn((sql: string, bound?: Record<string, unknown>) => {
    conditions.push(sql);
    params.push(bound ?? {});
    return stub;
  });
  stub.orderBy = jest.fn(() => stub);
  stub.addOrderBy = jest.fn(() => stub);
  stub.limit = jest.fn(() => stub);
  stub.offset = jest.fn(() => stub);
  stub.setParameter = jest.fn(() => stub);
  stub.setParameters = jest.fn(() => stub);
  stub.getMany = jest.fn(async () => []);
  stub.getCount = jest.fn(async () => 0);
  stub.select = jest.fn(() => stub);
  stub.addSelect = jest.fn(() => stub);
  stub.getRawOne = jest.fn(async () => ({}));
  stub.leftJoinAndSelect = jest.fn(() => stub);

  return stub;
}

describe('ExpensesRepository — read path (T28)', () => {
  let repo: ExpensesRepository;
  let qbs: QbStub[];
  let rawResult: Record<string, unknown>;
  let attachmentRepo: { existsBy: jest.Mock; find: jest.Mock };
  let expenseRepo: jest.Mocked<Repository<ExpenseEntity>>;

  const BOND = 'bond-1';

  beforeEach(async () => {
    qbs = [];
    rawResult = {
      saldo: '0',
      pendientes: 0,
      aprobados: 0,
      pagados: 0,
      rechazados: 0,
    };
    attachmentRepo = {
      existsBy: jest.fn().mockResolvedValue(false),
      find: jest.fn().mockResolvedValue([]),
    };
    expenseRepo = {
      target: ExpenseEntity,
      manager: {},
      createQueryBuilder: jest.fn(() => {
        const qb = createQbStub();
        qb.getRawOne.mockImplementation(async () => rawResult);
        qbs.push(qb);
        return qb;
      }),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<ExpenseEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesRepository,
        { provide: getRepositoryToken(ExpenseEntity), useValue: expenseRepo },
        { provide: getRepositoryToken(ExpenseAttachmentEntity), useValue: attachmentRepo },
      ],
    }).compile();

    repo = module.get(ExpensesRepository);
  });

  describe('findAliveById', () => {
    it('returns the expense with hasDocument false when no attachment exists', async () => {
      const row = {
        id: 'expense-1',
        bondId: BOND,
        category: { id: 'cat-1', name: 'Salud' },
        amount: '15000.50',
        status: ExpenseStatus.PENDING,
      };
      expenseRepo.findOne.mockResolvedValue(row as never);

      const result = await repo.findAliveById('expense-1');

      expect(expenseRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'expense-1' }),
          relations: ['category'],
        }),
      );
      expect(result).toEqual(expect.objectContaining({ ...row, hasDocument: false }));
    });

    it('returns hasDocument true when an attachment exists', async () => {
      const row = {
        id: 'expense-1',
        bondId: BOND,
        category: { id: 'cat-1', name: 'Salud' },
        amount: '15000.50',
        status: ExpenseStatus.PENDING,
      };
      expenseRepo.findOne.mockResolvedValue(row as never);
      attachmentRepo.existsBy.mockResolvedValue(true);

      const result = await repo.findAliveById('expense-1');

      expect(result).toEqual(expect.objectContaining({ hasDocument: true }));
    });
  });

  describe('listForBond', () => {
    it('scopes by bond_id and deleted_at IS NULL, then orders by created_at DESC, id DESC', async () => {
      await repo.listForBond(BOND, { limit: 20, offset: 0 });

      const rows = qbs[0];
      expect(rows.where).toHaveBeenNthCalledWith(1, 'e.bond_id = :bondId', { bondId: BOND });
      expect(rows.andWhere).toHaveBeenCalledWith('e.deleted_at IS NULL');
      expect(rows.orderBy).toHaveBeenCalledWith('e.created_at', 'DESC');
      expect(rows.addOrderBy).toHaveBeenCalledWith('e.id', 'DESC');
      expect(rows.limit).toHaveBeenCalledWith(20);
      expect(rows.offset).toHaveBeenCalledWith(0);
      expect(rows.leftJoinAndSelect).toHaveBeenCalledWith('e.category', 'category');
      expect(rows.getMany).toHaveBeenCalled();
    });

    it('counts the same scoped set in a separate query', async () => {
      await repo.listForBond(BOND, { limit: 20, offset: 0 });

      const count = qbs[1];
      expect(count.where).toHaveBeenNthCalledWith(1, 'e.bond_id = :bondId', { bondId: BOND });
      expect(count.andWhere).toHaveBeenCalledWith('e.deleted_at IS NULL');
      expect(count.getCount).toHaveBeenCalled();
      expect(count.orderBy).not.toHaveBeenCalled();
    });

    it('filters by status when provided', async () => {
      await repo.listForBond(BOND, { limit: 20, offset: 0, status: ExpenseStatus.PENDING });

      expect(qbs[0].andWhere).toHaveBeenCalledWith('e.status = :status', {
        status: ExpenseStatus.PENDING,
      });
    });

    it('filters by categoryId when provided', async () => {
      await repo.listForBond(BOND, { limit: 20, offset: 0, categoryId: 'cat-1' });

      expect(qbs[0].andWhere).toHaveBeenCalledWith('e.category_id = :categoryId', {
        categoryId: 'cat-1',
      });
    });

    it('filters by inclusive from/to on expense_date', async () => {
      await repo.listForBond(BOND, { limit: 20, offset: 0, from: '2026-10-01', to: '2026-10-31' });

      expect(qbs[0].andWhere).toHaveBeenCalledWith('e.expense_date >= :from', {
        from: '2026-10-01',
      });
      expect(qbs[0].andWhere).toHaveBeenCalledWith('e.expense_date <= :to', { to: '2026-10-31' });
    });

    it('sets hasDocument per item from ONE attachment query for the whole page', async () => {
      const items = [
        { id: 'e1', bondId: BOND, status: ExpenseStatus.PENDING },
        { id: 'e2', bondId: BOND, status: ExpenseStatus.APPROVED },
      ];
      const listQb = createQbStub();
      listQb.getMany.mockResolvedValue(items);
      const countQb = createQbStub();
      expenseRepo.createQueryBuilder
        .mockReturnValueOnce(listQb as never)
        .mockReturnValueOnce(countQb as never);
      attachmentRepo.find.mockResolvedValue([{ expenseId: 'e1' }]);

      const result = await repo.listForBond(BOND, { limit: 20, offset: 0 });

      expect(result.items).toEqual([
        expect.objectContaining({ id: 'e1', hasDocument: true }),
        expect.objectContaining({ id: 'e2', hasDocument: false }),
      ]);
      // UNA consulta para toda la página: preguntar gasto por gasto es un N+1.
      expect(attachmentRepo.find).toHaveBeenCalledTimes(1);
      expect(attachmentRepo.existsBy).not.toHaveBeenCalled();
    });
  });

  describe('summaryForBond', () => {
    const VIEWER = 'user-viewer';

    it('scopes by bond_id and deleted_at IS NULL', async () => {
      await repo.summaryForBond(BOND, VIEWER);

      const qb = qbs[0];
      expect(qb.where).toHaveBeenNthCalledWith(1, 'e.bond_id = :bondId', { bondId: BOND });
      expect(qb.andWhere).toHaveBeenCalledWith('e.deleted_at IS NULL');
    });

    it('computes saldo from the viewer point of view using the numeric aggregate', async () => {
      await repo.summaryForBond(BOND, VIEWER);

      const qb = qbs[0];
      expect(qb.select).toHaveBeenCalled();
      const selectCall = qb.select.mock.calls[0][0];
      expect(selectCall).toMatch(/SUM\(/i);
      expect(selectCall).toMatch(/::numeric/i);
      expect(selectCall).toMatch(/split_ratio_payer/i);
      expect(selectCall).toMatch(/split_ratio_other/i);
      expect(selectCall).toMatch(/requested_by/i);
      expect(qb.setParameter).toHaveBeenCalledWith('viewerId', VIEWER);
    });

    it('counts non-deleted rows per status', async () => {
      await repo.summaryForBond(BOND, VIEWER);

      const qb = qbs[0];
      expect(qb.addSelect).toHaveBeenCalledWith(
        expect.stringMatching(/COUNT\(\*\).*status = 'pending'/i),
        'pendientes',
      );
      expect(qb.addSelect).toHaveBeenCalledWith(
        expect.stringMatching(/COUNT\(\*\).*status = 'approved'/i),
        'aprobados',
      );
      expect(qb.addSelect).toHaveBeenCalledWith(
        expect.stringMatching(/COUNT\(\*\).*status = 'paid'/i),
        'pagados',
      );
      expect(qb.addSelect).toHaveBeenCalledWith(
        expect.stringMatching(/COUNT\(\*\).*status = 'rejected'/i),
        'rechazados',
      );
    });

    it('returns zeros and converts the numeric string to a number', async () => {
      rawResult = {
        saldo: '-123.45',
        pendientes: 2,
        aprobados: 1,
        pagados: 0,
        rechazados: 1,
      };

      const result = await repo.summaryForBond(BOND, VIEWER);

      expect(result.saldo).toBe(-123.45);
      expect(result.porPagar).toBe(123.45);
      expect(result.porCobrar).toBe(0);
      expect(result.counts).toEqual({
        pendientes: 2,
        aprobados: 1,
        pagados: 0,
        rechazados: 1,
      });
    });

    it('returns positive saldo as porCobrar', async () => {
      rawResult = { saldo: '75.00', pendientes: 0, aprobados: 0, pagados: 0, rechazados: 0 };

      const result = await repo.summaryForBond(BOND, VIEWER);

      expect(result.saldo).toBe(75);
      expect(result.porPagar).toBe(0);
      expect(result.porCobrar).toBe(75);
    });

    it('falls back to zero when the driver omits the row', async () => {
      const summaryQb = createQbStub();
      summaryQb.getRawOne.mockResolvedValue(null);
      expenseRepo.createQueryBuilder.mockReturnValueOnce(summaryQb as never);

      const result = await repo.summaryForBond(BOND, VIEWER);

      expect(result).toEqual({
        saldo: 0,
        porPagar: 0,
        porCobrar: 0,
        counts: { pendientes: 0, aprobados: 0, pagados: 0, rechazados: 0 },
      });
    });
  });
});
