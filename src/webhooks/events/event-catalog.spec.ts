import {
  PRODUCED_ACTIVITY_EVENT_TYPES,
  WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE,
  WEBHOOK_VIRTUAL_EVENT_TYPE,
  isProducedEventType,
  listEventCatalog,
} from './event-catalog';

/**
 * El catálogo DEBE reflejar exactamente lo que el productor emite (REQ-EVT-1,
 * AC-21): nueve `activity.*` (incluido `activity.unassigned` de T4), más el virtual
 * `state_changed` y el catalogado-no-emitido `activity.verify`.
 */
describe('event-catalog (REQ-EVT-1, AC-21)', () => {
  it('advertises exactly the nine produced activity.* types', () => {
    expect([...PRODUCED_ACTIVITY_EVENT_TYPES].sort()).toEqual(
      [
        'activity.assigned',
        'activity.assisting',
        'activity.cancelled',
        'activity.created',
        'activity.done',
        'activity.in_progress',
        'activity.not_assisting',
        'activity.overdue',
        'activity.unassigned',
      ].sort(),
    );
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).toHaveLength(9);
  });

  it('includes activity.unassigned (T4) and never activity.state_changed as produced', () => {
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).toContain('activity.unassigned');
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).not.toContain(WEBHOOK_VIRTUAL_EVENT_TYPE);
    expect(PRODUCED_ACTIVITY_EVENT_TYPES).not.toContain(WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE);
  });

  it('catalogues the virtual + not-emitted types with the right flags', () => {
    const catalog = listEventCatalog();

    expect(catalog).toContainEqual({
      type: WEBHOOK_VIRTUAL_EVENT_TYPE,
      emitted: false,
      virtual: true,
    });
    expect(catalog).toContainEqual({
      type: WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE,
      emitted: false,
      virtual: false,
    });
  });

  it('marks every produced type as emitted/non-virtual', () => {
    const catalog = listEventCatalog();
    for (const type of PRODUCED_ACTIVITY_EVENT_TYPES) {
      expect(catalog).toContainEqual({ type, emitted: true, virtual: false });
    }
    // 9 produced + 1 virtual + 1 catalogued-not-emitted
    expect(catalog).toHaveLength(11);
  });

  it('isProducedEventType distinguishes produced from virtual/catalogued', () => {
    expect(isProducedEventType('activity.done')).toBe(true);
    expect(isProducedEventType(WEBHOOK_VIRTUAL_EVENT_TYPE)).toBe(false);
    expect(isProducedEventType(WEBHOOK_CATALOGUED_NOT_EMITTED_EVENT_TYPE)).toBe(false);
  });
});
