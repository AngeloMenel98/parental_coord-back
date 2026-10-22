import { AddWebhookTables1792454400000 } from '../migrations/1792454400000-AddWebhookTables';

/**
 * Tests ESTRUCTURALES de la migración AddWebhookTables (design D2, AC-7). Sin
 * Postgres en CI se protege la FORMA y el ORDEN del DDL: las 3 tablas, los
 * estados `varchar(20)` + CHECK (sin enum nativo), el UNIQUE de idempotencia,
 * las FK con CASCADE y los dos índices.
 */
describe('1792454400000-AddWebhookTables migration', () => {
  let qr: { query: jest.Mock };

  const sqlOf = (mock: jest.Mock) => mock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    qr = { query: jest.fn().mockResolvedValue(undefined) };
  });

  describe('up()', () => {
    it('creates webhook_subscription with the exact columns', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "webhook_subscription"');
      expect(sql).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
      expect(sql).toContain('"bond_id" uuid NOT NULL');
      expect(sql).toContain('"created_by" uuid NOT NULL');
      expect(sql).toContain('"url" text NOT NULL');
      expect(sql).toContain('"description" character varying(255)');
      expect(sql).toContain(`"event_types" text[] NOT NULL DEFAULT '{*}'`);
      expect(sql).toContain('"secret_encrypted" text NOT NULL');
      expect(sql).toContain('"secret_prev_encrypted" text');
      expect(sql).toContain('"secret_prev_expires_at" TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain('"status" character varying(20) NOT NULL DEFAULT \'ACTIVE\'');
      expect(sql).toContain('"consecutive_failure_since" TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain('"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
      expect(sql).toContain('"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
      expect(sql).toContain('CONSTRAINT "PK_webhook_subscription_id" PRIMARY KEY ("id")');
    });

    it('creates webhook_delivery with the exact columns, UNIQUE and FK to outbox', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "webhook_delivery"');
      expect(sql).toContain('"event_id" uuid NOT NULL');
      expect(sql).toContain('"subscription_id" uuid NOT NULL');
      expect(sql).toContain('"status" character varying(20) NOT NULL DEFAULT \'PENDING\'');
      expect(sql).toContain('"attempt_count" integer NOT NULL DEFAULT 0');
      expect(sql).toContain('"next_attempt_at" TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain('"last_status_code" integer');
      expect(sql).toContain('"last_error" text');
      expect(sql).toContain('"completed_at" TIMESTAMP WITH TIME ZONE');
      expect(sql).toContain(
        'CONSTRAINT "UQ_webhook_delivery_event_sub" UNIQUE ("event_id", "subscription_id")',
      );
      expect(sql).toContain('CONSTRAINT "FK_webhook_delivery_event"');
      expect(sql).toContain(
        'FOREIGN KEY ("event_id") REFERENCES "outbox_event"("id") ON DELETE CASCADE',
      );
    });

    it('creates webhook_delivery_attempt (snippet ≤1KB) with FK to delivery', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "webhook_delivery_attempt"');
      expect(sql).toContain('"delivery_id" uuid NOT NULL');
      expect(sql).toContain('"attempt_no" integer NOT NULL');
      expect(sql).toContain('"started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
      expect(sql).toContain('"duration_ms" integer');
      expect(sql).toContain('"status_code" integer');
      expect(sql).toContain('"response_snippet" character varying(1024)');
      expect(sql).toContain('"error" text');
      expect(sql).toContain('CONSTRAINT "FK_webhook_delivery_attempt_delivery"');
      expect(sql).toContain(
        'FOREIGN KEY ("delivery_id") REFERENCES "webhook_delivery"("id") ON DELETE CASCADE',
      );
    });

    it('uses varchar+CHECK statuses and NO native enum (design D2)', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).not.toMatch(/CREATE TYPE/i);
      expect(sql).toContain(
        `CONSTRAINT "CHK_webhook_subscription_status" CHECK ("status" IN ('ACTIVE','DISABLED','AUTO_DISABLED'))`,
      );
      expect(sql).toContain(
        `CONSTRAINT "CHK_webhook_delivery_status" CHECK ("status" IN ('PENDING','RETRYING','SUCCEEDED','FAILED','DEAD'))`,
      );
    });

    it('cascades bond deletion through subscription → delivery → attempt', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(
        'CONSTRAINT "FK_webhook_subscription_bond" FOREIGN KEY ("bond_id") REFERENCES "bond"("id") ON DELETE CASCADE',
      );
      expect(sql).toContain(
        'FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE',
      );
      // created_by es RESTRICT (no se borra el rastro del dueño).
      expect(sql).toContain(
        'FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT',
      );
    });

    it('creates the two required indexes', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_webhook_delivery_pending" ON "webhook_delivery" ("status", "next_attempt_at")',
      );
      expect(sql).toContain(
        'CREATE INDEX IF NOT EXISTS "IDX_webhook_subscription_bond" ON "webhook_subscription" ("bond_id", "status")',
      );
    });

    it('is idempotent (IF NOT EXISTS guards)', async () => {
      await new AddWebhookTables1792454400000().up(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    });
  });

  describe('down()', () => {
    it('drops every table and index (IF EXISTS)', async () => {
      await new AddWebhookTables1792454400000().down(qr as any);
      const sql = sqlOf(qr.query).join('\n');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_webhook_delivery_pending"');
      expect(sql).toContain('DROP INDEX IF EXISTS "IDX_webhook_subscription_bond"');
      expect(sql).toContain('DROP TABLE IF EXISTS "webhook_delivery_attempt"');
      expect(sql).toContain('DROP TABLE IF EXISTS "webhook_delivery"');
      expect(sql).toContain('DROP TABLE IF EXISTS "webhook_subscription"');
    });

    it('drops in FK-safe order: attempt → delivery → subscription', async () => {
      await new AddWebhookTables1792454400000().down(qr as any);
      const sql = sqlOf(qr.query);
      const attempt = sql.findIndex((s) =>
        s.includes('DROP TABLE IF EXISTS "webhook_delivery_attempt"'),
      );
      const delivery = sql.findIndex((s) => s.includes('DROP TABLE IF EXISTS "webhook_delivery"'));
      const subscription = sql.findIndex((s) =>
        s.includes('DROP TABLE IF EXISTS "webhook_subscription"'),
      );
      expect(attempt).toBeGreaterThanOrEqual(0);
      expect(delivery).toBeGreaterThan(attempt);
      expect(subscription).toBeGreaterThan(delivery);
    });
  });
});
