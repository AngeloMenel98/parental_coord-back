import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `AddActivityCategoryId` — el FK que ninguna migración anterior creó.
 *
 * Raíz del fix: el entity `ActivityEntity` declara `category_id uuid NOT NULL`
 * (@JoinColumn → `category`), y `CreateActivityDto.categoryId` es UUID, pero el
 * esquema histórico (InitialSchema) creaba `activity.category activity_category
 * NOT NULL` (enum legacy) y NINGUNA migración lo reemplazó. La deriva no se veía
 * porque los DBs de dev nacieron con `synchronize` — un volumen/DB construido
 * SOLO con migraciones (compose con `down -v`, deploy nuevo) rompe toda query
 * TypeORM sobre activity (`column a.category_id does not exist`).
 *
 * Raíces (estilo A5: guardas con `::text`/information_schema → el reintento no
 * aborta):
 *  1. `ADD COLUMN IF NOT EXISTS` → idempotente.
 *  2. Backfill SÓLO si la columna legacy `category` existe (DO guard): upsert de
 *     las 5 categorías semilla faltantes (si alguien las borró) + mapeo
 *     enum→FK por nombre (`educacion`→`Educación`, acentos via CASE explícito).
 *  3. `SET NOT NULL` sólo si no queda ningún NULL (si quedara, no aborta).
 *  4. FK + índice con guarda `IF NOT EXISTS` (pg_constraint / pg_indexes).
 *  5. `DROP COLUMN IF EXISTS "category"` + `DROP TYPE` sólo cuando NINGUNA
 *     columna use el enum (DO guard — PG no tiene DROP TYPE condicional sobre
 *     dependencias).
 *
 * down() reconstruye el enum + columna legacy y revierte el FK/índice/columna;
 * el backfill inverso mapea nombre→enum con fallback `'familiar'` (los UUIDs
 * arbitrarios no son reversibles de forma segura).
 */
export class AddActivityCategoryId1792540800000 implements MigrationInterface {
  name = 'AddActivityCategoryId1792540800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Columna FK (idempotente).
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "category_id" uuid`,
    );

    // 2. Backfill desde el enum legacy — sólo si la columna legacy todavía existe.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'activity' AND column_name = 'category'
         ) THEN
           -- Categorías semilla que falten (borrado duro de una semilla no rompe el backfill).
           INSERT INTO "category" ("name", "description", "color", "icon")
           SELECT v.name, v.description, v.color, v.icon
           FROM (VALUES
             ('Salud',      'Actividades médicas, citas y salud de los hijos',   '#22C55E', 'heart-pulse'),
             ('Educación',  'Actividades escolares, tutorías y educación',       '#3B82F6', 'graduation-cap'),
             ('Social',     'Actividades sociales, fiestas y eventos',           '#A855F7', 'users'),
             ('Familiar',   'Actividades familiares, reuniones y convivencia',   '#F59E0B', 'home'),
             ('Recreación', 'Actividades recreativas, deportes y ocio libre',    '#EF4444', 'palette')
           ) AS v(name, description, color, icon)
           WHERE NOT EXISTS (
             SELECT 1 FROM "category" c WHERE c.name = v.name
           );

           UPDATE "activity" a
           SET "category_id" = c.id
           FROM "category" c
           WHERE a."category_id" IS NULL
             AND c.name = CASE a."category"::text
               WHEN 'salud'      THEN 'Salud'
               WHEN 'educacion'  THEN 'Educación'
               WHEN 'social'     THEN 'Social'
               WHEN 'familiar'   THEN 'Familiar'
               WHEN 'recreacion' THEN 'Recreación'
             END;
         END IF;
       END
       $$`,
    );

    // 3. NOT NULL sólo si no quedan NULLs (reintento seguro).
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'activity'
             AND column_name = 'category_id' AND is_nullable = 'YES'
         )
         AND NOT EXISTS (SELECT 1 FROM "activity" WHERE "category_id" IS NULL) THEN
           ALTER TABLE "activity" ALTER COLUMN "category_id" SET NOT NULL;
         END IF;
       END
       $$`,
    );

    // 4. FK con guarda (nombre único en el esquema).
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_activity_category'
             AND conrelid = '"activity"'::regclass
         ) THEN
           ALTER TABLE "activity"
             ADD CONSTRAINT "FK_activity_category"
             FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT;
         END IF;
       END
       $$`,
    );

    // 5. Índice para los JOIN por categoría.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_activity_category" ON "activity" ("category_id")`,
    );

    // 6. Retiro de la columna legacy (la única usuaria del enum).
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "category"`);

    // 7. Drop del enum sólo cuando NINGUNA columna lo use todavía.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND udt_name = 'activity_category'
         ) THEN
           DROP TYPE IF EXISTS "activity_category";
         END IF;
       END
       $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Reconstruir el enum legacy si fue eliminado.
    await queryRunner.query(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_category') THEN
           CREATE TYPE "activity_category" AS ENUM ('salud','educacion','social','familiar','recreacion');
         END IF;
       END
       $$`,
    );

    // 2. Columna legacy de vuelta (nullable mientras se backfillea).
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "category" "activity_category"`,
    );

    // 3. Backfill inverso nombre→enum; UUIDs sin match caen a 'familiar'.
    await queryRunner.query(
      `UPDATE "activity" a
       SET "category" = CASE c.name
         WHEN 'Salud'      THEN 'salud'
         WHEN 'Educación'  THEN 'educacion'
         WHEN 'Social'     THEN 'social'
         WHEN 'Familiar'   THEN 'familiar'
         WHEN 'Recreación' THEN 'recreacion'
       END
       FROM "category" c
       WHERE a."category_id" = c.id AND a."category" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "activity" SET "category" = 'familiar' WHERE "category" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "activity" ALTER COLUMN "category" SET NOT NULL`);

    // 4. Retirar FK + índice + columna FK (orden seguro).
    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_activity_category'
             AND conrelid = '"activity"'::regclass
         ) THEN
           ALTER TABLE "activity" DROP CONSTRAINT "FK_activity_category";
         END IF;
       END
       $$`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_activity_category"`);
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "category_id"`);
  }
}
