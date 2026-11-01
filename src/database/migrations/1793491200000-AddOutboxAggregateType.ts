import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T23 · Wave 2 — el outbox deja de ser exclusivo de `activity`.
 *
 * R8 manda que las notificaciones de gastos viajen por el outbox → fan-out
 * existente y prohíbe construir un segundo transporte. Pero el outbox estaba
 * cableado a un solo aggregate:
 *
 *   • `aggregate_id` tenía `FK_outbox_event_activity` → `activity(id)` con
 *     ON DELETE CASCADE. Un evento de gasto no se podía insertar: la FK lo
 *     rechazaba.
 *   • La entidad declaraba la relación `activity` sobre esa misma columna, así
 *     que el modelo tampoco lo permitía.
 *
 * Un aggregate POLIMÓRFICO no puede tener FK a una de sus dos tablas posibles.
 * Ese es el precio de reusar el pipeline, y se paga acá:
 *
 *   1. `aggregate_type` (`'activity' | 'expense'`), con DEFAULT `'activity'`
 *      para que las filas que ya existen y todos los productores de actividades
 *      conserven su significado sin backfill.
 *   2. Se ELIMINA `FK_outbox_event_activity`. La FK a `bond_id` queda: ningún
 *      evento puede apuntar a un vínculo inexistente, y el relay sigue
 *      resolviendo suscripciones por ese bond.
 *   3. Índice `(aggregate_type, aggregate_id)`. PostgreSQL no indexa las
 *      columnas de FK por su cuenta, y lo necesitan el anti-join del recordatorio
 *      de 7 días y cualquier lectura por aggregate.
 *
 * Idempotente y a prueba de reintento, en el estilo de `AddExpenseModelFields`:
 * `IF NOT EXISTS` para columna e índice, `pg_constraint` para la FK.
 *
 * ⚠ `down()` BORRA los eventos de gasto. Es inevitable: volver a crear una FK
 * hacia `activity` falla si quedan filas cuyo `aggregate_id` es un gasto, y no
 * existe forma de reescribirlas a una actividad válida. Un rollback pierde esos
 * eventos (y por lo tanto los recordatorios pendientes), no las notificaciones
 * ya creadas — ésas viven en `notification`.
 */
export class AddOutboxAggregateType1793491200000 implements MigrationInterface {
  name = 'AddOutboxAggregateType1793491200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. El discriminador. El DEFAULT es la razón por la que no hace falta
    //    backfill: toda fila previa es de una actividad.
    await queryRunner.query(
      `ALTER TABLE "outbox_event" ADD COLUMN IF NOT EXISTS "aggregate_type" character varying(32) NOT NULL DEFAULT 'activity'`,
    );

    // 2. La FK se va: el aggregate ahora puede ser una actividad o un gasto.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_outbox_event_activity'
             AND conrelid = '"outbox_event"'::regclass
         ) THEN
           ALTER TABLE "outbox_event" DROP CONSTRAINT "FK_outbox_event_activity";
         END IF;
       END
       $$`,
    );

    // 3. Lecturas por aggregate (anti-join del recordatorio incluido).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_aggregate" ON "outbox_event" ("aggregate_type", "aggregate_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_aggregate"`);

    // Sin esto la FK de más abajo no puede crearse. Ver el ⚠ del KDoc.
    await queryRunner.query(`DELETE FROM "outbox_event" WHERE "aggregate_type" <> 'activity'`);

    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_outbox_event_activity'
             AND conrelid = '"outbox_event"'::regclass
         ) THEN
           ALTER TABLE "outbox_event"
             ADD CONSTRAINT "FK_outbox_event_activity"
             FOREIGN KEY ("aggregate_id") REFERENCES "activity"("id") ON DELETE CASCADE;
         END IF;
       END
       $$`,
    );

    await queryRunner.query(`ALTER TABLE "outbox_event" DROP COLUMN IF EXISTS "aggregate_type"`);
  }
}
