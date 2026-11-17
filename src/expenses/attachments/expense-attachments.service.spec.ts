import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ActAttachmentEntity } from '../../activities/entities/act-attachment.entity';
import { AuthUser } from '../../auth/dto/auth-user.dto';
import { BondsService } from '../../bonds/bonds.service';
import { StorageService } from '../../storage/storage.service';
import { ExpenseAttachmentsService } from './expense-attachments.service';
import { ExpenseAttachmentsRepository } from '../repositories/expense-attachments.repository';
import { ExpensesRepository } from '../repositories/expenses.repository';
import { ExpenseStatus } from '../entities/expense.entity';

/**
 * T30 · Contrato de los tres endpoints de adjuntos de gasto.
 *
 * La capa de persistencia y storage están mockeadas; las reglas de autorización
 * y el namespace de las keys se prueban de punta a punta.
 */
describe('ExpenseAttachmentsService (T30)', () => {
  const BOND = 'bond-1';
  const EXPENSE = 'expense-1';
  const ACTIVITY = 'activity-1';
  const USER = { id: 'user-1', email: 'u@t.com', systemRole: 'user' } as AuthUser;
  const STRANGER = { id: 'user-2', email: 's@t.com', systemRole: 'user' } as AuthUser;
  const MEMBER = { id: 'user-3', email: 'm@t.com', systemRole: 'user' } as AuthUser;

  let service: ExpenseAttachmentsService;
  let expensesRepo: { findAliveById: jest.Mock; updateActivityId: jest.Mock };
  let expenseAttachmentsRepo: {
    createAttachment: jest.Mock;
    findActivityAttachment: jest.Mock;
  };
  let bondsService: any;
  let storage: {
    createSignedUploadUrl: jest.Mock;
    objectExists: jest.Mock;
    createSignedDownloadUrl: jest.Mock;
  };

  const expense = {
    id: EXPENSE,
    bondId: BOND,
    status: ExpenseStatus.PENDING,
    requestedBy: USER.id,
  };

  const uploadedAt = new Date('2026-10-27T12:00:00.000Z');

  const expectPresignShape = (body: any) => {
    expect(body).toEqual(
      expect.objectContaining({
        uploadUrl: expect.any(String),
        path: expect.stringMatching(/^expenses\/bond-1\/expense-1\/[\w-]+\.jpg$/),
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        expiresIn: 300,
      }),
    );
  };

  const expectAttachmentShape = (body: any) => {
    expect(body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        expenseId: EXPENSE,
        fileName: expect.any(String),
        fileType: expect.any(String),
        uploadedAt: expect.anything(),
        viewUrl: 'https://signed',
      }),
    );
    expect(body.uploadedBy).toEqual({ id: USER.id });
  };

  beforeEach(async () => {
    expensesRepo = {
      findAliveById: jest.fn().mockResolvedValue(expense),
      updateActivityId: jest.fn().mockResolvedValue(true),
    };
    expenseAttachmentsRepo = {
      createAttachment: jest.fn(async (data: any) => ({
        ...data,
        id: 'att-1',
        uploadedAt,
      })),
      findActivityAttachment: jest.fn().mockResolvedValue({
        id: 'act-att-1',
        activityId: ACTIVITY,
        fileUrl: 'activities/bond-1/activity-1/file.png',
        fileName: 'file.png',
        fileType: 'image/png',
        activity: { id: ACTIVITY, bondId: BOND },
      } as ActAttachmentEntity),
    };
    bondsService = {
      isActiveBondForMember: jest.fn().mockResolvedValue(true),
      isThirdPartyIn: jest.fn().mockResolvedValue(false),
    };
    storage = {
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        signedUrl: 'https://upload',
        path: 'expenses/bond-1/expense-1/uuid.jpg',
      }),
      objectExists: jest.fn().mockResolvedValue(true),
      createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseAttachmentsService,
        { provide: ExpensesRepository, useValue: expensesRepo },
        { provide: ExpenseAttachmentsRepository, useValue: expenseAttachmentsRepo },
        { provide: BondsService, useValue: bondsService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(ExpenseAttachmentsService);
  });

  // ── presign ───────────────────────────────────────────────────────────────

  describe('presign', () => {
    it('returns the same shape as the activity cycle with the expense namespace', async () => {
      const result = await service.presign(EXPENSE, USER, {
        fileName: 'ticket.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 70,
      });

      expectPresignShape(result);
      expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
        expect.stringMatching(/^expenses\/bond-1\/expense-1\/[\w-]+\.jpg$/),
      );
    });

    it('rejects an unsupported mime type', async () => {
      await expect(
        service.presign(EXPENSE, USER, { fileName: 'x.gif', mimeType: 'image/gif', sizeBytes: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws 400 when storage is not configured', async () => {
      storage.createSignedUploadUrl.mockResolvedValue(null);

      await expect(
        service.presign(EXPENSE, USER, { fileName: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hides the expense from a non-member with 404', async () => {
      bondsService.isActiveBondForMember.mockResolvedValue(false);

      await expect(
        service.presign(EXPENSE, STRANGER, {
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a bond member who is not the requester (403)', async () => {
      await expect(
        service.presign(EXPENSE, MEMBER, {
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── confirm ───────────────────────────────────────────────────────────────

  describe('confirm', () => {
    it('creates the expense_attachment row for the uploaded object', async () => {
      const result = await service.confirm(EXPENSE, USER, {
        path: 'expenses/bond-1/expense-1/uuid.jpg',
        fileName: 'ticket.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 70,
      });

      expectAttachmentShape(result);
      expect(expenseAttachmentsRepo.createAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: EXPENSE,
          fileUrl: 'expenses/bond-1/expense-1/uuid.jpg',
          fileName: 'ticket.jpg',
          fileType: 'image/jpeg',
          uploadedBy: USER.id,
        }),
      );
    });

    it('rejects a path outside the expense namespace', async () => {
      await expect(
        service.confirm(EXPENSE, USER, {
          path: 'expenses/bond-1/other-expense/uuid.jpg',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects confirmation when the object is missing from storage', async () => {
      storage.objectExists.mockResolvedValue(false);

      await expect(
        service.confirm(EXPENSE, USER, {
          path: 'expenses/bond-1/expense-1/uuid.jpg',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hides the expense from a non-member with 404', async () => {
      bondsService.isActiveBondForMember.mockResolvedValue(false);

      await expect(
        service.confirm(EXPENSE, STRANGER, {
          path: 'expenses/bond-1/expense-1/uuid.jpg',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a bond member who is not the requester (403)', async () => {
      await expect(
        service.confirm(EXPENSE, MEMBER, {
          path: 'expenses/bond-1/expense-1/uuid.jpg',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── convert ───────────────────────────────────────────────────────────────

  describe('convert', () => {
    it('points the new expense_attachment at the same storage object', async () => {
      const result = await service.convert(EXPENSE, USER, { activityAttachmentId: 'act-att-1' });

      expectAttachmentShape(result);
      expect(expenseAttachmentsRepo.createAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          expenseId: EXPENSE,
          fileUrl: 'activities/bond-1/activity-1/file.png',
          fileName: 'file.png',
          fileType: 'image/png',
          uploadedBy: USER.id,
        }),
      );
    });

    it('sets expense.activity_id to the activity that owns the attachment', async () => {
      await service.convert(EXPENSE, USER, { activityAttachmentId: 'act-att-1' });

      expect(expensesRepo.updateActivityId).toHaveBeenCalledWith(EXPENSE, ACTIVITY);
    });

    it('refuses to convert an attachment whose activity belongs to a different bond', async () => {
      expenseAttachmentsRepo.findActivityAttachment.mockResolvedValue({
        id: 'act-att-2',
        activityId: 'activity-2',
        fileUrl: 'activities/bond-2/activity-2/file.png',
        fileName: 'file.png',
        fileType: 'image/png',
        activity: { id: 'activity-2', bondId: 'bond-2' },
      } as ActAttachmentEntity);

      await expect(
        service.convert(EXPENSE, USER, { activityAttachmentId: 'act-att-2' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 when the activity attachment does not exist', async () => {
      expenseAttachmentsRepo.findActivityAttachment.mockResolvedValue(null);

      await expect(
        service.convert(EXPENSE, USER, { activityAttachmentId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides the expense from a non-member with 404', async () => {
      bondsService.isActiveBondForMember.mockResolvedValue(false);

      await expect(
        service.convert(EXPENSE, STRANGER, { activityAttachmentId: 'act-att-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a bond member who is not the requester (403)', async () => {
      await expect(
        service.convert(EXPENSE, MEMBER, { activityAttachmentId: 'act-att-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
