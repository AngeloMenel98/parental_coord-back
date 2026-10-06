import { ForbiddenException, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivityEntity, ActivityStatus } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivitySummaryDto, ActivityDetailDto } from './dto/activity-response.dto';

export interface ComplianceMemberRaw {
  userId: string;
  firstName: string;
  lastName: string;
  completed: number;
  total: number;
  percentage: number;
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    @InjectRepository(NotificationEntity)
    private readonly notifRepo: Repository<NotificationEntity>,
    private readonly bondsRepo: BondsRepository,
    private readonly dataSource: DataSource,
  ) {}

  private async verifyBondMembership(bondId: string, userId: string): Promise<void> {
    const bond = await this.bondsRepo.findActiveBondForMember(bondId, userId);
    if (!bond) {
      throw new ForbiddenException('You are not a member of this bond');
    }
  }

  private async verifyChildrenBelongToBond(
    bondId: string,
    childrenIds: string[],
  ): Promise<void> {
    const childRepo = this.dataSource.getRepository(ChildEntity);
    const children = await childRepo.find({
      where: { id: In(childrenIds), bondId },
    });
    if (children.length !== childrenIds.length) {
      throw new BadRequestException(
        'One or more children do not belong to this bond',
      );
    }
  }

  async create(bondId: string, dto: CreateActivityDto, userId: string): Promise<ActivityEntity> {
    await this.verifyBondMembership(bondId, userId);
    await this.verifyBondMembership(bondId, dto.assignedTo);

    if (dto.childrenIds?.length) {
      await this.verifyChildrenBelongToBond(bondId, dto.childrenIds);
    }

    return this.dataSource.transaction(async (manager) => {
      const activityRepo = manager.getRepository(ActivityEntity);
      const activityChildRepo = manager.getRepository(ActivityChildEntity);
      const notifRepo = manager.getRepository(NotificationEntity);

      const activity = activityRepo.create({
        bondId,
        categoryId: dto.categoryId,
        type: dto.type,
        status: ActivityStatus.ASSIGNED,
        criticality: dto.criticality,
        title: dto.title,
        description: dto.description ?? '',
        createdBy: userId,
        assignedTo: dto.assignedTo,
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : null,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      });

      const savedActivity = await activityRepo.save(activity);

      // Link children to activity
      if (dto.childrenIds?.length) {
        const activityChildren = dto.childrenIds.map((childId) =>
          activityChildRepo.create({
            activityId: savedActivity.id,
            childId,
          }),
        );
        await activityChildRepo.save(activityChildren);
      }

      const notification = notifRepo.create({
        userId: dto.assignedTo,
        bondId,
        type: 'activity_assigned',
        title: dto.title,
        body: `New activity assigned: ${dto.title}`,
        refEntityType: 'activity',
        refEntityId: savedActivity.id,
        isRead: false,
      });

      await notifRepo.save(notification);

      return savedActivity;
    });
  }

  /**
   * Returns summary DTOs for all activities of a bond, ordered
   * scheduled_start → deadline → createdAt (nulls last).
   */
  async listByBond(bondId: string): Promise<ActivitySummaryDto[]> {
    const rows = await this.activitiesRepo.findByBondIdOrdered(bondId);
    return plainToInstance(ActivitySummaryDto, rows, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Returns the detail DTO for an activity. 404 when the activity does not
   * exist or the caller is not an active member of the activity's bond.
   */
  async getDetail(id: string, userId: string): Promise<ActivityDetailDto> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const bond = await this.bondsRepo.findActiveBondForMember(
      activity.bondId,
      userId,
    );
    if (!bond) {
      throw new NotFoundException('Bond not found or you are not a member');
    }

    return plainToInstance(ActivityDetailDto, activity, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Confirms the assignment of an activity for the caller (idempotent,
   * flag-only). Check order: existence (404) → membership (404) →
   * assignee (403). Repeat confirm returns the stored confirmedAt with
   * NO write. Never touches `status`.
   */
  async confirmAssignment(
    id: string,
    userId: string,
  ): Promise<{ id: string; assignedConfirmed: boolean; confirmedAt: string | null }> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const bond = await this.bondsRepo.findActiveBondForMember(
      activity.bondId,
      userId,
    );
    if (!bond) {
      throw new NotFoundException('Bond not found or you are not a member');
    }

    if (activity.assignedTo !== userId) {
      throw new ForbiddenException('Only the assignee can confirm this activity');
    }

    if (activity.assignedConfirmed) {
      return {
        id: activity.id,
        assignedConfirmed: true,
        confirmedAt: activity.confirmedAt?.toISOString() ?? null,
      };
    }

    const now = new Date();
    await this.activitiesRepo.updateEntity(id, {
      assignedConfirmed: true,
      confirmedAt: now,
    });

    return {
      id: activity.id,
      assignedConfirmed: true,
      confirmedAt: now.toISOString(),
    };
  }

  /**
   * Returns per-member compliance data for a given bond.
   * Every active bond member appears in the result — members with zero
   * activities in the current month get total=0, completed=0, percentage=0.
   */
  async getComplianceForBond(bondId: string): Promise<ComplianceMemberRaw[]> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const members = await this.activitiesRepo.findActiveBondMembers(bondId);

    if (members.length === 0) {
      return [];
    }

    const rows = await this.activitiesRepo.countActivitiesByAssignee(
      bondId,
      startOfMonth,
      endOfMonth,
    );

    const activityMap = new Map<string, { total: number; completed: number }>();
    for (const row of rows) {
      activityMap.set(row.assignedTo, {
        total: Number(row.total),
        completed: Number(row.completed),
      });
    }

    return members.map((member) => {
      const stats = activityMap.get(member.userId) ?? { total: 0, completed: 0 };
      const total = stats.total;
      const completed = stats.completed;

      return {
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        completed,
        total,
        percentage: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
      };
    });
  }
}
