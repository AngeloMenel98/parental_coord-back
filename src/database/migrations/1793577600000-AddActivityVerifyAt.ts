import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T25 · Wave 3 — agrega `activity.verify_at` para poder derivar el origen de
 * un estado `overdue` sin adivinar (REQ-MODEL-4, L5).
 *
 * La columna se setea al entrar a `verify` y se limpia al salir (T12/T13).
 * Las filas históricas no tuvieron ventana de verificación, por lo que queda
 * NULLABLE y sin backfill.
 *
 * Idempotente y a prueba de reintento: `IF NOT EXISTS` en la columna.
 */
export class AddActivityVerifyAt1793577600000 implements MigrationInterface {
  name = 'AddActivityVerifyAt1793577600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "verify_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "verify_at"`);
  }
}
