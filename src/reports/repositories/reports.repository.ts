import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BondEntity } from '../../bonds/entities/bond.entity';
import { ReportEntity, ReportStatus } from '../entities/report.entity';

export interface CreateReportRow {
  bondId: string;
  requestedBy: string;
  dateFrom: string;
  dateTo: string;
  status: ReportStatus;
}

export interface CompleteReportRow {
  fileUrl: string;
  generatedAt: Date;
  generatedBy: string;
}

/** B3 · S9-S11 — persistencia de la tabla `report`. */
@Injectable()
export class ReportsRepository {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reports: Repository<ReportEntity>,
    @InjectRepository(BondEntity)
    private readonly bonds: Repository<BondEntity>,
  ) {}

  async findBond(bondId: string): Promise<Pick<BondEntity, 'id'> | null> {
    return this.bonds.findOne({ where: { id: bondId }, select: ['id'] });
  }

  async create(data: CreateReportRow): Promise<ReportEntity> {
    const entity = this.reports.create(data);
    return this.reports.save(entity);
  }

  async findById(id: string): Promise<ReportEntity | null> {
    return this.reports.findOne({ where: { id } });
  }

  async list(bondId?: string): Promise<ReportEntity[]> {
    return this.reports.find({
      where: bondId ? { bondId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async markCompleted(id: string, data: CompleteReportRow): Promise<void> {
    await this.reports.update(id, {
      status: ReportStatus.COMPLETED,
      fileUrl: data.fileUrl,
      generatedAt: data.generatedAt,
      generatedBy: data.generatedBy,
    });
  }
}
