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
          FROM "activity" WHERE "status"::text = 'objection';
        SELECT count(*) INTO dispute_status
          FROM "activity" WHERE "status"::text = 'dispute';
        SELECT count(*) INTO objection_resolved
          FROM "activity" WHERE "resolved_status"::text = 'objection';
        SELECT count(*) INTO dispute_resolved
          FROM "activity" WHERE "resolved_status"::text = 'dispute';

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

    // Sólo se llega aquí con el enum limpio.
    //
    // 🔴 PostgreSQL NO tiene `ALTER TYPE ... DROP VALUE`. Comprobado contra
    // pg16.15:
    //     ALTER TYPE activity_status DROP VALUE 'objection';
    //     ERROR: syntax error at or near "VALUE"
    // No es que falte `IF EXISTS`: la forma `DROP VALUE` directamente no existe.
    // (Para `ADD VALUE` sí hay `IF NOT EXISTS`, que es lo que usan los pasos 1 y 2.)
    //
    // La única forma soportada de quitar un valor de un enum es RECREAR el tipo:
    // se crea uno nuevo con la lista definitiva, se reconvierten las columnas que
    // lo usaban, se tira el viejo y el nuevo toma su nombre. `resolved_status`
    // también es `activity_status` (`initial-schema:87`), así que va ella también.
    //
    // Todo va en un DO block y empieza por comprobar el catálogo: si `objection` y
    // `dispute` ya no están, no se hace nada. Un reintento sobre una base ya
    // saneada es un no-op en vez de un abort.
    await queryRunner.query(`
      DO $$
      DECLARE
        objection_exists boolean;
        dispute_exists boolean;
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'activity_status' AND e.enumlabel = 'objection'
        ) INTO objection_exists;

        SELECT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'activity_status' AND e.enumlabel = 'dispute'
        ) INTO dispute_exists;

        IF NOT (objection_exists OR dispute_exists) THEN
          RETURN;
        END IF;

        -- Orden de A5, verificado contra la base en el momento de escribir esto.
        EXECUTE 'CREATE TYPE "activity_status__swipe" AS ENUM (''created'', ''assigned'', ''assisting'', ''in_progress'', ''verify'', ''done'', ''overdue'', ''not_assisting'', ''cancelled'')';

        -- El DEFAULT va anclado al tipo viejo: hay que soltarlo antes de mover la
        -- columna y volver a ponerlo contra el tipo nuevo.
        EXECUTE 'ALTER TABLE "activity" ALTER COLUMN "status" DROP DEFAULT';

        EXECUTE 'ALTER TABLE "activity" ALTER COLUMN "status" TYPE "activity_status__swipe" USING "status"::text::"activity_status__swipe"';

        EXECUTE 'ALTER TABLE "activity" ALTER COLUMN "resolved_status" TYPE "activity_status__swipe" USING "resolved_status"::text::"activity_status__swipe"';

        EXECUTE 'DROP TYPE "activity_status"';
        EXECUTE 'ALTER TYPE "activity_status__swipe" RENAME TO "activity_status"';

        EXECUTE 'ALTER TABLE "activity" ALTER COLUMN "status" SET DEFAULT ''created''::"activity_status"';
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add es posible (ADD VALUE), pero NO es una reversión real: las filas que
    // Usaran el valor mientras estuvo ausente ya no reaparecerían, y `down()`
    // mentiría sobre el estado. Se declara explícitamente en vez de fingir.
    await queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'objection'`);
    await queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'dispute'`);
  }
}
