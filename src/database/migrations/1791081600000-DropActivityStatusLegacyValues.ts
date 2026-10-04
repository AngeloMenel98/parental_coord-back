import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A5 · Paso 3 de 3 — `DROP VALUE 'objection'` y `DROP VALUE 'dispute'`.
 *
 * 🔴🔴 ESTA MIGRACIÓN ES DESTRUCTIVA, IRREVERSIBLE Y **NO SE HA EJECUTADO**.
 *
 * Motivo de no haberla ejecutado: en el entorno Postgres está CAÍDO
 * (`pg_isready` → `127.0.0.1:5432 - no response`; minikube corre pero `kubectl`
 * no está instalado, así que la base tampoco es alcanzable por el clúster). El
 * usuario afirma que ninguna fila de `activity` sostiene `objection` ni
 * `dispute`, pero eso NO está verificado. Por eso la migración NO se limita a
 * confiar en la afirmación: cuenta las filas y ABORTA ruidosamente si encuentra
 * alguna.
 *
 * Por qué abortar en vez de migrar las filas: `DROP VALUE` no puede ejecutarse si
 * alguna fila usa el valor, y decidir a qué estado pasar esas filas REESCRIBE
 * HISTORIA. Es una decisión de producto sobre datos, no una decisión de código; por
 * eso este fichero la hace explícita en lugar de tomarla por su cuenta.
 *
 * ⚠ El recuento mira las DOS columnas del enum, no sólo `status`: `initial-schema`
 * tipa también `resolved_status` como `activity_status` (`initial-schema:87`), así
 * que una fila puede sostener el valor por `resolved_status` aunque `status` esté
 * limpio. Olidar esa columna daría un "0 filas" falso y el `DROP` fallaría después
 * con el error genérico de Postgres, sin decir qué fila lo bloquea.
 *
 * ⚠ Viaja en su propia migración (y después del `ADD VALUE`) por la misma razón
 * que el paso 1: un `ADD VALUE` y un `DROP VALUE` no deben compartir transacción.
 */
export class DropActivityStatusLegacyValues1791081600000 implements MigrationInterface {
  name = 'DropActivityStatusLegacyValues1791081600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Verificación previa. Si algo falla aquí, la migración NO se aplica. ---
    await queryRunner.query(`
      DO $$
      DECLARE
        objection_status integer;
        dispute_status integer;
        objection_resolved integer;
        dispute_resolved integer;
        objection_total integer;
        dispute_total integer;
      BEGIN
        SELECT count(*) INTO objection_status
          FROM "activity" WHERE "status" = 'objection';
        SELECT count(*) INTO dispute_status
          FROM "activity" WHERE "status" = 'dispute';
        SELECT count(*) INTO objection_resolved
          FROM "activity" WHERE "resolved_status" = 'objection';
        SELECT count(*) INTO dispute_resolved
          FROM "activity" WHERE "resolved_status" = 'dispute';

        objection_total := objection_status + objection_resolved;
        dispute_total := dispute_status + dispute_resolved;

        IF objection_total > 0 OR dispute_total > 0 THEN
          RAISE EXCEPTION
            'Refusing to DROP VALUE: % activity row(s) still hold ''objection'' (status=%, resolved_status=%) and % hold ''dispute'' (status=%, resolved_status=%). Decide their destination status as a PRODUCT data decision, then re-run.',
            objection_total, objection_status, objection_resolved,
            dispute_total, dispute_status, dispute_resolved;
        END IF;
      END $$;
    `);

    // Sólo se llega aquí con el enum limpio. El IF EXISTS evita que un reintento
    // sobre una base ya saneada aborte por un valor que ya no existe.
    await queryRunner.query(`ALTER TYPE "activity_status" DROP VALUE IF EXISTS 'objection'`);
    await queryRunner.query(`ALTER TYPE "activity_status" DROP VALUE IF EXISTS 'dispute'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add es posible (ADD VALUE), pero NO es una reversión real: las filas que
    // Usaran el valor mientras estuvo ausente ya no reaparecerían, y `down()`
    // mentiría sobre el estado. Se declara explícitamente en vez de fingir.
    await queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'objection'`);
    await queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'dispute'`);
  }
}
