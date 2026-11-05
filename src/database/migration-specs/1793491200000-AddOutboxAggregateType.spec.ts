import { AddOutboxAggregateType1793491200000 } from '../migrations/1793491200000-AddOutboxAggregateType';

/**
 * Tests ESTRUCTURALES de la migración AddOutboxAggregateType (wave 2 · T23).
 *
 * Sin Postgres en CI se protege la FORMA: el discriminador entra con DEFAULT
 * `'activity'` (las filas previas y los productores de actividades no necesitan
 * backfill), la FK hacia `activity` desaparece porque el aggregate es
 * polimórfico, el índice de lectura por aggregate existe, y `down()` respeta el
 * orden seguro y borra los eventos de gasto antes de recrear la FK.
 */
describe('1793491200000-AddOutboxAggregateType migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));
  const up = async () => {
    await new AddOutboxAggregateType1793491200000().up(qr as any);
    return sqlOf(qr.query);
  };
  const down = async () => {
    await new AddOutboxAggregateType1793491200000().down(qr as any);
    return sqlOf(qr.query);
  };

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds the discriminator with the activity default, so nothing needs a backfill', async () => {
      const sql = await up();

      const add = sql.find((s) => s.includes('ADD COLUMN IF NOT EXISTS "aggregate_type"'));
      expect(add).toBeDefined();
      expect(add).toContain('character varying(32)');
      expect(add).toContain("NOT NULL DEFAULT 'activity'");
    });

    it('drops the activity FK, because a polymorphic aggregate cannot reference one table', async () => {
      const sql = await up();

      const drop = sql.find((s) => s.includes('DROP CONSTRAINT "FK_outbox_event_activity"'));
      expect(drop).toBeDefined();
      expect(drop).toContain('pg_constraint');
    });

    it('never recreates an activity FK, and never touches the bond FK', async () => {
      const sql = await up();

      expect(sql.some((s) => s.includes('ADD CONSTRAINT "FK_outbox_event_activity"'))).toBe(false);
      expect(sql.some((s) => s.includes('FK_outbox_event_bond'))).toBe(false);
    });

    it('indexes the aggregate lookup, which the stale reminder anti-join needs', async () => {
      const sql = await up();

      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_outbox_aggregate" ON "outbox_event" ("aggregate_type", "aggregate_id")',
      );
    });

    it('does not touch any existing row', async () => {
      const sql = await up();

      expect(sql.some((s) => /^\s*(DELETE|UPDATE)\b/i.test(s))).toBe(false);
    });
  });

  describe('down()', () => {
    it('deletes expense events before recreating the FK, otherwise the rollback cannot run', async () => {
      const sql = await down();

      const deleteAt = sql.findIndex((s) => s.includes('DELETE FROM "outbox_event"'));
      const fkAt = sql.findIndex((s) => s.includes('ADD CONSTRAINT "FK_outbox_event_activity"'));

      expect(deleteAt).toBeGreaterThanOrEqual(0);
      expect(fkAt).toBeGreaterThan(deleteAt);
      expect(sql[deleteAt]).toContain(`"aggregate_type" <> 'activity'`);
    });

    it('restores the original cascade so activity deletion still purges its events', async () => {
      const sql = await down();

      const fk = sql.find((s) => s.includes('ADD CONSTRAINT "FK_outbox_event_activity"'));
      expect(fk).toContain('REFERENCES "activity"("id") ON DELETE CASCADE');
    });

    it('drops the index before the column', async () => {
      const sql = await down();

      const indexAt = sql.findIndex((s) => s.includes('DROP INDEX IF EXISTS "IDX_outbox_aggregate"'));
      const columnAt = sql.findIndex((s) => s.includes('DROP COLUMN IF EXISTS "aggregate_type"'));

      expect(indexAt).toBeGreaterThanOrEqual(0);
      expect(columnAt).toBeGreaterThan(indexAt);
    });
  });
});
