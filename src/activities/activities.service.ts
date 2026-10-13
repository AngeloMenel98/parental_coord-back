import {
  ForbiddenException,
  Injectable,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { ActivitiesRepository } from './repositories/activities.repository';
import { ActivityChildRepository } from './repositories/activity-child.repository';
import { ActivityEntity, ActivityStatus, ActivityType } from './entities/activity.entity';
import { NotificationRepository } from '../notifications/repositories/notification.repository';
import {
  BondMembersRepository,
  ComplianceMemberRow,
} from '../bonds/repositories/bond-members.repository';
import { ChildrenRepository } from '../children/repositories/children.repository';
import { CategoriesRepository } from '../categories/repositories/categories.repository';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivitySummaryDto, ActivityDetailDto } from './dto/activity-response.dto';
import { CompleteActivityResponseDto } from './dto/complete-activity-response.dto';
import { parseActivityReason } from './dto/activity-reason.validator';
import { CategoryEntity } from '../categories/entities/category.entity';
import { Clock } from '../common/clock/clock';
import { ActivityPolicyService } from './activity-policy.service';
import {
  activityAlreadyPast,
  activityForbidden,
  activityNotFound,
  undoWindowExpired,
  validationFailed,
} from '../common/errors/coded.exception';
import { BondsService } from '../bonds/bonds.service';

