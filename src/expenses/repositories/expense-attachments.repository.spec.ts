import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ActAttachmentEntity } from '../../activities/entities/act-attachment.entity';
import { ExpenseAttachmentEntity } from '../entities/expense-attachment.entity';
import { ExpenseAttachmentsRepository } from './expense-attachments.repository';

describe('ExpenseAttachmentsRepository (T30)', () => {
  let repo: ExpenseAttachmentsRepository;
  let attachmentRepo: {
    create: jest.Mock;
    save: jest.Mock;
    manager: { getRepository: jest.Mock };
  };
  let actAttachmentRepo: { findOne: jest.Mock };

  const attachment = {
    id: 'att-1',
    expenseId: 'expense-1',
    fileUrl: 'expenses/bond-1/expense-1/file.png',
    fileName: 'file.png',
    fileType: 'image/png',
    uploadedBy: 'user-1',
    uploadedAt: new Date('2026-10-27T12:00:00.000Z'),
  };

  beforeEach(async () => {
    attachmentRepo = {
      create: jest.fn((v: any) => ({ ...v, id: v.id ?? 'att-1' })),
      save: jest.fn(async (v: any) => ({ ...v, uploadedAt: attachment.uploadedAt })),
      manager: { getRepository: jest.fn() },
    };
    actAttachmentRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'act-att-1',
        activityId: 'activity-1',
        activity: { id: 'activity-1', bondId: 'bond-1' },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseAttachmentsRepository,
        { provide: getRepositoryToken(ExpenseAttachmentEntity), useValue: attachmentRepo },
        { provide: getRepositoryToken(ActAttachmentEntity), useValue: actAttachmentRepo },
      ],
    }).compile();

    repo = module.get(ExpenseAttachmentsRepository);
  });

  it('creates an attachment row with the provided data', async () => {
    const result = await repo.createAttachment({
      expenseId: 'expense-1',
      fileUrl: 'expenses/bond-1/expense-1/file.png',
      fileName: 'file.png',
      fileType: 'image/png',
      uploadedBy: 'user-1',
    });

    expect(attachmentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expenseId: 'expense-1',
        fileUrl: 'expenses/bond-1/expense-1/file.png',
        uploadedBy: 'user-1',
      }),
    );
    expect(attachmentRepo.save).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ expenseId: 'expense-1' }));
  });

  it('uses the transactional manager when provided', async () => {
    const managerRepo = {
      create: jest.fn((v: any) => ({ ...v, id: 'att-tx' })),
      save: jest.fn(async (v: any) => v),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) } as any;

    await repo.createAttachment({ expenseId: 'expense-1', uploadedBy: 'user-1' }, manager);

    expect(manager.getRepository).toHaveBeenCalledWith(ExpenseAttachmentEntity);
    expect(managerRepo.create).toHaveBeenCalled();
    expect(attachmentRepo.create).not.toHaveBeenCalled();
  });

  it('loads an activity attachment with its activity for the bond check', async () => {
    const result = await repo.findActivityAttachment('act-att-1');

    expect(actAttachmentRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'act-att-1' },
      relations: { activity: true },
    });
    expect(result?.activity.bondId).toBe('bond-1');
  });
});
