import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ActAttachmentEntity } from '../../activities/entities/act-attachment.entity';
import { ExpenseAttachmentEntity } from '../entities/expense-attachment.entity';

@Injectable()
export class ExpenseAttachmentsRepository extends BaseRepository<ExpenseAttachmentEntity> {
  constructor(
    @InjectRepository(ExpenseAttachmentEntity)
    private readonly attachmentRepo: Repository<ExpenseAttachmentEntity>,
    @InjectRepository(ActAttachmentEntity)
    private readonly actAttachmentRepo: Repository<ActAttachmentEntity>,
  ) {
    super(attachmentRepo);
  }

  async createAttachment(
    data: DeepPartial<ExpenseAttachmentEntity>,
    manager?: EntityManager,
  ): Promise<ExpenseAttachmentEntity> {
    const target = manager ? manager.getRepository(ExpenseAttachmentEntity) : this.attachmentRepo;
    const entity = target.create(data);
    return target.save(entity);
  }

  /**
   * T30 · R6: el adjunto de actividad del que nace el gasto, con su actividad
   * cargada para poder verificar que ambos pertenecen al mismo vínculo.
   */
  async findActivityAttachment(id: string): Promise<ActAttachmentEntity | null> {
    return this.actAttachmentRepo.findOne({
      where: { id },
      relations: { activity: true },
    });
  }
}