export const NOTIF_BEFORE = '-3 days';
export const NOTIF_AFTER = '1 day';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    private readonly activityChildRepo: ActivityChildRepository,
    private readonly notificationRepo: NotificationRepository,

    @Inject(forwardRef(() => BondsService))
    private readonly bondService: BondsService,

    private readonly childrenRepo: ChildrenRepository,
    private readonly categoriesRepo: CategoriesRepository,
    private readonly clock: Clock,
    private readonly policy: ActivityPolicyService,
    private readonly bondMembersRepo: BondMembersRepository,
  ) {}

  private async findById(id: string) {
    const activity = await this.activitiesRepo.findById(id);

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    return activity;
  }

  private async verifyChildrenBelongToBond(bondId: string, childrenIds: string[]): Promise<void> {
    const children = await this.childrenRepo.findByIdsAndBond(childrenIds, bondId);
    if (children.length !== childrenIds.length) {
      throw new BadRequestException('One or more children do not belong to this bond');
    }
  }

  private async verifyCategoryActive(categoryId: string): Promise<CategoryEntity> {
    const category = await this.categoriesRepo.findActiveById(categoryId);
    if (!category) {
      throw new BadRequestException('Category is unknown or inactive');
    }
    return category;
  }

  private validateSchedules(scheduledStart: string, scheduledEnd?: string): void {
    const start = new Date(scheduledStart);
    if (start.getTime() <= this.clock.now().getTime()) {
      throw new BadRequestException('scheduledStart must be in the future');
    }

    if (scheduledEnd) {
      const end = new Date(scheduledEnd);
      if (end.getTime() <= start.getTime()) {
        throw new BadRequestException('scheduledEnd must be strictly after scheduledStart');
      }
    }
  }

  private async loadForMember(
    id: string,
    userId: string,
    includeDeleted = false,
  ): Promise<ActivityEntity> {
    const activity = await (includeDeleted
      ? this.activitiesRepo.findByIdIncludingDeleted(id)
      : this.activitiesRepo.findById(id));
    if (!activity) throw activityNotFound();

    await this.bondService.isActiveBondForMember(activity.bondId, userId);
    return activity;
  }

  async create(bondId: string, dto: CreateActivityDto, userId: string): Promise<ActivityEntity> {
    this.validateSchedules(dto.scheduledStart, dto.scheduledEnd);

    const memberIds =
      dto.assignedTo && dto.assignedTo !== userId ? [userId, dto.assignedTo] : [userId];

    const [category] = await Promise.all([
      this.verifyCategoryActive(dto.categoryId),
      this.verifyChildrenBelongToBond(bondId, dto.childrenIds),
      ...memberIds.map((id) => this.bondService.isActiveBondForMember(bondId, id)),
    ]);

    const assignedTo = dto.assignedTo ?? null;
    return this.activitiesRepo.transaction(async (manager) => {
      const activity = await this.activitiesRepo.createInTx(
        {
          bondId,
          categoryId: dto.categoryId,
          type: dto.type ?? ActivityType.EVENT,
          status: assignedTo ? ActivityStatus.ASSIGNED : ActivityStatus.CREATED,
          criticality: category.criticality,
          title: dto.title,
          description: dto.description ?? '',
          createdBy: userId,
          assignedTo,
          scheduledStart: dto.scheduledStart,
          scheduledEnd: dto.scheduledEnd,
          deadline: null,
          notifBefore: NOTIF_BEFORE,
          notifAfter: NOTIF_AFTER,
        },
        manager,
      );

      await this.activityChildRepo.saveChildrenFor(activity.id, dto.childrenIds, manager);

      if (assignedTo) {
        await this.notificationRepo.createForActivity(
          {
            userId: assignedTo,
            bondId,
            type: 'activity_assigned',
            title: dto.title,
            body: `New activity assigned: ${dto.title}`,
            refEntityId: activity.id,
          },
          manager,
        );
      }

      return activity;
    });
  }

  async listByBond(bondId: string, viewerId: string): Promise<ActivitySummaryDto[]> {
    await this.bondService.isActiveBondForMember(bondId, viewerId);

    const rows = await this.activitiesRepo.findByBondIdOrdered(bondId);
    const now = this.clock.now();
    return plainToInstance(
      ActivitySummaryDto,
      rows.map((row) => ({ ...row, ...this.policy.evaluate(row, viewerId, now) })),
      { excludeExtraneousValues: true, exposeUnsetFields: false },
    );
  }

  async getDetail(id: string, userId: string): Promise<ActivityDetailDto> {
    const activity = await this.findById(id);

    await this.bondService.isActiveBondForMember(activity.bondId, userId);

    const decision = this.policy.evaluate(activity, userId, this.clock.now());
    return plainToInstance(
      ActivityDetailDto,
      {
        ...activity,
        ...decision,
        declinedReason: activity.declinedReason ?? null,
      },
      { excludeExtraneousValues: true },
    );
  }

  async complete(id: string, userId: string): Promise<CompleteActivityResponseDto> {
    const activity = await this.findById(id);
    await this.bondService.isActiveBondForMember(activity.bondId, userId);

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
    const activity = await this.findById(id);

    await this.bondService.isActiveBondForMember(activity.bondId, userId);

    if (activity.assignedTo !== userId) {
      throw new ForbiddenException('Only the assignee can confirm this activity');
    }

    let confirmedAt = activity.confirmedAt;
    if (!activity.assignedConfirmed) {
      confirmedAt = new Date();
      await this.activitiesRepo.updateEntity(id, {
        assignedConfirmed: true,
        confirmedAt,
        status: ActivityStatus.ASSISTING,
      } as any);
    }

    return { id, assignedConfirmed: true, confirmedAt: confirmedAt?.toISOString() ?? null };
  }

  async delete(id: string, userId: string): Promise<{ id: string; deletedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canDelete } = this.policy.evaluate(activity, userId, now);
    if (!canDelete) throw activityForbidden(`You are not allowed to delete this activity`);

    await this.activitiesRepo.softDeleteWithAudit(activity, userId, now);
    return { id, deletedAt: now.toISOString() };
  }

  async cancel(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; cancelledAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canCancel } = this.policy.evaluate(activity, userId, now);
    if (!canCancel) throw activityForbidden(`You are not allowed to cancel this activity`);

    const reason = parseActivityReason(rawReason);

    await this.activitiesRepo.cancelWithAudit(activity, userId, now, reason);
    return { id, status: ActivityStatus.CANCELLED, cancelledAt: now.toISOString() };
  }

  async declineAssignment(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; declinedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canDecline } = this.policy.evaluate(activity, userId, now);
    if (!canDecline) throw activityForbidden(`You are not allowed to decline this activity`);

    const reason = parseActivityReason(rawReason);

    await this.activitiesRepo.cancelWithAudit(activity, userId, now, reason);
    return { id, status: ActivityStatus.NOT_ASSISTING, declinedAt: now.toISOString() };
  }

  async getComplianceForBond(
    bondId: string,
    viewerId: string,
  ): Promise<{ period: string; members: ComplianceMemberRow[] }> {
    await this.bondService.isActiveBondForMember(bondId, viewerId);

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 1); // exclusivo
    const period = `${year}-${String(month + 1).padStart(2, '0')}`;

    const rows = await this.bondMembersRepo.findActiveMembersWithActStats(bondId, from, to);

    const members = rows.map((r) => ({
      ...r,
      percentage: r.total > 0 ? Math.round((r.completed / r.total) * 1000) / 10 : 0,
    }));

    return { period, members };
  }
}
