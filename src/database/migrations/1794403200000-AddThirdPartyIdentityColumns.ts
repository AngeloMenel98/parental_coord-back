import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * S1 de `odd/tasks/thirdparty-identity.md` (front repo): identidad declarada del
 * tercero. El progenitor captura nombre, apellido, teléfono y documento al otorgar
 * el acceso; el nombre alimenta la asignación de actividades y la atribución en
 * cards (S2/S3).
 *
 * Es dato del GRANT, no de la cuenta: una cuenta puede servir a grants de distintos
 * vínculos y cada progenitor declara la identidad que le corresponde. Nullable en
 * los cuatro (sin NOT NULL): las filas previas a la feature sobreviven (S6) y el
 * front los lee como `string | null`.
 */
export class AddThirdPartyIdentityColumns1794403200000 implements MigrationInterface {
  name = 'AddThirdPartyIdentityColumns1794403200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "first_name" varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "last_name" varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "phone" varchar(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_third_party" ADD COLUMN "document" varchar(30)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "document"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "phone"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "last_name"`);
    await queryRunner.query(`ALTER TABLE "auth_third_party" DROP COLUMN IF EXISTS "first_name"`);
  }
}
