import { ActivityPolicyService, PolicySubject } from '../activity-policy.service';
import { ActivityStatus } from '../entities/activity.entity';

describe('ActivityPolicyService', () => {
  let policy: ActivityPolicyService;

  const NOW = new Date('2026-10-01T12:00:00Z');

  function subject(overrides: Partial<PolicySubject> = {}): PolicySubject {
    return {
      createdBy: 'creator',
      assignedTo: 'assignee',
      scheduledStart: new Date('2026-10-01T10:00:00Z'),
      scheduledEnd: new Date('2026-10-01T14:00:00Z'),
      status: ActivityStatus.ASSIGNED,
      verifyAt: null,
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

    it('IN PROGRESS: creator keeps delete/cancel, assignee keeps complete, decline is gone', () => {
      // 10:00 → 14:00, ahora 12:00: empezó y no ha terminado. El visor es creador
      // Y asignado para que las tres acciones le apliquen y la aserción sea sobre
      // el TIEMPO, no sobre el rol.
      const viewer = 'both';
      const inProgress = policy.evaluate(
        subject({
          createdBy: viewer,
          assignedTo: viewer,
          status: ActivityStatus.IN_PROGRESS,
        }),
        viewer,
        NOW,
      );
      expect(inProgress.isPast).toBe(false);
      expect(inProgress.canDelete).toBe(true);
      expect(inProgress.canCancel).toBe(true);
      expect(inProgress.canConfirm).toBe(false);
      expect(inProgress.canDecline).toBe(false);
      expect(inProgress.canComplete).toBe(true);
    });
  });

  describe('evaluate — role matrix', () => {
    it('creator gets delete+cancel but NOT decline (creator is not the assignee)', () => {
      const d = policy.evaluate(subject(), 'creator', NOW);
      expect(d).toEqual({
        canDelete: true,
        canCancel: true,
        canAssign: false,
        canReassign: false,
        canConfirm: false,
        canDecline: false,
        canComplete: false,
        isPast: false,
      });
    });

    it('assignee gets confirm+decline but NOT delete/cancel', () => {
      const d = policy.evaluate(subject(), 'assignee', NOW);
      expect(d).toEqual({
        canDelete: false,
        canCancel: false,
        canAssign: false,
        canReassign: false,
        canConfirm: true,
        canDecline: true,
        canComplete: false,
        isPast: false,
      });
    });

    it('a third bond member gets NOTHING', () => {
      const d = policy.evaluate(subject(), 'someone-else', NOW);
      expect(d).toEqual({
        canDelete: false,
        canCancel: false,
        canAssign: false,
        canReassign: false,
        canConfirm: false,
        canDecline: false,
        canComplete: false,
        isPast: false,
      });
    });

    it('unassigned activity: nobody can decline/confirm', () => {
      const d = policy.evaluate(subject({ assignedTo: null }), 'creator', NOW);
      expect(d.canConfirm).toBe(false);
      expect(d.canDecline).toBe(false);
      expect(d.canDelete).toBe(true);
    });

    it('creator who is ALSO the assignee gets all three creator/assignee flags', () => {
      const both = subject({ createdBy: 'both', assignedTo: 'both' });
      const d = policy.evaluate(both, 'both', NOW);
      expect(d).toEqual({
        canDelete: true,
        canCancel: true,
        canAssign: false,
        canReassign: false,
        canConfirm: true,
        canDecline: true,
        canComplete: false,
        isPast: false,
      });
    });

    it('past activity kills the creator/assignee flags, but NOT confirm', () => {
      // `isPast` mata delete/cancel/decline: de una actividad que ya pasó no se
      // puede deshacer nada, y decir "no asisto" no significa nada. CONFIRMAR es
      // al revés: confirmar una actividad YA terminada es el caso normal — la
      // ventana de verificación existe para eso — y es lo que la app ya
      // permitía (su regla de cliente no miraba la hora).
      const past = subject({ scheduledEnd: new Date('2026-10-01T11:00:00Z') });
      expect(policy.evaluate(past, 'creator', NOW)).toEqual({
        canDelete: false,
        canCancel: false,
        canAssign: false,
        canReassign: false,
        canConfirm: false,
        canDecline: false,
        canComplete: false,
        isPast: true,
      });
      expect(policy.evaluate(past, 'assignee', NOW)).toEqual({
        canDelete: false,
        canCancel: false,
        canAssign: false,
        canReassign: false,
        canConfirm: true,
        canDecline: false,
        canComplete: false,
        isPast: true,
      });
    });

    it('is deterministic: same input, same output (pure, no hidden state)', () => {
      const a = subject();
      expect(policy.evaluate(a, 'creator', NOW)).toEqual(policy.evaluate(a, 'creator', NOW));
    });
  });

  describe('evaluate — assignment flags (T21)', () => {
    it('canAssign is true only in `created`', () => {
      const created = subject({ status: ActivityStatus.CREATED, assignedTo: null });
      expect(policy.evaluate(created, 'someone-else', NOW).canAssign).toBe(true);

      for (const status of [
        ActivityStatus.ASSIGNED,
        ActivityStatus.ASSISTING,
        ActivityStatus.NOT_ASSISTING,
        ActivityStatus.IN_PROGRESS,
        ActivityStatus.VERIFY,
        ActivityStatus.OVERDUE,
        ActivityStatus.DONE,
        ActivityStatus.CANCELLED,
      ]) {
        const a = subject({
          status,
          assignedTo: status === ActivityStatus.CREATED ? null : 'assignee',
        });
        expect(policy.evaluate(a, 'someone-else', NOW).canAssign).toBe(false);
      }
    });

    it('canReassign is true only in `not_assisting`', () => {
      const notAssisting = subject({ status: ActivityStatus.NOT_ASSISTING });
      expect(policy.evaluate(notAssisting, 'someone-else', NOW).canReassign).toBe(true);

      for (const status of [
        ActivityStatus.CREATED,
        ActivityStatus.ASSIGNED,
        ActivityStatus.ASSISTING,
        ActivityStatus.IN_PROGRESS,
        ActivityStatus.VERIFY,
        ActivityStatus.OVERDUE,
        ActivityStatus.DONE,
        ActivityStatus.CANCELLED,
      ]) {
        const a = subject({ status });
        expect(policy.evaluate(a, 'someone-else', NOW).canReassign).toBe(false);
      }
    });

    it('assignment flags do NOT depend on the viewer role', () => {
      const created = subject({ status: ActivityStatus.CREATED, assignedTo: null });
      const notAssisting = subject({ status: ActivityStatus.NOT_ASSISTING });

      for (const viewer of ['creator', 'assignee', 'someone-else']) {
        expect(policy.evaluate(created, viewer, NOW).canAssign).toBe(true);
        expect(policy.evaluate(notAssisting, viewer, NOW).canReassign).toBe(true);
      }
    });
  });

  describe('evaluate — verify-window flags (R3)', () => {
    // S13 / D5 — el flag dejó de mirar sólo el estado (F1). Estas dos pruebas
    // afirmaban la regla vieja ("cualquier miembro del vínculo puede finalizar"),
    // que es justamente el agujero que T4 cierra: se conservan, invertidas.
    it('canComplete is true in `in_progress` ONLY for the assignee', () => {
      const a = subject({ status: ActivityStatus.IN_PROGRESS });
      expect(policy.evaluate(a, 'assignee', NOW).canComplete).toBe(true);
      expect(policy.evaluate(a, 'someone-else', NOW).canComplete).toBe(false);
    });

    it('canComplete is true in `verify` ONLY for the assignee', () => {
      const a = subject({ status: ActivityStatus.VERIFY, verifyAt: NOW });
      expect(policy.evaluate(a, 'assignee', NOW).canComplete).toBe(true);
      expect(policy.evaluate(a, 'someone-else', NOW).canComplete).toBe(false);
    });

    it('canComplete is false in `assigned`', () => {
      const a = subject({ status: ActivityStatus.ASSIGNED });
      expect(policy.evaluate(a, 'assignee', NOW).canComplete).toBe(false);
    });

    it('canComplete is false in terminal states', () => {
      const done = subject({ status: ActivityStatus.DONE });
      const overdue = subject({ status: ActivityStatus.OVERDUE });
      expect(policy.evaluate(done, 'assignee', NOW).canComplete).toBe(false);
      expect(policy.evaluate(overdue, 'assignee', NOW).canComplete).toBe(false);
    });

    /**
     * La aceptación TARDÍA ya no existe (decisión del usuario, 2026-11-03).
     *
     * Pasó con "A largo plazo": su ventana venció, el botón "Confirmar" siguió
     * vivo y el asignado confirmó tarde. Ahora `canConfirm` es SÓLO en `assigned`.
     *
     * El "NO ASISTE" tardío SE QUEDA, y es lo que evita el callejón sin salida: el
     * que no aceptó devuelve la actividad, y de ahí la reasigna cualquiera (T9).
     */
    it('en `overdue` el asignado NO puede confirmar, pero SÍ puede decir que no asiste', () => {
      const a = subject({ status: ActivityStatus.OVERDUE, assignedTo: 'assignee', verifyAt: null });
      const d = policy.evaluate(a, 'assignee', NOW);
      expect(d.canConfirm).toBe(false);
      expect(d.canDecline).toBe(true);
    });

    it('una actividad vencida y ya pasada no se puede confirmar NI devolver', () => {
      // Una actividad vencida suele tener la hora ya pasada (por eso venció).
      // La aceptación tardía se quitó, así que en `overdue` no hay "Confirmar";
      // y el "No asiste" tampoco, porque `isPast` lo mata — a una actividad que ya
      // pasó no tiene sentido decir que no se asiste.
      const a = subject({
        status: ActivityStatus.OVERDUE,
        assignedTo: 'assignee',
        verifyAt: null,
        scheduledEnd: new Date('2026-10-01T11:00:00Z'),
      });
      const d = policy.evaluate(a, 'assignee', NOW);
      expect(d.isPast).toBe(true);
      expect(d.canConfirm).toBe(false);
      expect(d.canDecline).toBe(false);
    });

    it('nobody can confirm/decline `overdue` when origin is `created` (no assignee)', () => {
      const a = subject({ status: ActivityStatus.OVERDUE, assignedTo: null, verifyAt: null });
      expect(policy.evaluate(a, 'someone-else', NOW).canConfirm).toBe(false);
    });

    it('nobody can confirm/decline `overdue` when origin is `verify`', () => {
      const a = subject({
        status: ActivityStatus.OVERDUE,
        assignedTo: 'assignee',
        verifyAt: NOW,
      });
      expect(policy.evaluate(a, 'assignee', NOW).canConfirm).toBe(false);
    });

    it('T4 removed: canUnassign must NOT exist on the decision', () => {
      const d = policy.evaluate(subject(), 'creator', NOW);
      expect('canUnassign' in d).toBe(false);
    });
  });
});

