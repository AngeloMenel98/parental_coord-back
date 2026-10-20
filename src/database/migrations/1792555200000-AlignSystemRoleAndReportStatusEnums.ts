import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alinea dos enums de Postgres con sus entities (la entity es la fuente de
 * verdad — el código escribe estos literales):
 *
 * 1. `system_role`: el entity `SystemRole` define USER='user' / ADMIN='admin'
 *    pero la migración inicial creó ('progenitor','admin') con default
 *    'progenitor'. Resultado: cualquier `INSERT` de un usuario no-admin
 *    (`/auth/register`, `AdminService.createUser`) abortaba con
 *    "invalid input value for enum system_role: \"user\"" — nunca se vio
 *    porque los DBs de dev nacieron con `synchronize` (schema → desde las
 *    entities) y el e2e usa app in-process con mocks (no toca la DB real).
 *
 * 2. `report_status`: la migración inicial creó valores en español
 *    ('solicitado','en_proceso','completado','entregado') y el default
 *    'solicitado', pero `ReportStatus` usa ('requested','in_progress',
 *    'completed','delivered') — un INSERT explícito con la entity fallaría
 *    y el default producía filas que el código no reconocía al comparar.
 *
 * Ambos enums se RECREAN (PG16 no permite descartar valores de un enum):
 * DROP DEFAULT → tipo nuevo → ALTER COLUMN TYPE … USING (mapeo explícito) →
 * DROP viejo → RENAME → SET DEFAULT sin tipar (literal crudo, se resuelve
 * contra la columna en cada INSERT ⇒ sobrevive al rename). Los guards revisan
 * `pg_enum` para que un reintento no aborte la transacción.
 */
export class AlignSystemRoleAndReportStatusEnums1792555200000
  implements MigrationInterface
{
  name = 'AlignSystemRoleAndReportStatusEnums1792555200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) system_role: 'progenitor' → 'user' (default incluido).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'system_role' AND e.enumlabel = 'user'
        ) THEN
          ALTER TABLE "user" ALTER COLUMN "system_role" DROP DEFAULT;
          CREATE TYPE "system_role_aligned" AS ENUM ('user', 'admin');
          ALTER TABLE "user" ALTER COLUMN "system_role" TYPE "system_role_aligned"
            USING (
              CASE "system_role"::text
                WHEN 'admin' THEN 'admin'
                ELSE 'user'
              END
            )::"system_role_aligned";
          DROP TYPE "system_role";
          ALTER TYPE "system_role_aligned" RENAME TO "system_role";
          ALTER TABLE "user" ALTER COLUMN "system_role" SET DEFAULT 'user';
        END IF;
      END
      $$;
    `);

    // 2) report_status: valores en español → los literales de ReportStatus.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'report_status' AND e.enumlabel = 'requested'
        ) THEN
          ALTER TABLE "report" ALTER COLUMN "status" DROP DEFAULT;
          CREATE TYPE "report_status_aligned" AS ENUM ('requested', 'in_progress', 'completed', 'delivered');
          ALTER TABLE "report" ALTER COLUMN "status" TYPE "report_status_aligned"
            USING (
              CASE "status"::text
                WHEN 'solicitado'  THEN 'requested'
                WHEN 'en_proceso'  THEN 'in_progress'
                WHEN 'completado'  THEN 'completed'
                WHEN 'entregado'   THEN 'delivered'
                ELSE 'requested'
              END
            )::"report_status_aligned";
          DROP TYPE "report_status";
          ALTER TYPE "report_status_aligned" RENAME TO "report_status";
          ALTER TABLE "report" ALTER COLUMN "status" SET DEFAULT 'requested';
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura los literales de la migración inicial ('progenitor' / español).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'system_role' AND e.enumlabel = 'progenitor'
        ) THEN
          ALTER TABLE "user" ALTER COLUMN "system_role" DROP DEFAULT;
          CREATE TYPE "system_role_legacy" AS ENUM ('progenitor', 'admin');
          ALTER TABLE "user" ALTER COLUMN "system_role" TYPE "system_role_legacy"
            USING (
              CASE "system_role"::text
                WHEN 'admin' THEN 'admin'
                ELSE 'progenitor'
              END
            )::"system_role_legacy";
          DROP TYPE "system_role";
          ALTER TYPE "system_role_legacy" RENAME TO "system_role";
          ALTER TABLE "user" ALTER COLUMN "system_role" SET DEFAULT 'progenitor';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
          WHERE t.typname = 'report_status' AND e.enumlabel = 'solicitado'
        ) THEN
          ALTER TABLE "report" ALTER COLUMN "status" DROP DEFAULT;
          CREATE TYPE "report_status_legacy" AS ENUM ('solicitado', 'en_proceso', 'completado', 'entregado');
          ALTER TABLE "report" ALTER COLUMN "status" TYPE "report_status_legacy"
            USING (
              CASE "status"::text
                WHEN 'requested'    THEN 'solicitado'
                WHEN 'in_progress'  THEN 'en_proceso'
                WHEN 'completed'    THEN 'completado'
                WHEN 'delivered'    THEN 'entregado'
                ELSE 'solicitado'
              END
            )::"report_status_legacy";
          DROP TYPE "report_status";
          ALTER TYPE "report_status_legacy" RENAME TO "report_status";
          ALTER TABLE "report" ALTER COLUMN "status" SET DEFAULT 'solicitado';
        END IF;
      END
      $$;
    `);
  }
}
