import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryCriticality1790726400000 implements MigrationInterface {
  name = 'AddCategoryCriticality1790726400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "category" ADD COLUMN IF NOT EXISTS "criticality" criticality NOT NULL DEFAULT 'medium'`,
    );
    await queryRunner.query(`
      UPDATE "category" SET "criticality" = v.crit::criticality FROM (VALUES
        ('Salud','critical'),
        ('Educación','critical'),
        ('Familiar','medium'),
        ('Social','low'),
        ('Recreación','low')
      ) AS v(name, crit) WHERE "category"."name" = v.name
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "category" DROP COLUMN IF EXISTS "criticality"`);
  }
}
