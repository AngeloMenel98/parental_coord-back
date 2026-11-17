import { QueryRunner } from 'typeorm';

import { AddUserMustChangePassword1793750400000 } from '../migrations/1793750400000-AddUserMustChangePassword';

/**
 * Estructura de la migración del flag de cambio obligatorio (S2/D3).
 *
 * Igual que el resto de `migration-specs`: sin Postgres en el test se verifica el SQL,
 * que es donde vive la garantía de que desplegar no bloquee a nadie (columna NOT NULL
 * con DEFAULT) y de que la migración se pueda volver atrás.
 */
describe('AddUserMustChangePassword1793750400000', () => {
  const migration = new AddUserMustChangePassword1793750400000();

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

  it('agrega must_change_password a `user` como NOT NULL DEFAULT false', async () => {
    const queries = await collect('up');
    const add = queries.find((sql) => sql.includes('ADD COLUMN'));

    expect(add).toBeDefined();
    expect(add).toContain('"user"');
    expect(add).toContain('"must_change_password"');
    expect(add).toContain('boolean');
    expect(add).toContain('NOT NULL');
    expect(add).toContain('DEFAULT false');
  });

  it('es idempotente: IF NOT EXISTS para que un deploy repetido no rompa', async () => {
    const queries = await collect('up');

    expect(queries[0]).toContain('IF NOT EXISTS');
  });

  it('down quita la columna y no toca el resto de la tabla', async () => {
    const queries = await collect('down');
    const all = queries.join('\n');

    expect(all).toContain('DROP COLUMN IF EXISTS "must_change_password"');
    expect(all).toContain('ALTER TABLE "user"');
    expect(queries).toHaveLength(1);
  });
});
