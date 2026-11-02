import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, In, IsNull, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
import { ExpenseAttachmentEntity } from '../entities/expense-attachment.entity';
import { ExpenseEntity, ExpenseStatus } from '../entities/expense.entity';

/** Columnas de efecto que una transición puede escribir junto con el estado. */
export type ExpenseTransitionFields = Partial<
  Pick<ExpenseEntity, 'approvedBy' | 'approvedAt' | 'paidAt'>
>;

/**
 * Columnas que un PATCH puede tocar (FR-11). Ni estado ni dueño.
 *
 * `categoryId` es `string` y no `string | null`: la columna es nullable por los
 * gastos históricos, pero editar NUNCA puede vaciar la categoría — sólo
 * reemplazarla por otra válida.
 */
export type ExpenseEditableFields = Partial<{
  concept: string;
  description: string | null;
  amount: number;
  categoryId: string;
  expenseDate: string;
  splitRatioPayer: number;
  splitRatioOther: number;
}>;

export interface TransitionStatusInput {
  id: string;
  /** El estado que el llamante vio. Si la fila ya no está ahí, la escritura no ocurre. */
  expectedFrom: ExpenseStatus;
  nextStatus: ExpenseStatus;
  fields?: ExpenseTransitionFields;
  /** El `EntityManager` de una transacción abierta por el servicio. */
  manager?: EntityManager;
}

/** Opciones de filtro y paginación para `listForBond`. */
export interface ListExpensesOptions {
  limit: number;
  offset: number;
  status?: ExpenseStatus;
  categoryId?: string;
  from?: string;
  to?: string;
}

/** Resultado de `listForBond`. */
export interface ListExpensesResult {
  items: (ExpenseEntity & { hasDocument: boolean })[];
  total: number;
  limit: number;
  offset: number;
}

/** Resultado de `summaryForBond`. */
export interface ExpenseSummaryResult {
  saldo: number;
  porPagar: number;
  porCobrar: number;
  counts: {
    pendientes: number;
    aprobados: number;
    pagados: number;
    rechazados: number;
  };
}

export type ExpenseWithDocument = ExpenseEntity & { hasDocument: boolean };

/**
 * Acceso a `expense`.
 *
 * Dos garantías que importan más que el CRUD:
 *
 *  · **Nada borrado se lee.** `findAliveById` filtra `deleted_at IS NULL`, igual
 *    que las lecturas de actividades. El "Eliminar" de un gasto es la marca, no
 *    la desaparición de la fila.
 *
 *  · **Toda mutación es compare-and-swap, sin columna nueva.** `expense` no tiene
 *    `version` (y T24 no agrega esquema), así que la condición viaja en el propio
 *    `UPDATE`: `WHERE id = :id AND status = :expected AND deleted_at IS NULL`. Si
 *    dos partes aprueban a la vez, la segunda afecta 0 filas y el servicio
 *    responde 409 en vez de pisar a la primera. `affected` es la respuesta, no un
 *    `find` previo — leer y después escribir deja la ventana abierta.
 */
