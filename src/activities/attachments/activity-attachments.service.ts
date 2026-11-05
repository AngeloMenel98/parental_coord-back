import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';

import { ActAttachmentEntity } from '../entities/act-attachment.entity';
import { ActivitiesRepository } from '../repositories/activities.repository';
import { BondsService } from '../../bonds/bonds.service';
import { StorageService } from '../../storage/storage.service';
import { AuthUser } from '../../auth/dto/auth-user.dto';
import { PresignAttachmentDto } from './dto/presign-attachment.dto';
import { ConfirmAttachmentDto } from './dto/confirm-attachment.dto';
import { ActivityStatus } from '../entities/activity.entity';

const ALLOWED_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

@Injectable()
export class ActivityAttachmentsService {
  constructor(
    @InjectRepository(ActAttachmentEntity)
    private readonly attachmentsRepo: Repository<ActAttachmentEntity>,
    private readonly activitiesRepo: ActivitiesRepository,
    private readonly bondsService: BondsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Forma ÚNICA de respuesta, compartida por los cinco endpoints.
   *
   * El cliente Kotlin (`ActivityAttachmentDto`) exige `activityId` y tipa
   * `uploadedBy` como objeto. Devolver el uuid suelto o omitir `activityId`
   * rompe la deserialización en el dispositivo sin error visible: la lista queda
   * vacía y el adjunto recién confirmado nunca se pinta.
   */
  private toResponse(entity: ActAttachmentEntity, viewUrl: string | null) {
    return {
      id: entity.id,
      activityId: entity.activityId,
      fileName: entity.fileName,
      fileType: entity.fileType,
      uploadedBy: { id: entity.uploadedBy },
      uploadedAt: entity.uploadedAt,
      viewUrl,
    };
  }

  private async ensureMemberAndEditable(activityId: string, user: AuthUser) {
    const activity = await this.activitiesRepo.findById(activityId);
    if (!activity) throw new NotFoundException('Activity not found');
    const bonds = await this.bondsService.findByUserId(user.id);
    const isMember = bonds.some((b) => b.id === activity.bondId);
    if (!isMember) throw new ForbiddenException('Not a member of this bond');

    const status = activity.status as ActivityStatus;

    // Terminal states: no edits allowed
    if (
      status === ActivityStatus.DONE ||
      status === ActivityStatus.CANCELLED ||
      status === ActivityStatus.OVERDUE
    ) {
      throw new ForbiddenException('Attachments cannot be edited in terminal state');
    }

    // Cannot add/edit until assigned
    if (status === ActivityStatus.CREATED && !activity.assignedTo) {
      throw new ForbiddenException('Attachments can only be added after assignment');
    }

    return activity;
  }

  async presign(activityId: string, user: AuthUser, dto: PresignAttachmentDto) {
    const activity = await this.ensureMemberAndEditable(activityId, user);
    const ext = ALLOWED_EXT[dto.mimeType];
    if (!ext) throw new BadRequestException('Invalid mimeType');

    const safeName = path.basename(dto.fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `activities/${activity.bondId}/${activityId}/${randomUUID()}.${ext}`;

    const res = await this.storage.createSignedUploadUrl(key);
    if (!res) {
      throw new BadRequestException('Storage not configured');
    }
    return {
      uploadUrl: res.signedUrl,
      path: res.path,
      method: 'PUT',
      headers: { 'Content-Type': dto.mimeType },
      expiresIn: 300,
    };
  }

  async confirm(activityId: string, user: AuthUser, dto: ConfirmAttachmentDto) {
    const activity = await this.ensureMemberAndEditable(activityId, user);
    if (!dto.path.startsWith(`activities/${activity.bondId}/${activityId}/`)) {
      throw new ForbiddenException('Invalid path');
    }

    const exists = await this.storage.objectExists(dto.path);
    if (!exists) {
      throw new BadRequestException('File not found in storage');
    }

    const entity = this.attachmentsRepo.create({
      activityId,
      fileUrl: dto.path,
      fileName: dto.fileName,
      fileType: dto.mimeType,
      uploadedBy: user.id,
    });
    const saved = await this.attachmentsRepo.save(entity);
    const viewUrl = await this.storage.createSignedDownloadUrl(saved.fileUrl);
    return this.toResponse(saved, viewUrl);
  }

  async list(activityId: string, user: AuthUser) {
    const activity = await this.activitiesRepo.findById(activityId);
    if (!activity) throw new NotFoundException('Activity not found');
    const bonds = await this.bondsService.findByUserId(user.id);
    const isMember = bonds.some((b) => b.id === activity.bondId);
    if (!isMember) throw new ForbiddenException('Not a member of this bond');

    const items = await this.attachmentsRepo.find({
      where: { activityId },
      order: { uploadedAt: 'ASC' },
    });
    return Promise.all(
      items.map(async (i) =>
        this.toResponse(i, await this.storage.createSignedDownloadUrl(i.fileUrl)),
      ),
    );
  }

  async remove(activityId: string, user: AuthUser, attachmentId: string) {
    const activity = await this.ensureMemberAndEditable(activityId, user);
    const attachment = await this.attachmentsRepo.findOne({ where: { id: attachmentId, activityId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.uploadedBy !== user.id && user.systemRole !== 'admin') {
      throw new ForbiddenException('Cannot delete this attachment');
    }
    await this.storage.removeObject(attachment.fileUrl);
    await this.attachmentsRepo.delete(attachment.id);
    return { success: true };
  }

  async rename(activityId: string, user: AuthUser, attachmentId: string, fileName: string) {
    const activity = await this.ensureMemberAndEditable(activityId, user);
    const attachment = await this.attachmentsRepo.findOne({ where: { id: attachmentId, activityId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.uploadedBy !== user.id && user.systemRole !== 'admin') {
      throw new ForbiddenException('Cannot rename this attachment');
    }
    attachment.fileName = fileName;
    await this.attachmentsRepo.save(attachment);
    const viewUrl = await this.storage.createSignedDownloadUrl(attachment.fileUrl);
    return this.toResponse(attachment, viewUrl);
  }

  async replace(activityId: string, user: AuthUser, attachmentId: string, dto: any) {
    const activity = await this.ensureMemberAndEditable(activityId, user);
    const attachment = await this.attachmentsRepo.findOne({ where: { id: attachmentId, activityId } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    if (attachment.uploadedBy !== user.id && user.systemRole !== 'admin') {
      throw new ForbiddenException('Cannot replace this attachment');
    }
    if (!dto.path.startsWith(`activities/${activity.bondId}/${activityId}/`)) {
      throw new ForbiddenException('Invalid path');
    }
    const exists = await this.storage.objectExists(dto.path);
    if (!exists) {
      throw new BadRequestException('File not found in storage');
    }

    const oldPath = attachment.fileUrl;
    attachment.fileUrl = dto.path;
    attachment.fileName = dto.fileName;
    attachment.fileType = dto.mimeType;
    await this.attachmentsRepo.save(attachment);

    // best effort delete old
    try {
      await this.storage.removeObject(oldPath);
    } catch {}

    const viewUrl = await this.storage.createSignedDownloadUrl(attachment.fileUrl);
    return this.toResponse(attachment, viewUrl);
  }
}
