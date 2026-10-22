import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  WEBHOOK_STATE_CHANGED_EVENT,
  WEBHOOK_WILDCARD,
  WebhookSubscriptionRepository,
  subscriptionMatchesEventType,
} from './webhook-subscription.repository';
import {
  WebhookSubscriptionEntity,
  WebhookSubscriptionStatus,
} from '../entities/webhook-subscription.entity';

describe('subscriptionMatchesEventType (REQ-DISP-2)', () => {
  it('matches the specific produced type', () => {
    expect(subscriptionMatchesEventType(['activity.done'], 'activity.done')).toBe(true);
  });

  it('matches the synthesized catch-all activity.state_changed', () => {
    expect(subscriptionMatchesEventType(['activity.state_changed'], 'activity.done')).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(subscriptionMatchesEventType([WEBHOOK_WILDCARD], 'activity.cancelled')).toBe(true);
  });

  it('does not match an unrelated specific type', () => {
    expect(subscriptionMatchesEventType(['activity.overdue'], 'activity.cancelled')).toBe(false);
  });

  it('catch-all + wildcard dedup: still a single boolean true', () => {
    expect(
      subscriptionMatchesEventType(
        ['activity.done', WEBHOOK_STATE_CHANGED_EVENT, WEBHOOK_WILDCARD],
        'activity.done',
      ),
    ).toBe(true);
  });
});

describe('WebhookSubscriptionRepository', () => {
  let repo: WebhookSubscriptionRepository;
  let subRepo: jest.Mocked<Repository<WebhookSubscriptionEntity>>;
  let qb: any;

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    subRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      target: WebhookSubscriptionEntity,
      manager: {},
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSubscriptionRepository,
        { provide: getRepositoryToken(WebhookSubscriptionEntity), useValue: subRepo },
      ],
    }).compile();

    repo = module.get(WebhookSubscriptionRepository);
  });

  it('findActiveByBond filters on ACTIVE', async () => {
    await repo.findActiveByBond('b1');
    expect(subRepo.find).toHaveBeenCalledWith({
      where: { bondId: 'b1', status: WebhookSubscriptionStatus.ACTIVE },
      order: { createdAt: 'ASC' },
    });
  });

  it('countByBond counts all subscriptions of the bond', async () => {
    subRepo.count.mockResolvedValueOnce(10);
    expect(await repo.countByBond('b1')).toBe(10);
    expect(subRepo.count).toHaveBeenCalledWith({ where: { bondId: 'b1' } });
  });

  it('findActiveMatchingByBond matches specific OR state_changed OR wildcard', async () => {
    await repo.findActiveMatchingByBond('b1', 'activity.done');

    expect(qb.where).toHaveBeenCalledWith('s.bond_id = :bondId', { bondId: 'b1' });
    expect(qb.andWhere).toHaveBeenCalledWith('s.status = :active', {
      active: WebhookSubscriptionStatus.ACTIVE,
    });
    const [clause, params] = qb.andWhere.mock.calls[1];
    expect(clause).toContain(':eventType = ANY(s.event_types)');
    expect(clause).toContain(':stateChanged = ANY(s.event_types)');
    expect(clause).toContain(':wildcard = ANY(s.event_types)');
    expect(params).toEqual({
      eventType: 'activity.done',
      stateChanged: WEBHOOK_STATE_CHANGED_EVENT,
      wildcard: WEBHOOK_WILDCARD,
    });
  });
});
