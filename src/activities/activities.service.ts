import {
  ForbiddenException,
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { ActivitiesRepository, ApplyTransitionFields } from './repositories/activities.repository';
import {
  resolveInitial,
  resolveTransition,
  TransitionSideEffects,
} from './activity-transition.map';
import { ActivityTimersProducer } from '../queues/activity-timers/activity-timers.producer';
import { TimerKind } from '../queues/activity-timers/activity-timers.constants';
import { timerOpsForTransition } from '../queues/activity-timers/activity-timers.ops';
import { ActivityChildRepository } from './repositories/activity-child.repository';
import { ActivityEntity, ActivityStatus, ActivityType } from './entities/activity.entity';
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
import { ActivityPolicyService, overdueOrigin } from './activity-policy.service';
import {
  activityForbidden,
  activityInvalidTransition,
  activityNotFound,
} from '../common/errors/coded.exception';
import { BondsService } from '../bonds/bonds.service';
import { BondAccessService } from '../bonds/bond-access.service';
import { ConfigService } from '@nestjs/config';

/** Who triggers a transition (design D3). */
export type TransitionActor = { kind: 'user'; userId: string } | { kind: 'system' };

export interface TransitionRequest {
  activityId: string;
  to: ActivityStatus;
  actor: TransitionActor;
  reason?: string | null;
  /** Extra column effects on top of the rule's side-effects (e.g. `deletedAt` for delete). */
  fields?: ApplyTransitionFields;
  /** Extra keys merged into the outbox payload (e.g. `{ deleted: true }`). */
  payloadExtra?: Record<string, unknown>;
}

export const NOTIF_BEFORE = '-3 days';
export const NOTIF_AFTER = '1 day';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    private readonly activityChildRepo: ActivityChildRepository,

    @Inject(forwardRef(() => BondsService))
    private readonly bondService: BondsService,

    // T3 · el chokepoint, para la regla de S7 que no es de membresía sino de propiedad
    // del grant: a un tercero temporal le asigna sólo el progenitor que lo autorizó.
    private readonly bondAccess: BondAccessService,

    private readonly childrenRepo: ChildrenRepository,
    private readonly categoriesRepo: CategoriesRepository,
    private readonly clock: Clock,
    private readonly policy: ActivityPolicyService,
    private readonly bondMembersRepo: BondMembersRepository,
    private readonly config: ConfigService,
    private readonly producer: ActivityTimersProducer,
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

  private async assertActivityMember(activity: ActivityEntity, userId: string): Promise<void> {
    const isMember = await this.bondService.isActiveBondForMember(activity.bondId, userId);
    if (!isMember) throw activityNotFound();
  }

  private async assertBondMember(bondId: string, userId: string): Promise<void> {
    const isMember = await this.bondService.isActiveBondForMember(bondId, userId);
    if (!isMember) throw new NotFoundException('Bond not found or you are not a member');
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

  /**
   * R16 · Minimum lead time for writes that change `scheduledStart`. Shared
   * between create and the future edit route: existing activities are never
   * re-validated.
   */
  private assertMinimumLeadTime(scheduledStart: string): void {
    const start = new Date(scheduledStart);
    const now = this.clock.now().getTime();
    const hours = this.config.get<number>('MIN_LEAD_TIME_HOURS') ?? 48;
    if (start.getTime() < now + hours * 60 * 60 * 1000) {
      throw new BadRequestException(
        'La actividad debe programarse con al menos 48 horas de anticipación',
      );
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

    await this.assertActivityMember(activity, userId);
    return activity;
  }

  /**
   * Single chokepoint for EVERY status change (REQ-TX-1/4, AC-1, design D3).
   *
   * Business layer only: the repository owns the transaction + outbox write via
   * `applyTransition`. A user CAS miss throws `409`; a stale SYSTEM request is a
   * no-op (`null`), because system timers must never surface a conflict.
   */
  async transition(req: TransitionRequest): Promise<ActivityEntity | null> {
    const actor = req.actor;
    const isSystem = actor.kind === 'system';
    const userId = actor.kind === 'user' ? actor.userId : null;

    const activity = await this.activitiesRepo.findById(req.activityId);
    if (!activity) {
      if (isSystem) return null;
      throw activityNotFound();
    }

    if (userId) {
      await this.assertActivityMember(activity, userId);
    }

    const now = this.clock.now();
    const rule = resolveTransition(activity.status, req.to);

    if (!rule) {
      // System timers never throw: an invalid/stale request is a silent no-op.
      if (isSystem) return activity;
      throw activityInvalidTransition(activity.status, req.to);
    }

    if (isSystem) {
      if (!rule.actors.includes('system')) return activity;
    } else {
      // A user must never trigger a system-only rule (T7/T10/T12/T14/T16).
      if (!rule.actors.includes('bond_member') && !rule.actors.includes('assignee')) {
        throw activityForbidden('This transition is system-only');
      }
      if (rule.requireAssignee && activity.assignedTo !== userId) {
        throw activityForbidden('Only the assignee can perform this action');
      }
    }

    // T8 origin guard: late acceptance/decline is only allowed when overdue
    // originated from `assigned`. The origin comes from `overdueOrigin()` — the
    // SAME function the policy uses, so the two cannot drift apart.
    if (rule.id === 'T8' && overdueOrigin(activity) !== 'assigned') {
      throw activityInvalidTransition(
        activity.status,
        req.to,
        'Late response is only allowed when overdue originated from assigned',
      );
    }

    const actorRole = userId ? await this.resolveActorRole(activity.bondId, userId) : null;

    const fields = this.buildTransitionFields(rule.sideEffects, {
      now,
      userId,
      reason: req.reason ?? null,
    });
    if (req.fields) Object.assign(fields, req.fields);

    const updated = await this.activitiesRepo.applyTransition({
      id: activity.id,
      expectedFrom: activity.status,
      expectedVersion: activity.version,
      nextStatus: req.to,
      fields,
      outbox: {
        bondId: activity.bondId,
        eventType: rule.event,
        payload: {
          activityId: activity.id,
          from: activity.status,
          to: req.to,
          actor: isSystem ? { type: 'system' } : { type: 'user', id: userId, role: actorRole },
          reason: req.reason ?? null,
          occurredAt: now.toISOString(),
          ...req.payloadExtra,
        },
      },
    });

    if (!updated) {
      if (isSystem) return null;
      throw activityInvalidTransition(activity.status, req.to);
    }

    // Post-commit timer wiring (REQ-TX-1, design D8): never throws.
    this.wireTimers(updated, activity.version);

    return updated;
  }

  /**
   * SYSTEM entry for the OVERDUE transition (T7/T14/T16). Called by the timer
   * processor and the reconciliation sweep (E9). A missing row is a 404; a
   * stale/invalid source state is a silent no-op (timers never surface a conflict).
   */
  async markOverdue(activityId: string): Promise<ActivityEntity | null> {
    const activity = await this.activitiesRepo.findById(activityId);
    if (!activity) throw new NotFoundException('Activity not found');

    return this.transition({
      activityId,
      to: ActivityStatus.OVERDUE,
      actor: { kind: 'system' },
    });
  }

  /**
   * SYSTEM dispatch shared by the timer processor and the reconciliation sweep
   * (design D9). Stale/404 tolerant: a vanished row or a state that no longer
   * matches the rule is a silent no-op — never throws into BullMQ.
   */
  async applySystemTransition(activityId: string, to: ActivityStatus): Promise<void> {
    try {
      await this.transition({ activityId, to, actor: { kind: 'system' } });
    } catch (error) {
      this.logger.warn(
        `System transition ${activityId} → ${to} no-op: ${(error as Error).message}`,
      );
    }
  }

  /** Bond-scoped actor role (REQ-ACTOR-1, design D2); `null` for system. */
  private async resolveActorRole(bondId: string, userId: string): Promise<string | null> {
    const member = await this.bondMembersRepo.findOneByBondAndUser(bondId, userId);
    return member?.role ?? null;
  }

  /** Materializes the rule's side-effects into concrete column values (design D3). */
  private buildTransitionFields(
    effects: TransitionSideEffects,
    ctx: { now: Date; userId: string | null; reason: string | null },
  ): ApplyTransitionFields {
    const fields: ApplyTransitionFields = {};

    if (effects.deadline === 'clear') {
      fields.deadline = null;
    } else if (effects.deadline === 'set') {
      fields.deadline = this.computeResponseDeadline(ctx.now);
    }

    if (effects.confirmedAt === true) {
      fields.confirmedAt = ctx.now;
    } else if (effects.confirmedAt === false) {
      fields.confirmedAt = null;
    }

    if (effects.completedAt === true) {
      fields.completedAt = ctx.now;
    }

    if (effects.cancelledAt === true) {
      fields.cancelledAt = ctx.now;
      if (ctx.userId) fields.cancelledBy = ctx.userId;
    }

    if (effects.declinedAt === true) {
      fields.declinedAt = ctx.now;
      if (ctx.reason != null) fields.declinedReason = ctx.reason;
    } else if (effects.declinedAt === false) {
      fields.declinedAt = null;
      fields.declinedReason = null;
    }

    if (effects.verifyAt === true) {
      fields.verifyAt = ctx.now;
    } else if (effects.verifyAt === false) {
      fields.verifyAt = null;
    }

    return fields;
  }

  /** `deadline = now + RESPONSE_TIMEOUT_HOURS` (default 36, REQ-MODEL-2/3). */
  private computeResponseDeadline(now: Date): Date {
    const hours = this.config.get<number>('RESPONSE_TIMEOUT_HOURS') ?? 36;
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }

  /**
   * Post-commit BullMQ wiring (design D8). `previousVersion` (null on create)
   * is the version the incoming state's timers were enqueued at: cancels must
   * target it because the deterministic jobId embeds the version.
   */
  private wireTimers(entity: ActivityEntity, previousVersion: number | null): void {
    const now = this.clock.now();
    for (const op of timerOpsForTransition(entity.status)) {
      if (op.action === 'cancel') {
        if (previousVersion == null) continue;
        this.fire(this.producer.cancel(op.kind, entity.id, previousVersion));
        continue;
      }
      const target = this.timerTarget(op.kind, entity);
      if (!target) continue;
      if (op.kind === TimerKind.START && target.getTime() <= now.getTime()) continue;
      this.fire(this.producer.enqueue(op.kind, entity.id, entity.version, target, now));
    }
  }

  /** Timer anchor per kind (decision 6 / REQ-TIMER-8). */
  private timerTarget(kind: TimerKind, entity: ActivityEntity): Date | null {
    switch (kind) {
      case TimerKind.RESPONSE_TIMEOUT:
        return entity.deadline;
      case TimerKind.START:
        return entity.scheduledStart;
      case TimerKind.END:
        return entity.scheduledEnd ?? entity.scheduledStart;
      case TimerKind.VERIFY_TIMEOUT:
        return entity.deadline;
      default:
        return null;
    }
  }

  /** Fire-and-forget: the producer already swallows Redis errors (B3). */
  private fire(p: Promise<unknown>): void {
    void p.catch(() => undefined);
  }

  async create(bondId: string, dto: CreateActivityDto, userId: string): Promise<ActivityEntity> {
    this.validateSchedules(dto.scheduledStart, dto.scheduledEnd);
    this.assertMinimumLeadTime(dto.scheduledStart);

    await this.assertBondMember(bondId, userId);

    const memberIds =
      dto.assignedTo && dto.assignedTo !== userId ? [userId, dto.assignedTo] : [userId];

    const memberships = await Promise.all(
      memberIds.map((id) => this.bondService.isActiveBondForMember(bondId, id)),
    );
    if (memberships.some((isMember) => !isMember)) {
      throw new BadRequestException('One or more members do not belong to this bond');
    }

    const [category] = await Promise.all([
      this.verifyCategoryActive(dto.categoryId),
      this.verifyChildrenBelongToBond(bondId, dto.childrenIds),
    ]);

    const assignedTo = dto.assignedTo ?? null;
    const initial = resolveInitial(assignedTo != null);
    const now = this.clock.now();

    const row = {
      bondId,
      categoryId: dto.categoryId,
      type: dto.type ?? ActivityType.EVENT,
      criticality: category.criticality,
      title: dto.title,
      description: dto.description ?? '',
      createdBy: userId,
      assignedTo,
      scheduledStart: new Date(dto.scheduledStart),
      scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
      // T1/T2 side-effect: the response window opens at create for both states.
      deadline: this.computeResponseDeadline(now),
      notifBefore: NOTIF_BEFORE,
      notifAfter: NOTIF_AFTER,
    };

    const activity = await this.activitiesRepo.transaction(async (manager) => {
      const created = await this.activitiesRepo.insertWithInitialTransition(
        {
          row,
          initial,
          payload: {
            from: 'new',
            to: initial.status,
            actor: { type: 'user', id: userId },
            occurredAt: now.toISOString(),
          },
        },
        manager,
      );

      await this.activityChildRepo.saveChildrenFor(created.id, dto.childrenIds, manager);

      return created;
    });

    // T2: post-commit, the initial `assigned` row enqueues rt+start+end (v1).
    this.wireTimers(activity, null);

    return activity;
  }

  async listByBond(bondId: string, viewerId: string): Promise<ActivitySummaryDto[]> {
    await this.assertBondMember(bondId, viewerId);

    const rows = await this.activitiesRepo.findByBondIdOrdered(bondId);
    const now = this.clock.now();
    // Una sola resolución por request: la lista entera comparte el rol del que mira.
    const viewer = { isThirdParty: await this.isThirdPartyViewer(bondId, viewerId) };
    return plainToInstance(
      ActivitySummaryDto,
      rows.map((row) => ({ ...row, ...this.policy.evaluate(row, viewerId, now, viewer) })),
      { excludeExtraneousValues: true, exposeUnsetFields: false },
    );
  }

  async getDetail(id: string, userId: string): Promise<ActivityDetailDto> {
    const activity = await this.activitiesRepo.findByIdWithChildren(id);
    if (!activity) throw activityNotFound();

    await this.assertActivityMember(activity, userId);

    const decision = this.policy.evaluate(activity, userId, this.clock.now(), {
      isThirdParty: await this.isThirdPartyViewer(activity.bondId, userId),
    });
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
    await this.assertActivityMember(activity, userId);

    // S13 / F2 de la propuesta — el cierre pasa por la POLÍTICA, no sólo por membresía.
    // Sin esto, esconder el botón en la UI no cambia nada: cualquiera con membresía podía
    // finalizar una actividad ajena con un POST directo.
    const decision = this.policy.evaluate(activity, userId, this.clock.now(), {
      isThirdParty: await this.isThirdPartyViewer(activity.bondId, userId),
    });
    // Un tercero (o el otro progenitor) recibe 403 aunque el estado permita cerrar. Si
    // ES el asignado y el estado no habilita, se deja pasar al `transition()`, que es
    // quien sabe responder 409 sin duplicar la máquina de estados acá.
    if (!decision.canComplete && activity.assignedTo !== userId) {
      throw activityForbidden('Only the assignee can complete this activity');
    }

    // T11 (cierre temprano desde `in_progress`) y T13 (cierre desde la ventana
    // de verificación). Cualquier otro origen —terminal incluido— es 409.
    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.DONE,
      actor: { kind: 'user', userId },
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.DONE);

    return plainToInstance(
      CompleteActivityResponseDto,
      {
        id: updated.id,
        status: updated.status,
        completedAt: updated.completedAt?.toISOString() ?? null,
      },
      { excludeExtraneousValues: true },
    );
  }

  async confirmAssignment(
    id: string,
    userId: string,
  ): Promise<{ id: string; assignedConfirmed: boolean; confirmedAt: string | null }> {
    const activity = await this.findById(id);

    await this.assertActivityMember(activity, userId);

    if (activity.assignedTo !== userId) {
      throw new ForbiddenException('Only the assignee can confirm this activity');
    }

    // T5 idempotency by STATUS, not the removed boolean (REQ-TRANS-3, design D5):
    // an already-confirmed activity succeeds without a new version/event.
    if (activity.status === ActivityStatus.ASSISTING) {
      return {
        id,
        assignedConfirmed: activity.confirmedAt != null,
        confirmedAt: activity.confirmedAt?.toISOString() ?? null,
      };
    }

    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.ASSISTING,
      actor: { kind: 'user', userId },
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.ASSISTING);

    return {
      id,
      assignedConfirmed: updated.status === ActivityStatus.ASSISTING && updated.confirmedAt != null,
      confirmedAt: updated.confirmedAt?.toISOString() ?? null,
    };
  }

  /**
   * ¿El que mira es un tercero temporal en este vínculo? (S8)
   *
   * Lo resuelve el chokepoint, que ya sabe de grants. Se llama una vez por request en la
   * lista y una vez por operación en el resto: no es un dato que se pueda adivinar desde
   * `systemRole`.
   */
  private async isThirdPartyViewer(bondId: string, viewerId: string): Promise<boolean> {
    const access = await this.bondAccess.resolveBondAccess(bondId, viewerId);
    return access?.isThirdParty === true;
  }

  async delete(id: string, userId: string): Promise<{ id: string; deletedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canDelete } = this.policy.evaluate(activity, userId, now, {
      isThirdParty: await this.isThirdPartyViewer(activity.bondId, userId),
    });
    if (!canDelete) throw activityForbidden(`You are not allowed to delete this activity`);

    // REQ-TRANS-4/AC-9: delete moves through T15 and soft-deletes in the SAME tx.
    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.CANCELLED,
      actor: { kind: 'user', userId },
      fields: { deletedAt: now },
      payloadExtra: { deleted: true },
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.CANCELLED);

    return { id, deletedAt: (updated.deletedAt ?? now).toISOString() };
  }

  async cancel(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; cancelledAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canCancel } = this.policy.evaluate(activity, userId, now, {
      isThirdParty: await this.isThirdPartyViewer(activity.bondId, userId),
    });
    if (!canCancel) throw activityForbidden(`You are not allowed to cancel this activity`);

    const reason = parseActivityReason(rawReason);

    // T15 with the policy.canCancel guard preserved (design D6).
    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.CANCELLED,
      actor: { kind: 'user', userId },
      reason,
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.CANCELLED);

    return {
      id,
      status: ActivityStatus.CANCELLED,
      cancelledAt: (updated.cancelledAt ?? now).toISOString(),
    };
  }

  async declineAssignment(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; declinedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    const now = this.clock.now();

    const { canDecline } = this.policy.evaluate(activity, userId, now, {
      isThirdParty: await this.isThirdPartyViewer(activity.bondId, userId),
    });
    if (!canDecline) throw activityForbidden(`You are not allowed to decline this activity`);

    const reason = parseActivityReason(rawReason);

    // T6 (`assigned`) / T8 (`overdue`) with the policy.canDecline guard preserved.
    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.NOT_ASSISTING,
      actor: { kind: 'user', userId },
      reason,
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.NOT_ASSISTING);

    return {
      id,
      status: ActivityStatus.NOT_ASSISTING,
      declinedAt: (updated.declinedAt ?? now).toISOString(),
    };
  }

  /**
   * T3 (`created` → `assigned`). Any bond member may assign the activity to
   * themselves or to another member. Membership validation is the service's job
   * (E5); the policy only reports the flag.
   *
   * The response is NARROW on purpose: this module answers the other actions with
   * `{ id, status, … }`, not with the row. Returning the entity would publish the
   * internal columns (`version`, `bondId`, `deletedAt`) that no client needs.
   */
  async assign(
    id: string,
    userId: string,
    assignedTo?: string,
  ): Promise<{ id: string; status: string; assignedTo: string | null }> {
    return this.reassignInternal(id, userId, assignedTo);
  }

  /**
   * T9 (`not_assisting` → `assigned`). Reassignment starts the new assignee from
   * a clean sheet: the transition clears `declined_at`/`confirmed_at`.
   */
  async reassign(
    id: string,
    userId: string,
    assignedTo?: string,
  ): Promise<{ id: string; status: string; assignedTo: string | null }> {
    return this.reassignInternal(id, userId, assignedTo);
  }

  private async reassignInternal(
    id: string,
    userId: string,
    assignedTo?: string,
  ): Promise<{ id: string; status: string; assignedTo: string | null }> {
    const activity = await this.loadForMember(id, userId);
    const targetId = assignedTo ?? userId;

    // A provided target must be an active bond member; 404 without revealing
    // whether that user exists at all (T21).
    if (assignedTo !== undefined) {
      const isMember = await this.bondService.isActiveBondForMember(activity.bondId, targetId);
      if (!isMember) throw activityNotFound();
      // S7: si el destino es un tercero temporal, sólo le asigna quien lo autorizó —
      // el otro progenitor del vínculo recibe 403 aunque sea miembro.
      await this.bondAccess.assertCanAssignTo(activity.bondId, userId, targetId);
    }

    const updated = await this.transition({
      activityId: id,
      to: ActivityStatus.ASSIGNED,
      actor: { kind: 'user', userId },
      fields: { assignedTo: targetId },
    });
    if (!updated) throw activityInvalidTransition(activity.status, ActivityStatus.ASSIGNED);

    return {
      id: updated.id,
      status: updated.status,
      assignedTo: updated.assignedTo ?? null,
    };
  }

  async getComplianceForBond(
    bondId: string,
    viewerId: string,
  ): Promise<{ period: string; members: ComplianceMemberRow[] }> {
    await this.assertBondMember(bondId, viewerId);

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
