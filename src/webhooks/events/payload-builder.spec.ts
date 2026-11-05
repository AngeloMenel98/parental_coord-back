import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { ActivityEntity, ActivityStatus } from '../../activities/entities/activity.entity';
import { ActivitiesRepository } from '../../activities/repositories/activities.repository';
import { OutboxEventEntity } from '../../outbox/entities/outbox-event.entity';
import {
  DEFAULT_WEBHOOK_API_VERSION,
  WebhookPayloadBuilder,
  buildWebhookPayload,
} from './payload-builder';

function activity(overrides: Partial<ActivityEntity> = {}): ActivityEntity {
  return {
    id: 'a1',
    bondId: 'b1',
    title: 'Paseo al parque',
    status: ActivityStatus.ASSIGNED,
    version: 7,
    assignedTo: 'u1',
    scheduledStart: new Date('2026-10-01T10:00:00Z'),
    scheduledEnd: new Date('2026-10-01T11:00:00Z'),
    deadline: new Date('2026-10-01T09:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as ActivityEntity;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    type: 'activity.done',
    activityId: 'a1',
    bondId: 'b1',
    aggregateVersion: 8,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    payload: {
      from: 'in_progress',
      to: 'done',
      actor: 'u1',
      occurredAt: '2026-10-01T12:00:01.000Z',
    } as Record<string, unknown>,
    activity: activity(),
    apiVersion: DEFAULT_WEBHOOK_API_VERSION,
    ...overrides,
  };
}

describe('buildWebhookPayload (REQ-DISP-5, D4)', () => {
  it('builds the PRD §7.2 shape with transition + activity snapshot', () => {
    const payload = buildWebhookPayload(baseInput());

    expect(payload).toEqual({
      id: 'e1',
      type: 'activity.done',
      apiVersion: '2026-10-01',
      occurredAt: '2026-10-01T12:00:01.000Z',
      data: {
        activity: {
          id: 'a1',
          familyId: 'b1',
          title: 'Paseo al parque',
          state: 'done',
          assigneeId: 'u1',
          scheduledStart: '2026-10-01T10:00:00.000Z',
          scheduledEnd: '2026-10-01T11:00:00.000Z',
          responseDeadlineAt: '2026-10-01T09:00:00.000Z',
          deleted: false,
          version: 8,
        },
        transition: { from: 'in_progress', to: 'done', actor: 'u1' },
      },
    });
  });

  it('OVERRIDES state=payload.to and version=aggregate_version (not the live row)', () => {
    // The live row is newer (status done, version 99) than the event being relayed.
    const payload = buildWebhookPayload(
      baseInput({
        payload: { from: 'assisting', to: 'not_assisting', actor: 'u2' },
        aggregateVersion: 12,
        activity: activity({ status: ActivityStatus.DONE, version: 99 }),
      }),
    );

    expect(payload.data.activity.state).toBe('not_assisting');
    expect(payload.data.activity.version).toBe(12);
  });

  it('marks deleted=true from payload.deleted and from a soft-deleted row', () => {
    const fromPayload = buildWebhookPayload(
      baseInput({ payload: { from: 'done', to: 'cancelled', actor: 'u1', deleted: true } }),
    );
    expect(fromPayload.data.activity.deleted).toBe(true);

    const softDeleted = buildWebhookPayload(
      baseInput({ activity: activity({ deletedAt: new Date('2026-10-01T13:00:00Z') }) }),
    );
    expect(softDeleted.data.activity.deleted).toBe(true);
  });

  it('includes reason only when present', () => {
    const withReason = buildWebhookPayload(
      baseInput({
        payload: { from: 'assigned', to: 'not_assisting', actor: 'u1', reason: 'enfermo' },
      }),
    );
    expect(withReason.data.transition).toEqual({
      from: 'assigned',
      to: 'not_assisting',
      actor: 'u1',
      reason: 'enfermo',
    });

    const withoutReason = buildWebhookPayload(baseInput());
    expect('reason' in withoutReason.data.transition).toBe(false);
  });

  it('OMITS requiresVerification and renewalDate (do not exist pre-verify)', () => {
    const payload = buildWebhookPayload(baseInput());
    expect('requiresVerification' in payload.data.activity).toBe(false);
    expect('renewalDate' in payload.data.activity).toBe(false);
  });

  it('falls back occurredAt to the event createdAt when absent', () => {
    const payload = buildWebhookPayload(
      baseInput({ payload: { from: 'created', to: 'assigned', actor: 'u1' } }),
    );
    expect(payload.occurredAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('throws when the body exceeds 64 KB', () => {
    const huge = 'x'.repeat(70 * 1024);
    expect(() => buildWebhookPayload(baseInput({ activity: activity({ title: huge }) }))).toThrow(
      /64 KB|exceed/i,
    );
  });
});

describe('WebhookPayloadBuilder (soft-delete-inclusive read, D4)', () => {
  let builder: WebhookPayloadBuilder;
  const activitiesRepo = {
    findByIdIncludingDeleted: jest.fn(),
  } as unknown as jest.Mocked<ActivitiesRepository>;
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    (config.get as jest.Mock).mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookPayloadBuilder,
        { provide: ActivitiesRepository, useValue: activitiesRepo },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    builder = module.get(WebhookPayloadBuilder);
  });

  it('reads via findByIdIncludingDeleted (soft-deleted rows included)', async () => {
    activitiesRepo.findByIdIncludingDeleted.mockResolvedValueOnce(
      activity({ deletedAt: new Date('2026-10-01T13:00:00Z') }),
    );

    const event = {
      id: 'e1',
      eventType: 'activity.cancelled',
      aggregateId: 'a1',
      bondId: 'b1',
      aggregateVersion: 3,
      createdAt: new Date('2026-10-01T12:00:00Z'),
      payload: { from: 'created', to: 'cancelled', actor: 'u1' },
    } as unknown as OutboxEventEntity;

    const payload = await builder.build(event);

    expect(activitiesRepo.findByIdIncludingDeleted).toHaveBeenCalledWith('a1');
    expect(payload.data.activity.deleted).toBe(true);
    expect(payload.data.activity.state).toBe('cancelled');
    expect(payload.apiVersion).toBe(DEFAULT_WEBHOOK_API_VERSION);
  });

  it('uses WEBHOOK_API_VERSION from config when set', async () => {
    (config.get as jest.Mock).mockReturnValue('2027-01-01');
    activitiesRepo.findByIdIncludingDeleted.mockResolvedValueOnce(activity());

    const event = {
      id: 'e1',
      eventType: 'activity.done',
      aggregateId: 'a1',
      bondId: 'b1',
      aggregateVersion: 3,
      createdAt: new Date('2026-10-01T12:00:00Z'),
      payload: { from: 'in_progress', to: 'done', actor: 'u1' },
    } as unknown as OutboxEventEntity;

    const payload = await builder.build(event);
    expect(payload.apiVersion).toBe('2027-01-01');
  });
});
