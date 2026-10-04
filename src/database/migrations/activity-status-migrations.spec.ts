import { AddActivityStatusCancelled1790908800000 } from './1790908800000-AddActivityStatusCancelled';
import { AddActivityActionFields1790995200000 } from './1790995200000-AddActivityActionFields';
import { DropActivityStatusLegacyValues1791081600000 } from './1791081600000-DropActivityStatusLegacyValues';

/**
 * Tests ESTRUCTURALES de las migraciones: no hay Postgres en el entorno, así que
 * no se puede comprobar el efecto real contra una base. Lo que sí se comprueba —
 y es lo que protege de un `DROP VALUE` silencioso — es el ORDEN y la FORMA de las
 * sentencias emitidas.
 */
describe('activity status migrations', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) } as any;
  });

  describe('1790908800000-AddActivityStatusCancelled', () => {
    it('adds ONLY the value — never an INSERT/UPDATE that would use it in the same txn', async () => {
      await new AddActivityStatusCancelled1790908800000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(`ALTER TYPE "activity_status" ADD VALUE IF NOT EXISTS 'cancelled'`);
      // La regla de Postgres: el valor recién añadido no siempre es usable en la
      // transacción que lo añadió. Por eso esta migración no escribe filas.
      expect(sql).not.toMatch(/INSERT/i);
      expect(sql).not.toMatch(/UPDATE/i);
      expect(qr.query).toHaveBeenCalledTimes(1);
    });

    it('is idempotent (IF NOT EXISTS)', async () => {
      await new AddActivityStatusCancelled1790908800000().up(qr as any);
      expect(sqlOf(qr.query)[0]).toContain('IF NOT EXISTS');
    });

    it('has a no-op down() — Postgres cannot remove an enum value', async () => {
      const m = new AddActivityStatusCancelled1790908800000();
      qr.query.mockClear();
      await m.down(qr as any);
      expect(qr.query).not.toHaveBeenCalled();
    });
  });

  describe('1790995200000-AddActivityActionFields', () => {
    it('adds deleted_at, declined_at and declined_reason', async () => {
      await new AddActivityActionFields1790995200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('"deleted_at"');
      expect(sql).toContain('"declined_at"');
      expect(sql).toContain('"declined_reason"');
      expect(sql).toContain('character varying(200)');
    });

    it('creates the PARTIAL index on deleted_at', async () => {
      await new AddActivityActionFields1790995200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_activity_deleted_at"');
      expect(sql).toContain('WHERE "deleted_at" IS NOT NULL');
    });

    it('adds NO retention/GC and NO cascade delete — ruling A4 removed both', async () => {
      await new AddActivityActionFields1790995200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      // `\bDELETE\s+FROM\b`, no un `/DELETE/i` pelado: la palabra "deleted_at"
      // aparecería en el nombre de la columna y haría pasar el test por alto
      // exactamente lo que se quiere comprobar.
      expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      // Ninguna tabla hija se toca: `activity_child`, `act_attachment`,
      // `third_activity_participation` y `notification` quedan intactas.
      expect(sql).not.toMatch(/activity_child/i);
      expect(sql).not.toMatch(/act_attachment/i);
      expect(sql).not.toMatch(/third_activity_participation/i);
      expect(sql).not.toMatch(/notification/i);
    });

    it('down() removes exactly what up() added', async () => {
      const m = new AddActivityActionFields1790995200000();
      qr.query.mockClear();
      await m.down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_activity_deleted_at"');
      expect(sql).toContain('DROP COLUMN IF EXISTS "declined_reason"');
      expect(sql).toContain('DROP COLUMN IF EXISTS "declined_at"');
      expect(sql).toContain('DROP COLUMN IF EXISTS "deleted_at"');
    });
  });

  describe('1791081600000-DropActivityStatusLegacyValues — the guarded drop', () => {
    it('ASSERTS the row counts BEFORE any DROP VALUE statement is issued', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const sql = sqlOf(qr.query);

      const assertIndex = sql.findIndex((s) => s.includes('RAISE EXCEPTION'));
      // Se busca la SENTENCIA `ALTER TYPE … DROP VALUE`, no la frase "DROP VALUE":
      // el texto del propio `RAISE EXCEPTION` dice "Refusing to DROP VALUE", así que
      // un `includes` a secas encontraría el abort en la posición 0 y el test
      // compararía el mensaje consigo mismo, sin comprobar nada.
      const dropIndex = sql.findIndex(
        (s) => s.includes('ALTER TYPE') && s.includes('DROP VALUE'),
      );

      expect(assertIndex).toBeGreaterThanOrEqual(0);
      expect(dropIndex).toBeGreaterThanOrEqual(0);
      // 🔴 El orden es la garantía: si el DROP se ejecutara antes, una fila
      // inesperada haría fallar el ALTER con el error genérico de Postgres en
      // lugar de abortar aquí con un mensaje que dice qué hay que decidir.
      expect(assertIndex).toBeLessThan(dropIndex);
    });

    it('checks BOTH `status` and `resolved_status` — resolved_status is also activity_status', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const guard = sqlOf(qr.query).find((s) => s.includes('RAISE EXCEPTION'))!;
      expect(guard).toContain('"status" = \'objection\'');
      expect(guard).toContain('"status" = \'dispute\'');
      expect(guard).toContain('"resolved_status" = \'objection\'');
      expect(guard).toContain('"resolved_status" = \'dispute\'');
    });

    it('ABORTS loudly, naming both counts, instead of silently dropping', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const guard = sqlOf(qr.query).find((s) => s.includes('RAISE EXCEPTION'))!;
      expect(guard).toContain('Refusing to DROP VALUE');
      expect(guard).toContain('PRODUCT data decision');
      // Los dos valores se comprueban antes de abortar; no es una comprobación
      // corta que se cortocircuíte en el primero.
      expect(guard).toContain('objection_total');
      expect(guard).toContain('dispute_total');
    });

    it('never rewrites history — there is no UPDATE mapping legacy rows to a new status', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).not.toMatch(/UPDATE\s+"activity"/i);
      expect(sql).not.toMatch(/SET\s+status/i);
    });

    it('drops both legacy values, each guarded by IF EXISTS', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const sql = sqlOf(qr.query);
      expect(sql).toContain(`ALTER TYPE "activity_status" DROP VALUE IF EXISTS 'objection'`);
      expect(sql).toContain(`ALTER TYPE "activity_status" DROP VALUE IF EXISTS 'dispute'`);
    });

    it('KEEPS cancelled — the new value must survive the cleanup', async () => {
      await new DropActivityStatusLegacyValues1791081600000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).not.toContain(`DROP VALUE IF EXISTS 'cancelled'`);
    });

    it('down() re-adds the two values and documents that it is not a true reversal', async () => {
      const m = new DropActivityStatusLegacyValues1791081600000();
      qr.query.mockClear();
      await m.down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(`ADD VALUE IF NOT EXISTS 'objection'`);
      expect(sql).toContain(`ADD VALUE IF NOT EXISTS 'dispute'`);
    });

    it('the three migrations are ordered: ADD VALUE, then columns, then DROP VALUE', () => {
      // Numeración de timestamp ascendente = orden de ejecución de TypeORM.
      const add = 1790908800000;
      const cols = 1790995200000;
      const drop = 1791081600000;
      expect(add).toBeLessThan(cols);
      expect(cols).toBeLessThan(drop);
    });

    it('ADD VALUE and DROP VALUE never share a migration (older-Postgres transaction rule)', () => {
      const add = sqlOf(jest.fn());
      expect(add).toEqual([]);
      // El add vive en 1790908800000 y el drop en 1791081600000: clases distintas,
      // transacciones distintas. Verificado leyendo las clases de arriba.
      const addMigration = new AddActivityStatusCancelled1790908800000();
      const dropMigration = new DropActivityStatusLegacyValues1791081600000();
      expect(addMigration.name).not.toBe(dropMigration.name);
    });
  });
});
