import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BondMembersRepository } from '../bonds/repositories/bond-members.repository';
import { BondsService } from '../bonds/bonds.service';
import { CategoriesRepository } from '../categories/repositories/categories.repository';
import { Clock } from '../common/clock/clock';
import { OutboxEventRepository } from '../outbox/repositories/outbox-event.repository';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpenseResponseDto } from './dto/expense-response.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ListExpensesQueryDto } from './dto/list-expenses-query.dto';
import { PaginatedExpensesDto } from './dto/paginated-expenses.dto';
import { ExpenseSummaryDto } from './dto/expense-summary.dto';
import { ExpenseEntity, ExpenseStatus } from './entities/expense.entity';
import { selectCounterpartId } from './expense-counterpart';
import {
  EXPENSE_EVENT,
  EXPENSE_STATUS_EVENT,
  ExpenseEventType,
  expenseAggregateVersion,
} from './expense-events';
import {
  ExpensePolicyDecision,
  ExpensePolicyService,
  ExpensePolicySubject,
} from './expense-policy.service';
import {
  EXPENSE_AUDIT_ACTIONS,
  ExpensesAuditRepository,
} from './repositories/expenses-audit.repository';
import {
  ExpenseEditableFields,
  ExpensesRepository,
  ExpenseTransitionFields,
} from './repositories/expenses.repository';

/** §5.3 · el reparto default es 50/50. */
const DEFAULT_SPLIT_PAYER = 50;

/** FR-11 · "sólo el solicitante" — el mensaje no revela quién sí puede. */
const EDIT_DENIED = 'You are not allowed to edit this expense';
const CANCEL_DENIED = 'You are not allowed to cancel this expense';
const APPROVE_DENIED = 'You are not allowed to approve this expense';
const REJECT_DENIED = 'You are not allowed to reject this expense';
const PAY_DENIED = 'You are not allowed to mark this expense as paid';

const CONFLICT = 'The expense changed before your action could be applied';

type ExpenseTransactionManager = Parameters<Parameters<ExpensesRepository['transaction']>[0]>[0];

