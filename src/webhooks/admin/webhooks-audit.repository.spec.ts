import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLogEntity } from '../../audit/entities/audit-log.entity';
import { WEBHOOK_AUDIT_ACTIONS, WebhooksAuditRepository } from './webhooks-audit.repository';

describe('WebhooksAuditRepository (T-W1.27, REQ-SUB-6)', () => {
  let repo: WebhooksAuditRepository;
  let auditRepo: jest.Mocked<Repository<AuditLogEntity>>;

  beforeEach(async () => {
    auditRepo = {
      create: jest.fn((data: object) => data),
      save: jest.fn(async (data: object) => data),
      target: AuditLogEntity,
      manager: {},
    } as unknown as jest.Mocked<Repository<AuditLogEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksAuditRepository,
        { provide: getRepositoryToken(AuditLogEntity), useValue: auditRepo },
      ],
    }).compile();

    repo = module.get(WebhooksAuditRepository);
  });

  it('writes entity_type=webhook_subscription with the mapped columns', async () => {
    await repo.record({
      bondId: 'b1',
      userId: 'u1',
      entityId: 's1',
      action: WEBHOOK_AUDIT_ACTIONS.CREATE,
      newValue: { url: 'https://x.example' },
    });

    expect(auditRepo.create).toHaveBeenCalledWith({
      bondId: 'b1',
      userId: 'u1',
      entityType: 'webhook_subscription',
      entityId: 's1',
      action: 'webhook_create',
      oldValue: null,
      newValue: { url: 'https://x.example' },
      detail: null,
      ipAddress: null,
      userAgent: null,
    });
  });

  it('uses an explicit EntityManager when provided', async () => {
    const managerRepo = {
      create: jest.fn((d: object) => d),
      save: jest.fn(async (d: object) => d),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };

    await repo.record(
      { bondId: 'b1', userId: 'u1', entityId: 's1', action: WEBHOOK_AUDIT_ACTIONS.DELETE },
      manager as never,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(AuditLogEntity);
    expect(auditRepo.save).not.toHaveBeenCalled();
  });
});
