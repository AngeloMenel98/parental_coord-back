import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A5 · Paso 1 de 3 — `ADD VALUE 'cancelled'`.
 *
 * 🔴 Va en su PROPIA migración, y no junto al `DROP VALUE` de `objection`/
 * `dispute`, por la regla de Postgres: un valor añadido con `ALTER TYPE ...
 * ADD VALUE` no siempre es usable dentro de la misma transacción que lo añadió
 * (comportamiento de las versiones antiguas, documentado en
 * `1790822400000-ExtendActivityStatus.ts`). Separando el `ADD` del `DROP` en
 * transacciones distintas, ninguna depende de esa ventana.
 *
 * ⚠ Esta migración NO inserta ni actualiza ninguna fila con `'cancelled'` por el
 * mismo motivo. La primera escritura ocurre en la aplicación, ya con el valor
 * commiteado.
 *
 * ⚠🔴 `down()` es un no-op: Postgres no puede quitar un valor de un enum. La
 * migración es IRREVERSIBLE, igual que su predecesora.
 *
 * ⚠🔴 ESTA MIGRACIÓN NO SE HA EJECUTADO. Postgres está caído en el entorno
 * (`pg_isready` → `127.0.0.1:5432 - no response`, y `kubectl` no está instalado
 * para alcanzar el clúster de minikube), así que la migración está escrita pero
 * NO verificada contra una base real.
 */
export class AddActivityStatusCancelled1790908800000 implements MigrationInterface {
  name = 'AddActivityStatusCancelled1790908800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'cancelled'`);
  }

  // Sin parámetro: `MigrationInterface` admite implementaciones con menos
  // parámetros, y declararlo sin usar sólo añade un error de lint.
  public async down(): Promise<void> {
    // Irreversible: Postgres no permite quitar valores de un enum.
  }
}