/**
 * T24 · La API de escritura de gastos.
 *
 * Reparto de responsabilidades, igual que en actividades:
 *   · `ExpensePolicyService` decide QUIÉN puede (puro, sin base).
 *   · `ExpensesRepository` hace compare-and-swap y filtra borrados.
 *   · Este servicio es el único que abre transacciones, porque es el único que
 *     conoce el caso de uso: gasto + audit tienen que confirmarse juntos.
 *
 * Los errores son excepciones estándar de Nest y NO `CodedException`: ese
 * contrato de códigos (`ACTIVITY_ERROR_CODES`) es del swipe de actividades y su
 * unión de tipos es cerrada. Los clientes de gastos no necesitan adivinar por
 * código — la respuesta trae la decisión de la política, así que la UI ya sabe
 * qué puede hacer antes de intentarlo.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly expensesRepo: ExpensesRepository,
    private readonly bondsService: BondsService,
    private readonly bondMembersRepo: BondMembersRepository,
    private readonly categoriesRepo: CategoriesRepository,
    private readonly policy: ExpensePolicyService,
    private readonly audit: ExpensesAuditRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxEventRepository,
  ) {}

  // ── Alta (FR-8) ───────────────────────────────────────────────────────────

  async create(
    bondId: string,
    dto: CreateExpenseDto,
    viewerId: string,
  ): Promise<ExpenseResponseDto> {
    await this.assertBondMember(bondId, viewerId);

    const category = await this.verifyCategoryActive(dto.categoryId);
    const expenseDate = this.parseExpenseDate(dto.expenseDate);
    const { payer, other } = this.splitRatios(dto.splitRatioPayer);

    const saved = await this.expensesRepo.transaction(async (manager) => {
      const row = await this.expensesRepo.insertWithManager(
        {
          bondId,
          requestedBy: viewerId,
          categoryId: dto.categoryId,
          concept: dto.concept,
          description: dto.description ?? null,
          amount: dto.amount,
          expenseDate,
          splitRatioPayer: payer,
          splitRatioOther: other,
          status: ExpenseStatus.PENDING,
        },
        manager,
      );

      await this.audit.record(
        {
          bondId,
          userId: viewerId,
          expenseId: row.id,
          action: EXPENSE_AUDIT_ACTIONS.CREATE,
          newValue: { status: ExpenseStatus.PENDING },
        },
        manager,
      );

      // R8: el aviso viaja por el MISMO outbox que las actividades, en la MISMA
      // transacción que el gasto. Si el INSERT falla, no queda ni gasto ni
      // evento; si la transacción se cae después, tampoco.
      await this.emitExpenseEvent(manager, {
        eventType: EXPENSE_EVENT.CREATED,
        expense: row,
        status: ExpenseStatus.PENDING,
        actorId: viewerId,
      });

      return row;
    });

    const counterpartId = await this.counterpartOf(bondId, saved.requestedBy);
    const decision = this.policy.evaluate(
      { status: saved.status, requestedBy: saved.requestedBy, counterpartId },
      viewerId,
    );

    const names = await this.bondMembersRepo.findMemberNames(bondId);
    return this.toResponse(saved, decision, counterpartId, names, category.name);
  }

  // ── Lectura ───────────────────────────────────────────────────────────────

  async getDetail(id: string, viewerId: string): Promise<ExpenseResponseDto> {
    const { expense, counterpartId, decision, names } = await this.loadForViewer(id, viewerId);
    return this.toResponse(expense, decision, counterpartId, names);
  }

  async listForBond(
    bondId: string,
    viewerId: string,
    query: ListExpensesQueryDto,
  ): Promise<PaginatedExpensesDto> {
    await this.assertBondMember(bondId, viewerId);

    const { items, total, limit, offset } = await this.expensesRepo.listForBond(bondId, {
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      status: query.status,
      categoryId: query.categoryId,
      from: query.from,
      to: query.to,
    });

    // La lista de miembros del vínculo se resuelve UNA vez por página: la
    // contraparte de cada gasto sale de ese mismo conjunto. Preguntarlo por
    // gasto sería un N+1 con una consulta idéntica por fila.
    const memberIds = await this.bondMembersRepo.findActiveMemberIds(bondId);
    // Los NOMBRES salen de UNA consulta por página, igual que los ids: preguntar el
    // nombre por gasto sería un N+1 con la misma consulta por fila.
    const names = await this.bondMembersRepo.findMemberNames(bondId);
    const mapped = items.map((expense) => {
      const counterpartId = selectCounterpartId(memberIds, expense.requestedBy);
      const decision = this.policy.evaluate(
        { status: expense.status, requestedBy: expense.requestedBy, counterpartId },
        viewerId,
      );
      return this.toResponse(expense, decision, counterpartId, names);
    });

    return { items: mapped, total, limit, offset };
  }

  async summaryForBond(bondId: string, viewerId: string): Promise<ExpenseSummaryDto> {
    await this.assertBondMember(bondId, viewerId);
    return this.expensesRepo.summaryForBond(bondId, viewerId);
  }

  // ── Edición y cancelación (FR-11) ─────────────────────────────────────────

  async update(id: string, dto: UpdateExpenseDto, viewerId: string): Promise<ExpenseResponseDto> {
    const { expense, decision } = await this.loadForViewer(id, viewerId);
    if (!decision.canEdit) throw new ForbiddenException(EDIT_DENIED);

    const patch = this.buildPatch(dto);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    if (patch.categoryId !== undefined) await this.verifyCategoryActive(patch.categoryId);
    if (patch.expenseDate !== undefined) this.parseExpenseDate(patch.expenseDate);

    const applied = await this.expensesRepo.transaction(async (manager) => {
      const ok = await this.expensesRepo.editFields({
        id,
        expectedStatus: expense.status,
        patch,
        manager,
      });
      if (!ok) return false;

      await this.audit.record(
        {
          bondId: expense.bondId,
          userId: viewerId,
          expenseId: id,
          action: EXPENSE_AUDIT_ACTIONS.UPDATE,
          oldValue: {
            concept: expense.concept,
            amount: expense.amount,
            categoryId: expense.categoryId,
            expenseDate: expense.expenseDate,
          },
          newValue: patch as Record<string, unknown>,
        },
        manager,
      );

      return true;
    });

    if (!applied) throw new ConflictException(CONFLICT);

    return this.getDetail(id, viewerId);
  }

  async cancel(id: string, viewerId: string): Promise<{ id: string; deletedAt: string }> {
    const { expense, decision } = await this.loadForViewer(id, viewerId);
    if (!decision.canCancel) throw new ForbiddenException(CANCEL_DENIED);

    const at = this.clock.now();

    const applied = await this.expensesRepo.transaction(async (manager) => {
      const ok = await this.expensesRepo.markDeleted({
        id,
        expectedStatus: expense.status,
        at,
        manager,
      });
      if (!ok) return false;

      await this.audit.record(
        {
          bondId: expense.bondId,
          userId: viewerId,
          expenseId: id,
          action: EXPENSE_AUDIT_ACTIONS.DELETE,
          oldValue: { status: expense.status },
          newValue: { deletedAt: at.toISOString() },
        },
        manager,
      );

      return true;
    });

    if (!applied) throw new ConflictException(CONFLICT);

    return { id, deletedAt: at.toISOString() };
  }

  // ── Transiciones (FR-10) ──────────────────────────────────────────────────

  async approve(id: string, viewerId: string): Promise<ExpenseResponseDto> {
    return this.transition({
      id,
      viewerId,
      allowed: (d) => d.canApprove,
      denial: APPROVE_DENIED,
      nextStatus: ExpenseStatus.APPROVED,
      fields: { approvedBy: viewerId, approvedAt: this.clock.now() },
    });
  }

  async reject(id: string, viewerId: string, rawReason?: string): Promise<ExpenseResponseDto> {
    return this.transition({
      id,
      viewerId,
      allowed: (d) => d.canReject,
      denial: REJECT_DENIED,
      nextStatus: ExpenseStatus.REJECTED,
      fields: {},
      detail: this.normalizeReason(rawReason),
    });
  }

  async pay(id: string, viewerId: string): Promise<ExpenseResponseDto> {
    return this.transition({
      id,
      viewerId,
      allowed: (d) => d.canMarkPaid,
      denial: PAY_DENIED,
      nextStatus: ExpenseStatus.PAID,
      fields: { paidAt: this.clock.now() },
    });
  }

  /**
   * Un solo camino para las tres transiciones: decidir, escribir con CAS y
   * auditar DENTRO de la misma transacción, y recién entonces releer.
   *
   * El orden importa: el `expectedFrom` sale del estado que la política acaba de
   * aprobar. Si alguien lo movió en el medio, el `UPDATE` afecta 0 filas y el
   * cliente recibe 409 en vez de un estado inventado.
   */
  private async transition(params: {
    id: string;
    viewerId: string;
    allowed: (decision: ExpensePolicyDecision) => boolean;
    denial: string;
    /**
     * Nunca `pending`: un gasto nace pendiente en el alta, no "transiciona" a
     * pendiente. El tipo lo dice para que `EXPENSE_STATUS_EVENT` tenga una
     * clave segura y no haya que castear.
     */
    nextStatus: Exclude<ExpenseStatus, ExpenseStatus.PENDING>;
    fields: ExpenseTransitionFields;
    detail?: string | null;
  }): Promise<ExpenseResponseDto> {
    const { expense, decision } = await this.loadForViewer(params.id, params.viewerId);
    if (!params.allowed(decision)) throw new ForbiddenException(params.denial);

    const from = expense.status;

    const applied = await this.expensesRepo.transaction(async (manager) => {
      const ok = await this.expensesRepo.transitionStatus({
        id: params.id,
        expectedFrom: from,
        nextStatus: params.nextStatus,
        fields: params.fields,
        manager,
      });
      if (!ok) return false;

      await this.audit.recordStatusChange(
        {
          bondId: expense.bondId,
          userId: params.viewerId,
          expenseId: params.id,
          from,
          to: params.nextStatus,
          detail: params.detail ?? null,
        },
        manager,
      );

      // La transición y su aviso se confirman juntos o no se confirman: si el
      // INSERT del evento falla, la transacción entera vuelve atrás y el gasto
      // sigue en el estado anterior. Un gasto aprobado sin aviso sería peor que
      // un reintento.
      await this.emitExpenseEvent(manager, {
        eventType: EXPENSE_STATUS_EVENT[params.nextStatus],
        expense: expense,
        status: params.nextStatus,
        actorId: params.viewerId,
      });

      return true;
    });

    if (!applied) throw new ConflictException(CONFLICT);

    return this.getDetail(params.id, params.viewerId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Escribe UNA fila de outbox para un gasto, dentro de la transacción abierta.
   *
   * `aggregateType: 'expense'` es el discriminante que el relay necesita para no
   * confundir un gasto con una actividad (el `aggregate_id` es un uuid sin FK
   * desde `AddOutboxAggregateType`).
   *
   * `aggregateVersion` sale del ORDINAL del ciclo de vida, no de un contador:
   * `expense` no tiene columna `version` porque T24 resolvió la concurrencia con
   * compare-and-swap sobre `status`. Ver `expenseAggregateVersion`.
   *
   * `cancel()` NO emite: §7 no define un evento de cancelación y el gasto deja
   * de existir para las lecturas, así que el fan-out no tendría a quién avisar
   * (el `findAliveById` de la rama de gastos devuelve `null`).
   */
  private async emitExpenseEvent(
    manager: ExpenseTransactionManager,
    params: {
      eventType: ExpenseEventType;
      expense: { id: string; bondId: string };
      status: ExpenseStatus;
      actorId: string;
    },
  ): Promise<void> {
    await this.outbox.insert(
      {
        aggregateType: 'expense',
        aggregateId: params.expense.id,
        bondId: params.expense.bondId,
        eventType: params.eventType,
        aggregateVersion: expenseAggregateVersion(params.status),
        // `actor` es `{ type, id }` igual que en actividades: la regla R2 del
        // fan-out (el actor nunca recibe el aviso de su propia acción) lee
        // exactamente este campo. `status` va para trazabilidad del evento.
        payload: {
          actor: { type: 'user', id: params.actorId },
          status: params.status,
        },
      },
      manager,
    );
  }

  /**
   * Carga el gasto vivo y la decisión para el viewer.
   *
   * Un no-miembro recibe 404, no 403: no se le confirma que el gasto exista.
   * Es la misma regla que `activityNotFound()` en actividades.
   */
  private async loadForViewer(
    id: string,
    viewerId: string,
  ): Promise<{
    expense: ExpenseEntity;
    counterpartId: string | null;
    decision: ExpensePolicyDecision;
    names: Map<string, string>;
  }> {
    const expense = await this.expensesRepo.findAliveById(id);
    if (!expense) throw new NotFoundException('Expense not found');

    const isMember = await this.bondsService.isActiveBondForMember(expense.bondId, viewerId);
    if (!isMember) throw new NotFoundException('Expense not found');

    const counterpartId = await this.counterpartOf(expense.bondId, expense.requestedBy);
    const subject: ExpensePolicySubject = {
      status: expense.status,
      requestedBy: expense.requestedBy,
      counterpartId,
    };

    // Los nombres de las personas del vínculo, para MOSTRARLOS en vez de pintar un
    // UUID. Una consulta: el gasto nombra a tres personas como mucho.
    const names = await this.bondMembersRepo.findMemberNames(expense.bondId);

    return { expense, counterpartId, decision: this.policy.evaluate(subject, viewerId), names };
  }

  private async assertBondMember(bondId: string, viewerId: string): Promise<void> {
    const isMember = await this.bondsService.isActiveBondForMember(bondId, viewerId);
    if (!isMember) throw new NotFoundException('Bond not found or you are not a member');
  }

  private async counterpartOf(bondId: string, requesterId: string): Promise<string | null> {
    const memberIds = await this.bondMembersRepo.findActiveMemberIds(bondId);
    return selectCounterpartId(memberIds, requesterId);
  }

  private async verifyCategoryActive(categoryId: string) {
    const category = await this.categoriesRepo.findActiveById(categoryId);
    if (!category) throw new BadRequestException('Category is unknown or inactive');
    return category;
  }

  /**
   * Un reparto inválido no se puede mandar: el DTO sólo acepta el porcentaje de
   * quien solicita y la otra parte SIEMPRE es el complemento. Dos números
   * independientes dejarían pasar un 60/60.
   */
  private splitRatios(payer?: number): { payer: number; other: number } {
    const ratio = payer ?? DEFAULT_SPLIT_PAYER;
    return { payer: ratio, other: Math.round((100 - ratio) * 100) / 100 };
  }

  /**
   * `2026-02-31` pasa un regex y revienta en Postgres. Se valida acá: se parsea y
   * se exige que la fecha vuelva igual, así un día inexistente es un 400 y no un
   * 500 desde el driver.
   */
  private parseExpenseDate(value: string): string {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('expenseDate is not a real calendar date');
    }
    return value;
  }

  private normalizeReason(rawReason?: string): string | null {
    const value = typeof rawReason === 'string' ? rawReason.trim() : '';
    return value.length > 0 ? value : null;
  }

  private buildPatch(dto: UpdateExpenseDto): ExpenseEditableFields {
    const patch: ExpenseEditableFields = {};

    if (dto.concept !== undefined) patch.concept = dto.concept;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.amount !== undefined) patch.amount = dto.amount;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.expenseDate !== undefined) patch.expenseDate = dto.expenseDate;

    if (dto.splitRatioPayer !== undefined) {
      const { payer, other } = this.splitRatios(dto.splitRatioPayer);
      patch.splitRatioPayer = payer;
      patch.splitRatioOther = other;
    }

    return patch;
  }

  private toResponse(
    expense: ExpenseEntity & { hasDocument?: boolean },
    decision: ExpensePolicyDecision,
    counterpartId: string | null,
    names: Map<string, string>,
    categoryName?: string | null,
  ): ExpenseResponseDto {
    return {
      id: expense.id,
      bondId: expense.bondId,
      categoryId: expense.categoryId,
      categoryName: categoryName ?? expense.category?.name ?? null,
      concept: expense.concept,
      description: expense.description,
      // `pg` devuelve `numeric` como STRING; el contrato expone números.
      amount: Number(expense.amount),
      expenseDate: expense.expenseDate,
      splitRatioPayer: Number(expense.splitRatioPayer),
      splitRatioOther: Number(expense.splitRatioOther),
      status: expense.status,
      requestedBy: expense.requestedBy,
      requestedByName: names.get(expense.requestedBy) ?? null,
      counterpartId,
      counterpartName: counterpartId ? (names.get(counterpartId) ?? null) : null,
      approvedBy: expense.approvedBy,
      approvedByName: expense.approvedBy ? (names.get(expense.approvedBy) ?? null) : null,
      approvedAt: this.iso(expense.approvedAt),
      paidAt: this.iso(expense.paidAt),
      createdAt: this.iso(expense.createdAt)!,
      updatedAt: this.iso(expense.updatedAt)!,
      canEdit: decision.canEdit,
      canCancel: decision.canCancel,
      canApprove: decision.canApprove,
      canReject: decision.canReject,
      canMarkPaid: decision.canMarkPaid,
      isTerminal: decision.isTerminal,
      hasDocument: expense.hasDocument ?? false,
    };
  }

  private iso(value: Date | string | null): string | null {
    return value == null ? null : new Date(value).toISOString();
  }
}
