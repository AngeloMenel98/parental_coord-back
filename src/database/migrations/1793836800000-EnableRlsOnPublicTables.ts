import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hardening: RLS en el schema `public`.
 *
 * Supabase expone PostgREST sobre `public`, y las tablas que crean las migraciones
 * en proyectos viejos nacen con grants para `anon` y `authenticated`. Sin RLS esos
 * grants valen acceso total con la anon key, que va publicada en el cliente por
 * diseño. Eso es lo que reporta el database linter como `rls_disabled_in_public`:
 * no es "RLS débil", es "no hay RLS".
 *
 * Este backend no usa PostgREST: la API y el worker entran por TCP como el rol de
 * `DB_USER` (`postgres.<ref>` en Supabase, owner de las tablas), así que RLS no los
 * afecta. Lo que se cierra es la puerta REST.
 *
 * - `ENABLE ROW LEVEL SECURITY` en toda tabla de `public` **sin políticas**: para
 *   cualquier rol que no sea owner ni tenga BYPASSRLS el resultado es deny-all.
 * - `REVOKE ALL` de `anon` y `authenticated` (guardado: en el Postgres de dev esos
 *   roles no existen y los bloques no hacen nada).
 * - `ALTER DEFAULT PRIVILEGES` para que las tablas y secuencias futuras creadas por
 *   **este** rol migrador ya no reciban grants. Un objeto creado por otro rol no
 *   queda cubierto por acá: ver el README.
 *
 * No se usa `FORCE ROW LEVEL SECURITY` a propósito: el owner tiene que seguir viendo
 * y escribiendo todo, que es exactamente el camino de la aplicación.
 *
 * Los objetos de `public` cuyo owner no somos (típico de extensiones instaladas por
 * otro rol, p. ej. `spatial_ref_sys`) no se tocan: se avisa por NOTICE. Tampoco se
 * aborta si Postgres niega un `REVOKE` puntual; ese grant queda listado por NOTICE.
 * La tabla igual queda cerrada por RLS, que es el control que decide el acceso.
 *
 * Caveat que queda documentado en el README: una migración futura que cree tablas
 * **tiene** que incluir su propio `ENABLE ROW LEVEL SECURITY`; los loops de acá
 * corren una sola vez.
 */
export class EnableRlsOnPublicTables1793836800000 implements MigrationInterface {
  name = 'EnableRlsOnPublicTables1793836800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotente: sólo toca tablas (y particiones) que todavía no tienen RLS.
    await queryRunner.query(`
      DO $$
      DECLARE
        r record;
        skipped text[] := ARRAY[]::text[];
      BEGIN
        FOR r IN
          SELECT c.relname, c.relowner, pg_get_userbyid(c.relowner) AS owner_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND NOT c.relrowsecurity
          ORDER BY c.relname
        LOOP
          IF pg_has_role(r.relowner, 'MEMBER') THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
          ELSE
            skipped := skipped || (r.relname || ' (owner ' || r.owner_name || ')');
          END IF;
        END LOOP;

        IF array_length(skipped, 1) IS NOT NULL THEN
          RAISE NOTICE 'RLS: tablas de public sin tocar por ownership: %',
            array_to_string(skipped, ', ');
        END IF;
      END
      $$;
    `);

