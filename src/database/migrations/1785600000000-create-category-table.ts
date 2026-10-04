import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `category` table and seeds the 5 default categories
 * that were previously defined as the `activity_category` enum.
 *
 * After this migration, the `activity.category` column should be
 * migrated from enum → uuid FK (handled in a follow-up migration).
 */
export class CreateCategoryTable1785600000000 implements MigrationInterface {
  name = 'CreateCategoryTable1785600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create category table
    await queryRunner.query(
      `CREATE TABLE "category" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(100) NOT NULL,
        "description" text,
        "color" character varying(7),
        "icon" character varying(50),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_category_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_category_name" UNIQUE ("name")
      )`,
    );

    // Seed default categories (matching the old enum values)
    await queryRunner.query(
      `INSERT INTO "category" ("name", "description", "color", "icon") VALUES
        ('Salud',      'Actividades médicas, citas y salud de los hijos',   '#22C55E', 'heart-pulse'),
        ('Educación',  'Actividades escolares, tutorías y educación',       '#3B82F6', 'graduation-cap'),
        ('Social',     'Actividades sociales, fiestas y eventos',           '#A855F7', 'users'),
        ('Familiar',   'Actividades familiares, reuniones y convivencia',   '#F59E0B', 'home'),
        ('Recreación', 'Actividades recreativas, deportes y ocio libre',    '#EF4444', 'palette')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "category"`);
  }
}
