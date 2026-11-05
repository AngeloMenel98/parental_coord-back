import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `notifications-hygiene` (slice 1) — AddNotificationSourceEventAndIndexes.
 *
 * Añade a `notification` la columna `source_event_id` + los índices que el read
 * path archivado y la deduplicación necesitan. Todo el DDL es ADITIVO e
 * IDEMPOTENTE (`IF NOT EXISTS` + guarda `pg_constraint`) ⇒ `up()` puede
 * re-ejecutarse sin abortar.
 *
 * Porqués (design D2/D5/D6 + spec "Migration"):
 *  - `source_event_id uuid` NULLABLE es el PRIMITIVO DE DEDUPLICACIÓN de la
 *    slice 2 (fan-out desde `outbox_event`): como máximo UNA notificación por
 *    (usuario, evento de origen). En esta slice NADA escribe la columna ⇒
 *    todas las filas quedan en NULL y el comportamiento actual no cambia.
 *  - El índice único es PARCIAL (`WHERE "source_event_id" IS NOT NULL`). En
 *    Postgres un UNIQUE normal ya admite NULLs repetidos, pero el predicado
 *    deja explícito que sólo las filas CON origen deduplican.
 *  - La FK es `ON DELETE SET NULL` (NO CASCADE): `outbox_event` se purga con SU
 *    propio reloj (`WEBHOOK_RETENTION_DAYS`), no con el de notificaciones. Con
 *    CASCADE, la retención del outbox borraría notificaciones en un reloj ajeno
 *    (y destruiría avisos sin leer); con SET NULL la notificación sobrevive y
 *    sólo se desvincula de su evento.
 *  - `IDX_notification_source_event` (parcial, mismo predicado) SOSTIENE la FK:
 *    `ON DELETE SET NULL` actualiza las filas por `source_event_id`, y el
 *    índice único parcial empieza por `user_id` ⇒ sin este índice, cada purga
 *    del outbox haría seq-scan sobre `notification`.
 *  - `IDX_notification_user_created` (`user_id`, `created_at DESC`, `id DESC`)
 *    replica el `ORDER BY` del read path ⇒ la paginación no ordena en memoria.
 *    `IDX_notification_user` se conserva (misma columna líder): su borrado es
 *    trabajo futuro.
 *  - `CREATE INDEX` plano, NO `CONCURRENTLY`: TypeORM envuelve las migraciones
 *    en una transacción y `CONCURRENTLY` no puede ejecutarse dentro de ella.
 *    La tabla es joven ⇒ el lock breve es aceptable.
 *
 * `down()` revierte en orden FK-safe: índices → constraint → columna.
 */
export class AddNotificationSourceEventAndIndexes1792646400000 implements MigrationInterface {
  name = 'AddNotificationSourceEventAndIndexes1792646400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Columna nullable del evento de origen (idempotente).
    await queryRunner.query(
      `ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "source_event_id" uuid`,
    );

    // 2. FK con guarda: un reintento de la migración no puede abortar.
    //    La guarda filtra por RELACIÓN (`conrelid`), no sólo por nombre: en
    //    Postgres los nombres de constraint son únicos POR TABLA, no por
    //    esquema ⇒ un `conname` a secas podría dar por existente una FK que
    //    vive en otra tabla. Precedente: `1792540800000-AddActivityCategoryId`.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_notification_source_event_id'
             AND conrelid = 'notification'::regclass
         ) THEN
           ALTER TABLE "notification"
             ADD CONSTRAINT "FK_notification_source_event_id"
             FOREIGN KEY ("source_event_id") REFERENCES "outbox_event"("id") ON DELETE SET NULL;
         END IF;
       END
       $$`,
    );

    // 3. Índice único PARCIAL: una notificación por (usuario, evento de origen).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_user_source_event" ON "notification" ("user_id", "source_event_id") WHERE "source_event_id" IS NOT NULL`,
    );

    // 4. Índice parcial que SOSTIENE la FK `ON DELETE SET NULL`.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_source_event" ON "notification" ("source_event_id") WHERE "source_event_id" IS NOT NULL`,
    );

    // 5. Índice compuesto que replica el ORDER BY del read path.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_notification_user_created" ON "notification" ("user_id", "created_at" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Orden FK-safe: primero los índices, luego la constraint, luego la columna.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_source_event"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_notification_user_source_event"`);
    await queryRunner.query(
      `ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "FK_notification_source_event_id"`,
    );
    await queryRunner.query(`ALTER TABLE "notification" DROP COLUMN IF EXISTS "source_event_id"`);
  }
}
