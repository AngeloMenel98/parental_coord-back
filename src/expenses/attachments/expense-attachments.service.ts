import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { AuthUser } from '../../auth/dto/auth-user.dto';
import { BondsService } from '../../bonds/bonds.service';
import { StorageService } from '../../storage/storage.service';
import { ConfirmExpenseAttachmentDto } from './dto/confirm-expense-attachment.dto';
import { ConvertExpenseAttachmentDto } from './dto/convert-expense-attachment.dto';
import { ExpenseAttachmentResponseDto } from './dto/expense-attachment-response.dto';
import { PresignExpenseAttachmentDto } from './dto/presign-expense-attachment.dto';
import { ExpenseAttachmentsRepository } from '../repositories/expense-attachments.repository';
import { ExpensesRepository } from '../repositories/expenses.repository';
import { ExpenseEntity } from '../entities/expense.entity';

const ALLOWED_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * T30 · Adjuntos de un gasto y conversión de un adjunto de actividad.
 *
 * R6: un objeto de Storage, dos filas. `convert` NO copia bytes — crea la fila
 * de `expense_attachment` apuntando a la MISMA key que el adjunto de actividad.
 * El flag `hasDocument` sigue derivado de la existencia de la fila (nunca una
 * columna booleana).
 *
 * Autorización: miembro activo del vínculo para LEER (404 si no lo es, el mismo
 * contrato que el resto del módulo) y SÓLO el solicitante para ADJUNTAR (403
 * para un miembro que no pidió el gasto — puede verlo, no puede cambiarle la
 * evidencia).
 */
@Injectable()
export class ExpenseAttachmentsService {
  constructor(
    private readonly expenseAttachmentsRepo: ExpenseAttachmentsRepository,
    private readonly expensesRepo: ExpensesRepository,
    private readonly bondsService: BondsService,
    private readonly storage: StorageService,
  ) {}

  private toResponse(entity: any, viewUrl: string | null): ExpenseAttachmentResponseDto {
    return {
      id: entity.id,
      expenseId: entity.expenseId,
      fileName: entity.fileName,
      fileType: entity.fileType,
      uploadedBy: { id: entity.uploadedBy },
      uploadedAt: entity.uploadedAt,
      viewUrl,
    };
  }

  /** Miembro activo del vínculo o 404: un gasto ajeno no existe para el visor. */
  private async ensureMember(expenseId: string, user: AuthUser): Promise<ExpenseEntity> {
    const expense = await this.expensesRepo.findAliveById(expenseId);
    if (!expense) throw new NotFoundException('Expense not found');
    const isMember = await this.bondsService.isActiveBondForMember(expense.bondId, user.id);
    if (!isMember) throw new NotFoundException('Expense not found');
    return expense;
  }

  /** S7 · sólo el solicitante adjunta; un miembro que no lo pidió recibe 403. */
  private async ensureRequester(expenseId: string, user: AuthUser): Promise<ExpenseEntity> {
    const expense = await this.ensureMember(expenseId, user);
    if (expense.requestedBy !== user.id) {
      throw new ForbiddenException('Only the requester can attach a document to this expense');
    }
    return expense;
  }

  private keyPrefix(expense: { bondId: string; id: string }): string {
    return `expenses/${expense.bondId}/${expense.id}`;
  }

  async presign(
    expenseId: string,
    user: AuthUser,
    dto: PresignExpenseAttachmentDto,
  ): Promise<{
    uploadUrl: string;
    path: string;
    method: string;
    headers: Record<string, string>;
    expiresIn: number;
  }> {
    const expense = await this.ensureRequester(expenseId, user);
    const ext = ALLOWED_EXT[dto.mimeType];
    if (!ext) throw new BadRequestException('Invalid mimeType');

    const key = `${this.keyPrefix(expense)}/${randomUUID()}.${ext}`;
    const res = await this.storage.createSignedUploadUrl(key);
    if (!res) throw new BadRequestException('Storage not configured');

    return {
      uploadUrl: res.signedUrl,
      path: res.path,
      method: 'PUT',
      headers: { 'Content-Type': dto.mimeType },
      expiresIn: 300,
    };
  }

  async confirm(
    expenseId: string,
    user: AuthUser,
    dto: ConfirmExpenseAttachmentDto,
  ): Promise<ExpenseAttachmentResponseDto> {
    const expense = await this.ensureRequester(expenseId, user);
    if (!dto.path.startsWith(`${this.keyPrefix(expense)}/`)) {
      throw new ForbiddenException('Invalid path');
    }

    const exists = await this.storage.objectExists(dto.path);
    if (!exists) throw new BadRequestException('File not found in storage');

    const saved = await this.expenseAttachmentsRepo.createAttachment({
      expenseId,
      fileUrl: dto.path,
      fileName: dto.fileName,
      fileType: dto.mimeType,
      uploadedBy: user.id,
    });
    const viewUrl = await this.storage.createSignedDownloadUrl(saved.fileUrl);
    return this.toResponse(saved, viewUrl);
  }

  async convert(
    expenseId: string,
    user: AuthUser,
    dto: ConvertExpenseAttachmentDto,
  ): Promise<ExpenseAttachmentResponseDto> {
    const expense = await this.ensureRequester(expenseId, user);

    const attachment = await this.expenseAttachmentsRepo.findActivityAttachment(
      dto.activityAttachmentId,
    );
    if (!attachment) throw new NotFoundException('Activity attachment not found');

    // R6 · misma key, misma fila de storage; el vínculo tiene que coincidir. Un
    // adjunto de otro vínculo se comporta como inexistente (nunca se revela que
    // existe en otra familia).
    if (!attachment.activity || attachment.activity.bondId !== expense.bondId) {
      throw new NotFoundException('Activity attachment not found');
    }

    const saved = await this.expenseAttachmentsRepo.createAttachment({
      expenseId,
      fileUrl: attachment.fileUrl,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      uploadedBy: user.id,
    });

    await this.expensesRepo.updateActivityId(expenseId, attachment.activityId);

    const viewUrl = await this.storage.createSignedDownloadUrl(saved.fileUrl);
    return this.toResponse(saved, viewUrl);
  }
}
