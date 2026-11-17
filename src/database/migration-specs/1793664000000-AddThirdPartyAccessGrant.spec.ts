import { QueryRunner } from 'typeorm';

import { AddThirdPartyAccessGrant1793664000000 } from '../migrations/1793664000000-AddThirdPartyAccessGrant';

/**
 * T1 · estructura de la migración.
 *
 * Igual que el resto de `migration-specs`: no hay Postgres en el test, así que se
 * verifica el SQL — que las guardas corran ANTES de las columnas NOT NULL, que los
 * enums se agreguen con `IF NOT EXISTS` y que el único índice parcial sea el que
 * permite revocar y volver a otorgar.
 */
describe('AddThirdPartyAccessGrant1793664000000', () => {
  const migration = new AddThirdPartyAccessGrant1793664000000();

  const collect = async (method: 'up' | 'down'): Promise<string[]> => {
    const queries: string[] = [];
    const qr = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return undefined;
      }),
    } as unknown as QueryRunner;

    await migration[method](qr);
    return queries;
  };

  const indexOf = (queries: string[], needle: string): number =>
    queries.findIndex((sql) => sql.includes(needle));

  it('agrega los dos valores de enum de forma idempotente', async () => {
    const queries = await collect('up');
    expect(queries.some((sql) => sql.includes(`ALTER TYPE "bond_member_role" ADD VALUE IF NOT EXISTS 'third_party'`))).toBe(true);
    expect(queries.some((sql) => sql.includes(`ALTER TYPE "auth_third_status" ADD VALUE IF NOT EXISTS 'expired'`))).toBe(true);
  });

  it('crea el tipo de relación sólo si no existe', async () => {
    const queries = await collect('up');
    const creation = queries.find((sql) => sql.includes('CREATE TYPE "third_party_relationship"'));
    expect(creation).toBeDefined();
    expect(creation).toContain('family');
    expect(creation).toContain('caregiver');
    expect(queries.some((sql) => sql.includes(`typname = 'third_party_relationship'`))).toBe(true);
  });

  it('falla ruidosamente si hay grants sin fecha, ANTES del NOT NULL', async () => {
    const queries = await collect('up');
    const guard = indexOf(queries, `WHERE "end_date" IS NULL`);
    const notNull = indexOf(queries, `ALTER COLUMN "end_date" SET NOT NULL`);

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(queries[guard]).toContain('RAISE EXCEPTION');
    expect(notNull).toBeGreaterThan(guard);
  });

  it('no agrega la relación obligatoria si ya hay filas que no podrían declararla', async () => {
    const queries = await collect('up');
    const guard = indexOf(queries, `IF EXISTS (SELECT 1 FROM "auth_third_party") THEN`);
    const column = indexOf(queries, `ADD COLUMN "relationship"`);

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(column).toBeGreaterThan(guard);
  });

  it('un solo grant activo por par, y los revocados no compiten', async () => {
    const queries = await collect('up');
    const unique = queries.find((sql) => sql.includes('UQ_auth_third_party_active_grant'));

    expect(unique).toBeDefined();
    expect(unique).toContain(`"bond_id", "user_id"`);
    expect(unique).toContain(`WHERE "status" = 'active'`);
  });

  it('protege al usuario que revoca con ON DELETE RESTRICT', async () => {
    const queries = await collect('up');
    const fk = queries.find((sql) => sql.includes('FK_auth_third_party_revoked_by'));

    expect(fk).toBeDefined();
    expect(fk).toContain('ON DELETE RESTRICT');
  });

  it('indexa authorized_by para la consola del progenitor', async () => {
    const queries = await collect('up');
    expect(queries.some((sql) => sql.includes('IDX_auth_third_party_authorized_by'))).toBe(true);
  });

  it('down revierte columnas e índices sin tocar las etiquetas de enum', async () => {
    const queries = await collect('down');
    const all = queries.join('\n');

    expect(all).toContain('DROP INDEX IF EXISTS "UQ_auth_third_party_active_grant"');
    expect(all).toContain('DROP COLUMN IF EXISTS "relationship"');
    expect(all).toContain('DROP COLUMN IF EXISTS "revoked_by"');
    expect(all).toContain('ALTER COLUMN "end_date" DROP NOT NULL');
    expect(all).toContain('DROP TYPE IF EXISTS "third_party_relationship"');
    // Postgres no puede quitar etiquetas de un enum: se quedan, inertes.
    expect(all).not.toContain('DROP TYPE "bond_member_role"');
    expect(all).not.toContain('DROP TYPE "auth_third_status"');
  });
});
