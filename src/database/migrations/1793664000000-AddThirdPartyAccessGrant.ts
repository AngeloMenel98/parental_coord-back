import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T1 de `odd/tasks/terciarios-temporales.md`: endurece `auth_third_party` para que sea
 * el grant que promete ser (F6: hoy la tabla existe y no otorga nada) y agrega el rol
 * `third_party` al vínculo.
 *
 * Reglas que esta migración hace cumplir en la DB, no en el servicio:
 * - `end_date` NOT NULL (D3: la fecha fija es obligatoria, no opcional).
 * - `relationship` NOT NULL (el progenitor declara el vínculo).
 * - Un solo grant `active` por `(bond_id, user_id)` — índice único PARCIAL, para que
 *   revocar y volver a otorgar siga siendo posible (los `revoked`/`expired` no chocan).
 * - `revoked_at`/`revoked_by`/`revoked_reason`: la revocación anticipada deja rastro y
 *   `revoked_by` protege al usuario con `ON DELETE RESTRICT`.
 *
 * `status` gana `expired`, separado de `revoked`: la distinción importa para el mensaje
 * que ve la persona y para la auditoría (venció ≠ lo dio de baja alguien).
 *
 * Requiere PostgreSQL 12+ (`ALTER TYPE ... ADD VALUE` dentro de la transacción de la
 * migración). Ningún valor agregado se USA en esta misma migración, que es la condición
 * que Postgres pone.
 */
export class AddThirdPartyAccessGrant1793664000000 implements MigrationInterface {
  name = 'AddThirdPartyAccessGrant1793664000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Los dos valores de enum que faltaban ─────────────────────────
    // `bond_member_role` sólo tenía `progenitor|coordinador` en la DB: el
    // `THIRD_PARTY` de TypeScript era un valor "nunca persistido" (F7).
    await queryRunner.query(
      `ALTER TYPE "bond_member_role" ADD VALUE IF NOT EXISTS 'third_party'`,
    );
    await queryRunner.query(
      `ALTER TYPE "auth_third_status" ADD VALUE IF NOT EXISTS 'expired'`,
    );

    // ── 2. Tipo de la relación declarada por el progenitor ──────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'third_party_relationship') THEN
          CREATE TYPE "third_party_relationship" AS ENUM ('family', 'caregiver', 'medical', 'educational');
        END IF;
      END $$;
    `);

    // ── 3. Guardas: fallar ruidosamente antes de inventar datos ─────────
    // D3 dice fecha fija obligatoria. Si hay grants sin fecha, no se elige una
    // por ellos: la migración se detiene y el operador decide.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "auth_third_party" WHERE "end_date" IS NULL) THEN
          RAISE EXCEPTION 'auth_third_party has grants without end_date; backfill them before applying AddThirdPartyAccessGrant1793664000000';
        END IF;
      END $$;
    `);
    // `relationship` no existía, así que no hay valor que copiar. Cualquier fila
    // preexistente tendría que declarar su relación a mano antes de esta migración.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "auth_third_party") THEN
          RAISE EXCEPTION 'auth_third_party already has rows; set their relationship value before applying AddThirdPartyAccessGrant1793664000000';
        END IF;
      END $$;
    `);

    // ── 4. Columnas del grant ───────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ALTER COLUMN "end_date" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "relationship" "third_party_relationship" NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "revoked_at" timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "revoked_by" uuid NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "revoked_reason" text NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "auth_third_party"
      ADD CONSTRAINT "FK_auth_third_party_revoked_by"
      FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE RESTRICT
    `);

    // ── 5. Índices ──────────────────────────────────────────────────────
    // Parcial: sólo los `active` compiten por el único grant vivo del par.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_auth_third_party_active_grant"
      ON "auth_third_party" ("bond_id", "user_id")
      WHERE "status" = 'active'
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_third_party_bond" ON "auth_third_party" ("bond_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_auth_third_party_user" ON "auth_third_party" ("user_id")`,
    );
    // La lista del dueño filtra por `authorized_by`: sin este índice, cada apertura
    // de la consola del progenitor escanea la tabla entera.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auth_third_party_authorized_by"
      ON "auth_third_party" ("authorized_by")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_third_party_authorized_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_third_party_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auth_third_party_bond"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_auth_third_party_active_grant"`);
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" DROP CONSTRAINT IF EXISTS "FK_auth_third_party_revoked_by"`,
    );
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "revoked_reason"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "revoked_by"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "revoked_at"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "relationship"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" ALTER COLUMN "end_date" DROP NOT NULL`);
    await queryRunner.query(`DROP TYPE IF EXISTS "third_party_relationship"`);

    // Postgres no puede quitar etiquetas de un enum. Los valores `third_party`
    // (bond_member_role) y `expired` (auth_third_status) quedan en los tipos: tras
    // el rollback ningún camino de código los escribe, así que son etiquetas
    // inertes. Reconstruir el tipo (patrón de
    // `1792555200000-AlignSystemRoleAndReportStatusEnums`) se reserva para cuando
    // una etiqueta TIENE que desaparecer, no para ahorrar dos strings.
  }
}
