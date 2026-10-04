import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendActivityStatus1790822400000 implements MigrationInterface {
  name = 'ExtendActivityStatus1790822400000';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    await _queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'assisting'`);
    await _queryRunner.query(
      `ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'not_assisting'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot remove enum values easily in Postgres; leave as no-op for safety
  }
}