    // `anon` y `authenticated` sólo existen en Supabase; en dev los bloques son
    // no-ops. El revoke va tabla por tabla y con el mismo criterio de ownership que
    // el bloque anterior: `REVOKE ... ON ALL TABLES IN SCHEMA` aborta con
    // `permission denied` apenas hay una tabla de otro owner, y eso dejaría la
    // migración a medio aplicar por un objeto ajeno al backend.
    await queryRunner.query(`
      DO $$
      DECLARE
        r record;
        role_name text;
        roles text[] := ARRAY[]::text[];
        skipped text[] := ARRAY[]::text[];
        failed text[] := ARRAY[]::text[];
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            roles := roles || role_name;
          END IF;
        END LOOP;

        IF array_length(roles, 1) IS NOT NULL THEN
          FOR r IN
            SELECT c.relname, c.relowner, pg_get_userbyid(c.relowner) AS owner_name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
            ORDER BY c.relname
          LOOP
            IF pg_has_role(r.relowner, 'MEMBER') THEN
              FOREACH role_name IN ARRAY roles
              LOOP
                BEGIN
                  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
                    r.relname, role_name);
                EXCEPTION
                  WHEN insufficient_privilege THEN
                    failed := failed || (r.relname || ' -> ' || role_name);
                END;
              END LOOP;
            ELSE
              skipped := skipped || (r.relname || ' (owner ' || r.owner_name || ')');
            END IF;
          END LOOP;

          FOR r IN
            SELECT c.relname, c.relowner, pg_get_userbyid(c.relowner) AS owner_name
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'S'
            ORDER BY c.relname
          LOOP
            IF pg_has_role(r.relowner, 'MEMBER') THEN
              FOREACH role_name IN ARRAY roles
              LOOP
                BEGIN
                  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %I',
                    r.relname, role_name);
                EXCEPTION
                  WHEN insufficient_privilege THEN
                    failed := failed || (r.relname || ' -> ' || role_name);
                END;
              END LOOP;
            END IF;
          END LOOP;

          -- Objetos que cree este rol migrador de acá en adelante. Los que cree
          -- otro rol no entran en este ACL por defecto.
          FOREACH role_name IN ARRAY roles
          LOOP
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
              role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
              role_name);
          END LOOP;
        END IF;

        IF array_length(skipped, 1) IS NOT NULL THEN
          RAISE NOTICE 'RLS: grants no revisados por ownership: %',
            array_to_string(skipped, ', ');
        END IF;
        IF array_length(failed, 1) IS NOT NULL THEN
          RAISE NOTICE 'RLS: grants que Postgres no dejó revocar (los cierra RLS): %',
            array_to_string(failed, ', ');
        END IF;
      END
      $$;
    `);
  }

  /**
   * Reversión real, no un no-op silencioso. `migration:revert` tiene que devolver la
   * base al estado anterior: si el hardening causa una caída (un consumidor legítimo de
   * PostgREST empieza a recibir 401) ese es el camino de recuperación, y un `down()`
   * vacío reportaba éxito sin deshacer nada. Deshace lo mismo que `up()` con el mismo
   * criterio de ownership: RLS afuera y grants de `anon`/`authenticated` de vuelta.
   *
   * Ojo: revertir vuelve a dejar las tablas de `public` legibles con la anon key.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        r record;
        skipped text[] := ARRAY[]::text[];
      BEGIN
        FOR r IN
          SELECT c.relname, c.relowner, pg_get_userbyid(c.relowner) AS owner_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p')
            AND c.relrowsecurity
          ORDER BY c.relname
        LOOP
          IF pg_has_role(r.relowner, 'MEMBER') THEN
            EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.relname);
          ELSE
            skipped := skipped || (r.relname || ' (owner ' || r.owner_name || ')');
          END IF;
        END LOOP;

        IF array_length(skipped, 1) IS NOT NULL THEN
          RAISE NOTICE 'RLS revert: tablas sin tocar por ownership: %',
            array_to_string(skipped, ', ');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        r record;
        role_name text;
        roles text[] := ARRAY[]::text[];
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            roles := roles || role_name;
          END IF;
        END LOOP;

        IF array_length(roles, 1) IS NOT NULL THEN
          FOR r IN
            SELECT c.relname, c.relowner
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
            ORDER BY c.relname
          LOOP
            IF pg_has_role(r.relowner, 'MEMBER') THEN
              FOREACH role_name IN ARRAY roles
              LOOP
                BEGIN
                  EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO %I',
                    r.relname, role_name);
                EXCEPTION
                  WHEN insufficient_privilege THEN
                    RAISE NOTICE 'RLS revert: no se pudo re-otorgar % sobre %',
                      role_name, r.relname;
                END;
              END LOOP;
            END IF;
          END LOOP;

          FOR r IN
            SELECT c.relname, c.relowner
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'S'
            ORDER BY c.relname
          LOOP
            IF pg_has_role(r.relowner, 'MEMBER') THEN
              FOREACH role_name IN ARRAY roles
              LOOP
                BEGIN
                  EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE public.%I TO %I',
                    r.relname, role_name);
                EXCEPTION
                  WHEN insufficient_privilege THEN
                    RAISE NOTICE 'RLS revert: no se pudo re-otorgar % sobre %',
                      role_name, r.relname;
                END;
              END LOOP;
            END IF;
          END LOOP;

          FOREACH role_name IN ARRAY roles
          LOOP
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I',
              role_name);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I',
              role_name);
          END LOOP;
        END IF;
      END
      $$;
    `);
  }
}
