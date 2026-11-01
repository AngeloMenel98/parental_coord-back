import {
  buildExpenseRecipientIds,
  EXPENSE_NOTIFICATION_RULES,
  ExpenseRenderContext,
  formatExpenseAmount,
  renderExpenseNotificationText,
  resolveExpenseNotificationRule,
} from './expense-notification.map';

/**
 * T23 · el mapa de notificaciones de gasto (PRD_expense §7).
 *
 * Se prueba la MATRIZ de destinatarios y el contrato de los textos (límites de
 * 40/100, title ≠ body, monto en formato es-AR), que es exactamente lo que el
 * fan-out ejecuta antes del primer INSERT.
 */
describe('expense-notification map (T23)', () => {
  const R = (id: string) => id;

  describe('resolveExpenseNotificationRule', () => {
    it('resolves all five §7 events', () => {
      expect(resolveExpenseNotificationRule('expense.created')?.type).toBe('expense_created');
      expect(resolveExpenseNotificationRule('expense.approved')?.type).toBe('expense_approved');
      expect(resolveExpenseNotificationRule('expense.rejected')?.type).toBe('expense_rejected');
      expect(resolveExpenseNotificationRule('expense.paid')?.type).toBe('expense_paid');
      expect(resolveExpenseNotificationRule('expense.stale')?.type).toBe('expense_stale');
    });

    it('defines exactly the five rules, with unique types', () => {
      expect(EXPENSE_NOTIFICATION_RULES).toHaveLength(5);
      const types = EXPENSE_NOTIFICATION_RULES.map((r) => r.type);
      expect(new Set(types).size).toBe(types.length);
    });

    it('returns null for an unknown event type (no throw)', () => {
      expect(resolveExpenseNotificationRule('expense.nope')).toBeNull();
      expect(resolveExpenseNotificationRule('activity.created')).toBeNull();
    });
  });

  describe('buildExpenseRecipientIds — §7 matrix', () => {
    const rule = (eventType: string) => resolveExpenseNotificationRule(eventType)!;
    const ctx = { requestedBy: R('requester'), counterpartId: R('approver'), actorId: null };

    it('created → the counterpart, because only they can approve', () => {
      expect(buildExpenseRecipientIds(rule('expense.created'), ctx)).toEqual(['approver']);
    });

    it('approved → the requester, not the approver who did it', () => {
      expect(
        buildExpenseRecipientIds(rule('expense.approved'), { ...ctx, actorId: R('approver') }),
      ).toEqual(['requester']);
    });

    it('rejected → the requester', () => {
      expect(
        buildExpenseRecipientIds(rule('expense.rejected'), { ...ctx, actorId: R('approver') }),
      ).toEqual(['requester']);
    });

    it('paid → the requester when the COUNTERPART marked it paid', () => {
      expect(
        buildExpenseRecipientIds(rule('expense.paid'), { ...ctx, actorId: R('approver') }),
      ).toEqual(['requester']);
    });

    it('paid → nobody when the requester marks their own expense paid (R2 beats §7)', () => {
      // §7 dice "Requester", pero `canMarkPaid` es para cualquiera de las dos
      // partes: si el solicitante marca el pago, avisarle sería avisarle de su
      // propia acción. La regla universal R2 lo descarta y el resultado es 0
      // filas, no una auto-notificación.
      expect(
        buildExpenseRecipientIds(rule('expense.paid'), { ...ctx, actorId: R('requester') }),
      ).toEqual([]);
    });

    it('stale → the counterpart, with a system actor excluding nobody', () => {
      expect(buildExpenseRecipientIds(rule('expense.stale'), ctx)).toEqual(['approver']);
    });
  });

  describe('buildExpenseRecipientIds — degradación', () => {
    it('a bond with one member has no counterpart, so nothing is notified', () => {
      const rule = resolveExpenseNotificationRule('expense.created')!;
      expect(
        buildExpenseRecipientIds(rule, {
          requestedBy: R('solo'),
          counterpartId: null,
          actorId: null,
        }),
      ).toEqual([]);
    });

    it('drops null/undefined ids instead of inserting them', () => {
      const rule = resolveExpenseNotificationRule('expense.approved')!;
      expect(buildExpenseRecipientIds(rule, { actorId: null })).toEqual([]);
    });

    it('a requester that is also the counterpart receives exactly one row', () => {
      const rule = resolveExpenseNotificationRule('expense.approved')!;
      expect(
        buildExpenseRecipientIds(rule, {
          requestedBy: R('same'),
          counterpartId: R('same'),
          actorId: null,
        }),
      ).toEqual(['same']);
    });
  });

  describe('textos (contrato N-2)', () => {
    const ctx: ExpenseRenderContext = { concept: 'Consulta pediatra', amount: 15000.5 };

    it('every rule has a title ≤ 40 chars and a body ≤ 100 chars', () => {
      for (const rule of EXPENSE_NOTIFICATION_RULES) {
        const text = renderExpenseNotificationText(rule, ctx);
        expect(text.title.length).toBeLessThanOrEqual(40);
        expect(text.body.length).toBeLessThanOrEqual(100);
      }
    });

    it('title and body are always different strings', () => {
      for (const rule of EXPENSE_NOTIFICATION_RULES) {
        const text = renderExpenseNotificationText(rule, ctx);
        expect(text.body).not.toBe(text.title);
      }
    });

    it('the body stays ≤ 100 chars with a 255-char concept (truncated, never overflows)', () => {
      const long: ExpenseRenderContext = { concept: 'x'.repeat(255), amount: 9999999999.99 };
      for (const rule of EXPENSE_NOTIFICATION_RULES) {
        expect(renderExpenseNotificationText(rule, long).body.length).toBeLessThanOrEqual(100);
      }
    });

    it('created copy names the concept, the amount and the next step', () => {
      const text = renderExpenseNotificationText(
        resolveExpenseNotificationRule('expense.created')!,
        ctx,
      );
      expect(text.title).toBe('Nuevo gasto');
      expect(text.body).toContain('Consulta pediatra');
      expect(text.body).toContain('$15.000,50');
      expect(text.body).toContain('aprobación');
    });

    it('stale copy says the expense has been pending more than 7 days', () => {
      const text = renderExpenseNotificationText(
        resolveExpenseNotificationRule('expense.stale')!,
        ctx,
      );
      expect(text.title).toBe('Gasto sin aprobar');
      expect(text.body).toContain('7 días');
    });

    it('a concept containing $& is inserted literally, not interpreted by replace', () => {
      const text = renderExpenseNotificationText(
        resolveExpenseNotificationRule('expense.approved')!,
        { concept: 'Colegio $& cuota', amount: 1000 },
      );
      expect(text.body).toContain('Colegio $& cuota');
    });
  });

  describe('formatExpenseAmount', () => {
    it('formats with dot thousands and comma decimals (es-AR)', () => {
      expect(formatExpenseAmount(15000.5)).toBe('$15.000,50');
      expect(formatExpenseAmount(9999999999.99)).toBe('$9.999.999.999,99');
      expect(formatExpenseAmount(0.01)).toBe('$0,01');
      expect(formatExpenseAmount(1000)).toBe('$1.000,00');
    });
  });
});
