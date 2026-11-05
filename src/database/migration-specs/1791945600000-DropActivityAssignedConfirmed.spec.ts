import { DropActivityAssignedConfirmed1791945600000 } from '../migrations/1791945600000-DropActivityAssignedConfirmed';

/**
 * Tests ESTRUCTURALES de la migración E7. Sin Postgres en CI se protege la FORMA y el
 * ORDEN del DDL: `up()` retira la columna legada; `down()` la recrea con su shape
 * original y ejecuta el backfill derivado (`assisting AND confirmed_at IS NOT NULL`).
 */
describe('1791945600000-DropActivityAssignedConfirmed migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('drops activity.assigned_confirmed (IF EXISTS)', async () => {
      await new DropActivityAssignedConfirmed1791945600000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('ALTER TABLE "activity" DROP COLUMN IF EXISTS "assigned_confirmed"');
    });

    it('issues exactly one statement (no residual DDL)', async () => {
      await new DropActivityAssignedConfirmed1791945600000().up(qr as any);
      expect(qr.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('down()', () => {
    it('re-adds the column as boolean NOT NULL DEFAULT false', async () => {
      await new DropActivityAssignedConfirmed1791945600000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "assigned_confirmed"');
      expect(sql).toContain('"assigned_confirmed" boolean NOT NULL DEFAULT false');
    });

    it('backfills from the derived state (assisting AND confirmed_at NOT NULL)', async () => {
      await new DropActivityAssignedConfirmed1791945600000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('UPDATE "activity" SET "assigned_confirmed" = true');
      expect(sql).toContain(`WHERE "status" = 'assisting' AND "confirmed_at" IS NOT NULL`);
    });

    it('adds the column BEFORE backfilling it', async () => {
      await new DropActivityAssignedConfirmed1791945600000().down(qr as any);
      const sql = sqlOf(qr.query);
      const add = sql.findIndex((s) => s.includes('ADD COLUMN IF NOT EXISTS "assigned_confirmed"'));
      const update = sql.findIndex((s) => s.includes('SET "assigned_confirmed" = true'));
      expect(add).toBeGreaterThanOrEqual(0);
      expect(update).toBeGreaterThanOrEqual(0);
      expect(add).toBeLessThan(update);
    });
  });
});
