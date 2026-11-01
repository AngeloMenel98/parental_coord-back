import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, IsNull, Repository } from 'typeorm';

import { BaseRepository } from '../../common/repositories/base.repository';
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
  ) {
    super(expenseRepo);
  }

  async findAliveById(id: string): Promise<ExpenseEntity | null> {
    return this.expenseRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['category'],
    });
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
