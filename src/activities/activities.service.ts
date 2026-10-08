import {
  ForbiddenException,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { ActivitiesRepository } from './repositories/activities.repository';
import {
  ACTIVITY_AUDIT_ACTIONS,
  ActivitiesAuditRepository,
} from './repositories/activities-audit.repository';
import { ActivityChildRepository } from './repositories/activity-child.repository';
import { ActivityEntity, ActivityStatus, ActivityType } from './entities/activity.entity';
import { NotificationRepository } from '../notifications/repositories/notification.repository';
import { BondsRepository } from '../bonds/repositories/bonds.repository';
import { ChildrenRepository } from '../children/repositories/children.repository';
import { CategoriesRepository } from '../categories/repositories/categories.repository';
import { CreateActivityDto } from './dto/create-activity.dto';
import { ActivitySummaryDto, ActivityDetailDto } from './dto/activity-response.dto';
import { CompleteActivityResponseDto } from './dto/complete-activity-response.dto';
import { validateActivityReason } from './dto/activity-reason.validator';
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
    private readonly activityChildRepo: ActivityChildRepository,
    private readonly notificationRepo: NotificationRepository,
    private readonly auditRepo: ActivitiesAuditRepository,
    private readonly bondsRepo: BondsRepository,
    private readonly childrenRepo: ChildrenRepository,
    private readonly categoriesRepo: CategoriesRepository,
    private readonly clock: Clock,
    private readonly policy: ActivityPolicyService,
  ) {}

  private async verifyBondMembership(bondId: string, userId: string): Promise<void> {
    const bond = await this.bondsRepo.findActiveBondForMember(bondId, userId);
    if (!bond) {
      throw new ForbiddenException('You are not a member of this bond');
    }
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

  async create(bondId: string, dto: CreateActivityDto, userId: string): Promise<ActivityEntity> {
    this.validateSchedules(dto.scheduledStart, dto.scheduledEnd);

    const [, , , category] = await Promise.all([
      this.verifyBondMembership(bondId, userId),
      dto.assignedTo ? this.verifyBondMembership(bondId, dto.assignedTo) : Promise.resolve(),
      this.verifyChildrenBelongToBond(bondId, dto.childrenIds),
      this.verifyCategoryActive(dto.categoryId),
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

  /**
   * Lista del vínculo, con los `can_*` calculados PARA ESTE VISOR (R1).
   *
   * `viewerId` es obligatorio: sin él los flags no se pueden calcular, y el
   * llamador (el controlador) ya ha comprobado la membresía.
   */
  async listByBond(bondId: string, viewerId: string): Promise<ActivitySummaryDto[]> {
    const rows = await this.activitiesRepo.findByBondIdOrdered(bondId);
    const now = this.clock.now();
    return rows.map((row) =>
      plainToInstance(
        ActivitySummaryDto,
        {
          ...row,
          childrenIds: (row as any).childrenIds ?? [],
          ...this.policy.evaluate(row, viewerId, now),
        },
        {
          excludeExtraneousValues: true,
        },
      ),
    );
  }

  /**
   * Returns the detail DTO for an activity. 404 when the activity does not
   * exist or the caller is not an active member of the activity's bond.
   *
   * 🔴 A3 · `declinedReason` se expone a CUALQUIER miembro del vínculo, ya no sólo
   * al creador. Lo que impide el cruce entre vínculos es ESTE chequeo de
   * membresía, que va antes de construir el DTO: un no-miembro recibe 404 y nunca
   * llega a leer el motivo. No hay ninguna rama aguas arriba que pueda filtrarlo.
   */
  async getDetail(id: string, userId: string): Promise<ActivityDetailDto> {
    const activity = await this.activitiesRepo.findById(id);
    if (!activity) {
      throw activityNotFound();
    }

    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
    if (!bond) {
      throw activityNotFound('Bond not found or you are not a member');
    }

    const decision = this.policy.evaluate(activity, userId, this.clock.now());
    return plainToInstance(
      ActivityDetailDto,
      {
        ...activity,
        ...decision,
        // A3 · se devuelve el valor tal cual. Se normaliza a `null` para que el
        // contrato sea exacto cuando nadie ha declinado.
        declinedReason: activity.declinedReason ?? null,
      },
      { excludeExtraneousValues: true },
    );
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

  // ── Acciones de swipe (R4–R8, R11) ───────────────────────────────────────
  //
  // Orden de comprobación, IGUAL en las cinco mutaciones y deliberado:
  //   404 (no existe / no es miembro) → 403 (miembro, pero no es el actor
  //   que puede hacer esto) → 409 (ya pasó) → 409 (ventana de deshacer cerrada)
  //   → 422 (motivo).
  // Va en ese orden porque es el que NO filtra existencia: un intruso recibe el
  // mismo 404 que un id inexistente, y sólo quien ya es miembro activo del
  // vínculo llega a descubrir que la actividad existe y que le falta el rol.
  // El motivo va el ÚLTIMO a propósito, pese a ser el más barato de validar:
  // validating it primero respondería 422 a quien no tiene ni derecho a saber.

  /**
   * Carga la actividad exigiendo que el llamador sea miembro ACTIVO del vínculo.
   * Un no-miembro recibe el mismo 404 que un id inexistente: no se revela que la
   * actividad existe.
   */
  private async loadForMember(
    id: string,
    userId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<ActivityEntity> {
    const activity = options.includeDeleted
      ? await this.activitiesRepo.findByIdIncludingDeleted(id)
      : await this.activitiesRepo.findById(id);
    if (!activity) {
      throw activityNotFound();
    }
    const bond = await this.bondsRepo.findActiveBondForMember(activity.bondId, userId);
    if (!bond) {
      throw activityNotFound('Bond not found or you are not a member');
    }
    return activity;
  }

  /** Exige rol de creador (Eliminar / Cancelar) o de asignado (No asistir). */
  private assertRole(activity: ActivityEntity, userId: string, role: 'creator' | 'assignee') {
    if (role === 'creator') {
      if (activity.createdBy !== userId) {
        throw activityForbidden('Only the creator can delete or cancel this activity');
      }
      return;
    }
    if (activity.assignedTo !== userId) {
      throw activityForbidden('Only the assignee can decline this activity');
    }
  }

  /** Exige que la actividad no haya terminado. Una en curso la deja pasar. */
  private assertNotPast(activity: ActivityEntity, now: Date) {
    if (this.policy.isPast(activity, now)) {
      throw activityAlreadyPast();
    }
  }

  /**
   * DELETE /activities/:id — "Eliminar".
   *
   * A4 · Soft delete PURO: se escribe `deleted_at` y NADA MÁS. No hay borrado en
   * cascada, ni purga, ni ventana de retención; la fila persiste con la bandera
   * puesta y el audit la deja trazable (R11). Inmediatamente deja de aparecer en
   * las cuatro consultas que filtran `deleted_at IS NULL`.
   */
  async delete(id: string, userId: string): Promise<{ id: string; deletedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    this.assertRole(activity, userId, 'creator');
    const now = this.clock.now();
    this.assertNotPast(activity, now);

    return this.activitiesRepo.transaction(async (manager) => {
      await this.activitiesRepo.updateFields(id, { deletedAt: now }, manager);
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: id,
          action: ACTIVITY_AUDIT_ACTIONS.DELETE,
          oldValue: { deletedAt: null },
          newValue: { deletedAt: now.toISOString() },
          detail: `Deleted by creator; undo available for 5000 ms`,
        },
        manager,
      );
      return { id, deletedAt: now.toISOString() };
    });
  }

  /**
   * POST /activities/:id/restore — deshacer "Eliminar" (ventana de 5000 ms).
   *
   * La ventana la decide el RELOJ DEL SERVIDOR, no el temporizador del cliente: si
   * la app muere a mitad de ventana, el borrado se sostiene (comportamiento
   * aceptado, D1). Por eso se lee `deleted_at` con
   * `findByIdIncludingDeleted` — la fila ya está oculta para las rutas de usuario.
   *
   * ⚠ NO se aplica la guarda de "ya pasada": el borrado exigía que no lo estuviera,
   * así que aplicar la guarda aquí convertiría "borré y no me deja deshacer" en un
   * fallo raro y sin explicación si la hora de fin cruzaba los 5 segundos.
   *
   * Idempotente: restaurar lo que no está eliminado devuelve 200 sin escribir
   * nada. Un doble toque en "Deshacer" no debe ensuciar el audit.
   */
  async restore(id: string, userId: string): Promise<{ id: string; deletedAt: string | null }> {
    const activity = await this.loadForMember(id, userId, { includeDeleted: true });
    this.assertRole(activity, userId, 'creator');
    const now = this.clock.now();

    if (activity.deletedAt === null) {
      return { id, deletedAt: null };
    }
    if (!this.policy.isWithinUndoWindow(activity.deletedAt, now)) {
      throw undoWindowExpired('restore');
    }

    return this.activitiesRepo.transaction(async (manager) => {
      await this.activitiesRepo.updateFields(id, { deletedAt: null }, manager);
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: id,
          action: ACTIVITY_AUDIT_ACTIONS.RESTORE,
          oldValue: { deletedAt: activity.deletedAt?.toISOString() ?? null },
          newValue: { deletedAt: null },
          detail: `Undo of delete within the 5000 ms window`,
        },
        manager,
      );
      return { id, deletedAt: null };
    });
  }

  /**
   * POST /activities/:id/cancel — "Cancelar".
   *
   * A1 · El motivo es OBLIGATORIO y usa el mismo validador 3–200 que "No asistir"
   * (`validateActivityReason`). Válido a posteriori, con 422 codificado.
   *
   * El motivo NO tiene columna propia: el design §6 no incluye `cancel_reason` en
   * la DDL de la migración, así que se registra en `audit_log` (`detail` legible +
   * `new_value` consultable), que es donde R9 pide los eventos con su motivo. Si
   * alguna vez hay que LEERLO de vuelta en la UI, hará falta una columna; hoy no
   * hay ninguna superficie que lo lea.
   */
  async cancel(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; cancelledAt: string }> {
    const activity = await this.loadForMember(id, userId);
    this.assertRole(activity, userId, 'creator');
    const now = this.clock.now();
    this.assertNotPast(activity, now);

    const reason = validateActivityReason(rawReason);
    if (!reason.ok) {
      throw validationFailed(reason.message, { field: 'reason', reason: reason.reason });
    }

    return this.activitiesRepo.transaction(async (manager) => {
      await this.activitiesRepo.updateFields(
        id,
        {
          status: ActivityStatus.CANCELLED,
          cancelledAt: now,
          cancelledBy: userId,
          updatedAt: now,
        },
        manager,
      );
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: id,
          action: ACTIVITY_AUDIT_ACTIONS.CANCEL,
          oldValue: { status: activity.status },
          newValue: {
            status: ActivityStatus.CANCELLED,
            cancelledAt: now.toISOString(),
            cancelledBy: userId,
          },
          detail: reason.value,
        },
        manager,
      );
      // R10 · Se avisa al asignado; al creador no, que ya lo sabe.
      if (activity.assignedTo && activity.assignedTo !== userId) {
        await this.notificationRepo.createForActivity(
          {
            userId: activity.assignedTo,
            bondId: activity.bondId,
            type: 'activity_cancelled',
            title: activity.title,
            body: `La actividad "${activity.title}" fue cancelada. Motivo: ${reason.value}`,
            refEntityId: id,
          },
          manager,
        );
      }
      return { id, status: ActivityStatus.CANCELLED, cancelledAt: now.toISOString() };
    });
  }

  /**
   * POST /activities/:id/decline — "No asistir", con el motivo ahora obligatorio.
   *
   * Endurece el endpoint preexistente, que aceptaba el motivo opcional y no lo
   * guardaba: ahora persiste `declined_at` + `declined_reason`, valida 3–200,
   * bloquea si la actividad ya pasó y usa `this.clock.now()` (antes llamaba a
   * `new Date()`, con lo que la guarda de tiempo no era testeable).
   *
   * El estado previo se guarda en el audit (`old_value.status`) porque `undo-decline`
   * necesita devolverlo y no hay columna para ello.
   */
  async declineAssignment(
    id: string,
    userId: string,
    rawReason: unknown,
  ): Promise<{ id: string; status: ActivityStatus; declinedAt: string }> {
    const activity = await this.loadForMember(id, userId);
    this.assertRole(activity, userId, 'assignee');
    const now = this.clock.now();
    this.assertNotPast(activity, now);

    const reason = validateActivityReason(rawReason);
    if (!reason.ok) {
      throw validationFailed(reason.message, { field: 'reason', reason: reason.reason });
    }

    return this.activitiesRepo.transaction(async (manager) => {
      await this.activitiesRepo.updateFields(
        id,
        {
          status: ActivityStatus.NOT_ASSISTING,
          declinedAt: now,
          declinedReason: reason.value,
          updatedAt: now,
        },
        manager,
      );
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: id,
          action: ACTIVITY_AUDIT_ACTIONS.DECLINE,
          // 🔴 El estado previo viaja aquí: es lo que permite deshacer sin columna extra.
          oldValue: { status: activity.status },
          newValue: {
            status: ActivityStatus.NOT_ASSISTING,
            declinedAt: now.toISOString(),
            declinedReason: reason.value,
          },
          detail: reason.value,
        },
        manager,
      );
      // R10 · Al creador, CON el motivo. La audiencia de esta notificación sigue
      // siendo el creador: A3 cambió la VISIBILIDAD del motivo en el DTO (toda la
      // actividad del vínculo), no la destinataria del aviso, que quedó sin ruling.
      if (activity.createdBy !== userId) {
        await this.notificationRepo.createForActivity(
          {
            userId: activity.createdBy,
            bondId: activity.bondId,
            type: 'activity_declined',
            title: activity.title,
            body: `La actividad "${activity.title}" se marcó como "No asisto". Motivo: ${reason.value}`,
            refEntityId: id,
          },
          manager,
        );
      }
      return { id, status: ActivityStatus.NOT_ASSISTING, declinedAt: now.toISOString() };
    });
  }

  /**
   * POST /activities/:id/undo-decline — deshacer "No asistir" (5000 ms).
   *
   * Devuelve el estado previo leyéndolo del audit, no de una columna. La ventana
   * se mide contra `declined_at`, con el reloj del servidor, igual que en
   * `restore`.
   *
   * ⚠ Sin guarda de "ya pasada", por el mismo motivo que en `restore`.
   */
  async undoDecline(id: string, userId: string): Promise<{ id: string; status: ActivityStatus }> {
    const activity = await this.loadForMember(id, userId);
    this.assertRole(activity, userId, 'assignee');
    const now = this.clock.now();

    // Idempotente: no hay declinación que deshacer.
    if (activity.declinedAt === null) {
      return { id, status: activity.status };
    }
    if (!this.policy.isWithinUndoWindow(activity.declinedAt, now)) {
      throw undoWindowExpired('undo-decline');
    }

    const previous = await this.auditRepo.findLatestOldValue(id, ACTIVITY_AUDIT_ACTIONS.DECLINE);
    const previousStatus = previous?.status as ActivityStatus | undefined;

    // Sin estado previo recuperable no hay nada fiable que restaurar. Es
    // inalcanzable en la práctica porque `declineAssignment` escribe el audit en la
    // MISMA transacción que el `declined_at`; se deja explícito para que un estado
    // corrupto devuelva la actividad tal cual en vez de inventar un estado.
    if (!previousStatus) {
      return { id, status: activity.status };
    }

    return this.activitiesRepo.transaction(async (manager) => {
      await this.activitiesRepo.updateFields(
        id,
        {
          status: previousStatus,
          declinedAt: null,
          declinedReason: null,
          updatedAt: now,
        },
        manager,
      );
      await this.auditRepo.record(
        {
          bondId: activity.bondId,
          userId,
          entityId: id,
          action: ACTIVITY_AUDIT_ACTIONS.UNDO_DECLINE,
          oldValue: {
            status: ActivityStatus.NOT_ASSISTING,
            declinedAt: activity.declinedAt?.toISOString() ?? null,
          },
          newValue: { status: previousStatus, declinedAt: null, declinedReason: null },
          detail: `Undo of decline within the 5000 ms window`,
        },
        manager,
      );
      return { id, status: previousStatus };
    });
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
