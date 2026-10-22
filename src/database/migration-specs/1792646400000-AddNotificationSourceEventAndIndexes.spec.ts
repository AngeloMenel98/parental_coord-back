import { AddNotificationSourceEventAndIndexes1792646400000 } from '../migrations/1792646400000-AddNotificationSourceEventAndIndexes';

/**
 * Tests ESTRUCTURALES de la migración AddNotificationSourceEventAndIndexes
 * (`notifications-hygiene`, slice 1). Sin Postgres: se mockea el `QueryRunner`
 * y se asserta la FORMA del SQL — idempotencia (`IF NOT EXISTS`), guarda de la
 * FK (`pg_constraint`), predicado parcial del índice único, columnas + `DESC`
 * del índice compuesto, acción `ON DELETE SET NULL` y el orden de reversión
 * FK-safe de `down()`.
 */
describe('1792646400000-AddNotificationSourceEventAndIndexes migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('adds the nullable source_event_id column idempotently (IF NOT EXISTS, uuid)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().up(qr as any);
      const sql = sqlOf(qr.query);
      expect(sql[0]).toContain(
        'ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "source_event_id" uuid',
      );
      // Nullable de verdad: sin NOT NULL (las filas existentes quedan en NULL).
      expect(sql[0]).not.toContain('NOT NULL');
    });

    it('creates the FK with a pg_constraint guard (ON DELETE SET NULL → outbox_event)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().up(qr as any);
      const fk = sqlOf(qr.query).find((s) => s.includes('FK_notification_source_event_id'));
      expect(fk).toBeDefined();
      expect(fk).toContain('DO $$');
      expect(fk).toContain('pg_constraint');
      expect(fk).toContain("conname = 'FK_notification_source_event_id'");
      expect(fk).toContain('IF NOT EXISTS');
      // La guarda ata la FK a SU RELACIÓN: en Postgres los nombres de constraint
      // son únicos POR TABLA, no por esquema ⇒ un `conname` a secas podría dar
      // por existente una FK homónima de otra tabla.
      expect(fk).toMatch(/conrelid\s*=\s*'"?notification"?'::regclass/);
      expect(fk).toContain(
        'FOREIGN KEY ("source_event_id") REFERENCES "outbox_event"("id") ON DELETE SET NULL',
      );
      // CASCADE borraría notificaciones con el reloj de retención del outbox.
      expect(fk).not.toContain('CASCADE');
    });

    it('creates the PARTIAL unique index on (user_id, source_event_id)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().up(qr as any);
      const uq = sqlOf(qr.query).find((s) => s.includes('UQ_notification_user_source_event'));
      expect(uq).toBeDefined();
      expect(uq).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_user_source_event" ON "notification" ("user_id", "source_event_id")',
      );
      // El predicado parcial es explícito: sólo deduplican las filas con origen.
      expect(uq).toContain('WHERE "source_event_id" IS NOT NULL');
    });

    it('creates the partial index that serves the FK (same WHERE predicate)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().up(qr as any);
      const idx = sqlOf(qr.query).find((s) => s.includes('IDX_notification_source_event'));
      expect(idx).toBeDefined();
      expect(idx).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_notification_source_event" ON "notification" ("source_event_id")',
      );
      expect(idx).toContain('WHERE "source_event_id" IS NOT NULL');
    });

    it('creates the composite index matching the read-path order (created_at DESC, id DESC)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().up(qr as any);
      const idx = sqlOf(qr.query).find((s) => s.includes('IDX_notification_user_created'));
      expect(idx).toBeDefined();
      expect(idx).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_notification_user_created" ON "notification" ("user_id", "created_at" DESC, "id" DESC)',
      );
    });

    it('is idempotent: every statement is IF NOT EXISTS / pg_constraint guarded', async () => {
      const migration = new AddNotificationSourceEventAndIndexes1792646400000();
      await migration.up(qr as any);
      const first = sqlOf(qr.query);

      await migration.up(qr as any);
      const all = sqlOf(qr.query);
      const second = all.slice(first.length);

      // La segunda pasada emite exactamente las mismas sentencias.
      expect(second).toEqual(first);
      expect(first).toHaveLength(5);

      // Todas idempotentes: `IF NOT EXISTS` o la guarda `DO $$ ... IF NOT EXISTS`.
      first.forEach((s) => {
        expect(s).toContain('IF NOT EXISTS');
      });
      expect(first[1]).toContain('DO $$');
      expect(first[1]).toContain('pg_constraint');
    });
  });

  describe('down()', () => {
    it('drops composite → source_event → unique → constraint → column (FK-safe order)', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().down(qr as any);
      const sql = sqlOf(qr.query);

      const dropComposite = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "IDX_notification_user_created"'),
      );
      const dropSourceEvent = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "IDX_notification_source_event"'),
      );
      const dropUnique = sql.findIndex((s) =>
        s.includes('DROP INDEX IF EXISTS "UQ_notification_user_source_event"'),
      );
      const dropConstraint = sql.findIndex((s) =>
        s.includes('DROP CONSTRAINT IF EXISTS "FK_notification_source_event_id"'),
      );
      const dropColumn = sql.findIndex((s) =>
        s.includes('DROP COLUMN IF EXISTS "source_event_id"'),
      );

      expect(dropComposite).toBeGreaterThanOrEqual(0);
      expect(dropSourceEvent).toBeGreaterThan(dropComposite);
      expect(dropUnique).toBeGreaterThan(dropSourceEvent);
      expect(dropConstraint).toBeGreaterThan(dropUnique);
      expect(dropColumn).toBeGreaterThan(dropConstraint);
      expect(sql).toHaveLength(5);
    });

    it('drops the FK constraint guardedly (IF EXISTS) before the column', async () => {
      await new AddNotificationSourceEventAndIndexes1792646400000().down(qr as any);
      const sql = sqlOf(qr.query);
      expect(sql.join('\n')).toContain(
        'ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "FK_notification_source_event_id"',
      );
      expect(sql.join('\n')).toContain(
        'ALTER TABLE "notification" DROP COLUMN IF EXISTS "source_event_id"',
      );
    });
  });
});
