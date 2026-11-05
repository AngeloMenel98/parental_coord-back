import { AddActivityVerifyAt1793577600000 } from '../migrations/1793577600000-AddActivityVerifyAt';

/**
 * Tests ESTRUCTURALES de la migración AddActivityVerifyAt (wave 3 · T25).
 *
 * Sin Postgres en CI se protege la FORMA: la columna entra con
 * `IF NOT EXISTS`, queda NULLABLE (sin backfill), no toca columnas
 * preexistentes y `down()` la elimina en orden seguro.
 */
describe('1793577600000-AddActivityVerifyAt migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));
  const up = async () => {
    await new AddActivityVerifyAt1793577600000().up(qr as any);
    return sqlOf(qr.query);
  };
  const down = async () => {
    await new AddActivityVerifyAt1793577600000().down(qr as any);
    return sqlOf(qr.query);
  };

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds verify_at idempotently', async () => {
      const sql = await up();

      expect(sql).toContain(
        'ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "verify_at" TIMESTAMP WITH TIME ZONE',
      );
    });

    it('leaves the column nullable: historical rows have no verify window', async () => {
      const sql = await up();
      const column = sql.find((s) => s.includes('verify_at'));

      expect(column).toBeDefined();
      expect(column).not.toContain('NOT NULL');
    });

    it('does not backfill: it would invent a verification moment for old rows', async () => {
      const sql = await up();

      expect(sql.filter((s) => /\bUPDATE\b/i.test(s))).toHaveLength(0);
      expect(sql.filter((s) => /SET NOT NULL/i.test(s))).toHaveLength(0);
    });

    it('never touches a pre-existing column', async () => {
      const sql = await up();

      expect(sql.filter((s) => /DROP COLUMN/i.test(s))).toHaveLength(0);
    });
  });

  describe('down()', () => {
    it('drops the verify_at column guardedly', async () => {
      const sql = await down();

      expect(sql).toContain('ALTER TABLE "activity" DROP COLUMN IF EXISTS "verify_at"');
    });
  });
});
