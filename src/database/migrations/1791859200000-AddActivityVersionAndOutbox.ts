import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motor de transiciones · E1 — `activity.version` (optimistic lock / FR-S5) +
 * tabla `outbox_event` (transactional outbox, write-only) + índice parcial.
 *
 * `version` es el contador monótono del CAS (REQ-MODEL-1 / REQ-TX-2): el DEFAULT 0
 * rellena las filas legadas; cada transición lo incrementa en 1 dentro de la tx.
 *
 * `outbox_event` es append-only: cada transición escribe UNA fila en la MISMA tx
 * (REQ-TX-3). El relay/fan-out queda FUERA de alcance; por eso `dispatched_at`
 * nace NULL y el índice es parcial (sólo las filas pendientes, `dispatched_at IS
 * NULL`). `aggregate_id` referencia `activity` (REQ-TX-3, "aggregate_id=activity
 * id"); el nombre del aggregate se conserva para que el futuro relay no dependa
 * del dominio concreto.
 *
 * Retención: 30 d para `activity` y `outbox_event` (REQ-MODEL-5, política
 * registrada — la purga concreta es future work).
 */
export class AddActivityVersionAndOutbox1791859200000 implements MigrationInterface {
  name = 'AddActivityVersionAndOutbox1791859200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // REQ-MODEL-1 / REQ-MODEL-4: DEFAULT 0 rellena las filas legadas (backfill
    // implícito). El UPDATE de `deadline` es el backfill documentado (no-op en la
    // práctica: la columna se re-escribe como ancla del response timeout).
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`UPDATE "activity" SET "deadline" = NULL WHERE "deadline" IS NOT NULL`);

    // REQ-TX-3: outbox write-only. `event_type` es varchar(64) (design D4) — no
    // hay enum (los nombres de evento se documentan en el mapa de transiciones).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "outbox_event" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "aggregate_id" uuid NOT NULL, "bond_id" uuid NOT NULL, "event_type" character varying(64) NOT NULL, "aggregate_version" integer NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "dispatched_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_outbox_event_id" PRIMARY KEY ("id"), CONSTRAINT "FK_outbox_event_activity" FOREIGN KEY ("aggregate_id") REFERENCES "activity"("id") ON DELETE CASCADE, CONSTRAINT "FK_outbox_event_bond" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE)`,
    );

    // Índice PARCIAL: el relay sólo barrerá las filas pendientes
    // (`dispatched_at IS NULL`); un índice completo guardaría entradas que ninguna
    // consulta busca.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_outbox_pending" ON "outbox_event" ("dispatched_at") WHERE "dispatched_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // El UPDATE de `deadline` en `up()` NO se revierte: reescribiría datos con un
    // valor inventado. `down()` deshace el DDL, no el backfill de datos.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_outbox_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_event"`);
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "version"`);
  }
}