/**
 * T11 · matriz de capacidades cruzada por ROL.
 *
 * Una sola prueba generativa en vez de una por combinación: recorre los seis estados
 * contra los dos roles que el sistema distingue hoy en la política, y afirma los
 * invariantes que el producto fijó (S8/S9/S13). Si alguien agrega una bandera o toca la
 * matriz del tercero, esto cae con el estado exacto.
 */
describe('ActivityPolicyService · T11 matriz por rol', () => {
  const policy = new ActivityPolicyService();
  const NOW = new Date('2026-10-01T12:00:00Z');
  const STATUSES = [
    ActivityStatus.CREATED,
    ActivityStatus.ASSIGNED,
    ActivityStatus.ASSISTING,
    ActivityStatus.IN_PROGRESS,
    ActivityStatus.VERIFY,
    ActivityStatus.DONE,
  ];

  function subject(overrides: Partial<PolicySubject> = {}): PolicySubject {
    return {
      createdBy: 'creator',
      assignedTo: 'assignee',
      scheduledStart: new Date('2026-10-01T10:00:00Z'),
      scheduledEnd: new Date('2026-10-01T14:00:00Z'),
      status: ActivityStatus.ASSIGNED,
      verifyAt: null,
      ...overrides,
    };
  }

  it('TERCERO: ninguna acción de gestión, y finalizar sólo si es el asignado', () => {
    for (const status of STATUSES) {
      const asAssignee = policy.evaluate(subject({ status }), 'assignee', NOW, {
        isThirdParty: true,
      });
      const asOther = policy.evaluate(subject({ status }), 'otro', NOW, { isThirdParty: true });

      for (const decision of [asAssignee, asOther]) {
        expect(decision.canDelete).toBe(false);
        expect(decision.canCancel).toBe(false);
        expect(decision.canAssign).toBe(false);
        expect(decision.canReassign).toBe(false);
        expect(decision.canConfirm).toBe(false);
        expect(decision.canDecline).toBe(false);
      }

      const completable =
        status === ActivityStatus.IN_PROGRESS || status === ActivityStatus.VERIFY;
      expect(asAssignee.canComplete).toBe(completable);
      expect(asOther.canComplete).toBe(false);
    }
  });

  it('PROGENITOR: finalizar es del asignado, no del creador ni de cualquier miembro', () => {
    for (const status of STATUSES) {
      const completable =
        status === ActivityStatus.IN_PROGRESS || status === ActivityStatus.VERIFY;
      const asAssignee = policy.evaluate(subject({ status }), 'assignee', NOW);
      const asCreator = policy.evaluate(subject({ status }), 'creator', NOW);
      const asStranger = policy.evaluate(subject({ status }), 'otro', NOW);

      expect(asAssignee.canComplete).toBe(completable);
      expect(asCreator.canComplete).toBe(false);
      expect(asStranger.canComplete).toBe(false);
    }
  });

  it('PROGENITOR: borrar y cancelar siguen siendo del creador y no de una actividad pasada', () => {
    for (const status of STATUSES) {
      const asCreator = policy.evaluate(subject({ status }), 'creator', NOW);
      const asStranger = policy.evaluate(subject({ status }), 'otro', NOW);

      expect(asCreator.canDelete).toBe(true);
      expect(asCreator.canCancel).toBe(true);
      expect(asStranger.canDelete).toBe(false);
      expect(asStranger.canCancel).toBe(false);
    }
  });
});
