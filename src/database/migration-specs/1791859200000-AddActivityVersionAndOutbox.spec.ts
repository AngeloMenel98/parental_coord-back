import { AddActivityVersionAndOutbox1791859200000 } from '../migrations/1791859200000-AddActivityVersionAndOutbox';

/**
 * Tests ESTRUCTURALES de la migración E1. Sin Postgres en CI, lo que se protege
 * es el ORDEN y la FORMA del DDL: la columna `version`, la tabla `outbox_event`
 * con su FK y el índice PARCIAL de pendientes.
 */
describe('1791859200000-AddActivityVersionAndOutbox migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds activity.version as integer NOT NULL DEFAULT 0', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "version"');
      expect(sql).toContain('"version" integer NOT NULL DEFAULT 0');
    });

    it('backfills deadline to NULL (documented no-op backfill)', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('UPDATE "activity" SET "deadline" = NULL WHERE "deadline" IS NOT NULL');
    });

    it('creates outbox_event with the exact columns', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "outbox_event"');
      expect(sql).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
      expect(sql).toContain('"aggregate_id" uuid NOT NULL');
      expect(sql).toContain('"bond_id" uuid NOT NULL');
      expect(sql).toContain('"event_type" character varying(64) NOT NULL');
      expect(sql).toContain('"aggregate_version" integer NOT NULL');
      expect(sql).toContain(`"payload" jsonb NOT NULL DEFAULT '{}'`);
      expect(sql).toContain('"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
      expect(sql).toContain('"dispatched_at" TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain('CONSTRAINT "PK_outbox_event_id" PRIMARY KEY ("id")');
    });

    it('wires the FK aggregate_id -> activity ON DELETE CASCADE (and bond_id -> bond)', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CONSTRAINT "FK_outbox_event_activity"');
      expect(sql).toContain(
        'FOREIGN KEY ("aggregate_id") REFERENCES "activity"("id") ON DELETE CASCADE',
      );
      expect(sql).toContain('CONSTRAINT "FK_outbox_event_bond"');
      expect(sql).toContain('FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE');
    });

    it('creates the PARTIAL index on dispatched_at IS NULL (the pending rows)', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_outbox_pending" ON "outbox_event" ("dispatched_at") WHERE "dispatched_at" IS NULL',
      );
    });

    it('creates NO enum type for event_type (varchar(64), per design D4)', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).not.toMatch(/CREATE TYPE/i);
    });

    it('is idempotent (IF NOT EXISTS guards)', async () => {
      await new AddActivityVersionAndOutbox1791859200000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });

  describe('down()', () => {
    it('drops the index, the table and the version column exactly', async () => {
      await new AddActivityVersionAndOutbox1791859200000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_outbox_pending"');
      expect(sql).toContain('DROP TABLE IF EXISTS "outbox_event"');
      expect(sql).toContain('ALTER TABLE "activity" DROP COLUMN IF EXISTS "version"');
    });

    it('drops the index BEFORE the table it indexes', async () => {
      await new AddActivityVersionAndOutbox1791859200000().down(qr as any);
      const sql = sqlOf(qr.query);
      const idx = sql.findIndex((s) => s.includes('DROP INDEX IF EXISTS "IDX_outbox_pending"'));
      const table = sql.findIndex((s) => s.includes('DROP TABLE IF EXISTS "outbox_event"'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(table).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(table);
    });
  });
});
