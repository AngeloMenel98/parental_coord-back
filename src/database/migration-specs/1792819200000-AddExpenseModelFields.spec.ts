import { AddExpenseModelFields1792819200000 } from '../migrations/1792819200000-AddExpenseModelFields';

/**
 * Tests ESTRUCTURALES de la migración AddExpenseModelFields (wave 2 · T14).
 *
 * Sin Postgres en CI se protege la FORMA: las tres columnas entran con
 * `IF NOT EXISTS`, las dos FK con guarda de `pg_constraint` y la política de
 * borrado que cada una necesita, los índices, y en `down()` el orden inverso
 * seguro (índices → FK → columnas).
 *
 * No se testea backfill porque no hay ninguno: `category_id` y `activity_id`
 * quedan NULL en las filas históricas a propósito (ver el KDoc de la migración).
 */
describe('1792819200000-AddExpenseModelFields migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));
  const up = async () => {
    await new AddExpenseModelFields1792819200000().up(qr as any);
    return sqlOf(qr.query);
  };
  const down = async () => {
    await new AddExpenseModelFields1792819200000().down(qr as any);
    return sqlOf(qr.query);
  };

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds the three columns idempotently', async () => {
      const sql = await up();

      expect(sql).toContain('ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "category_id" uuid');
      expect(sql).toContain('ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "activity_id" uuid');
      expect(sql).toContain(
        'ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE',
      );
    });

    it('leaves every new column nullable: history has no category, activity or delete mark', async () => {
      const sql = await up();

      const newColumns = sql.filter((s) => s.includes('ADD COLUMN IF NOT EXISTS'));
      expect(newColumns).toHaveLength(3);
      for (const statement of newColumns) {
        expect(statement).not.toContain('NOT NULL');
      }
    });

    it('does not backfill: it would invent a category or an origin for old rows', async () => {
      const sql = await up();

      expect(sql.filter((s) => /\bUPDATE\b/i.test(s))).toHaveLength(0);
      expect(sql.filter((s) => /SET NOT NULL/i.test(s))).toHaveLength(0);
    });

    it('creates the category FK guarded, RESTRICTing a category delete', async () => {
      const sql = await up();
      const fk = sql.find((s) => s.includes('FK_expense_category'));

      expect(fk).toBeDefined();
      expect(fk).toContain('pg_constraint');
      expect(fk).toContain('conrelid = \'"expense"\'::regclass');
      expect(fk).toContain(
        'FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT',
      );
    });

    it('creates the activity FK guarded, SET NULL so deleting an activity never deletes money', async () => {
      const sql = await up();
      const fk = sql.find((s) => s.includes('FK_expense_activity'));

      expect(fk).toBeDefined();
      expect(fk).toContain('pg_constraint');
      expect(fk).toContain(
        'FOREIGN KEY ("activity_id") REFERENCES "activity"("id") ON DELETE SET NULL',
      );
    });

    it('indexes both lookups used by the expense reads', async () => {
      const sql = await up();

      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_expense_category" ON "expense" ("category_id")',
      );
      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_expense_activity" ON "expense" ("activity_id")',
      );
    });

    it('indexes deleted_at partially, like activity does', async () => {
      const sql = await up();

      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_expense_deleted_at" ON "expense" ("deleted_at") WHERE "deleted_at" IS NOT NULL',
      );
    });

    it('never touches a pre-existing column', async () => {
      const sql = await up();

      expect(sql.filter((s) => /DROP COLUMN/i.test(s))).toHaveLength(0);
      expect(sql.filter((s) => /DROP CONSTRAINT/i.test(s))).toHaveLength(0);
    });
  });

  describe('down()', () => {
    it('drops indexes BEFORE the FKs, and the FKs BEFORE the columns', async () => {
      const sql = await down();
      const idxCategory = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "IDX_expense_category"'),
      );
      const idxActivity = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "IDX_expense_activity"'),
      );
      const idxDeleted = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "IDX_expense_deleted_at"'),
      );
      const fkCategory = sql.findIndex((s) => s.includes('DROP CONSTRAINT "FK_expense_category"'));
      const fkActivity = sql.findIndex((s) => s.includes('DROP CONSTRAINT "FK_expense_activity"'));
      const colCategory = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "category_id"'));
      const colActivity = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "activity_id"'));
      const colDeleted = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "deleted_at"'));

      for (const index of [
        idxCategory,
        idxActivity,
        idxDeleted,
        fkCategory,
        fkActivity,
        colCategory,
        colActivity,
        colDeleted,
      ]) {
        expect(index).toBeGreaterThanOrEqual(0);
      }
      expect(fkCategory).toBeGreaterThan(Math.max(idxCategory, idxActivity, idxDeleted));
      expect(fkActivity).toBeGreaterThan(Math.max(idxCategory, idxActivity, idxDeleted));
      expect(colCategory).toBeGreaterThan(fkCategory);
      expect(colActivity).toBeGreaterThan(fkActivity);
    });

    it('drops every FK guardedly so a manual revert does not abort', async () => {
      const sql = await down();
      const fkDrops = sql.filter((s) => s.includes('DROP CONSTRAINT "FK_expense_'));

      expect(fkDrops).toHaveLength(2);
      for (const statement of fkDrops) {
        expect(statement).toContain('pg_constraint');
      }
    });
  });
});