@Injectable()
export class ExpensesRepository extends BaseRepository<ExpenseEntity> {
  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenseRepo: Repository<ExpenseEntity>,
    @InjectRepository(ExpenseAttachmentEntity)
    private readonly attachmentRepo: Repository<ExpenseAttachmentEntity>,
  ) {
    super(expenseRepo);
  }

  async findAliveById(id: string): Promise<ExpenseWithDocument | null> {
    const expense = await this.expenseRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['category'],
    });
    if (!expense) return null;

    const hasDocument = await this.attachmentRepo.existsBy({ expenseId: id });
    return { ...expense, hasDocument };
  }

  async insertWithManager(
    row: DeepPartial<ExpenseEntity>,
    manager: EntityManager,
  ): Promise<ExpenseEntity> {
    const repo = manager.getRepository(ExpenseEntity);
    return repo.save(repo.create(row));
  }

  /** `false` = la fila ya no estaba en `expectedFrom` (o estaba borrada). */
  async transitionStatus(input: TransitionStatusInput): Promise<boolean> {
    return this.updateGuarded(
      input.id,
      input.expectedFrom,
      { status: input.nextStatus, ...input.fields },
      input.manager,
    );
  }

  /** FR-11 · editar, sólo mientras siga en `expectedStatus`. */
  async editFields(input: {
    id: string;
    expectedStatus: ExpenseStatus;
    patch: ExpenseEditableFields;
    manager?: EntityManager;
  }): Promise<boolean> {
    return this.updateGuarded(input.id, input.expectedStatus, input.patch, input.manager);
  }

  /** FR-11 · cancelar = marcar `deleted_at`, sólo mientras siga en `expectedStatus`. */
  async markDeleted(input: {
    id: string;
    expectedStatus: ExpenseStatus;
    at: Date;
    manager?: EntityManager;
  }): Promise<boolean> {
    return this.updateGuarded(
      input.id,
      input.expectedStatus,
      { deletedAt: input.at },
      input.manager,
    );
  }

  /**
   * T28 · lista paginada de gastos vivos de un vínculo, con filtros.
   *
   * Orden determinista: `created_at DESC, id DESC`. `deleted_at IS NULL` siempre.
   */
  async listForBond(bondId: string, options: ListExpensesOptions): Promise<ListExpensesResult> {
    const { limit, offset, status, categoryId, from, to } = options;

    const listQb = this.expenseRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.category', 'category')
      .where('e.bond_id = :bondId', { bondId })
      .andWhere('e.deleted_at IS NULL')
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .limit(limit)
      .offset(offset);

    if (status !== undefined) {
      listQb.andWhere('e.status = :status', { status });
    }
    if (categoryId !== undefined) {
      listQb.andWhere('e.category_id = :categoryId', { categoryId });
    }
    if (from !== undefined) {
      listQb.andWhere('e.expense_date >= :from', { from });
    }
    if (to !== undefined) {
      listQb.andWhere('e.expense_date <= :to', { to });
    }

    const countQb = this.expenseRepo
      .createQueryBuilder('e')
      .where('e.bond_id = :bondId', { bondId })
      .andWhere('e.deleted_at IS NULL');

    if (status !== undefined) countQb.andWhere('e.status = :status', { status });
    if (categoryId !== undefined) countQb.andWhere('e.category_id = :categoryId', { categoryId });
    if (from !== undefined) countQb.andWhere('e.expense_date >= :from', { from });
    if (to !== undefined) countQb.andWhere('e.expense_date <= :to', { to });

    const [items, total] = await Promise.all([listQb.getMany(), countQb.getCount()]);
    const itemsWithDocument = await this.attachHasDocument(items);

    return { items: itemsWithDocument, total, limit, offset };
  }

  /**
   * T28 · saldo y conteos de gastos de un vínculo, desde la perspectiva del viewer.
   *
   * `saldo = Σ (myShare − otherShare)` sobre `approved` o `paid`. El requester es
   * el payer (`split_ratio_payer`), la contraparte es el other (`split_ratio_other`).
   * `pg` devuelve `numeric` como string, por eso se convierte con `Number(...)`.
   */
  async summaryForBond(bondId: string, viewerId: string): Promise<ExpenseSummaryResult> {
    const raw = await this.expenseRepo
      .createQueryBuilder('e')
      .select(
        `SUM(
          CASE
            WHEN e.requested_by = :viewerId AND e.status IN ('approved', 'paid')
              THEN e.amount * e.split_ratio_payer / 100 - e.amount * e.split_ratio_other / 100
            WHEN e.requested_by != :viewerId AND e.status IN ('approved', 'paid')
              THEN e.amount * e.split_ratio_other / 100 - e.amount * e.split_ratio_payer / 100
            ELSE 0
          END
        )::numeric`,
        'saldo',
      )
      .addSelect(`COUNT(*) FILTER (WHERE e.status = 'pending')`, 'pendientes')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = 'approved')`, 'aprobados')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = 'paid')`, 'pagados')
      .addSelect(`COUNT(*) FILTER (WHERE e.status = 'rejected')`, 'rechazados')
      .where('e.bond_id = :bondId', { bondId })
      .andWhere('e.deleted_at IS NULL')
      .setParameter('viewerId', viewerId)
      .getRawOne<{
        saldo: string | null;
        pendientes: string;
        aprobados: string;
        pagados: string;
        rechazados: string;
      }>();

    const saldo = Number(raw?.saldo ?? 0);
    return {
      saldo,
      porPagar: Math.abs(Math.min(saldo, 0)),
      porCobrar: Math.abs(Math.max(saldo, 0)),
      counts: {
        pendientes: Number(raw?.pendientes ?? 0),
        aprobados: Number(raw?.aprobados ?? 0),
        pagados: Number(raw?.pagados ?? 0),
        rechazados: Number(raw?.rechazados ?? 0),
      },
    };
  }

  /**
   * Una SOLA consulta para toda la página: los `expense_attachment` de los gastos
   * listados se piden con un `IN` y se indexan en un `Set`. Preguntar uno por
   * gasto sería un N+1 (con `limit` 100 son 100 idas a la base por request).
   */
  private async attachHasDocument(items: ExpenseEntity[]): Promise<ExpenseWithDocument[]> {
    if (items.length === 0) return [];

    const attachments = await this.attachmentRepo.find({
      where: { expenseId: In(items.map((item) => item.id)) },
      select: { expenseId: true },
    });
    const documented = new Set(attachments.map((attachment) => attachment.expenseId));

    return items.map((item) => ({
      ...item,
      hasDocument: documented.has(item.id),
    }));
  }

  private async updateGuarded(
    id: string,
    expectedStatus: ExpenseStatus,
    patch: Partial<ExpenseEntity>,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager ? manager.getRepository(ExpenseEntity) : this.expenseRepo;

    const result = await repo.update({ id, status: expectedStatus, deletedAt: IsNull() }, patch);

    return (result.affected ?? 0) > 0;
  }
}
