import { ACTIVITY_EVENT } from '../../activities/activity-transition.map';
import {
  buildRecipientIds,
  NOTIFICATION_FAN_OUT_RULES,
  NotificationFanOutRule,
  renderNotificationText,
  resolveNotificationRule,
} from './activity-notification.map';

interface ExpectedRule {
  eventType: string;
  type: string;
  title: string;
  recipients: string[];
  excludeCoordinator: boolean;
  needsCoordinator: boolean;
  needsMembers: boolean;
}

const EXPECTED_RULES: ExpectedRule[] = [
  {
    eventType: 'activity.created',
    type: 'activity_created',
    title: 'Nueva actividad',
    recipients: ['members'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: true,
  },
  {
    eventType: 'activity.assigned',
    type: 'activity_assigned',
    title: 'Nueva actividad asignada',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: true,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: 'activity.assisting',
    type: 'activity_assisting',
    title: 'Actividad aceptada',
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: 'activity.in_progress',
    type: 'activity_in_progress',
    title: 'Actividad en curso',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
  {
    eventType: 'activity.overdue',
    type: 'activity_overdue',
    title: 'Actividad vencida',
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: 'activity.not_assisting',
    type: 'activity_not_assisting',
    title: 'Actividad declinada',
    recipients: ['creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: 'activity.done',
    type: 'activity_done',
    title: 'Actividad finalizada',
    recipients: ['assignee', 'creator', 'coordinator'],
    excludeCoordinator: false,
    needsCoordinator: true,
    needsMembers: false,
  },
  {
    eventType: 'activity.cancelled',
    type: 'activity_cancelled',
    title: 'Actividad cancelada',
    recipients: ['assignee', 'creator'],
    excludeCoordinator: false,
    needsCoordinator: false,
    needsMembers: false,
  },
];

function ruleOf(eventType: string): NotificationFanOutRule {
  const rule = resolveNotificationRule(eventType);
  if (!rule) throw new Error(`expected a fan-out rule for ${eventType}`);
  return rule;
}

const SAMPLE_TITLE = 'Clases de natación';
const LONG_TITLE = 'A'.repeat(80);
const SAMPLE_DATE = new Date('2026-10-05T10:00:00Z');

describe('activity-notification map (notifications-fanout T2.1/T2.2 + T10)', () => {
  describe('resolveNotificationRule', () => {
    it.each(EXPECTED_RULES)('maps $eventType to $type', (expected) => {
      const rule = resolveNotificationRule(expected.eventType);

      expect(rule).not.toBeNull();
      expect(rule).toMatchObject({
        eventType: expected.eventType,
        type: expected.type,
        title: expected.title,
        recipients: expected.recipients,
        excludeCoordinator: expected.excludeCoordinator,
        needsCoordinator: expected.needsCoordinator,
        needsMembers: expected.needsMembers,
      });
    });

    it('returns null for an unknown event type (no throw)', () => {
      expect(resolveNotificationRule('activity.teleported')).toBeNull();
      expect(resolveNotificationRule('')).toBeNull();
    });

    it('defines exactly the 8 deliverable rules (unassigned intentionally absent)', () => {
      expect(NOTIFICATION_FAN_OUT_RULES.map((rule) => rule.eventType).sort()).toEqual(
        [
          ACTIVITY_EVENT.CREATED,
          ACTIVITY_EVENT.ASSIGNED,
          ACTIVITY_EVENT.ASSISTING,
          ACTIVITY_EVENT.IN_PROGRESS,
          ACTIVITY_EVENT.OVERDUE,
          ACTIVITY_EVENT.NOT_ASSISTING,
          ACTIVITY_EVENT.DONE,
          ACTIVITY_EVENT.CANCELLED,
        ].sort(),
      );
    });

    it('uses the Spanish title for overdue', () => {
      expect(ruleOf(ACTIVITY_EVENT.OVERDUE).title).toBe('Actividad vencida');
    });

    it('reuses the already-shipped notification types for assigned and overdue', () => {
      expect(ruleOf(ACTIVITY_EVENT.ASSIGNED).type).toBe('activity_assigned');
      expect(ruleOf(ACTIVITY_EVENT.OVERDUE).type).toBe('activity_overdue');
    });

    it('every rule title is Spanish and ≤ 40 characters', () => {
      for (const rule of NOTIFICATION_FAN_OUT_RULES) {
        expect(rule.title.length).toBeLessThanOrEqual(40);
        expect(rule.title).not.toMatch(/^[A-Z][a-z]+ [a-z]+:/); // no legacy "X: title"
      }
    });
  });

  describe('buildRecipientIds — recipient matrix', () => {
    it('created: active members minus coordinator minus actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.CREATED), {
          memberIds: ['u3', 'u1', 'u4'],
          coordinatorId: 'u4',
          actorId: 'u1',
        }),
      ).toEqual(['u3']);
    });

    it('assigned: {assignee, creator} minus coordinator minus actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.ASSIGNED), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: 'u3',
        }),
      ).toEqual(['u2']);
    });

    it('assisting: {creator, coordinator} minus actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.ASSISTING), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: 'u2',
        }),
      ).toEqual(['u3', 'u4']);
    });

    it('in_progress: {assignee, creator} (system actor excludes nobody)', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.IN_PROGRESS), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: null,
        }),
      ).toEqual(['u2', 'u3']);
    });

    it('overdue: {assignee, creator, coordinator} (system actor)', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.OVERDUE), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: null,
        }),
      ).toEqual(['u2', 'u3', 'u4']);
    });

    it('not_assisting: {creator, coordinator} minus the assignee actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.NOT_ASSISTING), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: 'u2',
        }),
      ).toEqual(['u3', 'u4']);
    });

    it('done: {assignee, creator, coordinator} minus actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.DONE), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: 'u2',
        }),
      ).toEqual(['u3', 'u4']);
    });

    it('cancelled: {assignee, creator} minus actor, coordinator never added', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.CANCELLED), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: 'u3',
        }),
      ).toEqual(['u2']);
    });
  });

  describe('buildRecipientIds — actor, dedupe and degradation semantics', () => {
    it('system actor (actorId=null) excludes nobody', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.DONE), {
          assignedTo: 'u2',
          createdBy: 'u3',
          coordinatorId: 'u4',
          actorId: null,
        }),
      ).toEqual(['u2', 'u3', 'u4']);
    });

    it('a multi-role user receives exactly ONE row (Set dedupe)', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.DONE), {
          assignedTo: 'u1',
          createdBy: 'u1',
          coordinatorId: 'u1',
          actorId: null,
        }),
      ).toEqual(['u1']);
    });

    it('dedupes across different slots', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.DONE), {
          assignedTo: 'u2',
          createdBy: 'u2',
          coordinatorId: 'u4',
          actorId: null,
        }),
      ).toEqual(['u2', 'u4']);
    });

    it('returns [] when every candidate is the actor', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.ASSISTING), {
          createdBy: 'u1',
          coordinatorId: 'u1',
          actorId: 'u1',
        }),
      ).toEqual([]);
    });

    it('drops null/undefined candidates instead of inserting them', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.ASSIGNED), {
          assignedTo: null,
          createdBy: 'u3',
          coordinatorId: null,
          actorId: null,
        }),
      ).toEqual(['u3']);

      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.CREATED), {
          memberIds: null,
          coordinatorId: null,
          actorId: null,
        }),
      ).toEqual([]);
    });

    it('degrades gracefully when the coordinator is missing', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.ASSISTING), {
          createdBy: 'u3',
          coordinatorId: null,
          actorId: 'u2',
        }),
      ).toEqual(['u3']);

      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.CREATED), {
          memberIds: ['u1', 'u3'],
          coordinatorId: null,
          actorId: 'u1',
        }),
      ).toEqual(['u3']);
    });

    it('returns a deterministic sorted list regardless of candidate order', () => {
      expect(
        buildRecipientIds(ruleOf(ACTIVITY_EVENT.CREATED), {
          memberIds: ['u5', 'u2', 'u3'],
          coordinatorId: null,
          actorId: null,
        }),
      ).toEqual(['u2', 'u3', 'u5']);
    });
  });

  describe('renderNotificationText (T10 contract)', () => {
    it.each(EXPECTED_RULES)(
      'renders a Spanish title and body that differ for $eventType',
      (expected) => {
        const rendered = renderNotificationText(ruleOf(expected.eventType), {
          activityTitle: SAMPLE_TITLE,
        });

        expect(rendered.title).toBe(expected.title);
        expect(rendered.body).toContain(SAMPLE_TITLE);
        expect(rendered.title).not.toBe(rendered.body);
      },
    );

    it('title is always ≤ 40 chars and body ≤ 100 chars for a normal title', () => {
      for (const rule of NOTIFICATION_FAN_OUT_RULES) {
        const rendered = renderNotificationText(rule, {
          activityTitle: SAMPLE_TITLE,
          scheduledStart: SAMPLE_DATE,
        });
        expect(rendered.title.length).toBeLessThanOrEqual(40);
        expect(rendered.body.length).toBeLessThanOrEqual(100);
      }
    });

    it('body stays ≤ 100 chars even when the activity title is 80 characters', () => {
      for (const rule of NOTIFICATION_FAN_OUT_RULES) {
        const rendered = renderNotificationText(rule, {
          activityTitle: LONG_TITLE,
          scheduledStart: SAMPLE_DATE,
        });
        expect(rendered.body.length).toBeLessThanOrEqual(100);
      }
    });

    it('includes date/time when scheduledStart is provided (assigned example)', () => {
      const rendered = renderNotificationText(ruleOf(ACTIVITY_EVENT.ASSIGNED), {
        activityTitle: SAMPLE_TITLE,
        scheduledStart: SAMPLE_DATE,
      });

      expect(rendered.body).toContain(SAMPLE_TITLE);
      expect(rendered.body).toMatch(/\d{2}\/\d{2} a las \d{2}:\d{2}/);
    });

    it('falls back to a copy without date/time when scheduledStart is missing', () => {
      const rendered = renderNotificationText(ruleOf(ACTIVITY_EVENT.ASSIGNED), {
        activityTitle: SAMPLE_TITLE,
      });

      expect(rendered.body).toContain(SAMPLE_TITLE);
      expect(rendered.body).not.toMatch(/\d{2}\/\d{2}/);
    });

    it('matches the approved reference wording for assigned, overdue and done', () => {
      expect(
        renderNotificationText(ruleOf(ACTIVITY_EVENT.ASSIGNED), {
          activityTitle: 'Clases de natación',
          scheduledStart: new Date('2026-11-05T17:00:00Z'),
        }).title,
      ).toBe('Nueva actividad asignada');

      expect(
        renderNotificationText(ruleOf(ACTIVITY_EVENT.OVERDUE), {
          activityTitle: 'Reunión escolar',
        }).title,
      ).toBe('Actividad vencida');

      expect(
        renderNotificationText(ruleOf(ACTIVITY_EVENT.DONE), {
          activityTitle: 'Entrega de documentos',
        }).title,
      ).toBe('Actividad finalizada');
    });

    it('inserts $ replacement patterns in the activity title literally', () => {
      const rendered = renderNotificationText(ruleOf(ACTIVITY_EVENT.DONE), {
        activityTitle: 'Cost $& and $1',
      });

      expect(rendered.body).toContain('Cost $& and $1');
    });
  });
});
