import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T14 · Wave 2 — las tres columnas que el modelo de gastos necesita y que la
 * tabla `expense` no tenía (R2, R6).
 *
 * `category_id` — R2: hay UNA sola taxonomía de categorías. Es la tabla
 * `category` existente (la misma que ya usa `activity.category_id`), no una
 * `expense_category` paralela con sus propios íconos y colores: D-15 pide
 * preseleccionar la categoría del gasto desde la actividad, y eso sólo es
 * posible si comparten taxonomía. `ON DELETE RESTRICT` porque una categoría con
 * gastos no se puede borrar sin decidir antes qué pasa con ese dinero.
 *
 * `activity_id` — R6/D-17: el gasto que nace de un adjunto de una actividad
 * registra su origen. `ON DELETE SET NULL`, no CASCADE: borrar la actividad
 * (que además es soft delete) nunca puede borrar plata.
 *
 * `deleted_at` — el "Eliminar" del gasto, con la misma convención que
 * `activity.deleted_at` (`AddActivityActionFields`): marca, no purga, e índice
 * PARCIAL porque las lecturas vivas filtran `deleted_at IS NULL`.
 *
 * ⚠ Las tres columnas son NULLABLE y NO hay backfill, a propósito:
 *   • `category_id`: las filas históricas no tienen categoría y elegir una por
 *     ellas sería inventar un dato contable. El "obligatorio" es una regla de
 *     entrada (DTO/servicio, T22), no del esquema: `SET NOT NULL` acá obligaría
 *     a fabricar una categoría para los gastos ya cargados.
 *   • `activity_id`: no todo gasto nace de una actividad.
 *   • `deleted_at`: NULL es "vivo", el estado que ya tienen todas las filas.
 *
 * Idempotente y a prueba de reintento, en el estilo de `AddActivityCategoryId`:
 * `IF NOT EXISTS` en columnas e índices, `pg_constraint` para las FK. No toca
 * ninguna columna existente.
 */
export class AddExpenseModelFields1792819200000 implements MigrationInterface {
  name = 'AddExpenseModelFields1792819200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Columnas.
    await queryRunner.query(`ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "category_id" uuid`);
    await queryRunner.query(`ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "activity_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );

    // 2. FK de categoría (guarda por si el reintento o un entorno ya la tiene).
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_expense_category'
             AND conrelid = '"expense"'::regclass
         ) THEN
           ALTER TABLE "expense"
             ADD CONSTRAINT "FK_expense_category"
             FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT;
         END IF;
       END
       $$`,
    );

    // 3. FK de actividad de origen.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_expense_activity'
             AND conrelid = '"expense"'::regclass
         ) THEN
           ALTER TABLE "expense"
             ADD CONSTRAINT "FK_expense_activity"
             FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE SET NULL;
         END IF;
       END
       $$`,
    );

    // 4. Índices de los JOIN/filtros nuevos.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_expense_category" ON "expense" ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_expense_activity" ON "expense" ("activity_id")`,
    );

    // 5. Índice PARCIAL de borrados, igual que `IDX_activity_deleted_at`.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_expense_deleted_at" ON "expense" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Índices primero, después FK, después columnas: el orden inverso seguro.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_expense_deleted_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_expense_activity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_expense_category"`);

    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_expense_activity'
             AND conrelid = '"expense"'::regclass
         ) THEN
           ALTER TABLE "expense" DROP CONSTRAINT "FK_expense_activity";
         END IF;
       END
       $$`,
    );
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_expense_category'
             AND conrelid = '"expense"'::regclass
         ) THEN
           ALTER TABLE "expense" DROP CONSTRAINT "FK_expense_category";
         END IF;
       END
       $$`,
    );

    await queryRunner.query(`ALTER TABLE "expense" DROP COLUMN IF EXISTS "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "expense" DROP COLUMN IF EXISTS "activity_id"`);
    await queryRunner.query(`ALTER TABLE "expense" DROP COLUMN IF EXISTS "category_id"`);
  }
}
