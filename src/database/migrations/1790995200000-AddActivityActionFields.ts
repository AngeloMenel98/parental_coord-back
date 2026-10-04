import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A5 · Paso 2 de 3 — columnas de las acciones de swipe. Sólo DDL de tabla.
 *
 * A4 · `deleted_at` es la ÚNICA marca de "Eliminar". No hay retención de 30 días,
 * ni purga, ni borrado en cascada de las tablas hijas: el ruling A4 eliminó las
 * tres cosas. La fila se queda para siempre con la bandera puesta y el audit log
 * la deja trazable; deshacer es `POST /activities/:id/restore` dentro de 5000 ms.
 *
 * ⚠ `declined_reason` es `varchar(200)` porque el validador compartido corta en
 * 200 caracteres ANTES de escribir, así que la columna nunca trunca en silencio.
 *
 * ⚠🔴 ESTA MIGRACIÓN NO SE HA EJECUTADO (Postgres caído en el entorno). Escrita y
 * no verificada contra una base real.
 */
export class AddActivityActionFields1790995200000 implements MigrationInterface {
  name = 'AddActivityActionFields1790995200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "declined_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "declined_reason" character varying(200)`,
    );

    // Índice PARCIAL: las consultas vivas filtran por `deleted_at IS NULL`, así que
    // un índice completo sólo guardaría entradas que ninguna consulta busca.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_activity_deleted_at" ON "activity" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_activity_deleted_at"`);
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "declined_reason"`);
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "declined_at"`);
    await queryRunner.query(`ALTER TABLE "activity" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
