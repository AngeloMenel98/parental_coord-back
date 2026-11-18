import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

// Mismo criterio que `src/database/data-source.ts`: el archivo de entorno se elige
// con `ENV_FILE` (`pnpm test:e2e:rls` usa `.env.test`, `typeorm:prod` usa `.env.prod`).
//
// Cuando `ENV_FILE` viene explícito, el archivo manda sobre la shell (`override`):
// si no, un `DB_NAME` exportado en la terminal hacía que este test verificara otra
// base y saliera verde sin haber mirado la que el script pidió verificar.
const envFile = process.env.ENV_FILE;
dotenv.config({ path: envFile ?? '.env', override: envFile !== undefined });

const REQUIRED = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const;
const missing = REQUIRED.filter((name) => !process.env[name]);

// `RLS_E2E_REQUIRED=1` lo pone el script dedicado: ahí no se saltea. Un verde sin
// base verificada es peor que un rojo, así que sin `DB_*` el archivo falla.
if (process.env.RLS_E2E_REQUIRED === '1' && missing.length > 0) {
  throw new Error(
    `RLS e2e: falta ${missing.join(', ')} en el entorno (ENV_FILE=${envFile ?? '(sin definir)'}). ` +
      'Aplicá `pnpm smoke:db:setup && pnpm smoke:db:migrate` o corregí el archivo de entorno.',
  );
}

/**
 * RLS en `public` (e2e) — propiedad de seguridad, no comportamiento de negocio.
 *
 * POR QUÉ EXISTE — Supabase expone PostgREST sobre `public`. Cualquier tabla sin RLS
 * que además tenga grants para `anon`/`authenticated` se lee y se escribe entera con
 * la anon key, que viaja en el cliente por diseño. Es el hallazgo
 * `rls_disabled_in_public` del database linter, y no se ve en ningún test funcional:
 * la API sigue andando perfecto mientras la puerta REST está abierta.
 *
 * La migración `1793836800000-EnableRlsOnPublicTables` cierra las tablas que existían
 * cuando corrió. Este test es el que atrapa la tabla nueva que alguien agregue sin
 * `ENABLE ROW LEVEL SECURITY` en su propia migración.
 *
 * Requiere las migraciones aplicadas en la base apuntada:
 *   pnpm smoke:db:setup && pnpm smoke:db:migrate && pnpm test:e2e:rls
 *
 * `pnpm test:e2e` (sin `DB_*`) saltea el bloque para no romper una máquina sin
 * Postgres; `pnpm test:e2e:rls` define `RLS_E2E_REQUIRED=1` y entonces falla si no
 * puede verificar. Además se comprueba contra qué base se conectó: verde en la base
 * equivocada no es evidencia de nada.
 */
(missing.length === 0 ? describe : describe.skip)('RLS en public (e2e)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    await dataSource.initialize();

    const [connected]: Array<{ db: string }> = await dataSource.query(
      'select current_database() as db',
    );
    expect(connected.db).toBe(process.env.DB_NAME);
  }, 20000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('toda tabla de public tiene RLS habilitado', async () => {
    const rows: Array<{ relname: string }> = await dataSource.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity
      order by 1
    `);

    expect(rows.map((row) => row.relname)).toEqual([]);
  });

  it('anon y authenticated no tienen privilegios sobre las tablas de public', async () => {
    // `aclexplode` lee el ACL real de la tabla; `information_schema.role_table_grants`
    // sólo muestra las filas donde el usuario actual es grantor o grantee.
    const rows: Array<{ relname: string; grantee: string; privilege_type: string }> =
      await dataSource.query(`
        select c.relname, a.grantee::regrole::text as grantee, a.privilege_type
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and a.grantee <> 0
          and a.grantee::regrole::text in ('anon', 'authenticated')
        order by 1, 2, 3
      `);

    expect(rows).toEqual([]);
  });
});
