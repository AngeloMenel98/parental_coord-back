import { AddActivityCategoryId1792540800000 } from '../migrations/1792540800000-AddActivityCategoryId';

/**
 * Tests ESTRUCTURALES de la migración AddActivityCategoryId (fix de deriva:
 * el entity exige `category_id` y ninguna migración previa lo creaba). Sin
 * Postgres en CI se protege la FORMA: la columna FK, el backfill guardado por
 * la columna legacy, el SET NOT NULL condicional, la FK con guarda, el índice,
 * y el drop de columna + enum en ese orden.
 */
describe('1792540800000-AddActivityCategoryId migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds the FK column idempotently (IF NOT EXISTS)', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const sql = sqlOf(qr.query);
      expect(sql[0]).toContain('ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "category_id" uuid');
    });

    it('guards the backfill on the legacy column existing (retry-safe)', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const backfill = sqlOf(qr.query).find((s) => s.includes('UPDATE "activity" a'));
      expect(backfill).toBeDefined();
      expect(backfill).toContain('information_schema.columns');
      expect(backfill).toContain("column_name = 'category'");
      expect(backfill).toContain('a."category"::text');
    });

    it('maps every legacy enum value to its seeded category (accents explicit)', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const backfill = sqlOf(qr.query).find((s) => s.includes('UPDATE "activity" a')) ?? '';
      expect(backfill).toContain(`WHEN 'salud'      THEN 'Salud'`);
      expect(backfill).toContain(`WHEN 'educacion'  THEN 'Educación'`);
      expect(backfill).toContain(`WHEN 'social'     THEN 'Social'`);
      expect(backfill).toContain(`WHEN 'familiar'   THEN 'Familiar'`);
      expect(backfill).toContain(`WHEN 'recreacion' THEN 'Recreación'`);
    });

    it('re-seeds missing canonical categories before backfilling', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const backfill = sqlOf(qr.query).find((s) => s.includes('UPDATE "activity" a')) ?? '';
      expect(backfill).toContain('INSERT INTO "category"');
      expect(backfill).toContain(`WHERE NOT EXISTS (`);
      expect(backfill).toContain(`'Recreación'`);
    });

    it('SET NOT NULL only when no NULLs remain (does not abort on retry)', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const notNull = sqlOf(qr.query).find((s) => s.includes('SET NOT NULL'));
      expect(notNull).toBeDefined();
      expect(notNull).toContain('NOT EXISTS (SELECT 1 FROM "activity" WHERE "category_id" IS NULL)');
      expect(notNull).toContain("is_nullable = 'YES'");
    });

    it('creates the FK with a pg_constraint guard (ON DELETE RESTRICT)', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const fk = sqlOf(qr.query).find((s) => s.includes('FK_activity_category'));
      expect(fk).toBeDefined();
      expect(fk).toContain('pg_constraint');
      expect(fk).toContain('FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT');
    });

    it('creates the category_id index', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      expect(sqlOf(qr.query).join('\n')).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_activity_category" ON "activity" ("category_id")',
      );
    });

    it('drops the legacy column BEFORE the enum, and the enum only when unused', async () => {
      await new AddActivityCategoryId1792540800000().up(qr as any);
      const sql = sqlOf(qr.query);
      const dropCol = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "category"'));
      const dropType = sql.findIndex((s) => s.includes('DROP TYPE IF EXISTS "activity_category"'));
      expect(dropCol).toBeGreaterThanOrEqual(0);
      expect(dropType).toBeGreaterThan(dropCol);
      expect(sql[dropType]).toContain('udt_name = \'activity_category\'');
    });
  });

  describe('down()', () => {
    it('rebuilds enum + legacy column before dropping the FK column', async () => {
      const migration = new AddActivityCategoryId1792540800000();
      await migration.down(qr as any);
      const sql = sqlOf(qr.query);
      const createType = sql.findIndex((s) => s.includes('CREATE TYPE "activity_category"'));
      const addLegacy = sql.findIndex((s) =>
        s.includes('ADD COLUMN IF NOT EXISTS "category" "activity_category"'),
      );
      const dropFkCol = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "category_id"'));
      expect(createType).toBeGreaterThanOrEqual(0);
      expect(addLegacy).toBeGreaterThan(createType);
      expect(dropFkCol).toBeGreaterThan(addLegacy);
    });

    it('backfills the legacy enum with an explicit reverse mapping + fallback', async () => {
      await new AddActivityCategoryId1792540800000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(`WHEN 'Educación'  THEN 'educacion'`);
      expect(sql).toContain(`SET "category" = 'familiar' WHERE "category" IS NULL`);
      expect(sql).toContain('ALTER COLUMN "category" SET NOT NULL');
    });

    it('drops index and FK guardedly before the column', async () => {
      await new AddActivityCategoryId1792540800000().down(qr as any);
      const sql = sqlOf(qr.query);
      const fk = sql.findIndex((s) => s.includes('DROP CONSTRAINT "FK_activity_category"'));
      const idx = sql.findIndex((s) => s.includes('DROP INDEX IF EXISTS "IDX_activity_category"'));
      const col = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "category_id"'));
      expect(fk).toBeGreaterThanOrEqual(0);
      expect(idx).toBeGreaterThan(fk);
      expect(col).toBeGreaterThan(idx);
    });
  });
});
