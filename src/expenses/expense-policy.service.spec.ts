import { ExpenseStatus } from './entities/expense.entity';
import { ExpensePolicyService } from './expense-policy.service';

/**
 * T22 · La matriz de "quién puede hacer qué" sobre un gasto (FR-10, FR-11).
 *
 * La política es PURA — no toca la base ni conoce HTTP — así que se ejercita acá
 * sin contenedor. Resolver quiénes son las dos partes (y que el viewer sea
 * miembro del bond) es responsabilidad del servicio que llama; esta política
 * sólo distingue solicitante, otra parte y tercero.
 */
describe('ExpensePolicyService', () => {
  const service = new ExpensePolicyService();
  const REQUESTER = 'user-requester';
  const COUNTERPART = 'user-counterpart';
  const STRANGER = 'user-stranger';

  const expense = (
    status: ExpenseStatus,
    requestedBy = REQUESTER,
    counterpartId: string | null = COUNTERPART,
  ) => ({ status, requestedBy, counterpartId });

  describe('FR-11 · editar y cancelar: sólo el solicitante y sólo en pendiente', () => {
    it('el solicitante puede editar y cancelar mientras está pendiente', () => {
      const decision = service.evaluate(expense(ExpenseStatus.PENDING), REQUESTER);

      expect(decision.canEdit).toBe(true);
      expect(decision.canCancel).toBe(true);
    });

    it('la otra parte nunca puede editar ni cancelar, en ningún estado', () => {
      for (const status of Object.values(ExpenseStatus)) {
        const decision = service.evaluate(expense(status), COUNTERPART);

        expect(decision.canEdit).toBe(false);
        expect(decision.canCancel).toBe(false);
      }
    });

    it.each([ExpenseStatus.APPROVED, ExpenseStatus.REJECTED, ExpenseStatus.PAID])(
      'el solicitante tampoco puede editar ni cancelar en %s',
      (status) => {
        const decision = service.evaluate(expense(status), REQUESTER);

        expect(decision.canEdit).toBe(false);
        expect(decision.canCancel).toBe(false);
      },
    );
  });

  describe('aprobación y rechazo: sólo la otra parte, y sólo en pendiente', () => {
    it('la otra parte aprueba y rechaza un gasto pendiente', () => {
      const decision = service.evaluate(expense(ExpenseStatus.PENDING), COUNTERPART);

      expect(decision.canApprove).toBe(true);
      expect(decision.canReject).toBe(true);
    });

    it('el solicitante NO aprueba su propio gasto', () => {
      const decision = service.evaluate(expense(ExpenseStatus.PENDING), REQUESTER);

      expect(decision.canApprove).toBe(false);
      expect(decision.canReject).toBe(false);
    });

    it.each([ExpenseStatus.APPROVED, ExpenseStatus.REJECTED, ExpenseStatus.PAID])(
      'nadie aprueba ni rechaza en %s',
      (status) => {
        for (const viewer of [REQUESTER, COUNTERPART]) {
          const decision = service.evaluate(expense(status), viewer);

          expect(decision.canApprove).toBe(false);
          expect(decision.canReject).toBe(false);
        }
      },
    );
  });

  describe('marcar pagado: sólo desde aprobado, y cualquiera de las dos partes', () => {
    it('las dos partes pueden marcarlo pagado cuando está aprobado', () => {
      for (const viewer of [REQUESTER, COUNTERPART]) {
        expect(service.evaluate(expense(ExpenseStatus.APPROVED), viewer).canMarkPaid).toBe(true);
      }
    });

    it.each([ExpenseStatus.PENDING, ExpenseStatus.REJECTED, ExpenseStatus.PAID])(
      'nadie lo marca pagado desde %s',
      (status) => {
        for (const viewer of [REQUESTER, COUNTERPART]) {
          expect(service.evaluate(expense(status), viewer).canMarkPaid).toBe(false);
        }
      },
    );
  });

  describe('estados terminales', () => {
    it.each([ExpenseStatus.PAID, ExpenseStatus.REJECTED])(
      '%s no admite ninguna acción',
      (status) => {
        for (const viewer of [REQUESTER, COUNTERPART]) {
          const decision = service.evaluate(expense(status), viewer);

          expect(decision).toEqual({
            canApprove: false,
            canReject: false,
            canMarkPaid: false,
            canEdit: false,
            canCancel: false,
            isTerminal: true,
          });
        }
      },
    );

    it.each([ExpenseStatus.PENDING, ExpenseStatus.APPROVED])('%s no es terminal', (status) => {
      expect(service.evaluate(expense(status), COUNTERPART).isTerminal).toBe(false);
    });
  });

  describe('un tercero (no es ninguna de las dos partes) no puede nada', () => {
    it('no aprueba, no rechaza, no edita, no cancela ni marca pagado', () => {
      for (const status of Object.values(ExpenseStatus)) {
        const decision = service.evaluate(expense(status), STRANGER);

        expect(decision.canApprove).toBe(false);
        expect(decision.canReject).toBe(false);
        expect(decision.canMarkPaid).toBe(false);
        expect(decision.canEdit).toBe(false);
        expect(decision.canCancel).toBe(false);
      }
    });
  });

  describe('un bond sin segunda parte todavía', () => {
    it('el solicitante no puede aprobarse a sí mismo por ausencia de contraparte', () => {
      const decision = service.evaluate(expense(ExpenseStatus.PENDING, REQUESTER, null), REQUESTER);

      expect(decision.canApprove).toBe(false);
      expect(decision.canReject).toBe(false);
    });
  });
});
