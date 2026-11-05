import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { ExpenseStatus } from '../entities/expense.entity';
import { EXPENSE_AUDIT_ACTIONS, ExpensesAuditRepository } from './expenses-audit.repository';

/**
 * T22 · El audit de gastos. FR-10: "Status changes are logged with user and
 * timestamp." El `user_id` lo aporta la entrada y el `created_at` lo pone la
 * columna, así que lo que se prueba acá es que el cambio de estado quede escrito
 * con el estado viejo, el nuevo y la acción correcta.
 */
describe('ExpensesAuditRepository (T22, FR-10)', () => {
  let repo: ExpensesAuditRepository;
  let auditRepo: jest.Mocked<Repository<AuditLogEntity>>;

  beforeEach(async () => {
    auditRepo = {
      create: jest.fn((data: object) => data),
      save: jest.fn(async (data: object) => data),
      target: AuditLogEntity,
      manager: {},
    } as unknown as jest.Mocked<Repository<AuditLogEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesAuditRepository,
        { provide: getRepositoryToken(AuditLogEntity), useValue: auditRepo },
      ],
    }).compile();

    repo = module.get(ExpensesAuditRepository);
  });

  const savedRow = () => (auditRepo.save as jest.Mock).mock.calls[0][0];

  it('writes entity_type=expense with the mapped columns', async () => {
    await repo.record({
      bondId: 'b1',
      userId: 'u1',
      expenseId: 'e1',
      action: EXPENSE_AUDIT_ACTIONS.CREATE,
      newValue: { status: ExpenseStatus.PENDING },
    });

    expect(auditRepo.create).toHaveBeenCalledWith({
      bondId: 'b1',
      userId: 'u1',
      entityType: 'expense',
      entityId: 'e1',
      action: 'expense_create',
      oldValue: null,
      newValue: { status: 'pending' },
      detail: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it('defaults the optional columns to null instead of undefined', async () => {
    await repo.record({
      bondId: 'b1',
      userId: 'u1',
      expenseId: 'e1',
      action: EXPENSE_AUDIT_ACTIONS.UPDATE,
    });

    const row = savedRow();
    expect(row.oldValue).toBeNull();
    expect(row.newValue).toBeNull();
    expect(row.detail).toBeNull();
  });

  it('uses an explicit EntityManager when provided', async () => {
    const managerRepo = {
      create: jest.fn((d: object) => d),
      save: jest.fn(async (d: object) => d),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await repo.record(
      { bondId: 'b1', userId: 'u1', expenseId: 'e1', action: EXPENSE_AUDIT_ACTIONS.DELETE },
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  describe('recordStatusChange', () => {
    const statusChange = (from: ExpenseStatus, to: ExpenseStatus) =>
      repo.recordStatusChange({
        bondId: 'b1',
        userId: 'u1',
        expenseId: 'e1',
        from,
        to,
      });

    it.each([
      [ExpenseStatus.PENDING, ExpenseStatus.APPROVED, 'expense_approve'],
      [ExpenseStatus.PENDING, ExpenseStatus.REJECTED, 'expense_reject'],
      [ExpenseStatus.APPROVED, ExpenseStatus.PAID, 'expense_pay'],
    ])('derives the action for %s → %s as %s', async (from, to, action) => {
      await statusChange(from, to);

      expect(savedRow().action).toBe(action);
    });

    it('records the old and the new status, which is what makes the trail readable', async () => {
      await statusChange(ExpenseStatus.PENDING, ExpenseStatus.APPROVED);

      const row = savedRow();
      expect(row.oldValue).toEqual({ status: ExpenseStatus.PENDING });
      expect(row.newValue).toEqual({ status: ExpenseStatus.APPROVED });
      expect(row.entityType).toBe('expense');
      expect(row.entityId).toBe('e1');
    });

    it('carries the acting user, which is half of FR-10', async () => {
      await statusChange(ExpenseStatus.PENDING, ExpenseStatus.APPROVED);

      expect(savedRow().userId).toBe('u1');
    });

    it('falls back to a generic action for a pair it does not know', async () => {
      await statusChange(ExpenseStatus.PENDING, ExpenseStatus.PAID);

      expect(savedRow().action).toBe(EXPENSE_AUDIT_ACTIONS.STATUS_CHANGE);
    });

    it('passes the manager through so a rolled-back transition never leaves a lying audit', async () => {
      const managerRepo = {
        create: jest.fn((d: object) => d),
        save: jest.fn(async (d: object) => d),
      };
      const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

      await repo.recordStatusChange(
        {
          bondId: 'b1',
          userId: 'u1',
          expenseId: 'e1',
          from: ExpenseStatus.PENDING,
          to: ExpenseStatus.APPROVED,
        },
        manager as never,
      );

      expect(manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
      expect(auditRepo.save).not.toHaveBeenCalled();
      expect(managerRepo.save).toHaveBeenCalled();
    });

    it('keeps the given detail', async () => {
      await repo.recordStatusChange({
        bondId: 'b1',
        userId: 'u1',
        expenseId: 'e1',
        from: ExpenseStatus.PENDING,
        to: ExpenseStatus.REJECTED,
        detail: 'sin comprobante',
      });

      expect(savedRow().detail).toBe('sin comprobante');
    });
  });
});
