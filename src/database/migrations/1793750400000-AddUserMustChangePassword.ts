import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * S2/D3 · flag de cambio obligatorio de contraseña.
 *
 * `NOT NULL DEFAULT false` es lo que hace la migración segura sobre una base con filas:
 * al desplegar nadie queda bloqueado, y después sólo se marcan `true` las cuentas cuya
 * contraseña generó el sistema (alta de tercero con email desconocido y alta del admin).
 * Un usuario que se registra elige su propia contraseña: queda en `false` (D3).
 *
 * `IF NOT EXISTS` para que un deploy repetido no tumbe la migración.
 */
export class AddUserMustChangePassword1793750400000 implements MigrationInterface {
  name = 'AddUserMustChangePassword1793750400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "must_change_password"`);
  }
}
