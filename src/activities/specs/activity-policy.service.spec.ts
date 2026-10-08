import { ActivityPolicyService, UNDO_WINDOW_MS, PolicySubject } from '../activity-policy.service';

describe('ActivityPolicyService', () => {
  let policy: ActivityPolicyService;

  const NOW = new Date('2026-10-01T12:00:00Z');

  function subject(overrides: Partial<PolicySubject> = {}): PolicySubject {
    return {
      createdBy: 'creator',
      assignedTo: 'assignee',
      scheduledStart: new Date('2026-10-01T10:00:00Z'),
      scheduledEnd: new Date('2026-10-01T14:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    policy = new ActivityPolicyService();
  });

  describe('isPast — now >= coalesce(scheduledEnd, scheduledStart)', () => {
    it('is NOT past one millisecond before scheduledEnd', () => {
      const a = subject({ scheduledEnd: new Date('2026-10-01T12:00:00.001Z') });
      expect(policy.isPast(a, NOW)).toBe(false);
    });

    it('IS past EXACTLY at scheduledEnd (the boundary is inclusive)', () => {
      const a = subject({ scheduledEnd: new Date('2026-10-01T12:00:00Z') });
      expect(policy.isPast(a, NOW)).toBe(true);
    });

    it('is past well after scheduledEnd', () => {
      const a = subject({ scheduledEnd: new Date('2026-10-01T11:00:00Z') });
      expect(policy.isPast(a, NOW)).toBe(true);
    });

    it('falls back to scheduledStart when scheduledEnd is null', () => {
      const a = subject({ scheduledStart: new Date('2026-10-01T11:00:00Z'), scheduledEnd: null });
      expect(policy.isPast(a, NOW)).toBe(true);
    });

    it('is NOT past before scheduledStart when scheduledEnd is null', () => {
      const a = subject({ scheduledStart: new Date('2026-10-01T18:00:00Z'), scheduledEnd: null });
      expect(policy.isPast(a, NOW)).toBe(false);
    });

    it('is NOT past when BOTH are null — no temporal anchor, not "ended long ago"', () => {
      const a = subject({ scheduledStart: null, scheduledEnd: null });
      expect(policy.isPast(a, NOW)).toBe(false);
    });

    it('ignores `deadline`: the predicate has no deadline parameter at all', () => {
      // `deadline` no forma parte de `PolicySubject` a propósito; si alguien lo
      // añadiera al predicado, el tipado de este test dejaría de compilar.
      const a = subject();
      expect(Object.keys(a)).not.toContain('deadline');
      expect(policy.isPast(a, NOW)).toBe(false);
    });

    it('IN PROGRESS keeps every action — the reason is structural, not a special case', () => {
      // 10:00 → 14:00, ahora 12:00: empezó y no ha terminado. El visor es creador
      // Y asignado para que las tres acciones le apliquen y la aserción sea sobre
      // el TIEMPO, no sobre el rol.
      const viewer = 'both';
      const inProgress = policy.evaluate(
        subject({ createdBy: viewer, assignedTo: viewer }),
        viewer,
        NOW,
      );
      expect(inProgress.isPast).toBe(false);
      expect(inProgress.canDelete).toBe(true);
      expect(inProgress.canCancel).toBe(true);
      expect(inProgress.canDecline).toBe(true);
    });
  });

  describe('evaluate — role matrix', () => {
    it('creator gets delete+cancel but NOT decline (creator is not the assignee)', () => {
      const d = policy.evaluate(subject(), 'creator', NOW);
      expect(d).toEqual({ canDelete: true, canCancel: true, canDecline: false, isPast: false });
    });

    it('assignee gets decline but NOT delete/cancel', () => {
      const d = policy.evaluate(subject(), 'assignee', NOW);
      expect(d).toEqual({ canDelete: false, canCancel: false, canDecline: true, isPast: false });
    });

    it('a third bond member gets NOTHING', () => {
      const d = policy.evaluate(subject(), 'someone-else', NOW);
      expect(d).toEqual({ canDelete: false, canCancel: false, canDecline: false, isPast: false });
    });

    it('unassigned activity: nobody can decline', () => {
      const d = policy.evaluate(subject({ assignedTo: null }), 'creator', NOW);
      expect(d.canDecline).toBe(false);
      expect(d.canDelete).toBe(true);
    });

    it('creator who is ALSO the assignee gets all three', () => {
      const both = subject({ createdBy: 'both', assignedTo: 'both' });
      const d = policy.evaluate(both, 'both', NOW);
      expect(d).toEqual({ canDelete: true, canCancel: true, canDecline: true, isPast: false });
    });

    it('past activity kills ALL THREE flags for everyone, creator included', () => {
      const past = subject({ scheduledEnd: new Date('2026-10-01T11:00:00Z') });
      expect(policy.evaluate(past, 'creator', NOW)).toEqual({
        canDelete: false,
        canCancel: false,
        canDecline: false,
        isPast: true,
      });
    });

    it('is deterministic: same input, same output (pure, no hidden state)', () => {
      const a = subject();
      expect(policy.evaluate(a, 'creator', NOW)).toEqual(policy.evaluate(a, 'creator', NOW));
    });
  });

  describe('isWithinUndoWindow — the server owns the 5000 ms window', () => {
    const actedAt = new Date('2026-10-01T11:59:55Z');

    it('is open 0 ms after the action', () => {
      expect(policy.isWithinUndoWindow(actedAt, actedAt)).toBe(true);
    });

    it('is open at 4999 ms', () => {
      expect(policy.isWithinUndoWindow(actedAt, new Date(actedAt.getTime() + 4999))).toBe(true);
    });

    it('is open at EXACTLY 5000 ms — the bound is inclusive', () => {
      expect(policy.isWithinUndoWindow(actedAt, new Date(actedAt.getTime() + UNDO_WINDOW_MS))).toBe(
        true,
      );
    });

    it('is CLOSED at 5001 ms', () => {
      expect(policy.isWithinUndoWindow(actedAt, new Date(actedAt.getTime() + 5001))).toBe(false);
    });

    it('is closed when there is no timestamp at all (null)', () => {
      expect(policy.isWithinUndoWindow(null, NOW)).toBe(false);
    });

    it('is closed for a FUTURE timestamp — a clock skew must not open the window', () => {
      const future = new Date(NOW.getTime() + 60_000);
      expect(policy.isWithinUndoWindow(future, NOW)).toBe(false);
    });

    it('exposes 5000 as the single source of the constant', () => {
      expect(UNDO_WINDOW_MS).toBe(5000);
    });
  });
});
