import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { BondsService } from '../bonds/bonds.service';
import { CategoriesRepository } from '../categories/repositories/categories.repository';
import { Clock } from '../common/clock/clock';
import { OutboxEventRepository } from '../outbox/repositories/outbox-event.repository';
import { ExpensePolicyService } from './expense-policy.service';
import { ExpensesService } from './expenses.service';
import { ExpenseStatus } from './entities/expense.entity';
import { ExpensesAuditRepository } from './repositories/expenses-audit.repository';
import { ExpensesRepository } from './repositories/expenses.repository';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

/**
 * T24 · La API de escritura de gastos.
 *
 * La política se usa REAL (es pura y ya tiene su propio spec): así esto prueba las
 * reglas de FR-10/FR-11 de punta a punta en vez de mockear la decisión y terminar
 * verificando que el mock devolvió lo que el mock devolvió. Lo mockeado es sólo la
 * persistencia y el vínculo.
 */
describe('ExpensesService (T24)', () => {
  const REQUESTER = 'user-requester';
  const COUNTERPART = 'user-counterpart';
  const STRANGER = 'user-stranger';
  const BOND = 'bond-1';
  const EXPENSE = 'expense-1';
  const CATEGORY = 'cat-1';
  const NOW = new Date('2026-10-30T12:00:00.000Z');

  let service: ExpensesService;
  let expensesRepo: {
    findAliveById: jest.Mock;
    insertWithManager: jest.Mock;
    transitionStatus: jest.Mock;
    editFields: jest.Mock;
    markDeleted: jest.Mock;
    transaction: jest.Mock;
  };
  let bondsService: { isActiveBondForMember: jest.Mock };
  let bondMembersRepo: { findActiveMemberIds: jest.Mock };
  let categoriesRepo: { findActiveById: jest.Mock };
  let audit: { record: jest.Mock; recordStatusChange: jest.Mock };
  let clock: { now: jest.Mock };
  let outbox: { insert: jest.Mock };
  const manager = { getRepository: jest.fn() };

  /**
   * `amount` y los ratios viajan como STRING en el mock porque así los devuelve
   * `pg` para las columnas `numeric`. Si el mapeo dejara de convertirlos, este
   * spec lo ve.
   */
  const expenseRow = (over: Record<string, unknown> = {}) =>
    ({
      id: EXPENSE,
      bondId: BOND,
      categoryId: CATEGORY,
      category: { id: CATEGORY, name: 'Salud' },
      activityId: null,
      childId: null,
      concept: 'Consulta pediatra',
      description: null,
      amount: '15000.50',
      expenseDate: '2026-10-30',
      splitRatioPayer: '50.00',
      splitRatioOther: '50.00',
      status: ExpenseStatus.PENDING,
      requestedBy: REQUESTER,
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      deletedAt: null,
      createdAt: new Date('2026-10-30T10:00:00.000Z'),
      updatedAt: new Date('2026-10-30T10:00:00.000Z'),
      ...over,
    }) as never;

  const createDto = (over: Partial<CreateExpenseDto> = {}): CreateExpenseDto =>
    ({
      concept: 'Consulta pediatra',
      amount: 15000.5,
      categoryId: CATEGORY,
      expenseDate: '2026-10-30',
      ...over,
    }) as CreateExpenseDto;

  beforeEach(async () => {
    expensesRepo = {
      findAliveById: jest.fn(),
      insertWithManager: jest.fn(),
      transitionStatus: jest.fn().mockResolvedValue(true),
      editFields: jest.fn().mockResolvedValue(true),
      markDeleted: jest.fn().mockResolvedValue(true),
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)),
    };
    bondsService = { isActiveBondForMember: jest.fn().mockResolvedValue(true) };
    bondMembersRepo = {
      findActiveMemberIds: jest.fn().mockResolvedValue([REQUESTER, COUNTERPART]),
    };
    categoriesRepo = {
      findActiveById: jest.fn().mockResolvedValue({ id: CATEGORY, name: 'Salud' }),
    };
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordStatusChange: jest.fn().mockResolvedValue(undefined),
    };
    clock = { now: jest.fn().mockReturnValue(NOW) };
    outbox = { insert: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        ExpensePolicyService,
        { provide: ExpensesRepository, useValue: expensesRepo },
        { provide: BondsService, useValue: bondsService },
        { provide: BondMembersRepository, useValue: bondMembersRepo },
        { provide: CategoriesRepository, useValue: categoriesRepo },
        { provide: ExpensesAuditRepository, useValue: audit },
        { provide: Clock, useValue: clock },
        { provide: OutboxEventRepository, useValue: outbox },
      ],
    }).compile();

    service = module.get(ExpensesService);
  });

  const givenAlive = (over: Record<string, unknown> = {}) => {
    const row = expenseRow(over);
    expensesRepo.findAliveById.mockResolvedValue(row);
    return row;
  };

  /** Después de una transición el servicio relee: primera lectura el estado viejo, segunda el nuevo. */
  const givenTransition = (
    from: ExpenseStatus,
    to: ExpenseStatus,
    extra: Record<string, unknown> = {},
  ) => {
    expensesRepo.findAliveById
      .mockResolvedValueOnce(expenseRow({ status: from }))
      .mockResolvedValueOnce(expenseRow({ status: to, ...extra }));
  };

  // ── create ────────────────────────────────────────────────────────────────

  describe('create (FR-8)', () => {
    it('creates the expense as pending, owned by the caller', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto(), REQUESTER);

      const row = expensesRepo.insertWithManager.mock.calls[0][0];
      expect(row.status).toBe(ExpenseStatus.PENDING);
      expect(row.requestedBy).toBe(REQUESTER);
      expect(row.bondId).toBe(BOND);
    });

    it('defaults the split to 50/50 and derives the counterpart share from 100', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto(), REQUESTER);

      const row = expensesRepo.insertWithManager.mock.calls[0][0];
      expect(row.splitRatioPayer).toBe(50);
      expect(row.splitRatioOther).toBe(50);
    });

    it('derives the other share from an explicit ratio instead of trusting two numbers', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto({ splitRatioPayer: 70 }), REQUESTER);

      const row = expensesRepo.insertWithManager.mock.calls[0][0];
      expect(row.splitRatioPayer).toBe(70);
      expect(row.splitRatioOther).toBe(30);
    });

    it('rounds the derived share so 33.33 does not become 66.67000000000001', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto({ splitRatioPayer: 33.33 }), REQUESTER);

      expect(expensesRepo.insertWithManager.mock.calls[0][0].splitRatioOther).toBe(66.67);
    });

    it('refuses a caller who is not a member of the bond', async () => {
      bondsService.isActiveBondForMember.mockResolvedValue(false);

      await expect(service.create(BOND, createDto(), STRANGER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(expensesRepo.insertWithManager).not.toHaveBeenCalled();
    });

    it('refuses an unknown or inactive category', async () => {
      categoriesRepo.findActiveById.mockResolvedValue(null);

      await expect(service.create(BOND, createDto(), REQUESTER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses a date that is well-formed but does not exist on the calendar', async () => {
      await expect(
        service.create(BOND, createDto({ expenseDate: '2026-02-31' }), REQUESTER),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('writes the creation to the audit in the same transaction', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto(), REQUESTER);

      expect(expensesRepo.transaction).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          bondId: BOND,
          userId: REQUESTER,
          expenseId: EXPENSE,
          action: 'expense_create',
        }),
        manager,
      );
    });

    it('writes expense.created to the outbox in the same transaction', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      await service.create(BOND, createDto(), REQUESTER);

      expect(outbox.insert).toHaveBeenCalledWith(
        {
          aggregateType: 'expense',
          aggregateId: EXPENSE,
          bondId: BOND,
          eventType: 'expense.created',
          aggregateVersion: 1,
          payload: { actor: { type: 'user', id: REQUESTER }, status: ExpenseStatus.PENDING },
        },
        manager,
      );
    });

    it('does not complete creation when the outbox write fails', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());
      outbox.insert.mockRejectedValue(new Error('outbox unavailable'));

      await expect(service.create(BOND, createDto(), REQUESTER)).rejects.toThrow(
        'outbox unavailable',
      );
    });

    it('returns the policy decision so the requester knows they can still edit and cancel', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      const result = await service.create(BOND, createDto(), REQUESTER);

      expect(result.canEdit).toBe(true);
      expect(result.canCancel).toBe(true);
      expect(result.canApprove).toBe(false);
      expect(result.counterpartId).toBe(COUNTERPART);
    });

    it('returns numeric columns as numbers, not as the strings pg hands over', async () => {
      expensesRepo.insertWithManager.mockResolvedValue(expenseRow());

      const result = await service.create(BOND, createDto(), REQUESTER);

      expect(result.amount).toBe(15000.5);
      expect(result.splitRatioPayer).toBe(50);
      expect(result.splitRatioOther).toBe(50);
    });
  });

  // ── getDetail ─────────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('returns the expense with the decision for the requester', async () => {
      givenAlive();

      const result = await service.getDetail(EXPENSE, REQUESTER);

      expect(result.id).toBe(EXPENSE);
      expect(result.categoryName).toBe('Salud');
      expect(result.canEdit).toBe(true);
      expect(result.canApprove).toBe(false);
    });

    it('returns the decision for the counterpart on the same expense', async () => {
      givenAlive();

      const result = await service.getDetail(EXPENSE, COUNTERPART);

      expect(result.canEdit).toBe(false);
      expect(result.canApprove).toBe(true);
      expect(result.canReject).toBe(true);
    });

    it('hides existence from someone outside the bond', async () => {
      givenAlive();
      bondsService.isActiveBondForMember.mockResolvedValue(false);

      await expect(service.getDetail(EXPENSE, STRANGER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides a cancelled expense even from a member', async () => {
      expensesRepo.findAliveById.mockResolvedValue(null);

      await expect(service.getDetail(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reports a bond with a single member as having no counterpart', async () => {
      givenAlive();
      bondMembersRepo.findActiveMemberIds.mockResolvedValue([REQUESTER]);

      const result = await service.getDetail(EXPENSE, REQUESTER);

      expect(result.counterpartId).toBeNull();
      expect(result.canApprove).toBe(false);
    });
  });

  // ── update (FR-11) ────────────────────────────────────────────────────────

  describe('update (FR-11)', () => {
    const patch: UpdateExpenseDto = { concept: 'Consulta + medicación', amount: 18000 };

    it('lets the requester edit while pending', async () => {
      expensesRepo.findAliveById
        .mockResolvedValueOnce(expenseRow())
        .mockResolvedValueOnce(
          expenseRow({ concept: 'Consulta + medicación', amount: '18000.00' }),
        );

      const result = await service.update(EXPENSE, patch, REQUESTER);

      expect(result.concept).toBe('Consulta + medicación');
    });

    it('derives the other share again when the split is edited', async () => {
      expensesRepo.findAliveById.mockResolvedValue(expenseRow());

      await service.update(EXPENSE, { splitRatioPayer: 25 }, REQUESTER);

      expect(expensesRepo.editFields.mock.calls[0][0].patch).toEqual(
        expect.objectContaining({ splitRatioPayer: 25, splitRatioOther: 75 }),
      );
    });

    it('refuses the counterpart', async () => {
      givenAlive();

      await expect(service.update(EXPENSE, patch, COUNTERPART)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(expensesRepo.editFields).not.toHaveBeenCalled();
    });

    it('refuses the requester once the expense is approved', async () => {
      givenAlive({ status: ExpenseStatus.APPROVED });

      await expect(service.update(EXPENSE, patch, REQUESTER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses an empty patch instead of silently doing nothing', async () => {
      givenAlive();

      await expect(service.update(EXPENSE, {}, REQUESTER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('guards the write with the pending status so a concurrent approval wins', async () => {
      givenAlive();
      expensesRepo.editFields.mockResolvedValue(false);

      await expect(service.update(EXPENSE, patch, REQUESTER)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('records the edit in the audit', async () => {
      givenAlive();

      await service.update(EXPENSE, patch, REQUESTER);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'expense_update',
          userId: REQUESTER,
          expenseId: EXPENSE,
        }),
        manager,
      );
    });
  });

  // ── cancel (FR-11) ────────────────────────────────────────────────────────

  describe('cancel (FR-11)', () => {
    it('marks deleted_at and keeps the row', async () => {
      givenAlive();

      await service.cancel(EXPENSE, REQUESTER);

      const call = expensesRepo.markDeleted.mock.calls[0][0];
      expect(call.expectedStatus).toBe(ExpenseStatus.PENDING);
      expect(call.at).toEqual(NOW);
      expect(outbox.insert).not.toHaveBeenCalled();
    });

    it('refuses the counterpart', async () => {
      givenAlive();

      await expect(service.cancel(EXPENSE, COUNTERPART)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses the requester once the expense is approved', async () => {
      givenAlive({ status: ExpenseStatus.APPROVED });

      await expect(service.cancel(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('records the cancellation in the audit', async () => {
      givenAlive();

      await service.cancel(EXPENSE, REQUESTER);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'expense_delete', userId: REQUESTER }),
        manager,
      );
    });

    it('returns 409 if the expense moved while cancelling', async () => {
      givenAlive();
      expensesRepo.markDeleted.mockResolvedValue(false);

      await expect(service.cancel(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('moves pending to approved for the counterpart, stamping who and when', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.APPROVED);

      const result = await service.approve(EXPENSE, COUNTERPART);

      expect(result.status).toBe(ExpenseStatus.APPROVED);
      expect(expensesRepo.transitionStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedFrom: ExpenseStatus.PENDING,
          nextStatus: ExpenseStatus.APPROVED,
          fields: { approvedBy: COUNTERPART, approvedAt: NOW },
        }),
      );
    });

    it('refuses the requester approving their own expense', async () => {
      givenAlive();

      await expect(service.approve(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(expensesRepo.transitionStatus).not.toHaveBeenCalled();
    });

    it('refuses to approve something already rejected', async () => {
      givenAlive({ status: ExpenseStatus.REJECTED });

      await expect(service.approve(EXPENSE, COUNTERPART)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('logs the transition as an expense_approve entry in the same transaction', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.APPROVED);

      await service.approve(EXPENSE, COUNTERPART);

      expect(expensesRepo.transaction).toHaveBeenCalled();
      expect(audit.recordStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          from: ExpenseStatus.PENDING,
          to: ExpenseStatus.APPROVED,
          userId: COUNTERPART,
          expenseId: EXPENSE,
        }),
        manager,
      );
    });

    it('writes expense.approved with lifecycle version 2 in the same transaction', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.APPROVED);

      await service.approve(EXPENSE, COUNTERPART);

      expect(outbox.insert).toHaveBeenCalledWith(
        {
          aggregateType: 'expense',
          aggregateId: EXPENSE,
          bondId: BOND,
          eventType: 'expense.approved',
          aggregateVersion: 2,
          payload: { actor: { type: 'user', id: COUNTERPART }, status: ExpenseStatus.APPROVED },
        },
        manager,
      );
    });

    it('returns 409 when the compare-and-swap finds the row already moved', async () => {
      givenAlive();
      expensesRepo.transitionStatus.mockResolvedValue(false);

      await expect(service.approve(EXPENSE, COUNTERPART)).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not audit a transition that the compare-and-swap refused', async () => {
      givenAlive();
      expensesRepo.transitionStatus.mockResolvedValue(false);

      await expect(service.approve(EXPENSE, COUNTERPART)).rejects.toBeInstanceOf(ConflictException);
      expect(audit.recordStatusChange).not.toHaveBeenCalled();
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('moves pending to rejected for the counterpart', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.REJECTED);

      const result = await service.reject(EXPENSE, COUNTERPART);

      expect(result.status).toBe(ExpenseStatus.REJECTED);
    });

    it('writes expense.rejected with lifecycle version 2', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.REJECTED);

      await service.reject(EXPENSE, COUNTERPART);

      expect(outbox.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'expense.rejected',
          aggregateVersion: 2,
          payload: { actor: { type: 'user', id: COUNTERPART }, status: ExpenseStatus.REJECTED },
        }),
        manager,
      );
    });

    it('keeps the reason in the audit detail', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.REJECTED);

      await service.reject(EXPENSE, COUNTERPART, '  el comprobante no coincide  ');

      expect(audit.recordStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ detail: 'el comprobante no coincide' }),
        manager,
      );
    });

    it('accepts a rejection without a reason', async () => {
      givenTransition(ExpenseStatus.PENDING, ExpenseStatus.REJECTED);

      await expect(service.reject(EXPENSE, COUNTERPART)).resolves.toBeDefined();
      expect(audit.recordStatusChange.mock.calls[0][0].detail).toBeNull();
    });

    it('refuses the requester rejecting their own expense', async () => {
      givenAlive();

      await expect(service.reject(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── pay ───────────────────────────────────────────────────────────────────

  describe('pay', () => {
    it.each([REQUESTER, COUNTERPART])(
      'lets %s mark an approved expense as paid',
      async (viewer) => {
        givenTransition(ExpenseStatus.APPROVED, ExpenseStatus.PAID);

        const result = await service.pay(EXPENSE, viewer as string);

        expect(result.status).toBe(ExpenseStatus.PAID);
        expect(expensesRepo.transitionStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            expectedFrom: ExpenseStatus.APPROVED,
            nextStatus: ExpenseStatus.PAID,
            fields: { paidAt: NOW },
          }),
        );
        expect(outbox.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'expense.paid',
            aggregateVersion: 3,
            payload: { actor: { type: 'user', id: viewer }, status: ExpenseStatus.PAID },
          }),
          manager,
        );
      },
    );

    it('refuses to mark paid something still pending', async () => {
      givenAlive();

      await expect(service.pay(EXPENSE, COUNTERPART)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a third party', async () => {
      givenAlive({ status: ExpenseStatus.APPROVED });

      await expect(service.pay(EXPENSE, STRANGER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('logs the payment as expense_pay', async () => {
      givenTransition(ExpenseStatus.APPROVED, ExpenseStatus.PAID);

      await service.pay(EXPENSE, REQUESTER);

      expect(audit.recordStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          from: ExpenseStatus.APPROVED,
          to: ExpenseStatus.PAID,
          userId: REQUESTER,
        }),
        manager,
      );
    });

    it('returns 409 on a lost race', async () => {
      givenAlive({ status: ExpenseStatus.APPROVED });
      expensesRepo.transitionStatus.mockResolvedValue(false);

      await expect(service.pay(EXPENSE, REQUESTER)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
