import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Motor de transiciones · E7 — elimina la columna física `activity.assigned_confirmed`.
 *
 * El campo desapareció del modelo en E5 (REQ-MODEL-4 / AC-12): "confirmado" ahora se
 * DERIVA de `status === 'assisting' AND confirmed_at IS NOT NULL` (DTO). Esta migración
 * retira la columna legada; el código ya no la lee ni la escribe.
 *
 * `down()` es reversible con semántica de datos: recrea la columna y RELLENA desde el
 * estado derivado (no un valor inventado), de modo que un rollback restaura el modelo
 * anterior sin pérdida lógica.
 */
export class DropActivityAssignedConfirmed1791945600000 implements MigrationInterface {
  name = 'DropActivityAssignedConfirmed1791945600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "assigned_confirmed"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recrear la columna con el mismo shape del initial-schema (NOT NULL DEFAULT false).
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "assigned_confirmed" boolean NOT NULL DEFAULT false`,
    );
    // Backfill DESDE el estado derivado: sólo las filas realmente confirmadas vuelven a true.
    await queryRunner.query(
      `UPDATE "activity" SET "assigned_confirmed" = true WHERE "status" = 'assisting' AND "confirmed_at" IS NOT NULL`,
    );
  }
}
