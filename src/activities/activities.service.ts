import {
  ForbiddenException,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivityEntity, ActivityStatus, ActivityType } from './entities/activity.entity';
import { ActivityChildEntity } from './entities/activity-child.entity';
import { ChildEntity } from '../children/entities/child.entity';
import { NotificationEntity } from '../notifications/entities/notification.entity';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivitySummaryDto, ActivityDetailDto } from './dto/activity-response.dto';
import { CompleteActivityResponseDto } from './dto/complete-activity-response.dto';
import { CategoryEntity } from '../categories/entities/category.entity';
import { Clock } from '../common/clock/clock';

export interface ComplianceMemberRaw {
  userId: string;
  firstName: string;
  lastName: string;
  completed: number;
  total: number;
  percentage: number;
}

export const NOTIF_BEFORE = '-3 days';
export const NOTIF_AFTER = '1 day';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepo: Repository<CategoryEntity>,
    @InjectRepository(ChildEntity)
    private readonly childRepo: Repository<ChildEntity>,
    private readonly bondsRepo: BondsRepository,
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  private async verifyBondMembership(bondId: string, userId: string): Promise<void> {
    const bond = await this.bondsRepo.findActiveBondForMember(bondId, userId);
    if (!bond) {
      throw new ForbiddenException('You are not a member of this bond');
    }
  }

  private async verifyChildrenBelongToBond(bondId: string, childrenIds: string[]): Promise<void> {
    const children = await this.childRepo.find({
      where: { id: In(childrenIds), bondId },
    });
    if (children.length !== childrenIds.length) {
      throw new BadRequestException('One or more children do not belong to this bond');
    }
  }

  async create(bondId: string, dto: CreateActivityDto, userId: string): Promise<ActivityEntity> {
    await this.verifyBondMembership(bondId, userId);
    if (dto.assignedTo) {
      await this.verifyBondMembership(bondId, dto.assignedTo);
    }

    if (!dto.childrenIds || dto.childrenIds.length === 0) {
      throw new BadRequestException('childrenIds must contain at least one child');
    }
    if (new Set(dto.childrenIds).size !== dto.childrenIds.length) {
      throw new BadRequestException('childrenIds must not contain duplicates');
    }
    await this.verifyChildrenBelongToBond(bondId, dto.childrenIds);

    const category = await this.categoryRepo.findOneBy({ id: dto.categoryId, isActive: true });
    if (!category) {
      throw new BadRequestException('Category is unknown or inactive');
    }

    const start = new Date(dto.scheduledStart);
    if (start.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('scheduledStart must be in the future');
    }
    const end = dto.scheduledEnd ? new Date(dto.scheduledEnd) : null;
    if (end && end.getTime() <= start.getTime()) {
      throw new BadRequestException('scheduledEnd must be strictly after scheduledStart');
    }

    const assignedTo = dto.assignedTo ?? null;
    return this.dataSource.transaction(async (manager) => {
      const activityRepo = manager.getRepository(ActivityEntity);
      const activityChildRepo = manager.getRepository(ActivityChildEntity);
      const notifRepo = manager.getRepository(NotificationEntity);

      const savedActivity = await activityRepo.save(
        activityRepo.create({
          bondId,
          categoryId: dto.categoryId,
          type: dto.type ?? ActivityType.EVENT,
          status: assignedTo ? ActivityStatus.ASSIGNED : ActivityStatus.CREATED,
          criticality: category.criticality,
          title: dto.title,
          description: dto.description ?? '',
          createdBy: userId,
          assignedTo,
          scheduledStart: start,
          scheduledEnd: end,
          deadline: null,
          notifBefore: NOTIF_BEFORE,
          notifAfter: NOTIF_AFTER,
        }),
      );

      await activityChildRepo.save(
        dto.childrenIds.map((childId) =>
          activityChildRepo.create({
            activityId: savedActivity.id,
            childId,
          }),
        ),
      );

      if (assignedTo) {
        const notification = notifRepo.create({
          userId: assignedTo,
          bondId,
          type: 'activity_assigned',
          title: dto.title,
          body: `New activity assigned: ${dto.title}`,
          refEntityType: 'activity',
          refEntityId: savedActivity.id,
          isRead: false,
        });
        await notifRepo.save(notification);
      }

      return savedActivity;
    });
  }

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

    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
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

  async complete(id: string, userId: string): Promise<CompleteActivityResponseDto> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
    if (!bond) {
      throw new ForbiddenException('You are not a member of this bond');
    }
    const { status, completedAt } = await this.activitiesRepo.markCompleted(id, this.clock.now());
    return plainToInstance(
      CompleteActivityResponseDto,
      { id, status, completedAt },
      { excludeExtraneousValues: true },
    );
  }

  async confirmAssignment(
    id: string,
    userId: string,
  ): Promise<{ id: string; assignedConfirmed: boolean; confirmedAt: string | null }> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
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
      status: ActivityStatus.ASSISTING,
    } as any);

    return {
      id: activity.id,
      assignedConfirmed: true,
      confirmedAt: now.toISOString(),
    };
  }

  async declineAssignment(
    id: string,
    userId: string,
    reason?: string,
  ): Promise<{ id: string; status: ActivityStatus; declinedAt: string | null }> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
    if (!bond) {
      throw new NotFoundException('Bond not found or you are not a member');
    }
    if (activity.assignedTo !== userId) {
      throw new ForbiddenException('Only the assignee can decline this activity');
    }
    const now = new Date();
    await this.activitiesRepo.updateEntity(id, {
      status: ActivityStatus.NOT_ASSISTING,
      updatedAt: now,
    } as any);
    return {
      id: activity.id,
      status: ActivityStatus.NOT_ASSISTING,
      declinedAt: now.toISOString(),
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
