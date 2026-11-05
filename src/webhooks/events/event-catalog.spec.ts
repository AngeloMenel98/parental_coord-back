import {
  PRODUCED_ACTIVITY_EVENT_TYPES,
  WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPES,
  WEBHOOK_VIRTUAL_EVENT_TYPE,
  isProducedEventType,
  listEventCatalog,
} from './event-catalog';
import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';

/**
 * El catálogo DEBE reflejar exactamente lo que el productor emite (REQ-EVT-1,
 * AC-21): once `activity.*` (sin `activity.unassigned`, que pasó al bucket
 * catalogado-no-emitido), más el virtual `state_changed` y un catalogado-no-emitido.
 */
describe('event-catalog (REQ-EVT-1, AC-21)', () => {
  it('advertises exactly the eleven produced activity.* types', () => {
    expect([...PRODUCED_ACTIVITY_EVENT_TYPES].sort()).toEqual(
      [
        'activity.assigned',
        'activity.assisting',
        'activity.cancelled',
        'activity.created',
        'activity.created_overdue',
        'activity.done',
        'activity.in_progress',
        'activity.not_assisting',
        'activity.overdue',
        'activity.verify',
        'activity.verify_expired',
      ].sort(),
    );
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).toHaveLength(11);
  });

  it('does not advertise activity.unassigned or activity.state_changed as produced', () => {
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).not.toContain(ACTIVITY_EVENT.UNASSIGNED);
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).not.toContain(WEBHOOK_VIRTUAL_EVENT_TYPE);
  });

  it('catalogues the virtual + not-emitted types with the right flags', () => {
    const catalog = listEventCatalog();

    expect(catalog).toContainEqual({
      type: WEBHOOK_VIRTUAL_EVENT_TYPE,
      emitted: false,
      virtual: true,
    });
    expect(catalog).toContainEqual({
      type: ACTIVITY_EVENT.UNASSIGNED,
      emitted: false,
      virtual: false,
    });
  });

  it('keeps the catalogued-not-emitted bucket explicit', () => {
    // `activity.unassigned` sobrevive como constante de contrato (un suscriptor
    // puede filtrar por él) pero T4 fue removido: ya no hay productor.
    expect(WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPES).toEqual([ACTIVITY_EVENT.UNASSIGNED]);
    expect(isProducedEventType(ACTIVITY_EVENT.UNASSIGNED)).toBe(false);
  });

  it('marks every produced type as emitted/non-virtual', () => {
    const catalog = listEventCatalog();
    for (const type of PRODUCED_ACTIVITY_EVENT_TYPES) {
      expect(catalog).toContainEqual({ type, emitted: true, virtual: false });
    }
    // 11 produced + 1 virtual + 1 catalogued-not-emitted
    expect(catalog).toHaveLength(13);
  });

  it('isProducedEventType distinguishes produced from virtual/catalogued', () => {
    expect(isProducedEventType('activity.done')).toBe(true);
    expect(isProducedEventType('activity.verify')).toBe(true);
    expect(isProducedEventType(WEBHOOK_VIRTUAL_EVENT_TYPE)).toBe(false);
    expect(isProducedEventType(ACTIVITY_EVENT.UNASSIGNED)).toBe(false);
  });
});
